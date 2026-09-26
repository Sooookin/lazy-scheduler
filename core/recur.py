# -*- coding: utf-8 -*-
"""반복 일정 규칙 엔진.

규칙은 [주기] × [기준] 의 조합으로 표현한다.

    period : "day" | "week" | "month" | "quarter"
    basis  : "day" | "business_day" | "weekday" | "before_end" | "before_end_bd"
             (month / quarter 주기에서만 사용)

    day     : business_only
    week    : weekdays[], interval, anchor
    month   : basis + (n | weekday | k), months[]  ← 실행할 월 제한
    quarter : basis + (n | weekday | k)            ← 달력 분기(1·4·7·10월 시작)

    holiday_shift : "none" | "prev" | "next"   (기본 prev — 회사 일정은 영업일 기준)
"""
from datetime import date, timedelta
from functools import lru_cache
import calendar

# 대한민국 공휴일(양력 확정분). data.json 의 holidays 로 추가할 수 있다.
DEFAULT_HOLIDAYS = {
    "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02",
    "2026-05-05", "2026-05-24", "2026-05-25", "2026-06-03", "2026-06-06", "2026-08-15",
    "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05",
    "2026-10-09", "2026-12-25",
    "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-03-01",
    "2027-05-05", "2027-05-13", "2027-06-06", "2027-06-07", "2027-08-15", "2027-08-16",
    "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-03", "2027-10-04", "2027-10-09",
    "2027-10-11", "2027-12-25",
}
# 달력에 표시할 이름. 대체공휴일처럼 이름이 확실하지 않은 날은 뭉뚱그린다.
HOLIDAY_NAMES = {
    "2026-01-01": "신정",
    "2026-02-16": "설날 연휴", "2026-02-17": "설날", "2026-02-18": "설날 연휴",
    "2026-03-01": "삼일절", "2026-03-02": "대체공휴일",
    "2026-05-05": "어린이날", "2026-05-24": "부처님오신날", "2026-05-25": "대체공휴일",
    "2026-06-03": "지방선거", "2026-06-06": "현충일",
    "2026-08-15": "광복절", "2026-08-17": "대체공휴일",
    "2026-09-24": "추석 연휴", "2026-09-25": "추석", "2026-09-26": "추석 연휴",
    "2026-10-03": "개천절", "2026-10-05": "대체공휴일", "2026-10-09": "한글날",
    "2026-12-25": "성탄절",
    "2027-01-01": "신정",
    "2027-02-06": "설날 연휴", "2027-02-07": "설날",
    "2027-02-08": "설날 연휴", "2027-02-09": "대체공휴일",
    "2027-03-01": "삼일절",
    "2027-05-05": "어린이날", "2027-05-13": "부처님오신날",
    "2027-06-06": "현충일", "2027-06-07": "대체공휴일",
    "2027-08-15": "광복절", "2027-08-16": "대체공휴일",
    "2027-09-14": "추석 연휴", "2027-09-15": "추석", "2027-09-16": "추석 연휴",
    "2027-10-03": "개천절", "2027-10-04": "대체공휴일",
    "2027-10-09": "한글날", "2027-10-11": "대체공휴일",
    "2027-12-25": "성탄절",
}

# 스케줄러·HTTP 스레드가 동시에 읽으므로 제자리에서 고치지 않고 통째로 갈아끼운다.
# 예전에는 clear() 와 update() 사이에 다른 스레드가 빈 집합을 읽어 공휴일을 영업일로 셌다.
HOLIDAYS = frozenset()          # "YYYY-MM-DD" 문자열 (밖으로 내보낼 때 쓴다)
_HOLIDAY_DATES = frozenset()    # 같은 것을 date 로. 아래 _apply 가 둘을 함께 세운다
W = "월화수목금토일"
ALL_MONTHS = list(range(1, 13))

PERIODS = ("day", "week", "month", "quarter")
BASES = ("day", "business_day", "weekday", "before_end", "before_end_bd")
SHIFTS = ("none", "prev", "next")

# 휴일 보정이 날짜를 옮기는 최대 거리 (next_business_day 의 탐색 한도).
SHIFT_REACH = 31
# 기준 주(anchor)가 없는 격주 규칙이 쓰는 고정 기준일 (월요일).
# 예전에는 계산 구간의 시작일을 기준으로 삼았는데, 구간이 호출마다 달라서
# (화면은 10일 전부터, 스케줄러는 어제부터) 같은 규칙이 화면과 알림에서 다른 주를 골랐다.
WEEK_EPOCH = date(2024, 1, 1)


class RuleError(ValueError):
    """규칙이 잘못됐다. 메시지는 화면에 그대로 보여줄 수 있는 문장이다."""


def _apply(names):
    """휴일 목록을 문자열과 date 두 벌로 세운다. 반드시 여기서만 바꾼다.

    is_business_day 는 회차를 펼칠 때마다 불린다 (한 번 그리는 데 20만 번쯤).
    문자열 집합에 견주려면 그때마다 d.isoformat() 으로 새 문자열을 지어야 했다.
    date 끼리 견주면 그 일이 통째로 없어진다.
    """
    global HOLIDAYS, _HOLIDAY_DATES
    HOLIDAYS = frozenset(names)
    out = set()
    for x in HOLIDAYS:
        try:
            out.add(date.fromisoformat(x))
        except ValueError:
            pass            # 손으로 적어 넣은 값이 깨져 있어도 나머지 휴일은 산다
    _HOLIDAY_DATES = frozenset(out)


_apply(DEFAULT_HOLIDAYS)


def set_holidays(extra):
    _apply(frozenset(DEFAULT_HOLIDAYS)
           | frozenset(x for x in (extra or []) if isinstance(x, str)))


def is_business_day(d):
    return d.weekday() < 5 and d not in _HOLIDAY_DATES


def next_business_day(d, forward=True):
    step = 1 if forward else -1
    cur = d
    for _ in range(SHIFT_REACH):
        if is_business_day(cur):
            return cur
        cur += timedelta(days=step)
    return d


@lru_cache(maxsize=512)
def _span_days(d0, d1):
    """[d0, d1] 의 모든 날. 항목마다 같은 구간을 다시 만들던 것을 한 번만 만든다.

    반복 업무가 40개면 같은 85일치 목록을 40번 만들었다. 날짜만 받는 순수한
    함수라 결과를 들고 있어도 된다. 부르는 쪽이 고치지 못하게 tuple 로 준다.
    """
    out, d = [], d0
    while d <= d1:
        out.append(d)
        d += timedelta(days=1)
    return tuple(out)


def _shift(d, mode):
    if mode == "none" or is_business_day(d):
        return d
    return next_business_day(d, forward=(mode == "next"))


# ---------- 예전 규칙 형식 → 현재 형식 ----------
def normalize(rule):
    r = dict(rule or {})
    if "period" not in r:
        k = r.pop("kind", "daily")
        if k == "daily":
            r["period"] = "day"
        elif k == "weekly":
            r["period"] = "week"
        elif k == "yearly":
            r.update(period="month", basis="day", n=r.get("day", 1),
                     months=[int(r.get("month", 1))])
        elif k == "quarterly_day":
            r.update(period="month", basis="day", n=r.get("day", 1),
                     months=[int(x) for x in r.get("months", [3, 6, 9, 12])])
        else:
            r["period"] = "month"
            r["basis"] = {"monthly_day": "day",
                          "monthly_business_day": "business_day",
                          "monthly_weekday": "weekday",
                          "before_month_end": "before_end",
                          "before_month_end_bd": "before_end_bd"}.get(k, "day")
            if r["basis"] == "day":
                r["n"] = r.get("day", 1)
    r.setdefault("holiday_shift", "prev")
    if r.get("period") == "day":
        r.setdefault("business_only", True)
    return r


# ---------- 기준 계산 ----------
def _by_basis(r, d0, d1):
    """주기 구간 [d0, d1] 안에서 기준에 맞는 날짜 하나."""
    basis = r.get("basis", "day")
    days = _span_days(d0, d1)
    bd = [d for d in days if is_business_day(d)]

    if basis == "day":
        n = int(r.get("n", 1))
        idx = n - 1 if n > 0 else len(days) + n
        return days[idx] if 0 <= idx < len(days) else None

    if basis == "business_day":
        n = int(r.get("n", 1))
        idx = n - 1 if n > 0 else len(bd) + n
        return bd[idx] if 0 <= idx < len(bd) else None

    if basis == "weekday":
        n = int(r.get("n", 1))
        wd = int(r.get("weekday", 0))
        hit = [d for d in days if d.weekday() == wd]
        idx = n - 1 if n > 0 else len(hit) + n
        return hit[idx] if 0 <= idx < len(hit) else None

    if basis == "before_end":
        k = int(r.get("k", 0))
        idx = len(days) - 1 - k
        return days[idx] if 0 <= idx < len(days) else None

    if basis == "before_end_bd":
        k = int(r.get("k", 0))
        idx = len(bd) - 1 - k
        return bd[idx] if 0 <= idx < len(bd) else None

    return None


def _month_span(y, m):
    return date(y, m, 1), date(y, m, calendar.monthrange(y, m)[1])


def _quarter_span(y, q):     # q = 0..3  →  1·4·7·10월 시작
    sm = q * 3 + 1
    em = sm + 2
    return date(y, sm, 1), date(y, em, calendar.monthrange(y, em)[1])


# ---------- 날짜 생성 ----------
def occurrences(rule, start, end):
    """휴일 보정을 마친 실행일 중 [start, end] 안에 떨어지는 것.

    후보는 구간보다 SHIFT_REACH 만큼 넓게 만든 뒤 보정하고 나서 자른다.
    구간 안에서만 후보를 만들면, 구간 밖의 날짜가 보정되어 구간 안으로 들어오는
    회차를 놓친다. 스케줄러는 어제~내일만 보므로 "11/1(일) → 10/30(금)" 같은
    회차의 알림이 통째로 빠졌다. 결과는 구간을 어떻게 잡든 같아야 한다.
    """
    r = normalize(rule)
    period = r.get("period", "day")
    shift = r.get("holiday_shift", "prev")

    if period == "day":
        return [d for d in _span_days(start, end)
                if not r.get("business_only", True) or is_business_day(d)]

    lo = start - timedelta(days=SHIFT_REACH)
    hi = end + timedelta(days=SHIFT_REACH)
    raw = []

    if period == "week":
        wd = set(r.get("weekdays") or [])
        every = max(1, int(r.get("interval", 1)))
        anchor = date.fromisoformat(r["anchor"]) if r.get("anchor") else WEEK_EPOCH
        a_mon = anchor - timedelta(days=anchor.weekday())
        for d in _span_days(lo, hi):
            if d.weekday() in wd:
                weeks = ((d - timedelta(days=d.weekday())) - a_mon).days // 7
                if weeks % every == 0:
                    raw.append(d)
    elif period == "quarter":
        for y in range(lo.year, hi.year + 1):
            for q in range(4):
                d0, d1 = _quarter_span(y, q)
                if d1 >= lo and d0 <= hi:
                    raw.append(_by_basis(r, d0, d1))
    else:                                               # month
        months = set(int(x) for x in (r.get("months") or ALL_MONTHS))
        y, m = lo.year, lo.month
        while date(y, m, 1) <= hi:
            if m in months:
                raw.append(_by_basis(r, *_month_span(y, m)))
            y, m = (y + 1, 1) if m == 12 else (y, m + 1)

    shifted = {_shift(d, shift) for d in raw if d}
    return sorted(d for d in shifted if start <= d <= end)


# ---------- 설명 문구 ----------
_ORD = {1: "첫째", 2: "둘째", 3: "셋째", 4: "넷째"}


def _basis_text(r, q=False):
    """q=True 면 분기 주기용 문구."""
    basis = r.get("basis", "day")
    n = int(r.get("n", 1))
    k = int(r.get("k", 0))
    if basis == "day":
        if n == -1:
            return "마지막 날" if q else "말일"
        return f"{n}일째" if q else f"{n}일"
    if basis == "business_day":
        return "마지막 영업일" if n == -1 else f"{n}번째 영업일"
    if basis == "weekday":
        wd = W[int(r.get("weekday", 0))]
        if n == -1:
            return f"마지막 {wd}요일"
        return f"{_ORD.get(n, f'{n}번째')} {wd}요일"
    if basis == "before_end":
        if k == 0:
            return "마지막 날" if q else "말일"
        return f"말일 {k}일 전"
    if basis == "before_end_bd":
        if k == 0:
            return "마지막 영업일"
        return f"말일 {k}영업일 전"
    return ""


def describe(rule):
    if not rule:
        return "반복"
    r = normalize(rule)
    p = r.get("period", "day")

    if p == "day":
        # 달력 날이 기본이다. 영업일만 도는 것은 덧붙여 밝힌다 (예전 "매 영업일" 은
        # 영업일이 기본처럼 읽혔다)
        return "매일 · 영업일만" if r.get("business_only", True) else "매일"

    if p == "week":
        ds = "·".join(W[i] for i in sorted(r.get("weekdays") or []))
        iv = int(r.get("interval", 1))
        head = {1: "매주", 2: "격주", 3: "3주마다", 4: "4주마다"}.get(iv, f"{iv}주마다")
        return f"{head} {ds}요일"

    if p == "quarter":
        return "매 분기 " + _basis_text(r, q=True)

    months = sorted(set(int(x) for x in (r.get("months") or ALL_MONTHS)))
    body = _basis_text(r)
    if len(months) == 12:
        return "매월 " + body
    if len(months) == 1:
        return f"매년 {months[0]}월 " + body
    return "·".join(str(x) for x in months) + "월 " + body


# ---------- 예시 날짜 + 단위 → 규칙 고르기 ----------
SUGGEST_MAX = 7
UNITS = ("day", "week", "month", "year")
# 달 간격은 열두 달을 고르게 나누는 것만 (2 · 3 · 4 · 6). 3 은 분기, 6 은 반기다.
EVERY_MONTHS = (1, 2, 3, 4, 6)


def months_every(day, every):
    """간격(달)로 도는 달 목록. 예시 날짜의 달에서 시작한다.

    9월 + 3달 간격 → 3·6·9·12월, 10월 + 3달 간격 → 1·4·7·10월.
    "분기 말 / 분기 초" 를 따로 고를 일이 없어진다 - 예시 날짜가 이미 답이다.
    """
    if every <= 1:
        return None
    return sorted({(day.month - 1 + i * every) % 12 + 1 for i in range(12 // every)})


def _month_patterns(day):
    """한 달 안에서 그 날을 가리키는 방법들. 자주 쓰는 순서.

    같은 날 하나를 여러 가지로 읽을 수 있다 (9월 30일 = 말일 = 마지막 영업일 =
    마지막 수요일 = 말일 0일 전...). 사람은 이 중 무엇을 뜻했는지만 고르면 된다.
    """
    first, last_day = _month_span(day.year, day.month)
    last = last_day.day
    d, wd = day.day, day.weekday()
    bd = [x for x in _span_days(first, last_day) if is_business_day(x)]
    biz = day in bd
    out = []
    if d == last:
        out.append({"basis": "day", "n": -1})                        # 말일
    if biz and day == bd[-1]:
        out.append({"basis": "business_day", "n": -1})               # 마지막 영업일
    out.append({"basis": "day", "n": d})                             # N일
    if biz and day != bd[-1] and bd.index(day) < 10:
        out.append({"basis": "business_day", "n": bd.index(day) + 1})  # N번째 영업일
    if d + 7 > last:
        out.append({"basis": "weekday", "n": -1, "weekday": wd})     # 마지막 O요일
    elif (d - 1) // 7 + 1 <= 4:
        out.append({"basis": "weekday", "n": (d - 1) // 7 + 1, "weekday": wd})
    if 1 <= last - d <= 5:
        out.append({"basis": "before_end", "k": last - d})           # 말일 K일 전
    if biz and 1 <= len(bd) - 1 - bd.index(day) <= 5:
        out.append({"basis": "before_end_bd", "k": len(bd) - 1 - bd.index(day)})
    return out


def suggest(day, unit="month", every=1):
    """예시 날짜 하나 + 단위 → 그 날에 도는 규칙들. 자주 쓰는 순서로.

    [{"text": 설명, "rule": 규칙}]. 규칙은 모두 validate_rule 을 통과한 표준 형식이고,
    반드시 그 날짜에 돈다 - 화면에 뜬 것 중 무엇을 골라도 "그 날 하는 일" 이 된다.
    (단위가 "일" 일 때만 예외다. 매일 하는 일에는 예시 날짜가 뜻이 없다.)

    단위와 간격이 주기를 정하고, 여기서 고르는 것은 "그 주기 안에서 언제" 하나뿐이다.
      일          날마다 · 영업일만
      주  1 · 2   그 요일에 (격주는 예시 날짜가 있는 주가 기준)
      월  1~6     말일 · N일 · N번째 영업일 · 마지막 O요일 · 말일 K일 전 …
      년          그 달의 같은 방법들

    고른 날이 영업일이면 휴일 보정은 늘 쓰던 "앞 영업일로", 주말 · 공휴일이면
    "그대로" 로 둔다 - 그날 한다고 짚은 것이니 그날이 빠지면 안 된다.
    휴대폰 앱이 같은 것을 만든다 (tests/vectors/suggest.json 이 둘의 약속).
    """
    if unit not in UNITS:
        raise RuleError("단위는 일 · 주 · 월 · 년 중 하나여야 합니다")
    every = int(every or 1)
    biz = is_business_day(day)
    shift = "prev" if biz else "none"

    if unit == "day":
        cands = [{"period": "day", "business_only": False},
                 {"period": "day", "business_only": True}]
    elif unit == "week":
        cands = [{"period": "week", "weekdays": [day.weekday()],
                  "interval": max(1, min(every, 52)), "anchor": day.isoformat()}]
    else:
        months = [day.month] if unit == "year" else months_every(day, every)
        cands = [dict(p, period="month", **({"months": months} if months else {}))
                 for p in _month_patterns(day)]

    out, seen = [], set()
    for c in cands:
        try:
            rule = validate_rule(dict(c, holiday_shift=shift))
        except RuleError:
            continue
        text = describe(rule)
        # 날마다 · 영업일만은 예시 날짜와 무관하다. 나머지는 그 날에 돌아야 한다
        if text in seen or (unit != "day" and day not in occurrences(rule, day, day)):
            continue
        seen.add(text)
        out.append({"text": text, "rule": rule})
    return out[:SUGGEST_MAX]


# ---------- 저장 전 확인 ----------
def _is_int(v, lo, hi):
    return type(v) is int and lo <= v <= hi


def validate_rule(rule):
    """규칙을 확인하고 표준 형식(모르는 키 없음)으로 돌려준다. 잘못되면 RuleError.

    화면은 올바른 값만 보내지만 서버는 화면을 믿지 않는다. 잘못된 규칙이 한 번
    저장되면 목록 계산과 알림이 매번 그 항목에서 터진다.
    """
    if not isinstance(rule, dict):
        raise RuleError("반복 규칙을 정하세요")
    try:
        r = normalize(rule)
    except (TypeError, ValueError):
        raise RuleError("반복 규칙 형식이 올바르지 않습니다") from None
    period = r.get("period")
    if period not in PERIODS:
        raise RuleError("반복 주기를 선택하세요")
    shift = r.get("holiday_shift", "prev")
    if shift not in SHIFTS:
        raise RuleError("휴일 보정 방식이 올바르지 않습니다")
    out = {"period": period, "holiday_shift": shift}

    if period == "day":
        if not isinstance(r.get("business_only", True), bool):
            raise RuleError("주말·공휴일 제외 값이 올바르지 않습니다")
        out["business_only"] = r.get("business_only", True)
        return out

    if period == "week":
        wds = r.get("weekdays")
        if not isinstance(wds, list) or not wds or not all(_is_int(x, 0, 6) for x in wds):
            raise RuleError("요일을 하나 이상 선택하세요")
        out["weekdays"] = sorted(set(wds))
        iv = r.get("interval", 1)
        if not _is_int(iv, 1, 52):
            raise RuleError("반복 간격은 1~52주 사이여야 합니다")
        out["interval"] = iv
        a = r.get("anchor")
        if a is not None:
            try:
                if not (isinstance(a, str) and len(a) == 10):
                    raise ValueError
                date.fromisoformat(a)
            except ValueError:
                raise RuleError("기준 주 날짜가 올바르지 않습니다") from None
            out["anchor"] = a
        return out

    q = period == "quarter"
    basis = r.get("basis", "day")
    if basis not in BASES:
        raise RuleError("어느 날에 할지 기준을 선택하세요")
    out["basis"] = basis
    if basis in ("day", "business_day", "weekday"):
        top = {"day": 92 if q else 31, "business_day": 66 if q else 23,
               "weekday": 13 if q else 5}[basis]
        n = r.get("n", 1)
        if not (type(n) is int and (n == -1 or 1 <= n <= top)):
            raise RuleError("몇 번째인지는 1~%d 사이여야 합니다" % top)
        out["n"] = n
        if basis == "weekday":
            wd = r.get("weekday", 0)
            if not _is_int(wd, 0, 6):
                raise RuleError("요일이 올바르지 않습니다")
            out["weekday"] = wd
    else:
        top = 60 if q else 27
        k = r.get("k", 0)
        if not _is_int(k, 0, top):
            raise RuleError("말일 기준 일수는 0~%d 사이여야 합니다" % top)
        out["k"] = k
    if not q and r.get("months") is not None:
        ms = r["months"]
        if not isinstance(ms, list) or not ms or not all(_is_int(x, 1, 12) for x in ms):
            raise RuleError("실행할 달을 하나 이상 선택하세요")
        out["months"] = sorted(set(ms))
    return out
