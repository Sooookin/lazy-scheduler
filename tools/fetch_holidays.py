"""공휴일 표를 받아 docs/holidays.json (+ .sha256) 으로 쓴다. GitHub Actions(holidays.yml)가 매주 돌린다.

출처: 한국천문연구원 특일 정보 (공공데이터포털 SpcdeInfoService/getRestDeInfo). 키는 저장소 비밀값
HOLIDAY_API_KEY 에만 있다 - 앱은 이 파일만 받으므로(desktop/holidays.py) 키가 앱에 실리지 않는다.

    HOLIDAY_API_KEY=... python tools/fetch_holidays.py [--years 3]

표가 바뀌지 않았으면 파일을 건드리지 않는다 (커밋이 생기지 않게). 올해 것이 하나도 오지 않으면
API 고장으로 보고 아무것도 쓰지 않고 실패한다.
"""
import hashlib
import json
import os
import sys
import urllib.parse
import urllib.request
from datetime import date

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(ROOT, "docs", "holidays.json")
API = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo"


def items_of(payload):
    """응답 JSON 에서 쉬는 날 {YYYY-MM-DD: 이름}. 하나뿐이면 item 이 목록이 아니라 dict, 없으면 빈 문자열이다."""
    body = ((payload or {}).get("response") or {}).get("body") or {}
    items = body.get("items") or {}
    it = items.get("item") if isinstance(items, dict) else None
    if isinstance(it, dict):
        it = [it]
    out = {}
    for x in it or []:
        if not isinstance(x, dict) or x.get("isHoliday") != "Y":
            continue
        s = str(x.get("locdate") or "")
        if len(s) != 8 or not s.isdigit():
            continue
        day = "%s-%s-%s" % (s[:4], s[4:6], s[6:])
        date.fromisoformat(day)
        out[day] = str(x.get("dateName") or "공휴일").strip()[:20]
    return out


def fetch_year(year, key):
    q = urllib.parse.urlencode({"solYear": year, "numOfRows": 100, "_type": "json"})
    # serviceKey 는 포털이 준 값(이미 인코딩된 것)을 그대로 붙인다 - 다시 인코딩하면 거절된다
    with urllib.request.urlopen(API + "?serviceKey=" + key + "&" + q, timeout=30) as r:
        return items_of(json.loads(r.read().decode("utf-8")))


def build(days, today=None):
    today = today or date.today()
    years = sorted({int(d[:4]) for d in days})
    return {"v": 1, "until": years[-1] if years else today.year, "days": dict(sorted(days.items()))}


def write(doc, path=OUT):
    """바뀌었을 때만 쓴다. 돌려주는 값: 썼는지."""
    body = (json.dumps(doc, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8")
    try:
        with open(path, "rb") as f:
            if f.read() == body:
                return False
    except FileNotFoundError:
        pass
    with open(path, "wb") as f:
        f.write(body)
    with open(path + ".sha256", "w", encoding="ascii", newline="\n") as f:
        f.write(hashlib.sha256(body).hexdigest() + "  holidays.json\n")
    return True


def main(argv):
    key = os.environ.get("HOLIDAY_API_KEY", "").strip()
    if not key:
        print("HOLIDAY_API_KEY 가 없다", file=sys.stderr)
        return 2
    n = int(argv[argv.index("--years") + 1]) if "--years" in argv else 3
    this = date.today().year
    days = {}
    for y in range(this, this + n):
        got = fetch_year(y, key)
        print("%d: %d일" % (y, len(got)))
        if y == this and not got:
            print("올해 공휴일이 비었다 - API 고장으로 보고 멈춘다", file=sys.stderr)
            return 1
        days.update(got)
    print("바뀜" if write(build(days)) else "그대로")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
