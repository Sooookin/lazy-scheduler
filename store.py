# -*- coding: utf-8 -*-
"""데이터 저장 + 일정 인스턴스 계산.

파일은 둘로 나눈다.
  data.json   내 일정. 나중에 휴대폰과 동기화할 대상이다.
  state.json  이 PC 에만 해당하는 상태(띄운 알림 기록). 동기화하지 않는다.

동기화를 위해 지키는 약속
  · 항목마다 마지막으로 바뀐 시각(updated, UTC)을 남긴다. 어느 쪽이 최신인지 가리는 기준이다.
  · 지운 항목은 흔적(id · deleted · updated)만 남긴다. 다른 기기에도 지워졌다고 알릴 수 있다.
  · 파일에 형식 버전(version)을 적는다. 형식이 바뀌면 migrate() 에서 한 번만 옮긴다.

저장 안전
  · 쓰기는 임시 파일 → fsync → 바꿔 끼우기. 쓰다가 전원이 나가도 이전 내용이 남는다.
  · 쓰기 전에 직전 파일(.bak)과 하루 한 벌(backups/)을 남긴다.
  · 파일이 깨졌으면 옆으로 치워 두고 백업에서 되살린다. 빈 데이터로 덮어쓰지 않는다.
  · 읽기-고치기-쓰기는 transaction() 안에서 한 번에 한다.
"""
import hashlib
import json
import os
import re
import shutil
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone

import paths
import recur
import syncdoc

paths.migrate_legacy()
DATA = paths.DATA_FILE
STATE = paths.STATE_FILE
LOCK = threading.RLock()

SCHEMA_VERSION = 2
assert syncdoc.SCHEMA == SCHEMA_VERSION, "클라우드 문서의 schema 와 파일 형식 버전이 어긋났다"
BACKUP_KEEP = 14                # 하루 한 벌 백업을 며칠치 남길지
TOMBSTONE_DAYS = 180            # 지운 흔적을 얼마나 남길지 (다른 기기가 따라잡을 시간)
FIRED_KEEP_DAYS = 3             # 띄운 알림 기록 (스케줄러는 어제~내일만 본다)

KINDS = ("routine", "deadline", "floating")
_SETTINGS = {
    "notify_min": 30,
    "brief_time": "08:30",
    "business_only": True,
    "show_weekend": True,          # 달력에 주말 칸을 보여줄지
    "show_routines": True,         # 달력에 반복 업무도 얹을지
    "hold_when_busy": True,        # 발표 · 화면 공유 중에는 알림을 미뤘다가 나중에
}
# 요청으로 바꿀 수 있는 필드. id · created · done_dates 같은 관리 필드는 여기 없다.
_TASK_FIELDS = ("title", "note", "kind", "due_date", "due_time",
                "notify_min", "muted", "pinned", "rule", "tag")
_TIME = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
_DATE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

NOTICE = None                   # 손상 복구처럼 화면에 알려야 할 일


class StoreError(Exception):
    """파일을 읽거나 쓸 수 없다. 이때는 절대 빈 데이터로 덮어쓰지 않는다."""


class ValidationError(ValueError):
    """요청 내용이 잘못됐다. 메시지는 화면에 그대로 보여줄 수 있는 문장이다."""


class NotFoundError(LookupError):
    """그런 항목이 없다 (이미 지웠거나 다른 곳에서 지워졌다)."""


def _now_utc():
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _blank():
    return {"version": SCHEMA_VERSION, "tasks": [], "holidays": [],
            "settings": dict(_SETTINGS)}


# ---------- 파일 ----------

def _replace(tmp, path):
    """바꿔 끼운다. 윈도에서 가끔 실패하므로 몇 번 다시 해 본다.

    백신이나 검색 색인기가 data.json 을 잠깐 열어 보는 사이에 os.replace 를
    부르면 WinError 5(액세스가 거부되었습니다) 가 난다. 파일에는 아무 문제가
    없고 몇십 밀리초 뒤면 된다.

    한 번 실패했다고 "저장하지 못했습니다" 를 띄우면, 사용자는 방금 적은
    것을 잃는다. 자기 잘못도 아니고 다시 해 보면 되는 일로 일정을 잃게 할
    수는 없다. 그래서 간격을 늘려 가며 여섯 번까지 기다려 본다(최대 1.3초).
    """
    delay = 0.02
    for _ in range(6):
        try:
            os.replace(tmp, path)
            return
        except PermissionError:
            time.sleep(delay)
            delay *= 2
    os.replace(tmp, path)          # 여기서도 안 되면 진짜 문제다. 그대로 올린다.


def _digest(raw):
    """파일 내용의 지문 (revision). 내용이 같으면 같고, 한 글자라도 바뀌면 다르다.

    화면은 이 값이 바뀌었을 때만 다시 물어볼 것(달력의 반복 회차)을 다시 묻는다.
    나중에 다른 기기와 맞출 때도 "내가 본 것 이후로 바뀌었나" 를 이것으로 가린다.
    시각(mtime)을 쓰지 않는 이유: 백업에서 되살리거나 파일을 옮기면 내용은 같은데
    시각만 바뀌고, 반대로 같은 초 안의 두 번 저장은 시각이 같을 수 있다.
    """
    return hashlib.sha1(raw).hexdigest()[:16]


EMPTY_REV = "0"                 # 파일이 아직 없을 때


def _write_json(path, obj):
    """임시 파일에 쓰고 디스크에 내린 뒤 한 번에 바꿔 끼운다. 쓴 내용의 지문을 돌려준다.

    fsync 없이 바꿔 끼우면 전원이 나갔을 때 내용이 빈 파일이 남을 수 있다.
    """
    paths.ensure_data_dir()
    tmp = path + ".tmp"
    raw = json.dumps(obj, ensure_ascii=False, indent=2).encode("utf-8")
    try:
        with open(tmp, "wb") as f:
            f.write(raw)
            f.flush()
            os.fsync(f.fileno())
        _replace(tmp, path)
    except OSError as e:
        raise StoreError("저장하지 못했습니다 (%s)" % e) from e
    return _digest(raw)


def _load_raw(path):
    """(내용, 이유, 지문). 파일이 없으면 (None, None, None) · 깨졌으면 (None, 이유, None)."""
    try:
        with open(path, "rb") as f:
            raw = f.read()
    except FileNotFoundError:
        return None, None, None
    except OSError as e:
        # 잠겨 있거나(백신 검사 등) 권한이 없다. 비었다고 보면 다음 저장이 일정을 지운다.
        raise StoreError("일정 파일을 읽을 수 없습니다 (%s)" % e) from e
    try:
        return json.loads(raw.decode("utf-8")), None, _digest(raw)
    except (ValueError, UnicodeDecodeError) as e:
        return None, "%s: %s" % (type(e).__name__, e), None


def _load_json(path):
    """(내용, None) · 파일이 없으면 (None, None) · 깨졌으면 (None, 이유)."""
    obj, bad, _ = _load_raw(path)
    return obj, bad


def _looks_valid(d):
    return isinstance(d, dict) and isinstance(d.get("tasks", []), list)


def _backup_before_write():
    """덮어쓰기 전에 지금 파일을 남긴다: 직전 한 벌(.bak) + 하루 한 벌(backups/).

    백업이 실패해도 저장은 계속한다 (로그만 남긴다).
    """
    if not os.path.exists(DATA):
        return
    try:
        shutil.copyfile(DATA, DATA + ".bak")
        os.makedirs(paths.BACKUP_DIR, exist_ok=True)
        daily = os.path.join(paths.BACKUP_DIR, "data-%s.json" % date.today().isoformat())
        if not os.path.exists(daily):
            shutil.copyfile(DATA, daily)
            olds = sorted(n for n in os.listdir(paths.BACKUP_DIR)
                          if n.startswith("data-") and n.endswith(".json"))
            for n in olds[:-BACKUP_KEEP]:
                os.remove(os.path.join(paths.BACKUP_DIR, n))
    except OSError as e:
        paths.log("백업 실패 (저장은 계속): %s" % e)


def _backups():
    """되살릴 후보. 가까운 것부터."""
    out = [DATA + ".bak"]
    try:
        names = sorted((n for n in os.listdir(paths.BACKUP_DIR)
                        if n.startswith("data-") and n.endswith(".json")), reverse=True)
        out += [os.path.join(paths.BACKUP_DIR, n) for n in names]
    except OSError:
        pass
    return out


def _recover(reason):
    """깨진 파일을 치워 두고 백업에서 되살린다. 쓸 백업이 없으면 빈 데이터."""
    global NOTICE
    kept = "%s.corrupt-%s" % (DATA, datetime.now().strftime("%Y%m%d-%H%M%S"))
    try:
        os.replace(DATA, kept)
    except OSError as e:
        raise StoreError("손상된 일정 파일을 치우지 못했습니다 (%s)" % e) from e
    name = os.path.basename(kept)
    found = None
    for cand in _backups():
        try:
            c, _ = _load_json(cand)
        except StoreError:
            continue
        if _looks_valid(c):
            found = c
            NOTICE = ("일정 파일이 손상되어 백업(%s)에서 되살렸습니다. "
                      "손상된 파일은 %s 로 보관했습니다." % (os.path.basename(cand), name))
            break
    if found is None:
        NOTICE = ("일정 파일이 손상되었고 쓸 만한 백업이 없어 빈 목록으로 시작합니다. "
                  "손상된 파일은 %s 로 보관했습니다." % name)
    paths.log("data.json 손상 (%s). %s" % (reason, NOTICE))
    return found if found is not None else _blank()


def _read():
    """일정과 그 지문(rev)을 읽는다. LOCK 을 잡은 채로 불러야 한다."""
    d, bad, rev = _load_raw(DATA)
    if d is not None and not _looks_valid(d):
        bad = "형식이 올바르지 않음"
    if bad:
        d = migrate(_recover(bad))
        return d, _write_json(DATA, d)       # 되살린 내용을 바로 제자리에
    if d is None:
        return _blank(), EMPTY_REV
    ver = d.get("version") or 1
    if type(ver) is not int or ver > SCHEMA_VERSION:
        # 더 새로운 앱(또는 다른 기기)이 만든 형식이다. 모르는 형식을 고쳐 쓰면 망가뜨린다.
        raise StoreError("이 일정 파일은 더 새로운 버전의 앱에서 만들어졌습니다. 앱을 업데이트하세요.")
    if ver < SCHEMA_VERSION:
        d = migrate(d)
        _backup_before_write()
        return d, _write_json(DATA, d)
    return migrate(d), rev


def migrate(d):
    """예전 형식을 지금 형식으로 맞춘다. 여러 번 불러도 결과가 같다."""
    ver = d.get("version") or 1
    for k, v in _blank().items():
        d.setdefault(k, v)
    if not isinstance(d["settings"], dict):
        d["settings"] = {}
    for k, v in _SETTINGS.items():
        d["settings"].setdefault(k, v)
    if not isinstance(d["holidays"], list):
        d["holidays"] = []
    d["tasks"] = [t for t in d["tasks"] if isinstance(t, dict)]

    if ver < 2:
        # 띄운 알림 기록은 이 PC 에만 해당하므로 state.json 으로 옮긴다
        _absorb_fired(d.get("fired") or [])
        stamp = _now_utc()
        for t in d["tasks"]:
            t.setdefault("id", uuid.uuid4().hex)
            t.setdefault("updated", stamp)
            r = t.get("rule")
            try:
                weekly = (t.get("kind") == "routine" and isinstance(r, dict)
                          and not r.get("anchor") and recur.normalize(r).get("period") == "week")
            except (TypeError, ValueError):
                weekly = False
            if weekly:
                # 기준 주가 없던 격주 규칙은 등록한 주를 기준으로 삼는다
                r["anchor"] = (t.get("created") or "")[:10] or date.today().isoformat()
    d.pop("fired", None)
    d["version"] = SCHEMA_VERSION
    return d


# ---------- 이 PC 의 상태 ----------

def _read_state():
    """없거나 깨졌으면 새로 시작한다 (잃어도 알림 몇 개가 다시 뜨는 정도)."""
    s, bad = _load_json(STATE)
    if bad:
        paths.log("state.json 손상 (%s) - 새로 시작" % bad)
    if not isinstance(s, dict):
        s = {}
    if not isinstance(s.get("fired"), dict):
        s["fired"] = {}
    return s


def _absorb_fired(keys):
    keys = [k for k in keys if isinstance(k, str)]
    if not keys:
        return
    s = _read_state()
    stamp = datetime.now().isoformat(timespec="seconds")
    for k in keys:
        s["fired"].setdefault(k, stamp)
    _write_json(STATE, s)


def mark_fired(key, now=None):
    """이 알림을 처음 띄우는 것이면 기록하고 True, 이미 띄웠으면 False."""
    now = now or datetime.now()
    with LOCK:
        s = _read_state()
        if key in s["fired"]:
            return False
        cutoff = (now - timedelta(days=FIRED_KEEP_DAYS)).isoformat(timespec="seconds")
        s["fired"] = {k: v for k, v in s["fired"].items() if isinstance(v, str) and v >= cutoff}
        s["fired"][key] = now.isoformat(timespec="seconds")
        _write_json(STATE, s)
        return True


def fired_keys():
    with LOCK:
        return set(_read_state()["fired"])


# ---------- 읽기 · 쓰기 ----------

@contextmanager
def transaction(record=True):
    """읽기-고치기-쓰기를 한 번에 한다.

    예전에는 스케줄러가 읽어 둔 옛 내용을 저장하면서, 그 사이 창에서 완료한 것을 지웠다.
    블록 안에서 예외가 나면 쓰지 않는다.

    동기화가 켜져 있으면 무엇이 바뀌었는지 보낼 목록(outbox)에 함께 적는다.
    record=False 는 서버에서 받아 온 것을 반영할 때 쓴다 (받은 것을 되돌려 보내지 않게).
    """
    with LOCK:
        d, _ = _read()
        track = record and sync_enabled()
        before = syncdoc.snapshot(d) if track else None
        yield d
        ops = syncdoc.changes(before, syncdoc.snapshot(d)) if track else []
        _backup_before_write()
        if ops:
            _write_with_outbox(d, ops)
        else:
            _write_json(DATA, d)
        recur.set_holidays(d.get("holidays"))


# ---------- 동기화: 보낼 목록 (docs/sync.md 5장) ----------
#
# 로그인하기 전에는 아무것도 적지 않는다. 처음 로그인할 때는 항목 전체를 id 로
# 맞춰 올리므로, 그 전의 변경을 하나하나 모아 둘 까닭이 없다 (끝없이 쌓이기만 한다).

OUTBOX = paths.SYNC_OUTBOX_FILE
SYNC_STATE = paths.SYNC_STATE_FILE


def sync_state():
    """{"uid": ..., "cursor": ...} · 로그인하지 않았으면 {}."""
    s, _ = _load_json(SYNC_STATE)
    return s if isinstance(s, dict) else {}


def sync_enabled():
    return bool(sync_state().get("uid"))


def sync_enable(uid):
    """로그인했다. 이 뒤의 변경부터 보낼 목록에 적는다."""
    if not isinstance(uid, str) or not uid:
        raise ValidationError("로그인 정보가 올바르지 않습니다")
    with LOCK:
        s = sync_state()
        if s.get("uid") not in (None, uid):
            # 다른 계정의 보낼 목록 · 받은 자리를 이어 쓰면 남의 계정에 섞여 들어간다
            _clear_sync_files()
            s = {}
        s["uid"] = uid
        _write_json(SYNC_STATE, s)
    _notify()                        # 곧바로 처음 맞추기를 시작하게


def sync_disable():
    """로그아웃. 보낼 목록 · 받은 자리를 지운다. 일정(data.json)은 그대로 둔다."""
    with LOCK:
        _clear_sync_files()


def wipe_tasks():
    """이 기기의 일정을 모두 지운다. 되돌릴 수 없다.

    계정 삭제에서 "이 기기의 일정도" 를 고른 경우에만 부른다. 그때는 이미 동기화가
    꺼져 있으므로 보낼 목록에 남지 않는다 - 지운 것이 서버로 되돌아가지 않는다.
    설정과 공휴일은 남긴다 (개인 정보가 아니고, 다시 채우게 하면 성가시기만 하다).
    지우기 직전의 백업은 여느 쓰기와 같이 backups 폴더에 남는다.
    """
    with LOCK:
        d, _ = _read()
        n = len(d.get("tasks") or [])
        d["tasks"] = []
        _backup_before_write()
        _write_json(DATA, d)
    paths.log("store: 이 기기의 일정 %d 건을 지웠다 (계정 삭제)" % n)
    return n


def _clear_sync_files():
    for f in (OUTBOX, SYNC_STATE):
        try:
            os.remove(f)
        except FileNotFoundError:
            pass
        except OSError as e:
            raise StoreError("동기화 기록을 지우지 못했습니다 (%s)" % e) from e


def _read_outbox():
    o, bad = _load_json(OUTBOX)
    if bad:
        # 보낼 목록이 깨졌다. 버리면 변경이 조용히 사라지므로 옆으로 치워 두고 알린다.
        # 처음 로그인할 때처럼 전체를 맞추면 되살아난다 (sync 엔진이 할 일).
        kept = "%s.corrupt-%s" % (OUTBOX, datetime.now().strftime("%Y%m%d-%H%M%S"))
        try:
            os.replace(OUTBOX, kept)
        except OSError:
            pass
        paths.log("sync-outbox.json 손상 (%s) - %s 로 옮기고 새로 시작" % (bad, kept))
        o = None
    if not isinstance(o, dict) or not isinstance(o.get("ops"), list):
        o = {"version": 1, "next_seq": 1, "ops": []}
    return o


def _write_with_outbox(d, ops):
    """보낼 목록에 먼저 적고, 그다음 일정을 쓴다. 일정 쓰기가 실패하면 목록을 되돌린다.

    순서가 반대면: 일정은 저장됐는데 목록에 적기 전에 꺼지면 그 변경은 영영
    다른 기기로 가지 않는다. 이 순서면 최악의 경우에도 "보낸 것과 저장한 것이
    같다" 가 지켜진다.
    """
    box = _read_outbox()
    prev = json.loads(json.dumps(box))
    stamp = _now_utc()
    for op in ops:
        op = dict(op, seq=box["next_seq"], at=stamp)
        box["next_seq"] += 1
        box["ops"].append(op)
    _write_json(OUTBOX, box)
    try:
        _write_json(DATA, d)
    except StoreError:
        _write_json(OUTBOX, prev)
        raise
    _notify()


LISTENERS = []                  # 보낼 변경이 생기면 부른다 (동기화를 깨운다). 오래 걸리면 안 된다


def _notify():
    for fn in list(LISTENERS):
        try:
            fn()
        except Exception:
            paths.log("store listener 실패: %r" % (fn,))


def outbox_pending():
    """아직 서버가 받았다고 하지 않은 변경 (오래된 것부터)."""
    with LOCK:
        return _read_outbox()["ops"]


def outbox_confirm(upto_seq):
    """서버가 받았다: seq 가 upto_seq 이하인 변경을 목록에서 지운다."""
    with LOCK:
        box = _read_outbox()
        left = [op for op in box["ops"] if op.get("seq", 0) > upto_seq]
        if len(left) != len(box["ops"]):
            box["ops"] = left
            _write_json(OUTBOX, box)


def outbox_remove(seqs):
    """서버가 받은 변경만 골라 지운다 (중간 것이 거절돼 남아 있을 때)."""
    seqs = set(seqs)
    with LOCK:
        box = _read_outbox()
        left = [op for op in box["ops"] if op.get("seq") not in seqs]
        if len(left) != len(box["ops"]):
            box["ops"] = left
            _write_json(OUTBOX, box)


REJECTED_KEEP = 50


def outbox_reject(op, reason):
    """서버가 끝내 받지 않는 변경을 목록에서 빼 옆에 남긴다.

    남겨 두면 뒤의 변경까지 영원히 막힌다. 버리지는 않는다 - 무엇이 왜
    거절됐는지 나중에 확인할 수 있게 rejected 에 이유와 함께 둔다.
    """
    with LOCK:
        box = _read_outbox()
        box["ops"] = [o for o in box["ops"] if o.get("seq") != op.get("seq")]
        box.setdefault("rejected", []).append(dict(op, reason=reason, rejected_at=_now_utc()))
        box["rejected"] = box["rejected"][-REJECTED_KEEP:]
        _write_json(OUTBOX, box)
    paths.log("sync: 서버가 거절한 변경 seq=%s %s (%s)" % (op.get("seq"), op.get("doc"), reason))


def outbox_add(ops):
    """직접 만든 변경을 보낼 목록에 붙인다 (처음 동기화할 때 이 기기 것을 올리기)."""
    if not ops:
        return
    with LOCK:
        box = _read_outbox()
        stamp = _now_utc()
        for op in ops:
            box["ops"].append(dict(op, seq=box["next_seq"], at=stamp))
            box["next_seq"] += 1
        _write_json(OUTBOX, box)
    _notify()


def sync_update_state(**fields):
    """동기화 진행 기록(받은 자리 · 처음 맞추기 여부)을 고친다. 로그인 중일 때만."""
    with LOCK:
        s = sync_state()
        if not s.get("uid"):
            return
        s.update(fields)
        _write_json(SYNC_STATE, s)


def _parse_utc(text):
    try:
        t = datetime.fromisoformat(str(text).replace("Z", "+00:00"))
    except ValueError:
        return None
    return t if t.tzinfo else t.replace(tzinfo=timezone.utc)


def apply_remote(docs, settings=None):
    """서버에서 받아 온 항목 · 설정을 반영한다. 반영해서 바뀐 수를 돌려준다.

    docs: [(항목 id, 클라우드 문서(dict), 서버 updated(ISO 문자열))]
    settings: 클라우드의 meta/settings 문서 (없으면 None)

      · 아직 보내지 않은 이 기기의 변경은 지킨다 (syncdoc.merge_task)
      · 지운 흔적은 늘 이긴다. 그 항목에 걸린 이 기기의 고침은 보낼 목록에서 뺀다
        (보내 봐야 서버가 제목 없는 반쪽 항목을 되살리거나 거절한다)
      · 더 새로운 앱이 만든 문서(schema 가 크다)는 건드리지 않는다
      · 바뀐 것이 없으면 파일을 쓰지 않는다 - 자기가 보낸 것이 되돌아와도 조용하다
    """
    with LOCK:
        d, _ = _read()
        box = _read_outbox()
        ops = box["ops"]
        index = {t.get("id"): n for n, t in enumerate(d["tasks"]) if isinstance(t, dict)}
        changed, drop = 0, set()
        for tid, doc, updated in docs:
            if not isinstance(tid, str) or not tid or not isinstance(doc, dict):
                continue
            schema = doc.get("schema")
            if isinstance(schema, int) and schema > SCHEMA_VERSION:
                paths.log("sync: 더 새로운 형식(schema %s)의 항목 %s 는 반영하지 않는다" % (schema, tid))
                continue
            incoming = syncdoc.from_remote(tid, doc, updated)
            local = d["tasks"][index[tid]] if tid in index else None
            where = syncdoc.task_doc(tid)
            if incoming.get("deleted"):
                merged = incoming
                if any(op.get("doc") == where and op.get("kind") == "patch" for op in ops):
                    drop.add(where)
            else:
                merged = syncdoc.merge_task(local, incoming, syncdoc.pending_paths(ops, where))
            if local is not None and syncdoc._same(local, merged):
                continue
            if local is None:
                if merged.get("deleted"):
                    # 이 기기가 한 번도 본 적 없는 항목의 흔적. 들여올 까닭이 없다.
                    continue
                d["tasks"].append(merged)
                index[tid] = len(d["tasks"]) - 1
            else:
                d["tasks"][index[tid]] = merged
            changed += 1

        if isinstance(settings, dict):
            pend = syncdoc.pending_paths(ops, syncdoc.SETTINGS_DOC)
            for k in syncdoc.SHARED_SETTINGS:
                if k in settings and k not in pend:
                    try:
                        _check_setting(k, settings[k])
                    except ValidationError:
                        continue
                    if d["settings"].get(k) != settings[k]:
                        d["settings"][k] = settings[k]
                        changed += 1
            hol = settings.get("holidays")
            if ("holidays" not in pend and isinstance(hol, list)
                    and all(isinstance(x, str) for x in hol) and d.get("holidays") != hol):
                d["holidays"] = list(hol)
                changed += 1

        if drop:
            box["ops"] = [op for op in ops if not (op.get("doc") in drop and op.get("kind") == "patch")]
            _write_json(OUTBOX, box)
        if changed:
            _backup_before_write()
            _write_json(DATA, d)
            recur.set_holidays(d.get("holidays"))
        return changed


def snapshot():
    """(일정, rev). 둘이 같은 순간의 것이다 - 따로 읽으면 그 사이 저장이 끼어든다."""
    with LOCK:
        d, rev = _read()
    recur.set_holidays(d.get("holidays"))
    return d, rev


def load():
    return snapshot()[0]


def tasks():
    return [t for t in load()["tasks"] if not t.get("deleted")]


# ---------- 요청 확인 ----------

def _clean_text(v, limit, label):
    if v is None:
        return ""
    if not isinstance(v, str):
        raise ValidationError("%s 형식이 올바르지 않습니다" % label)
    v = v.strip()
    if len(v) > limit:
        raise ValidationError("%s: 최대 %d자까지 쓸 수 있습니다" % (label, limit))
    return v


def _clean_day(v):
    if v in (None, ""):
        return None
    if not isinstance(v, str) or not _DATE.match(v):
        raise ValidationError("날짜 형식이 올바르지 않습니다")
    try:
        date.fromisoformat(v)
    except ValueError:
        raise ValidationError("없는 날짜입니다") from None
    return v


def _check_setting(k, v):
    """설정 한 개가 올바른지. 모르는 항목이면 False, 잘못된 값이면 ValidationError."""
    if k == "notify_min":
        if not (type(v) is int and 0 <= v <= 1440):
            raise ValidationError("기본 알림은 0~1440분 전 사이의 정수여야 합니다")
    elif k == "brief_time":
        if not (isinstance(v, str) and (v == "" or _TIME.match(v))):
            raise ValidationError("브리핑 시각은 00:00~23:59 형식이어야 합니다")
    elif k in ("business_only", "show_weekend", "show_routines", "hold_when_busy"):
        if not isinstance(v, bool):
            raise ValidationError("요청 형식이 올바르지 않습니다")
    else:
        return False
    return True


def clean_task(patch, base=None):
    """요청으로 받은 항목을 확인하고 저장 형식으로 맞춘다.

    base 가 있으면(수정) 기존 항목에 patch 를 덮은 결과 전체를 확인한다.
    관리 필드와 모르는 필드는 요청에서 받지 않는다.
    """
    if not isinstance(patch, dict):
        raise ValidationError("요청 형식이 올바르지 않습니다")
    t = dict(base or {})
    for k in _TASK_FIELDS:
        if k in patch:
            t[k] = patch[k]

    t["title"] = _clean_text(t.get("title"), 200, "이름")
    if not t["title"]:
        raise ValidationError("이름을 입력하세요")
    t["note"] = _clean_text(t.get("note"), 2000, "메모")
    t["tag"] = _clean_text(t.get("tag"), 50, "태그")

    kind = t.get("kind") or "deadline"
    if kind not in KINDS:
        raise ValidationError("항목 종류가 올바르지 않습니다")
    t["kind"] = kind

    tm = t.get("due_time") or ""
    if not isinstance(tm, str) or (tm and not _TIME.match(tm)):
        raise ValidationError("시각은 00:00~23:59 형식이어야 합니다")
    nm = t.get("notify_min")
    if nm is not None and not (type(nm) is int and 0 <= nm <= 10080):
        raise ValidationError("알림은 0~10080분 전 사이의 정수여야 합니다")
    for b in ("muted", "pinned"):
        v = t.get(b)
        if v is None:
            v = False
        if not isinstance(v, bool):
            raise ValidationError("요청 형식이 올바르지 않습니다")
        t[b] = v

    if kind == "routine":
        try:
            t["rule"] = recur.validate_rule(t.get("rule"))
        except recur.RuleError as e:
            raise ValidationError(str(e)) from None
        t.update(due_date=None, due_time=tm, notify_min=nm)
    elif kind == "deadline":
        t.update(rule=None, due_date=_clean_day(t.get("due_date")), due_time=tm, notify_min=nm)
    else:
        t.update(rule=None, due_date=None, due_time="", notify_min=None, muted=False)
    return t


# ---------- 항목 ----------

def _find(d, tid):
    if isinstance(tid, str) and tid:
        for t in d["tasks"]:
            if t.get("id") == tid and not t.get("deleted"):
                return t
    raise NotFoundError("항목을 찾을 수 없습니다. 이미 삭제되었을 수 있습니다.")


def add(patch):
    t = clean_task(patch)
    created = datetime.now().isoformat(timespec="seconds")
    t.update(id=uuid.uuid4().hex, created=created, updated=_now_utc(),
             done=False, done_at=None, done_dates=[], skip_dates=[])
    r = t.get("rule")
    if r and r["period"] == "week":
        # 격주 이상은 기준 주가 고정돼야 한다. 등록한 날을 기준으로 박아둔다.
        # (예전에는 옛 형식 kind == "weekly" 만 확인해서 새 규칙에는 기준이 없었다)
        r.setdefault("anchor", created[:10])
    with transaction() as d:
        d["tasks"].append(t)
    return t


def update(tid, patch):
    with transaction() as d:
        t = _find(d, tid)
        new = clean_task(patch, base=t)
        r = new.get("rule")
        if r and r["period"] == "week" and not r.get("anchor"):
            try:
                old = recur.normalize(t["rule"]) if isinstance(t.get("rule"), dict) else {}
            except (TypeError, ValueError):
                old = {}
            r["anchor"] = (old.get("anchor") or (t.get("created") or "")[:10]
                           or date.today().isoformat())
        new["updated"] = _now_utc()
        t.clear()
        t.update(new)
        return dict(t)


def remove(tid):
    """지운다. 다른 기기에 '지워졌다' 를 전할 수 있게 흔적만 남기고 내용은 없앤다."""
    with transaction() as d:
        t = _find(d, tid)
        keep = t["id"]
        t.clear()
        t.update(id=keep, deleted=True, updated=_now_utc())
        cutoff = (datetime.now(timezone.utc)
                  - timedelta(days=TOMBSTONE_DAYS)).isoformat(timespec="seconds")
        d["tasks"] = [x for x in d["tasks"]
                      if not (x.get("deleted") and (x.get("updated") or "") < cutoff)]


def set_done(tid, day=None, done=True):
    """완료 상태를 그 값으로 정한다 (뒤집지 않는다).

    예전 toggle 은 창에서 완료한 뒤 알림 카드의 [완료] 를 누르면 도로 미완료가 됐다.
    반복 일정은 그 날짜 회차만, 나머지는 항목 자체를 완료 처리한다.
    """
    if not isinstance(done, bool):
        raise ValidationError("요청 형식이 올바르지 않습니다")
    day = _clean_day(day)
    with transaction() as d:
        t = _find(d, tid)
        if t.get("kind") == "routine":
            dd = set(t.get("done_dates") or [])
            (dd.add if done else dd.discard)(day or date.today().isoformat())
            t["done_dates"] = sorted(dd)
        elif bool(t.get("done")) != done:
            t["done"] = done
            t["done_at"] = datetime.now().isoformat(timespec="seconds") if done else None
        t["updated"] = _now_utc()
        return dict(t)


def _set_skip(tid, day, skipped):
    day = _clean_day(day) or date.today().isoformat()
    with transaction() as d:
        t = _find(d, tid)
        if t.get("kind") != "routine":
            raise ValidationError("반복 일정만 회차를 건너뛸 수 있습니다")
        sk = set(t.get("skip_dates") or [])
        (sk.add if skipped else sk.discard)(day)
        t["skip_dates"] = sorted(sk)
        t["updated"] = _now_utc()
        return dict(t)


def skip(tid, day=None):
    """반복 일정의 그 회차만 건너뛴다."""
    return _set_skip(tid, day, True)


def unskip(tid, day=None):
    """건너뛴 회차를 되돌린다."""
    return _set_skip(tid, day, False)


# ---------- 설정 ----------

def update_settings(patch):
    """설정을 확인하고 저장한다. 모르는 항목은 저장하지 않는다.

    예전에는 받은 값을 그대로 넣어서, notify_min 에 글자가 들어가면
    스케줄러가 20초마다 터지며 알림이 전부 멈췄다.
    """
    if not isinstance(patch, dict):
        raise ValidationError("요청 형식이 올바르지 않습니다")
    clean = {k: v for k, v in patch.items() if _check_setting(k, v)}
    with transaction() as d:
        d["settings"].update(clean)
        return dict(d["settings"])


def settings(data=None):
    """저장된 설정. 파일에 이상한 값이 있어도 그 항목만 기본값으로 버틴다."""
    raw = (data if data is not None else load()).get("settings") or {}
    out = dict(_SETTINGS)
    for k in _SETTINGS:
        if k in raw:
            try:
                _check_setting(k, raw[k])
                out[k] = raw[k]
            except ValidationError:
                pass
    return out


# ---------- 인스턴스 계산 ----------

_bad_logged = set()


def _dt(day, hhmm):
    h, m = (hhmm or "23:59").split(":")
    return datetime.combine(day, datetime.min.time()).replace(hour=int(h), minute=int(m))


def instances(back=14, ahead=45, data=None, today=None):
    """화면/알림이 공통으로 쓰는 평면화된 일정 목록 (오늘 기준 앞뒤 며칠)."""
    today = today or date.today()
    return between(today - timedelta(days=back), today + timedelta(days=ahead), data=data)


def between(lo, hi, data=None, kinds=None):
    """[lo, hi] 기간의 평면화된 일정 목록. kinds 를 주면 그 종류만 펼친다.

    항목 하나가 잘못돼 있어도(손으로 고친 파일, 예전 형식) 그 항목만 빼고 계속한다.
    예전에는 한 항목 때문에 화면이 통째로 비고 알림도 전부 멈췄다.
    """
    d = data if data is not None else load()
    out = []
    for t in d["tasks"]:
        if t.get("archived") or t.get("deleted"):
            continue
        if kinds is not None and t.get("kind", "deadline") not in kinds:
            continue                         # 펼치기 전에 거른다 (반복은 펼치는 값이 크다)
        try:
            out.extend(_expand(t, lo, hi))
        except Exception as e:
            key = (t.get("id"), repr(e))
            if key not in _bad_logged:
                _bad_logged.add(key)
                paths.log("항목을 계산하지 못해 건너뜀 (%s): %s: %s"
                          % (t.get("id"), type(e).__name__, e))
    return out


def occurrences(lo, hi, kinds=None):
    """기간 안의 회차를 가볍게: {rev, from, to, items: [{id, date, time, done}]}.

    항목 내용(제목 · 메모 · 규칙)은 싣지 않는다. 받는 쪽은 overview 의 항목과
    id 로 잇는다. 반복 20개를 한 달 펼치면 회차가 350개쯤 되는데, 예전에는
    회차마다 제목 · 메모 · 규칙을 통째로 실어 140KB 가 넘었다.
    rev 는 이 목록을 만든 일정 파일의 지문이다. 같은 rev 면 다시 물을 필요가 없다.
    """
    d, rev = snapshot()
    items = [{"id": i["id"], "date": i["date"], "time": i["time"], "done": i["done"]}
             for i in between(lo, hi, data=d, kinds=kinds) if i["date"]]
    return {"rev": rev, "from": lo.isoformat(), "to": hi.isoformat(), "items": items}


# 화면에 내보내는 항목 필드 - 받는 쪽(창 화면 · 나중의 휴대폰 화면)과의 약속이다.
# 저장 형식과 일부러 떼어 둔다. done_dates · skip_dates 는 날마다 늘어나는데
# 화면은 읽지 않는다 (회차의 완료 여부는 overview · occurrences 가 이미 계산해 준다).
# 동기화는 이 목록이 아니라 저장 형식 전체를 주고받는다.
PUBLIC_TASK_FIELDS = ("id", "title", "note", "kind", "tag", "due_date", "due_time",
                      "notify_min", "muted", "pinned", "done", "rule")


def public_task(t):
    return {k: t[k] for k in PUBLIC_TASK_FIELDS if k in t}


def _rule_of(t):
    """정규화한 규칙과 설명 문구. 날짜가 아니라 항목에만 달린 값이다.

    예전에는 _inst 안에서 회차마다 다시 구했다. "매 영업일" 반복 하나가 85일
    구간에서 60회차로 펼쳐지면 똑같은 문구를 60번 지어냈고, describe 안에서
    normalize 가 또 불려 정규화가 회차마다 두 번씩 일어났다. 항목당 한 번이면 된다.
    """
    if t.get("kind") != "routine":
        return None, ""
    r = t.get("rule")
    return (recur.normalize(r) if r else None), recur.describe(r)


def _expand(t, lo, hi):
    kind = t.get("kind", "deadline")
    pre = _rule_of(t)
    if kind == "floating":
        return [_inst(t, None, pre)]
    if kind == "routine":
        # 등록 이전 날짜는 밀린 일로 잡지 않는다
        born = (t.get("created") or "")[:10]
        start = max(lo, date.fromisoformat(born)) if born else lo
        skips = set(t.get("skip_dates") or [])
        # 완료한 날짜 목록은 쓰는 동안 계속 늘어난다 (매 영업일 반복이면 한 해에 250개).
        # 회차마다 목록을 처음부터 훑지 않게 한 번만 집합으로 만든다.
        done = set(t.get("done_dates") or [])
        return [_inst(t, day, pre, done) for day in recur.occurrences(t.get("rule") or {}, start, hi)
                if day.isoformat() not in skips]
    if not t.get("due_date"):
        return [_inst(t, None, pre)]
    return [_inst(t, date.fromisoformat(t["due_date"]), pre)]


def _inst(t, day, pre=None, done_dates=None):
    routine = t.get("kind") == "routine"
    iso = day.isoformat() if day else None          # 한 번만 짓는다
    if routine and day:
        done = iso in (done_dates if done_dates is not None else (t.get("done_dates") or []))
    else:
        done = bool(t.get("done"))
    due_dt = _dt(day, t.get("due_time")) if day else None
    rule_n, rule_text = pre if pre is not None else _rule_of(t)
    return {
        "id": t["id"],
        "title": t.get("title", ""),
        "note": t.get("note", ""),
        "kind": t.get("kind", "deadline"),
        "tag": t.get("tag", ""),
        "pinned": bool(t.get("pinned")),
        "date": iso,
        "time": t.get("due_time") or "",
        "due": due_dt.isoformat(timespec="minutes") if due_dt else None,
        # raw rule 은 싣지 않는다. 수정 창은 rule_n(정규화한 것)을 읽고,
        # 반복 하나가 달력 구간에서 40회차로 펼쳐지면 같은 규칙이 40번 실린다.
        "rule_n": rule_n,
        "period": rule_n.get("period") if rule_n else None,
        "rule_text": rule_text,
        "muted": bool(t.get("muted")),
        "notify_min": t.get("notify_min", None),
        "done": done,
    }


def overview(data=None, now=None):
    """한 화면 개요. 마감 있는 일을 앞세우고, 반복 업무는 따로 묶는다.

    data 를 주지 않으면 파일을 읽고, 그 내용의 지문(rev)도 함께 싣는다.
    """
    rev = None
    if data is None:
        d, rev = snapshot()
    else:
        d = data
    now = now or datetime.now()
    today = now.date()
    ti = today.isoformat()
    ins = instances(back=10, ahead=75, data=d, today=today)
    live = [t for t in d["tasks"] if not t.get("archived") and not t.get("deleted")]

    # 마감 우선 → 날짜 → 시각
    def key(i):
        return (i["kind"] != "deadline", i["date"] or "9999", i["time"] or "99:99")

    # ── 밀린 것 ─────────────────────────────────────────────
    past = [i for i in ins if i["date"] and i["date"] < ti and not i["done"]]
    overdue = [i for i in past if i["kind"] == "deadline"]
    # 반복 업무는 "가장 최근에 놓친 1건"만, 최근 7일 안쪽만.
    # 매 영업일 반복은 지난 회차를 따라갈 의미가 없어 제외한다.
    limit = (today - timedelta(days=7)).isoformat()
    seen = set()
    for i in sorted([x for x in past if x["kind"] == "routine"],
                    key=lambda x: x["date"], reverse=True):
        if i["period"] == "day" or i["id"] in seen or i["date"] < limit:
            continue
        seen.add(i["id"])
        overdue.append(i)
    overdue.sort(key=key)

    # ── 오늘 ────────────────────────────────────────────────
    todays = sorted([i for i in ins if i["date"] == ti], key=lambda i: (i["done"],) + key(i))

    # ── 다가오는 마감 (반복 제외) ────────────────────────────
    wk = (today + timedelta(days=7)).isoformat()
    upcoming = sorted([i for i in ins if i["kind"] == "deadline" and i["date"]
                       and ti < i["date"] <= wk and not i["done"]], key=key)

    # ── 반복 업무: 항목당 "다음 예정일" 한 줄 ────────────────
    nxt = {}
    for i in ins:
        if i["kind"] != "routine" or not i["date"] or i["date"] < ti:
            continue
        cur = nxt.get(i["id"])
        if cur is None or i["date"] < cur["date"]:
            nxt[i["id"]] = i
    routines = []
    for t in live:
        if t.get("kind") != "routine":
            continue
        row = nxt.get(t["id"])
        if row is None:
            try:
                row = _inst(t, None)
            except Exception:
                continue                     # instances() 가 이미 로그를 남겼다
        routines.append(dict(row, next_date=row.get("date")))
    routines.sort(key=lambda r: (r["next_date"] or "9999", r["time"] or "99:99"))

    floating = [i for i in ins if i["kind"] == "floating" and not i["done"]]
    floating.sort(key=lambda i: (not i["pinned"],))
    donetoday = [i for i in todays if i["done"]]

    return {
        "today": ti,
        "now": now.strftime("%H:%M"),
        "is_business_day": recur.is_business_day(today),
        "holidays": sorted(recur.HOLIDAYS),
        "holiday_names": recur.HOLIDAY_NAMES,
        "overdue": overdue,
        "todays": todays,
        "upcoming": upcoming,
        "routines": routines,
        "floating": floating,
        "stats": {
            "left": len([i for i in todays if not i["done"]]) + len(overdue),
            "done": len(donetoday),
            "total": len(todays),
        },
        "tasks": [public_task(t) for t in live],
        "settings": settings(d),
        "notice": NOTICE,
        "rev": rev,
    }
