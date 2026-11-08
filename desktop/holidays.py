"""공휴일 표 받기. 영업일 셈의 바탕(core/recur.py 의 표)은 손으로 적은 것이라 끝이 있고 임시공휴일을 모른다.

GitHub Actions(holidays.yml)가 매주 특일 정보를 받아 docs/holidays.json + .sha256 으로 올린다. 여기서는
하루 한 번쯤 그 둘을 받아 해시를 맞춰 보고, 꼴이 맞을 때만 쓴다:
  - 이름 → recur.set_holiday_names (달력에 보이는 말)
  - 날짜 → data.json 의 holidays (이미 있는 '더한 휴일' 자리 - 동기화로 휴대폰도 같은 날을 쉰다).
    기본 표에 이미 있는 날은 넣지 않는다. 받은 표에서 빠진 날은 우리가 넣었던 것만 거둔다.
받은 것은 이 PC 의 holidays.json 에 두어, 다음에 켤 때 받기 전에도 이름이 보인다. 못 받으면 그대로 둔다.
"""
import hashlib
import json
import os
import threading
import time
import traceback
import urllib.request
from datetime import date, datetime

from core import recur, store
from desktop import paths
import version

URL = "https://raw.githubusercontent.com/Sooookin/lazy-scheduler/main/docs/holidays.json"
CACHE = os.path.join(paths.DATA_DIR, "holidays.json")
EVERY_S = 20 * 3600         # 이만큼 지났으면 다시 받는다
MAX_DAYS = 300              # 이보다 많으면 받은 것이 잘못됐다
TIMEOUT_S = 20


def log(msg):
    paths.log("[공휴일] " + msg)


def parse(doc, today=None):
    """받은 표 → {YYYY-MM-DD: 이름}. 꼴이 어긋나면 ValueError (그때는 아무것도 바꾸지 않는다)."""
    today = today or date.today()
    if not isinstance(doc, dict) or doc.get("v") != 1 or not isinstance(doc.get("days"), dict):
        raise ValueError("꼴이 다르다")
    days = doc["days"]
    if not days or len(days) > MAX_DAYS:
        raise ValueError("날 수가 이상하다: %d" % len(days))
    out = {}
    for k, v in days.items():
        d = date.fromisoformat(k)               # 깨진 날짜면 ValueError
        if k != d.isoformat() or not today.year - 1 <= d.year <= today.year + 5:
            raise ValueError("범위 밖의 날: %s" % k)
        if not isinstance(v, str) or not 0 < len(v.strip()) <= 20:
            raise ValueError("이름이 이상하다: %r" % (v,))
        out[k] = v.strip()
    return out


def _get(url):
    req = urllib.request.Request(url, headers={"User-Agent": "LazyScheduler/%s" % version.VERSION,
                                               "Cache-Control": "no-cache"})
    with urllib.request.urlopen(req, timeout=TIMEOUT_S) as r:
        return r.read()


def fetch():
    body = _get(URL)
    want = _get(URL + ".sha256").decode("ascii", "replace").split()[0].strip().lower()
    if hashlib.sha256(body).hexdigest() != want:
        raise ValueError("해시가 맞지 않는다")
    return parse(json.loads(body.decode("utf-8")))


def _load_cache():
    try:
        with open(CACHE, encoding="utf-8") as f:
            c = json.load(f)
        return c if isinstance(c, dict) else {}
    except (OSError, ValueError):
        return {}


def apply(days, now=None):
    """받은 표를 쓴다. 돌려주는 값: data.json 의 holidays 를 바꿨는지."""
    now = now or datetime.now()
    recur.set_holiday_names(days)
    cache = _load_cache()
    ours = {x for x in cache.get("added") or [] if isinstance(x, str)}
    cur = {x for x in store.load().get("holidays") or [] if isinstance(x, str)}
    add = {x for x in days if x not in recur.DEFAULT_HOLIDAYS and x not in cur}
    drop = {x for x in ours if x not in days and x in cur}
    if add or drop:
        with store.transaction() as d:
            have = {x for x in d.get("holidays") or [] if isinstance(x, str)}
            d["holidays"] = sorted((have | add) - drop)
        log("더함 %s · 거둠 %s" % (sorted(add), sorted(drop)))
    store_cache = {"days": days, "got": now.date().isoformat(), "at": time.time(),
                   "added": sorted((ours | add) - drop)}
    tmp = CACHE + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(store_cache, f, ensure_ascii=False)
    os.replace(tmp, CACHE)
    return bool(add or drop)


def status():
    """설정 화면의 한 줄: 영업일 셈이 아는 마지막 해와 마지막으로 받은 날."""
    years = [int(x[:4]) for x in recur.HOLIDAYS if x[:4].isdigit()]
    return {"until": max(years) if years else None, "got": _load_cache().get("got")}


def check_once():
    try:
        apply(fetch())
    except Exception as e:
        log("받지 못함: %s" % e)


def start():
    """서비스가 켤 때 부른다. 받아 둔 이름을 먼저 세우고, 20시간마다 한 번 받는다."""
    c = _load_cache()
    if isinstance(c.get("days"), dict):
        recur.set_holiday_names(c["days"])

    def loop():
        time.sleep(120)
        while True:
            try:
                if time.time() - float(_load_cache().get("at") or 0) >= EVERY_S:
                    check_once()
            except Exception:
                log("고리 오류: " + traceback.format_exc())
            time.sleep(3600)

    threading.Thread(target=loop, daemon=True, name="holidays").start()
