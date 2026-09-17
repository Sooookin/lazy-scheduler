# -*- coding: utf-8 -*-
"""PC 의 동기화 엔진: 보낼 목록을 Firestore 에 보내고, 바뀐 것을 받아 온다. 설계: docs/sync.md 5장.

한 번 맞추기 (sync_once)
  1. 처음이면: 서버 것과 이 기기 것을 id 로 맞춘다 (_initial)
  2. 받기:     지난번 받은 자리 뒤로 바뀐 문서를 순서대로 받아 반영한다
  3. 보내기:   보낼 목록을 commit 으로 보낸다. 서버가 받은 것만 목록에서 지운다

언제 맞추나 (run_forever)
  이 기기에서 무언가 바뀌면 곧바로(2초 모아서), 아니면 2분마다.
  인터넷이 끊기면 15초 · 30초 · 1분 … 최대 10분 간격으로 다시 해 본다.

Firestore REST 를 직접 쓴다. 휴대폰은 Firestore SDK 가 이 일을 스스로 한다.
"""
import json
import threading
import time
import traceback
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime

import cloudauth
import paths
import store
import syncdoc

PAGE = 300                      # 한 번에 받는 문서 수
COMMIT_MAX = 450                # 한 commit 에 넣는 변경 수 (Firestore 한도 500)
INTERVAL_S = 120
DEBOUNCE_S = 2
RETRY_S, RETRY_MAX_S = 15, 600
HTTP_TIMEOUT_S = 30


class SyncError(Exception):
    """이번에는 맞추지 못했다 (인터넷 · 서버 문제). 잠시 뒤 다시 한다."""


class Rejected(SyncError):
    """서버가 요청 내용을 거절했다 (규칙 위반 · 형식 오류). 같은 요청을 되풀이해도 안 된다."""


# ---------------- Firestore 값 ⇄ 파이썬 값 ----------------

def encode(v):
    if v is None:
        return {"nullValue": None}
    if isinstance(v, bool):
        return {"booleanValue": v}
    if isinstance(v, int):
        return {"integerValue": str(v)}
    if isinstance(v, float):
        return {"doubleValue": v}
    if isinstance(v, str):
        return {"stringValue": v}
    if isinstance(v, (list, tuple)):
        return {"arrayValue": {"values": [encode(x) for x in v]} if v else {}}
    if isinstance(v, dict):
        return {"mapValue": {"fields": encode_fields(v)} if v else {}}
    raise TypeError("Firestore 에 보낼 수 없는 값: %r" % (v,))


def encode_fields(d):
    return {k: encode(v) for k, v in d.items()}


def decode(v):
    if "nullValue" in v:
        return None
    if "booleanValue" in v:
        return bool(v["booleanValue"])
    if "integerValue" in v:
        return int(v["integerValue"])
    if "doubleValue" in v:
        return float(v["doubleValue"])
    if "stringValue" in v:
        return v["stringValue"]
    if "timestampValue" in v:
        return v["timestampValue"]
    if "arrayValue" in v:
        return [decode(x) for x in v["arrayValue"].get("values", [])]
    if "mapValue" in v:
        return decode_fields(v["mapValue"].get("fields", {}))
    if "referenceValue" in v:
        return v["referenceValue"]
    return None


def decode_fields(fields):
    return {k: decode(v) for k, v in (fields or {}).items()}


def _nest(pairs):
    """{경로: 값} → 중첩 dict. "done_dates.`2026-09-18`": True → {"done_dates": {"2026-09-18": True}}"""
    out = {}
    for path, value in pairs.items():
        parts = syncdoc.split_path(path)
        cur = out
        for p in parts[:-1]:
            cur = cur.setdefault(p, {})
        cur[parts[-1]] = value
    return out


# ---------------- HTTP ----------------

def _base(conf):
    return "https://firestore.googleapis.com/v1/projects/%s/databases/(default)/documents" % conf["project_id"]


def _call(method, url, body=None, _retry=True):
    """Firestore 에 요청한다. 로그인 토큰이 막 끝났으면 한 번 새로 받아 다시 한다."""
    token = cloudauth.id_token()
    data = None if body is None else json.dumps(body).encode("utf-8")
    req = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT_S) as r:
            raw = r.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode("utf-8"))
        except (ValueError, UnicodeDecodeError, OSError):
            detail = {}
        status = (detail.get("error") or {}).get("status", "") if isinstance(detail, dict) else ""
        message = (detail.get("error") or {}).get("message", "") if isinstance(detail, dict) else ""
        if e.code == 401 and _retry:
            cloudauth._cache["until"] = 0.0          # 토큰을 새로 받게 한다
            return _call(method, url, body, _retry=False)
        paths.log("cloudsync: HTTP %s %s %s" % (e.code, status, message[:300]))
        if e.code in (400, 403, 404, 409, 412):
            raise Rejected("%s %s" % (status or e.code, message[:200])) from None
        raise SyncError("서버 응답 오류 (%s)" % (status or e.code)) from None
    except (urllib.error.URLError, OSError, ValueError):
        raise SyncError("인터넷에 연결할 수 없습니다") from None


# ---------------- 보내기 ----------------

def _write_for(op, conf, uid):
    name = "projects/%s/databases/(default)/documents/users/%s/%s" % (conf["project_id"], uid, op["doc"])
    stamp = [{"fieldPath": "updated", "setToServerValue": "REQUEST_TIME"}]
    if op["kind"] == "put":
        return {"update": {"name": name, "fields": encode_fields(op["data"])},
                "updateTransforms": stamp}
    sets, deletes = op.get("set") or {}, op.get("delete") or []
    return {"update": {"name": name, "fields": encode_fields(_nest(sets))},
            "updateMask": {"fieldPaths": list(sets) + list(deletes)},
            "updateTransforms": stamp}


def _commit(writes, conf):
    return _call("POST", _base(conf) + ":commit", {"writes": writes})


def push(conf, uid):
    """보낼 목록을 보낸다. 보낸 수를 돌려준다.

    한 commit 은 전부 되거나 전부 안 된다. 하나가 거절되면 묶음 전체가 거절되므로
    그때는 하나씩 보내 보고, 끝내 거절되는 것만 옆으로 뺀다 (뒤의 변경이 막히지 않게).
    """
    ops = store.outbox_pending()
    sent = 0
    for start in range(0, len(ops), COMMIT_MAX):
        chunk = ops[start:start + COMMIT_MAX]
        try:
            _commit([_write_for(op, conf, uid) for op in chunk], conf)
            store.outbox_remove(op["seq"] for op in chunk)
            sent += len(chunk)
            continue
        except Rejected:
            pass
        for op in chunk:
            try:
                _commit([_write_for(op, conf, uid)], conf)
            except Rejected as e:
                store.outbox_reject(op, str(e))
                continue
            store.outbox_remove([op["seq"]])
            sent += 1
    return sent


# ---------------- 받기 ----------------

def _query(conf, uid, collection, cursor):
    q = {"from": [{"collectionId": collection}],
         "orderBy": [{"field": {"fieldPath": "updated"}, "direction": "ASCENDING"},
                     {"field": {"fieldPath": "__name__"}, "direction": "ASCENDING"}],
         "limit": PAGE}
    if cursor:
        # 같은 시각에 저장된 문서가 여럿이어도(한 commit 은 시각이 같다) 이름으로 이어 받는다.
        # 시각만으로 ">=" 를 쓰면 한 페이지보다 많은 문서가 같은 시각일 때 영원히 같은 페이지를 받는다.
        q["startAt"] = {"values": [{"timestampValue": cursor["ts"]},
                                   {"referenceValue": cursor["name"]}], "before": False}
    rows = _call("POST", "%s/users/%s:runQuery" % (_base(conf), urllib.parse.quote(uid)),
                 {"structuredQuery": q})
    out = []
    for row in rows if isinstance(rows, list) else []:
        doc = row.get("document")
        if doc:
            out.append(doc)
    return out


def pull_all(conf, uid, collection, cursor):
    """cursor 뒤로 바뀐 문서 전부. (문서 목록, 새 cursor)"""
    docs = []
    while True:
        page = _query(conf, uid, collection, cursor)
        for doc in page:
            ts = (doc.get("fields", {}).get("updated") or {}).get("timestampValue")
            if ts:
                cursor = {"ts": ts, "name": doc["name"]}
        docs.extend(page)
        if len(page) < PAGE:
            return docs, cursor


def _as_task(doc):
    tid = doc["name"].rsplit("/", 1)[-1]
    fields = decode_fields(doc.get("fields"))
    updated = fields.pop("updated", None)
    return tid, fields, updated


def _settings_of(meta_docs):
    for doc in meta_docs:
        if doc["name"].endswith("/meta/settings"):
            fields = decode_fields(doc.get("fields"))
            fields.pop("updated", None)
            return fields
    return None


def pull(conf, uid):
    """지난번 뒤로 바뀐 항목 · 설정을 받아 반영한다. 반영해 바뀐 수."""
    st = store.sync_state()
    cursors = st.get("cursor") or {}
    tasks, tc = pull_all(conf, uid, "tasks", cursors.get("tasks"))
    meta, mc = pull_all(conf, uid, "meta", cursors.get("meta"))
    changed = store.apply_remote([_as_task(d) for d in tasks], _settings_of(meta))
    store.sync_update_state(cursor={"tasks": tc, "meta": mc})
    return changed


# ---------------- 처음 맞추기 ----------------

def _initial(conf, uid):
    """처음 로그인한 기기: 서버 것과 이 기기 것을 id 로 합친다. 어느 쪽도 지우지 않는다.

      서버에만 있다  → 받아 온다
      기기에만 있다  → 올린다
      둘 다 있다     → updated 가 더 나중인 쪽
      설정           → 서버에 없으면 이 기기 것을 올리고, 있으면 서버 것을 받는다
    """
    tasks, tc = pull_all(conf, uid, "tasks", None)
    meta, mc = pull_all(conf, uid, "meta", None)
    remote = {tid: (tid, fields, updated) for tid, fields, updated in map(_as_task, tasks)}

    local = {t["id"]: t for t in store.load()["tasks"] if isinstance(t, dict) and t.get("id")}
    uploads, downloads = [], []
    for tid, t in local.items():
        if tid not in remote:
            if not t.get("deleted"):
                uploads.append({"doc": syncdoc.task_doc(tid), "kind": "put", "data": syncdoc.to_remote(t)})
            continue
        mine, theirs = store._parse_utc(t.get("updated")), store._parse_utc(remote[tid][2])
        if mine and theirs and mine > theirs:
            uploads.append({"doc": syncdoc.task_doc(tid), "kind": "put", "data": syncdoc.to_remote(t)})
    for tid, row in remote.items():
        if tid not in local or not any(u["doc"] == syncdoc.task_doc(tid) for u in uploads):
            downloads.append(row)

    settings = _settings_of(meta)
    if settings is None:
        d = store.load()
        shared = {syncdoc.field_path(k): d["settings"][k]
                  for k in syncdoc.SHARED_SETTINGS if k in d["settings"]}
        shared[syncdoc.field_path("holidays")] = list(d.get("holidays") or [])
        uploads.append({"doc": syncdoc.SETTINGS_DOC, "kind": "patch", "set": shared, "delete": []})

    store.outbox_add(uploads)
    store.apply_remote(downloads, settings)
    store.sync_update_state(initialized=True, cursor={"tasks": tc, "meta": mc})
    paths.log("cloudsync: 처음 맞추기 - 올림 %d · 받음 %d" % (len(uploads), len(downloads)))


# ---------------- 한 번 · 계속 ----------------
_run_lock = threading.Lock()
_status = {"last_ok": None, "error": "", "busy": False}
_wake = threading.Event()


def sync_once():
    """한 번 맞춘다. 로그인하지 않았으면 아무것도 하지 않는다."""
    conf = cloudauth.config()
    if conf is None or not store.sync_enabled():
        return False
    with _run_lock:
        uid = store.sync_state().get("uid")
        _status["busy"] = True
        try:
            if not store.sync_state().get("initialized"):
                _initial(conf, uid)
            # 받기 먼저. 다른 기기가 지운 항목을 먼저 알아야, 그 항목에 걸린 이 기기의
            # 고침을 보내지 않는다 (보내면 지운 흔적에 제목이 되살아 붙는다).
            pull(conf, uid)
            push(conf, uid)
        finally:
            _status["busy"] = False
        _status.update(last_ok=datetime.now().strftime("%H:%M"), error="")
        return True


def kick():
    """이 기기에서 무언가 바뀌었다. 곧 맞추게 깨운다."""
    _wake.set()


def run_forever():
    failures, delay = 0, 3.0
    while True:
        woke = _wake.wait(delay)
        _wake.clear()
        if woke:
            time.sleep(DEBOUNCE_S)                # 연달아 누른 것을 한 번에
            _wake.clear()
        try:
            sync_once()
            failures, delay = 0, INTERVAL_S
        except cloudauth.AuthError as e:
            _status["error"] = str(e)
            delay = INTERVAL_S
        except Rejected as e:
            _status["error"] = "서버가 요청을 거절했습니다 (%s)" % e
            delay = INTERVAL_S
        except SyncError as e:
            failures += 1
            _status["error"] = str(e)
            delay = min(RETRY_MAX_S, RETRY_S * 2 ** (failures - 1))
        except Exception:
            paths.log("cloudsync: 맞추기 실패" + chr(10) + traceback.format_exc())
            _status["error"] = "동기화 중 오류가 났습니다. 로그를 확인하세요."
            delay = INTERVAL_S


def start():
    """서비스가 시작할 때 한 번. 이 기기의 변경이 생기면 깨어나게 연결해 둔다."""
    if kick not in store.LISTENERS:
        store.LISTENERS.append(kick)
    threading.Thread(target=run_forever, daemon=True, name="cloudsync").start()


def status():
    return {"last_sync": _status["last_ok"], "sync_error": _status["error"], "syncing": _status["busy"]}

