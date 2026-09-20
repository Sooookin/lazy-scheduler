# -*- coding: utf-8 -*-
"""디자인 값의 유일한 출처.

색과 굵기는 세 군데서 쓰인다.

    web/style.css   창 화면        (:root 블록을 여기서 만들어 넣는다)
    toast.py        알림 카드      (PIL 로 직접 그린다 - 여기서 바로 읽는다)
    tray.py         트레이 아이콘

예전에는 같은 색을 각자 적어 뒀다. 바탕을 한 단계 밝히려고 style.css 를
고치면 알림 카드만 예전 색으로 남아, 나란히 뜨면 종이 두 장의 색이 달랐다.
손으로 맞추는 한 언젠가 또 어긋난다.

이제 파이썬 쪽은 이 파일을 그대로 읽고, CSS 쪽은

    python tools/gen_tokens.py

가 :root 블록을 다시 써 넣는다. 어긋나면 테스트(test_tokens.py)가 잡는다.

나중에 다른 형태의 앱을 붙일 때도 사본을 하나 더 만들지 말고 여기서 읽는다.
"""

# ---------------- 색 ----------------
# 점토 바탕 · 청록 강조. 채도를 낮게 잡아 오래 봐도 피로하지 않게 한다.
COLOR = {
    # 바탕과 종이. 디자인 2차의 결 C: 한 단계 밝게 (얼룩덜룩함을 줄이고 글자 대비는 오른다).
    # 예전 값(#efeae3 계열)은 색상 35°에 빨강이 파랑보다 12 높아 누리끼리했다.
    # 색상만 170°(청록)로 옮기고 채도를 3분의 1로 줄였다. 밝기(L)는 한 톤도
    # 건드리지 않았으므로 글자 대비와 그림자 관계는 예전 그대로다.
    # 강조색(mid #4d7572)과 같은 갈래라, 고리·체크·단추가 남의 색처럼 겉돌지 않는다.
    "bg":      "#eef1f0",
    "card":    "#eef1f0",
    "dark":    "#c6cccb",      # 눌린 그림자
    "light":   "#ffffff",      # 올라온 면의 빛
    "pale":    "#dde2e1",
    "wash-hi": "#f5f7f6",      # 바탕 그라데이션 밝은 쪽
    "wash-lo": "#e8eceb",      # 어두운 쪽
    # 홈의 종이 묶음: 맨 위 장(card) 뒤로 비껴 쌓인 두 장과, 뒤에 있는 인덱스 탭
    "sheet2":  "#e6ebea",
    "sheet3":  "#dee4e3",

    # 글자 (괄호 안은 바탕 #efeae3 위 대비)
    "ink2":    "#2b2620",      # 제목        12.5:1
    "body":    "#3a332b",      # 본문        10.4:1
    "muted":   "#453d33",      # 라벨         8.2:1
    "faint":   "#5c5346",      # 보조         6.3:1
    "dim":     "#8b8175",      # 흐림(지난 것) 3.2:1 - 글자에는 쓰지 않는다

    # 강조
    "mint":    "#85bdb3",
    "mid":     "#4d7572",      # 장식 전용 (4.0:1)
    "mid-hi":  "#5a827e",      # 청록 버튼에 마우스를 올렸을 때
    "mid-ink": "#466a68",      # 청록을 글자로 쓸 때 (4.7:1)
    # 달력의 공휴일 · 일요일. 진짜 달력처럼 빨강이되, 점토 바탕에 맞춰
    # 채도를 낮춘 벽돌빛이다 (#eef1f0 위 5.5:1). 토요일은 팔레트의 청록(mid-ink)을 쓴다.
    "hol":     "#9d4038",
    "deep":    "#08202b",
    "deep-hi": "#123140",
    "onmid":   "#eef3f1",      # 청록·먹 위에 얹는 글자
}

# 반투명 값은 색과 불투명도를 따로 둔다 (CSS 는 rgba, PIL 은 (r,g,b,a) 로 쓴다)
ALPHA = {
    "rule":       ("56,46,32", ".085"),   # 줄 사이 실선
    "rule2":      ("56,46,32", ".17"),    # 칸 제목 아래 실선
    "midshadow":  ("77,117,114", ".30"),  # 청록 버튼 그림자
    # 마우스를 올렸을 때 덮는 색. 예전 값(.035~.08)은 너무 옅어서 지금 어디를
    # 가리키고 있는지 알기 어려웠다. 줄처럼 넓은 면은 옅게, 단추처럼 작은 것은
    # 진하게 - 같은 농도를 쓰면 넓은 면이 과하게 어두워진다.
    "hover":      ("56,46,32", ".085"),   # 목록 줄 · 넓은 면
    "hover-hi":   ("56,46,32", ".15"),    # 단추 · 아이콘처럼 작은 것
}


def rgba_tuple(name):
    """PIL 용 (r, g, b, a). CSS 의 rgba() 와 같은 값이 나온다."""
    rgb, a = ALPHA[name]
    r, g, b = (int(v) for v in rgb.split(","))
    return (r, g, b, int(round(float(a) * 255)))

# ---------------- 글자 굵기 ----------------
# Paperlogy 300 · 400 · 500 세 종.
# Bold(700) 는 한글에서 획이 서로 붙어 뭉툭해 보여 뺐다. 본문을 Medium 으로
# 내리고, 그만큼 보조 글씨는 Light 대신 Regular 로 올려 두 단계를 벌려 둔다.
# Light 는 큰 글자에만 남는다 - 42px 시계에서는 가는 획이 오히려 또렷하다.
WEIGHT = {
    "thin": 300,      # 큰 글자에만 (시계 · 창 제목 · 달력 연월)
    "sec":  400,      # 보조 · 라벨   (Light → Regular)
    "pri":  500,      # 본문 · 제목 · 숫자 (Bold → Medium)
}

# ---------------- 치수 · 움직임 ----------------
METRIC = {
    "rowpad": "12px",    # 목록 한 줄의 위아래 여백
    "tb":     "34px",    # 제목줄 높이
    # 자간. 한글은 자소가 네모 칸을 꽉 채워서, 0 보다 아주 조금 벌려야 글자가
    # 서로 붙지 않고 읽힌다. 큰 글자는 여기서 빼서 좁힌다 (calc(var(--track) - N)).
    "track":  ".1px",
}

MOTION = {
    "ease":   "cubic-bezier(.2,.8,.2,1)",
    "t-fast": "140ms",
    "t-med":  "220ms",
    "t-slow": "320ms",
}


def rgba(name):
    """CSS 용 rgba() 문자열."""
    rgb, a = ALPHA[name]
    return "rgba(%s,%s)" % (rgb, a)


def rgb_tuple(name):
    """PIL 용 (r, g, b). 색 이름이나 #rrggbb 를 받는다."""
    h = COLOR.get(name, name).lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


def css_root():
    """web/style.css 의 :root 블록 안에 들어갈 줄들."""
    c = COLOR
    return "\n".join([
        "  --bg:%(bg)s; --card:%(card)s; --dark:%(dark)s; --light:%(light)s; --pale:%(pale)s;" % c,
        "  --wash:radial-gradient(130%% 130%% at 12%% 6%%, %(wash-hi)s 0%%, %(bg)s 45%%, %(wash-lo)s 100%%);" % c,
        "  --wash-hi:%(wash-hi)s; --sheet2:%(sheet2)s; --sheet3:%(sheet3)s;" % c,
        "  --rule:%s; --rule2:%s;" % (rgba("rule"), rgba("rule2")),
        "  --hover:%s; --hover-hi:%s;" % (rgba("hover"), rgba("hover-hi")),
        "  --ink2:%(ink2)s; --body:%(body)s; --muted:%(muted)s; --faint:%(faint)s; --dim:%(dim)s;" % c,
        "  --mint:%(mint)s; --mid:%(mid)s; --mid-hi:%(mid-hi)s; --mid-ink:%(mid-ink)s;" % c,
        "  --hol:%(hol)s;" % c,
        "  --deep:%(deep)s; --deep-hi:%(deep-hi)s; --onmid:%(onmid)s;" % c,
        "  --midshadow:%s;" % rgba("midshadow"),
        "  /* 굵기 단계. Light 는 작은 한글에서 획이 끊겨 읽히지 않아 큰 글자에만 남긴다. */",
        "  --w-thin:%(thin)d; --w-sec:%(sec)d; --w-pri:%(pri)d;" % WEIGHT,
        "  --rowpad:%(rowpad)s; --tb:%(tb)s; --track:%(track)s;" % METRIC,
        "  --ease:%(ease)s; --t-fast:%(t-fast)s; --t-med:%(t-med)s; --t-slow:%(t-slow)s;" % MOTION,
    ])
