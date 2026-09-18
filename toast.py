# -*- coding: utf-8 -*-
"""화면 오른쪽 아래에 뜨는 알림 카드 — A′ (점토 · 모조지 결 · Paperlogy).

카드 전체를 Pillow 로 그린 뒤 Windows 레이어드 윈도우(UpdateLayeredWindow)로 띄운다.
픽셀 단위 알파라 모서리와 그림자가 계단 없이 부드럽다. 창과 이벤트 루프도 Win32 로
직접 다룬다 - tkinter 를 쓰면 배포본에 tcl/tk 6MB 가 따라 들어온다.

선명도: 카드는 모니터 배율(SCALE)에 맞춘 실제 픽셀 크기로 새로 그린다. 작게 그려
늘리지 않는다. 글꼴은 Paperlogy TTF, 선과 모서리는 4배로 그린 뒤 줄여 계단을 없앤다.
움직임: 등장은 오른쪽에서 28px 미끄러지며 360ms, 퇴장은 투명도만 220ms, 쌓인 카드는
220ms 동안 자리를 옮긴다. 곡선은 앱 화면과 같은 cubic-bezier(.2,.8,.2,1).
그림은 바뀔 때만 다시 만들고, 움직이는 동안에는 위치와 투명도만 바꿔 준다.
"""
import ctypes
import functools
import math
import queue
import threading
import time
import traceback

import paths
import tokens
import win32
from ctypes import wintypes

# ---------------- 색 ----------------
# tokens.py 가 유일한 출처다. 창 화면(web/style.css)도 같은 값에서 나온다.
# 예전에는 여기에 색을 따로 적어 뒀는데, 바탕을 밝히면 알림 카드만 예전
# 색으로 남아 나란히 떴을 때 종이 두 장의 색이 달랐다.
_C      = tokens.COLOR
CARD    = _C["card"]
WASH_HI = _C["wash-hi"]
WASH_LO = _C["wash-lo"]
DARK    = _C["dark"]
LIGHT   = _C["light"]
PALE    = _C["pale"]
INK2    = _C["ink2"]
BODY    = _C["body"]
MUTED   = _C["muted"]
FAINT   = _C["faint"]
MID     = _C["mid"]
MID_HI  = _C["mid-hi"]
MID_INK = _C["mid-ink"]
MINT    = _C["mint"]
DEEP    = _C["deep"]
DEEP_HI = _C["deep-hi"]
ONMID   = _C["onmid"]

# ---------------- 치수 (배율 100% 기준, set_scale 이 실제 픽셀로 바꾼다) ----------------
_BASE = dict(
    PAD=26,                 # 카드 밖 여백: 그림자가 잘리지 않고 끝까지 번질 자리
    CW=384, R=18, GAP=8,          # 340 이었다. 제목 칸이 좁아 넓혔다
    TX=40, TY=19, TR=46,    # 글자 시작 · 위 여백 · 오른쪽(✕ 자리)
    BAR_X=22, BAR_W=3,
    CLOSE=28, CLOSE_R=12, CLOSE_T=10,
    TITLE_PX=13, SUB_PX=11, LINE_H=18, SUB_LINE_H=16,
    LIST_PAD=22, LIST_ROW=26, FOLD_H=36,

    # ── 한 건짜리 카드 (시각 우선) ──────────────────────────────────
    # 가로 340 을 이렇게 나눈다. 숫자를 여기 모아 두면 배율이 바뀌어도
    # 비율이 그대로 따라온다.
    #
    #   18 │3│11│  64  │ 16 │ ────── 제목 ────── │ 18
    #      ▍    10:00        퇴연 RA 비즈니스 미팅      ✕
    #           10분 뒤       루틴 · 매월 마지막 목요일
    #   ├──────────────── 40 ────────────────────────┤
    #   │     완료    │    10분 뒤   │      열기        │
    #
    # 시각 칸 폭은 글꼴에서 직접 잰다 ("00:00"). 숫자가 tabular 라 어떤 시각이든
    # 같은 폭이고, 값을 손으로 적어 두면 어긋난다 (64 로 적어 뒀는데 실제는 74 라
    # 시각이 제 칸을 넘어 제목 자리를 먹고 있었다).
    N_MARGIN=18, N_BAR_W=3, N_BARGAP=11, N_COLGAP=16,
    N_TOP=18, N_BOT=16, N_XCOL=44,          # ✕ 가 차지해 제목이 비워 두는 폭
    # 26px 이었다. 조금 줄여 제목 칸을 벌었다 (시각칸 71→62 · 제목 221→230px).
    # 22px 도 칸 폭은 같아서, 같은 값이면 큰 쪽을 쓴다.
    N_TIME_PX=23, N_TIME_LH=24, N_TIME_GAP=6,
    N_REL_PX=11, N_REL_LH=14,
    N_TTL_PX=13.5, N_TTL_LH=19, N_TTL_GAP=5,
    N_SUB_PX=11, N_SUB_LH=15,
    N_ACT_H=40, N_ACT_PX=11.5, N_ACT_INSET=4, N_ACT_R=8, N_SEG_PAD=9,
)
TITLE_LINES, SUB_LINES = 2, 3
LIST_MAX = 4
SCALE = 1.0
globals().update(_BASE)


def s(v):
    """100% 기준 치수 → 실제 화면 픽셀."""
    return int(round(v * SCALE))


def set_scale(scale):
    """모니터 배율에 맞춰 치수를 다시 정한다. 그려 둔 바탕 · 결은 배율이 바뀌면 버린다."""
    global SCALE
    SCALE = max(1.0, min(4.0, float(scale)))
    for k, v in _BASE.items():
        globals()[k] = s(v)
    for cached in (_texture_sheet, _shadow_sheet, _shadow, _card_face, _font, _x_mark,
                   _rounded_mask):
        cached.cache_clear()


# ---------------- 글꼴 ----------------
def _font_paths(weight):
    # 300 은 큰 글자에만. Bold 는 한글에서 획이 붙어 뭉툭해 보여 쓰지 않는다.
    name = {300: "Paperlogy-3Light.ttf",
            400: "Paperlogy-4Regular.ttf"}.get(weight, "Paperlogy-5Medium.ttf")
    return paths.font_paths(name)


@functools.lru_cache(maxsize=256)
def _lsb(weight, size, ch):
    """글자 왼쪽에 붙은 빈 자리(픽셀).

    Paperlogy 에서 ImageFont.getbbox()[0] 은 늘 0 을 돌려준다. 그 값을 믿고
    보정하면 아무 일도 일어나지 않는다. 그래서 한 번 그려 보고 잉크가 실제로
    시작하는 자리를 잰다 (글꼴 · 크기 · 첫 글자마다 한 번, 그 뒤로는 기억한다).

    이게 없으면 26px 숫자(3px 안쪽)와 11px 한글(1px 안쪽)을 같은 x 에 그렸을 때
    왼쪽 끝이 어긋나 보인다.
    """
    from PIL import Image, ImageDraw
    if not ch:
        return 0
    f = _font(weight, size)
    pad = max(8, size)
    img = Image.new("L", (pad * 3, max(8, size) * 3), 255)
    ImageDraw.Draw(img).text((pad, pad // 2), ch, font=f, fill=0)
    px = img.load()
    for x in range(img.width):
        for y in range(img.height):
            if px[x, y] < 200:
                return x - pad
    return 0


@functools.lru_cache(maxsize=64)
def _font(weight, size):
    from PIL import ImageFont
    for p in _font_paths(weight):
        try:
            return ImageFont.truetype(p, size)
        except Exception:
            continue
    return ImageFont.load_default()


def _rgb(h):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))


# ---------------- 알림 요청 ----------------
_queue = queue.Queue()
_seen = {}                    # key -> 마지막으로 띄운 시각
_open_handler = None          # [열기] · 접힌 줄을 누르면 앱 창을 연다 (app.py 가 넣어 준다)


def set_open_handler(fn):
    global _open_handler
    _open_handler = fn


def notify(title, sub="", accent=None, on_done=None, key=None, extra=None,
           late=False, on_snooze=None, can_open=True):
    """같은 알림이 겹쳐 쌓이지 않게 key 로 한 번 걸러낸다.

    key 를 주지 않으면 제목+내용을 키로 쓴다. 60초 안에 같은 키가 다시 오면 버린다.
    accent 는 예전 호출과의 호환용이다 (짙은 색이면 지난 알림으로 본다).
    """
    k = key or (title + "|" + sub)
    now = time.time()
    for old_key, t in list(_seen.items()):
        if now - t > 300:
            _seen.pop(old_key, None)
    if now - _seen.get(k, 0) < 60:
        return
    _seen[k] = now
    if accent and accent.lower() == DEEP:
        late = True
    item = {"title": title, "sub": sub, "late": late, "on_done": on_done,
            "on_snooze": on_snooze, "can_open": can_open, "key": k,
            "info": accent is not None and accent.lower() == MINT}
    item.update(extra or {})
    _queue.put(item)


def notify_list(label, title, rows, more=0, accent=None, key=None):
    """여러 건을 한 장에 나열한다. rows 는 (왼쪽칸, 제목, 지났는지) 목록."""
    notify(title, "", accent=accent, key=key,
           extra={"label": label, "rows": list(rows), "more": more})


# ---------------- 그리기 ----------------
def _wrap(text, font, width, max_lines=TITLE_LINES):
    """픽셀 폭을 재서 줄을 나눈다. 한국어는 공백이 드물어 글자 단위로 채우고,
    끊을 자리 근처에 공백이 있으면 거기서 끊는다.

    width 는 숫자 하나이거나, 줄 번호를 받아 그 줄의 폭을 돌려주는 함수다.
    ✕ 는 첫 줄 옆에만 있으므로 둘째 줄부터는 카드 끝까지 쓸 수 있다.
    """
    wof = width if callable(width) else (lambda _k: width)
    text = " ".join((text or "").split())
    if not text:
        return [""]
    lines, i, n = [], 0, len(text)
    while i < n and len(lines) < max_lines:
        w = wof(len(lines))
        lo, hi = i + 1, n
        while lo < hi:
            mid = (lo + hi + 1) // 2
            if font.getlength(text[i:mid]) <= w:
                lo = mid
            else:
                hi = mid - 1
        end = lo
        if end < n and len(lines) < max_lines - 1:
            sp = text.rfind(" ", i + 1, end + 1)
            if sp > i and end - sp < 8:
                end = sp
        lines.append(text[i:end].rstrip())
        i = end
        while i < n and text[i] == " ":
            i += 1
    if i < n and lines:
        last, w = lines[-1], wof(len(lines) - 1)
        while last and font.getlength(last + "\u2026") > w:
            last = last[:-1]
        lines[-1] = last + "\u2026"
    return lines


@functools.lru_cache(maxsize=64)
def _rounded_mask(w, h, radius, ss=4):
    """둥근 사각형 알파. 4배로 그린 뒤 줄여서 모서리 계단을 없앤다.

    기억해 두고 나눠 쓰므로 받은 쪽은 고치지 않는다 (paste · putalpha 의 재료로만 쓴다).
    """
    from PIL import Image, ImageDraw
    m = Image.new("L", (w * ss, h * ss), 0)
    ImageDraw.Draw(m).rounded_rectangle([0, 0, w * ss - 1, h * ss - 1], radius=radius * ss, fill=255)
    return m.resize((w, h), Image.LANCZOS)


SHEET_H = 360                   # 결 한 장의 높이 (100% 기준). 어떤 카드보다 크다.


@functools.lru_cache(maxsize=2)
def _texture_sheet(w, h):
    """모조지 결을 곱하기용 밝기 지도로 만든다 (255 = 그대로, 낮을수록 어둡게).

    고운 요철(비스듬한 빛) + 크게 번지는 얼룩 + 잔 티끌.
    """
    from PIL import Image, ImageChops, ImageFilter

    def noise(size, sigma):
        return Image.effect_noise(size, sigma).point(lambda v: max(0, min(255, v)))
    tooth = noise((w, h), 48).filter(ImageFilter.GaussianBlur(0.6 * SCALE)).filter(ImageFilter.EMBOSS)
    # 결 C (디자인 2차): 창 화면과 같이 요철은 절반, 큰 얼룩은 뺀다 - 얼룩이 넓은 면을 얼룩덜룩하게 만들었다
    tooth = tooth.point(lambda v: 255 - int(abs(v - 128) * 0.10))          # 0~13 만큼 어둡게
    speck = noise((w, h), 70).point(lambda v: 255 - (5 if v > 235 else 0))
    return ImageChops.multiply(tooth, speck)


def _texture(w, h):
    """카드 크기만큼의 결. 큰 한 장을 한 번 만들어 두고 잘라 쓴다.

    예전에는 카드 높이마다 새로 만들었다. 제목 줄 수 · 단추 유무로 높이가 여러
    가지라, 새 높이의 카드가 뜰 때마다 결을 짓느라 메시지 루프가 멈췄고 그 사이
    다른 카드의 움직임이 끊겼다. 같은 장에서 잘라 오므로 결도 늘 같다.
    """
    sheet = _texture_sheet(max(w, CW), max(h, s(SHEET_H)))
    return sheet.crop((0, 0, w, h))


def _shadow_reach():
    """그림자가 카드 위 · 아래 끝의 영향을 받는 높이 (실제 픽셀).

    모서리 반경 + 내려앉는 거리 + 흐림이 번지는 거리. 이보다 안쪽의 줄은 카드
    높이와 상관없이 모두 같다.
    """
    return R + s(5) + int(math.ceil(6 * SCALE * 3)) + 2


@functools.lru_cache(maxsize=4)
def _shadow_sheet(w, h):
    """카드 밑 그림자 (먼 그림자 + 가까운 그림자) 를 실제로 흐려서 만든다."""
    from PIL import Image, ImageFilter
    W, H = w + PAD * 2, h + PAD * 2
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    # 번지는 거리(흐림 × 3 + 내려앉는 거리)가 PAD 안에 들어와야 네모나게 잘리지 않는다
    for dy, blur, alpha in ((s(5), 6 * SCALE, 84), (s(1), 1.6 * SCALE, 44)):
        m = Image.new("L", (W, H), 0)
        m.paste(_rounded_mask(w, h, R), (PAD, PAD + dy))
        m = m.filter(ImageFilter.GaussianBlur(blur)).point(lambda v, a=alpha: v * a // 255)
        layer = Image.new("RGBA", (W, H), (20, 16, 12, 0))
        layer.putalpha(m)
        out.alpha_composite(layer)
    return out


@functools.lru_cache(maxsize=16)
def _shadow(w, h):
    """카드 크기의 그림자. 한 번 흐려 둔 본을 위 · 아래로 나눠 붙이고 가운데를 늘린다.

    흐림은 카드를 그리는 일 가운데 가장 무겁다 (새 높이마다 50ms 가까이). 예전에는
    높이가 다른 카드가 뜰 때마다 새로 흐렸다. 그런데 카드 끝에서 충분히 떨어진
    줄은 높이와 상관없이 똑같으므로, 한 번 흐린 본의 가운데 줄을 늘려 쓰면 된다.
    """
    from PIL import Image
    t = 2 * _shadow_reach()
    if h <= t:
        return _shadow_sheet(w, h)
    sheet = _shadow_sheet(w, t)
    W, H = w + PAD * 2, h + PAD * 2
    cut = PAD + t // 2                                # 본의 위 절반 = 아래 절반 높이
    out = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    out.paste(sheet.crop((0, 0, W, cut)), (0, 0))
    out.paste(sheet.crop((0, cut, W, cut * 2)), (0, H - cut))
    out.paste(sheet.crop((0, cut - 1, W, cut)).resize((W, H - cut * 2), Image.NEAREST), (0, cut))
    return out


@functools.lru_cache(maxsize=16)
def _card_face(w, h):
    """점토 면 + 결 + 경계선. 글자 없이.

    마우스를 올릴 때마다 카드를 새로 그리는데, 그중 대부분(6ms)이 이 바탕이었다.
    바탕은 크기가 같으면 늘 같으므로 기억해 두고, 받은 쪽이 .copy() 해서 그 위에 그린다.
    """
    from PIL import Image, ImageChops, ImageDraw
    face = Image.new("RGB", (w, h), _rgb(CARD))
    grad = Image.linear_gradient("L").resize((w, h))                       # 위 밝게 → 아래 조금 어둡게
    hi, lo = _rgb(WASH_HI), _rgb(WASH_LO)
    face = Image.merge("RGB", [grad.point(lambda v, a=a, b=b: a + (b - a) * v // 255)
                               for a, b in zip(hi, lo)])
    tex = _texture(w, h)
    face = Image.merge("RGB", [ImageChops.multiply(ch, tex) for ch in face.split()])
    card = face.convert("RGBA")
    card.putalpha(_rounded_mask(w, h, R))
    ring = Image.new("L", (w * 4, h * 4), 0)
    ImageDraw.Draw(ring).rounded_rectangle([0, 0, w * 4 - 1, h * 4 - 1], radius=R * 4,
                                           outline=255, width=max(4, int(4 * SCALE)))
    ring = ring.resize((w, h), Image.LANCZOS).point(lambda v: v * 70 // 255)
    edge = Image.new("RGBA", (w, h), _rgb(DARK) + (0,))
    edge.putalpha(ring)
    card.alpha_composite(edge)
    return card


@functools.lru_cache(maxsize=8)
def _x_mark(size, color, thick):
    from PIL import Image, ImageDraw
    n = size * 4
    m = Image.new("L", (n, n), 0)
    d = ImageDraw.Draw(m)
    p, wd = int(n * 0.14), max(1, int(thick * 4))
    d.line((p, p, n - 1 - p, n - 1 - p), fill=255, width=wd)
    d.line((p, n - 1 - p, n - 1 - p, p), fill=255, width=wd)
    layer = Image.new("RGBA", (size, size), _rgb(color) + (0,))
    layer.putalpha(m.resize((size, size), Image.LANCZOS))
    return layer


def _wash(name):
    """마우스를 올렸을 때 덮는 색. 창 화면(--hover · --hover-hi)과 같은 값이다."""
    r, g, b, a = tokens.rgba_tuple(name)
    return "#%02x%02x%02x" % (r, g, b), a


# 창 화면의 --rule2 · --rule 과 같은 선. 값은 tokens.py 에서만 온다.
RULE2 = tokens.rgba_tuple("rule2")
RULE1 = tokens.rgba_tuple("rule")


def _hline(card, x, y, w, color=RULE2):
    """1px 가로선. 배율이 커져도 굵어지지 않는다 (선은 선이다)."""
    from PIL import Image
    if w > 0:
        card.alpha_composite(Image.new("RGBA", (int(w), 1), color), (int(x), int(y)))


def _vline(card, x, y, h, color=RULE1):
    from PIL import Image
    if h > 0:
        card.alpha_composite(Image.new("RGBA", (1, int(h)), color), (int(x), int(y)))


def _blob(card, box, radius, color, alpha=255):
    """둥근 면 하나를 칠한다 (알약 · 강조).

    paste 로 붙이면 알파까지 덮어써서, 반투명한 색을 칠하면 그 자리가 카드에
    구멍이 된다 (바탕화면이 비쳐 시커멓게 보였다). 겹쳐 칠해야 한다.
    """
    from PIL import Image
    x, y, w, h = box
    if w <= 0 or h <= 0:
        return
    m = _rounded_mask(w, h, radius)
    if alpha < 255:
        m = m.point(lambda v, a=alpha: v * a // 255)
    layer = Image.new("RGBA", (w, h), _rgb(color) + (0,))
    layer.putalpha(m)
    card.alpha_composite(layer, (int(x), int(y)))


def _close(card, hover):
    size = CLOSE
    x, y = card.width - CLOSE_R - size, CLOSE_T
    if hover == "x":
        _blob(card, (x, y, size, size), s(9), *_wash("hover-hi"))
    mark = _x_mark(s(12), INK2 if hover == "x" else FAINT, 1.5 * SCALE)
    card.alpha_composite(mark, (x + (size - mark.width) // 2, y + (size - mark.height) // 2))
    return (x, y, size, size)


def _seg_row(card, acts, hover):
    """카드 아래를 가득 채우는 단추 줄.

    예전에는 왼쪽부터 글자 길이만큼 차지해서, 단추가 다 왼쪽에 몰리고
    오른쪽이 휑하게 비었다. 이제 카드 너비를 똑같이 나눠 갖는다 -
    창 화면의 오늘/달력 전환과 같은 생김새다.

    돌려주는 값은 각 단추를 누를 자리.
    """
    from PIL import ImageDraw
    d = ImageDraw.Draw(card)
    f = _font(500, N_ACT_PX)
    n = len(acts)
    top = card.height - N_ACT_H
    _hline(card, 0, top, card.width, RULE2)

    hits = {}
    edges = [int(round(card.width * k / float(n))) for k in range(n + 1)]
    for k, (name, label, kind) in enumerate(acts):
        x0, x1 = edges[k], edges[k + 1]
        if k:
            _vline(card, x0, top + N_SEG_PAD, N_ACT_H - N_SEG_PAD * 2, RULE1)
        if hover == name:
            _blob(card, (x0 + N_ACT_INSET, top + N_ACT_INSET,
                         x1 - x0 - N_ACT_INSET * 2, N_ACT_H - N_ACT_INSET * 2),
                  N_ACT_R, *_wash("hover-hi"))
        fill = MID_INK if kind == "primary" else (DEEP if kind == "late" else MUTED)
        d.text(((x0 + x1) / 2, top + N_ACT_H / 2 + s(1)), label, font=f, anchor="mm",
               fill=_rgb(fill) + (255,))
        hits[name] = (x0, top, x1 - x0, N_ACT_H)
    return hits


def _draw_normal(item, hover):
    """한 건짜리 카드 — 시각을 먼저.

    알림은 곁눈으로 보는 것이라 "언제" 가 먼저 읽혀야 한다. 창 화면의 큰
    시계와 같은 목소리(가는 획의 큰 숫자)를 써서, 어느 프로그램이 부르는
    것인지 한눈에 알게 한다.

    시각이 없는 알림(기한 없는 메모 · 안내 · 미리보기)은 시각 칸을 통째로
    비우고 제목이 그 자리까지 넓게 쓴다.
    """
    from PIL import ImageDraw
    f_time = _font(300, N_TIME_PX)      # 큰 숫자는 가는 획이 또렷하다
    f_rel = _font(400, N_REL_PX)
    f_ttl = _font(500, N_TTL_PX)
    f_sub = _font(400, N_SUB_PX)

    when = (item.get("when") or "").strip()
    rel = (item.get("rel") or "").strip()
    # 시각이 없으면 시각 칸을 두지 않는다 (빈 칸을 남기면 카드가 기울어 보인다)
    wx = N_MARGIN + N_BAR_W + N_BARGAP
    # 시각 잉크가 차지하는 실제 폭 (왼쪽 빈 자리를 뺀다)
    lsb_t = _lsb(300, N_TIME_PX, when[:1]) if when else 0
    time_w = int(round(f_time.getlength(when))) - lsb_t if when else 0
    tx = wx + ((time_w + N_COLGAP) if when else 0)
    # ✕ 는 첫 줄 옆에만 있다. 모든 줄이 그 자리를 비우면 긴 제목에서 둘째 줄이
    # 까닭 없이 짧아진다.
    tw_first = CW - tx - N_XCOL
    tw = CW - tx - N_MARGIN

    lines = _wrap(item["title"], f_ttl,
                  lambda k: tw_first if k == 0 else tw, TITLE_LINES)
    # 시각을 위로 뽑았으니 아래 줄은 "무엇인지"(루틴 · 매월 마지막 목요일)를 쓴다.
    # meta 를 주지 않은 옛 호출(안내 · 미리보기)은 예전처럼 sub 를 그대로 쓴다.
    under = item.get("meta") or item.get("sub") or ""
    subs = _wrap(under, f_sub, tw, SUB_LINES) if under else []

    time_h = (N_TIME_LH + (N_TIME_GAP + N_REL_LH if rel else 0)) if when else 0
    drop = max(0, f_time.getbbox("0")[1] - f_ttl.getbbox("가")[1]) if when else 0
    ttl_h = drop + len(lines) * N_TTL_LH + (N_TTL_GAP + len(subs) * N_SUB_LH if subs else 0)
    block = max(time_h, ttl_h)

    acts = []
    if item.get("on_done"):
        acts.append(("done", "완료", "late" if item.get("late") else "primary"))
    if item.get("on_snooze"):
        acts.append(("snooze", "10분 뒤", "ghost"))
    if item.get("can_open") and _open_handler is not None and item.get("on_done"):
        acts.append(("open", "열기", "ghost"))

    h = N_TOP + block + N_BOT + (N_ACT_H if acts else 0)
    card = _card_face(CW, h).copy()
    d = ImageDraw.Draw(card)

    # 종류 띠: 글자 덩어리와 같은 높이로 (예전에는 제목 줄에만 걸려 짧았다)
    bar = DEEP if item.get("late") else (MINT if item.get("info") else MID)
    _blob(card, (N_MARGIN, N_TOP + s(2), N_BAR_W, max(1, block - s(4))),
          max(1, N_BAR_W // 2), bar)

    if when:
        # 시각의 잉크가 wx 에서 시작하게 한다 (띠와의 간격이 시각마다 흔들리지 않게)
        d.text((wx - lsb_t, N_TOP - s(2)), when, font=f_time, fill=_rgb(DEEP) + (255,))
        # 아래 글자는 시각 아래 가운데로. 왼쪽을 맞추려 하면 어느 한쪽은 반드시
        # 어긋난다 - 큰 숫자의 세로 획은 글자 안쪽 깊숙이 있고(26px "1" 은 9px),
        # 작은 글자는 가장자리에 있다(11px "1" 은 3px). 눈은 획을 보므로 왼쪽 끝을
        # 맞춰도 획이 3px 어긋나 보인다. 창 화면의 링도 "큰 숫자 + 작은 라벨" 을
        # 이렇게 가운데로 맞춘다.
        cx = wx + time_w / 2.0
        if rel:
            ry = N_TOP + N_TIME_LH + N_TIME_GAP
            if item.get("late"):
                # 지난 것은 짙은 알약으로. 창 화면의 "지남" 표시와 같은 모양이라
                # 굳이 읽지 않아도 무슨 뜻인지 안다.
                pw = int(f_rel.getlength(rel)) + s(15)
                _blob(card, (int(cx - pw / 2), ry - s(2), pw, N_REL_LH + s(5)), s(7), DEEP)
                d.text((cx, ry + N_REL_LH / 2), rel, font=f_rel, anchor="mm",
                       fill=_rgb(ONMID) + (255,))
            else:
                d.text((cx, ry), rel, font=f_rel, anchor="ma", fill=_rgb(FAINT) + (255,))

    # 시각(26px)과 제목(14px)은 글자 위 빈 자리가 서로 달라서, 같은 y 에서
    # 시작하면 제목이 떠 보인다. 숫자와 한글의 "윗머리" 를 재서 맞춘다.
    y = N_TOP
    if when:
        y += max(0, f_time.getbbox("0")[1] - f_ttl.getbbox("가")[1])
    for ln in lines:
        d.text((tx, y), ln, font=f_ttl, fill=_rgb(INK2) + (255,))
        y += N_TTL_LH
    if subs:
        y += N_TTL_GAP
        for ln in subs:
            d.text((tx, y), ln, font=f_sub, fill=_rgb(FAINT) + (255,))
            y += N_SUB_LH

    hits = {"x": _close(card, hover)}
    if acts:
        hits.update(_seg_row(card, acts, hover))
    return card, hits


def _draw_list(item, hover):
    """여러 건을 한 장에: 아침 브리핑 · 놓친 알림 · 자리를 비운 동안 쌓인 알림."""
    from PIL import ImageDraw
    f_lab, f_ttl = _font(500, s(10)), _font(500, s(14.5))
    f_key, f_row, f_n = _font(400, s(10.5)), _font(500, s(11.5)), _font(500, s(11))
    f_pill, f_more = _font(500, s(9.5)), _font(500, s(10.5))
    rows = item["rows"][:LIST_MAX]
    more = item.get("more", 0)
    L = LIST_PAD
    head = s(15 + 14 + 3 + 20 + 9)
    h = head + len(rows) * LIST_ROW + (s(22) if more else s(4)) + s(13)

    card = _card_face(CW, h).copy()
    d = ImageDraw.Draw(card)
    d.text((L, s(15)), item.get("label", ""), font=f_lab, fill=_rgb(FAINT) + (255,))
    d.text((L, s(31)), item["title"], font=f_ttl, fill=_rgb(INK2) + (255,))
    d.text((CW - TR, s(35)), "%d건" % (len(item["rows"]) + more), font=f_n, anchor="ra",
           fill=_rgb(MID_INK) + (255,))
    y = head
    _hline(card, L, y, CW - L * 2, RULE2)
    for i, (key, name, over) in enumerate(rows):
        if i:
            _hline(card, L, y, CW - L * 2, RULE1)
        cy = y + LIST_ROW // 2
        d.text((L, cy), key or "—", font=f_key, anchor="lm", fill=_rgb(MID_INK) + (255,))
        pill_w = int(f_pill.getlength("지남")) + s(14) if over else 0
        wide = CW - L - (L + s(48)) - (pill_w + s(8) if over else 0)
        d.text((L + s(48), cy), _wrap(name, f_row, wide, 1)[0], font=f_row, anchor="lm",
               fill=_rgb(BODY) + (255,))
        if over:
            px = CW - L - pill_w
            _blob(card, (px, cy - s(8), pill_w, s(16)), s(6), DEEP)
            d.text((px + pill_w / 2, cy), "지남", font=f_pill, anchor="mm", fill=_rgb(ONMID) + (255,))
        y += LIST_ROW
    if more:
        d.text((L + s(48), y + s(6)), "그 외 %d건" % more, font=f_more, fill=_rgb(FAINT) + (255,))
    return card, {"x": _close(card, hover)}


def _draw_fold(item, hover):
    """3장을 넘으면 더 쌓지 않고 한 줄로 접는다. 누르면 앱 창이 열린다."""
    from PIL import ImageDraw
    h = FOLD_H
    card = _card_face(CW, h).copy()
    d = ImageDraw.Draw(card)
    f, f_c = _font(500, s(11.5)), _font(500, s(10.5))
    cx = s(18)
    chev = [(cx, h // 2 + s(3)), (cx + s(5), h // 2 - s(2)), (cx + s(10), h // 2 + s(3))]
    d.line(chev, fill=_rgb(INK2 if hover else MUTED) + (255,), width=max(1, int(2 * SCALE)), joint="curve")
    d.text((cx + s(20), h // 2), "밀린 알림 펼치기", font=f, anchor="lm",
           fill=_rgb(INK2 if hover else MUTED) + (255,))
    label = "+%d" % item.get("count", 0)
    pw = int(f_c.getlength(label)) + s(16)
    _blob(card, (CW - s(14) - pw, h // 2 - s(9), pw, s(18)), s(7), DEEP)
    d.text((CW - s(14) - pw / 2, h // 2), label, font=f_c, anchor="mm", fill=_rgb(ONMID) + (255,))
    return card, {"fold": (0, 0, CW, h)}


def _card_rgba(item, hover=None):
    """카드 한 장(그림자 포함)과 누를 수 있는 자리. 자리는 그림자 여백을 뺀 카드 기준."""
    if item.get("fold"):
        card, hits = _draw_fold(item, hover)
    elif item.get("rows") is not None:
        card, hits = _draw_list(item, hover)
    else:
        card, hits = _draw_normal(item, hover)
    img = _shadow(card.width, card.height).copy()
    img.alpha_composite(card, (PAD, PAD))
    return img, hits

# ---------------- 레이어드 윈도우 (GDI) ----------------
GWL_EXSTYLE = -20
WS_EX_LAYERED = 0x00080000
WS_EX_TOOLWINDOW = 0x00000080     # Alt+Tab · 작업표시줄에 안 잡히게
ULW_ALPHA = 0x00000002
AC_SRC_OVER, AC_SRC_ALPHA = 0x00, 0x01
BI_RGB, DIB_RGB_COLORS = 0, 0
PVOID = ctypes.c_void_p


class BLENDFUNCTION(ctypes.Structure):
    _fields_ = [("BlendOp", ctypes.c_byte), ("BlendFlags", ctypes.c_byte),
                ("SourceConstantAlpha", ctypes.c_byte), ("AlphaFormat", ctypes.c_byte)]


class BITMAPINFOHEADER(ctypes.Structure):
    _fields_ = [("biSize", wintypes.DWORD), ("biWidth", wintypes.LONG),
                ("biHeight", wintypes.LONG), ("biPlanes", wintypes.WORD),
                ("biBitCount", wintypes.WORD), ("biCompression", wintypes.DWORD),
                ("biSizeImage", wintypes.DWORD), ("biXPelsPerMeter", wintypes.LONG),
                ("biYPelsPerMeter", wintypes.LONG), ("biClrUsed", wintypes.DWORD),
                ("biClrImportant", wintypes.DWORD)]


# 이 모듈 전용 핸들을 쓴다. ctypes.windll.user32 는 프로세스 전체가 같이 쓰는 객체라
# 여기서 argtypes 를 바꾸면 pystray 같은 다른 코드의 호출까지 바뀐다.
# use_last_error 를 켜야 ctypes.get_last_error() 가 실제 오류 번호를 돌려준다.
U32 = ctypes.WinDLL("user32", use_last_error=True)
G32 = ctypes.WinDLL("gdi32", use_last_error=True)

# 핸들은 64비트다. restype 을 지정하지 않으면 c_long(32비트)으로 잘려서 실패한다.
U32.GetDC.restype = PVOID
U32.GetDC.argtypes = [PVOID]
U32.ReleaseDC.argtypes = [PVOID, PVOID]
U32.GetParent.restype = PVOID
U32.GetParent.argtypes = [PVOID]
U32.GetWindowLongW.restype = ctypes.c_long
U32.GetWindowLongW.argtypes = [PVOID, ctypes.c_int]
U32.SetWindowLongW.restype = ctypes.c_long
U32.SetWindowLongW.argtypes = [PVOID, ctypes.c_int, ctypes.c_long]
U32.UpdateLayeredWindow.restype = wintypes.BOOL
U32.UpdateLayeredWindow.argtypes = [
    PVOID, PVOID, ctypes.POINTER(wintypes.POINT), ctypes.POINTER(wintypes.SIZE),
    PVOID, ctypes.POINTER(wintypes.POINT), wintypes.DWORD,
    ctypes.POINTER(BLENDFUNCTION), wintypes.DWORD]
G32.CreateCompatibleDC.restype = PVOID
G32.CreateCompatibleDC.argtypes = [PVOID]
G32.CreateDIBSection.restype = PVOID
G32.CreateDIBSection.argtypes = [PVOID, PVOID, wintypes.UINT,
                                 ctypes.POINTER(PVOID), PVOID, wintypes.DWORD]
G32.SelectObject.restype = PVOID
G32.SelectObject.argtypes = [PVOID, PVOID]
G32.DeleteObject.argtypes = [PVOID]
G32.DeleteDC.argtypes = [PVOID]

# ---------------- 창 (순수 Win32) ----------------
# 예전에는 tkinter 를 창 껍데기와 타이머로만 썼는데, 그 하나 때문에 배포본에
# tcl/tk 가 6MB 들어갔다. 카드는 어차피 UpdateLayeredWindow 로 직접 그리므로
# 창과 이벤트 루프도 Win32 로 직접 다룬다.
WM_DESTROY, WM_TIMER = 0x0002, 0x0113
WM_MOUSEMOVE, WM_LBUTTONDOWN, WM_MOUSELEAVE = 0x0200, 0x0201, 0x02A3
WM_SETCURSOR = 0x0020
WS_POPUP = 0x80000000
WS_EX_TOPMOST, WS_EX_NOACTIVATE = 0x00000008, 0x08000000
SW_SHOWNOACTIVATE, SW_HIDE = 4, 0
SWP_NOACTIVATE, SWP_NOSIZE, SWP_NOZORDER = 0x0010, 0x0001, 0x0004
HWND_TOPMOST = -1
IDC_ARROW, IDC_HAND = 32512, 32649
TME_LEAVE = 0x00000002

LRESULT = ctypes.c_ssize_t
WPARAM = ctypes.c_size_t
LPARAM = ctypes.c_ssize_t
WNDPROC = ctypes.WINFUNCTYPE(LRESULT, PVOID, ctypes.c_uint, WPARAM, LPARAM)


class WNDCLASS(ctypes.Structure):
    _fields_ = [("style", wintypes.UINT), ("lpfnWndProc", WNDPROC),
                ("cbClsExtra", ctypes.c_int), ("cbWndExtra", ctypes.c_int),
                ("hInstance", PVOID), ("hIcon", PVOID), ("hCursor", PVOID),
                ("hbrBackground", PVOID), ("lpszMenuName", ctypes.c_wchar_p),
                ("lpszClassName", ctypes.c_wchar_p)]


class TRACKMOUSEEVENT(ctypes.Structure):
    _fields_ = [("cbSize", wintypes.DWORD), ("dwFlags", wintypes.DWORD),
                ("hwndTrack", PVOID), ("dwHoverTime", wintypes.DWORD)]


class MSG(ctypes.Structure):
    _fields_ = [("hwnd", PVOID), ("message", wintypes.UINT), ("wParam", WPARAM),
                ("lParam", LPARAM), ("time", wintypes.DWORD),
                ("pt_x", ctypes.c_long), ("pt_y", ctypes.c_long)]


U32.DefWindowProcW.restype = LRESULT
U32.DefWindowProcW.argtypes = [PVOID, ctypes.c_uint, WPARAM, LPARAM]
U32.CreateWindowExW.restype = PVOID
U32.CreateWindowExW.argtypes = [wintypes.DWORD, ctypes.c_wchar_p, ctypes.c_wchar_p,
                                wintypes.DWORD, ctypes.c_int, ctypes.c_int,
                                ctypes.c_int, ctypes.c_int, PVOID, PVOID, PVOID, PVOID]
U32.RegisterClassW.argtypes = [ctypes.POINTER(WNDCLASS)]
U32.SetWindowPos.argtypes = [PVOID, PVOID, ctypes.c_int, ctypes.c_int,
                             ctypes.c_int, ctypes.c_int, wintypes.UINT]
U32.SetTimer.restype = PVOID
U32.SetTimer.argtypes = [PVOID, PVOID, wintypes.UINT, PVOID]
U32.KillTimer.argtypes = [PVOID, PVOID]
U32.DestroyWindow.argtypes = [PVOID]
U32.ShowWindow.argtypes = [PVOID, ctypes.c_int]
U32.LoadCursorW.restype = PVOID
U32.LoadCursorW.argtypes = [PVOID, ctypes.c_wchar_p]
U32.SetCursor.restype = PVOID
U32.SetCursor.argtypes = [PVOID]
U32.GetMessageW.argtypes = [ctypes.POINTER(MSG), PVOID, wintypes.UINT, wintypes.UINT]
U32.TranslateMessage.argtypes = [ctypes.POINTER(MSG)]
U32.DispatchMessageW.argtypes = [ctypes.POINTER(MSG)]
U32.TrackMouseEvent.argtypes = [ctypes.POINTER(TRACKMOUSEEVENT)]

_cards = {}                     # hwnd -> Card
_ctrl = None                    # 타이머만 받는 숨은 창
_rate = 0                       # 지금 타이머 간격
_cursors = {}


def _cursor(which):
    if which not in _cursors:
        _cursors[which] = U32.LoadCursorW(None, ctypes.c_wchar_p(which))
    return _cursors[which]


def _lo(v):
    v &= 0xFFFF
    return v - 0x10000 if v > 0x7FFF else v

def _premultiplied_bgra(img):
    """PIL RGBA → 알파 미리곱한 BGRA 바이트."""
    from PIL import Image, ImageChops
    r, g, b, a = img.split()
    r = ImageChops.multiply(r, a)
    g = ImageChops.multiply(g, a)
    b = ImageChops.multiply(b, a)
    return Image.merge("RGBA", (b, g, r, a)).tobytes()


class _Surface:
    """카드 그림 한 장을 담아 두는 GDI 비트맵.

    예전에는 틀마다 그림을 다시 곱하고 복사해서 넘겼다. 이제 그림은 바뀔 때(처음 ·
    마우스 올림)만 올리고, 움직이는 동안에는 위치와 투명도만 넘긴다.
    """

    def __init__(self):
        self.mem_dc = self.hbmp = self.old = None
        self.size = (0, 0)

    def load(self, img):
        self.free()
        screen = U32.GetDC(None)
        try:
            self.mem_dc = G32.CreateCompatibleDC(screen)
            bi = BITMAPINFOHEADER()
            bi.biSize = ctypes.sizeof(BITMAPINFOHEADER)
            bi.biWidth, bi.biHeight = img.width, -img.height        # 음수 = 위에서 아래로
            bi.biPlanes, bi.biBitCount, bi.biCompression = 1, 32, BI_RGB
            bits = PVOID()
            self.hbmp = G32.CreateDIBSection(self.mem_dc, ctypes.byref(bi), DIB_RGB_COLORS,
                                             ctypes.byref(bits), None, 0)
            if not self.hbmp:
                raise OSError("CreateDIBSection failed")
            data = _premultiplied_bgra(img)
            ctypes.memmove(bits, data, len(data))
            self.old = G32.SelectObject(self.mem_dc, self.hbmp)
            self.size = img.size
        finally:
            U32.ReleaseDC(None, screen)

    def present(self, hwnd, x, y, alpha):
        a = max(0, min(255, int(round(alpha))))
        screen = U32.GetDC(None)
        try:
            pt = wintypes.POINT(int(round(x)), int(round(y)))
            size = wintypes.SIZE(*self.size)
            src = wintypes.POINT(0, 0)
            blend = BLENDFUNCTION(AC_SRC_OVER, 0, a - 256 if a > 127 else a, AC_SRC_ALPHA)
            if not U32.UpdateLayeredWindow(hwnd, screen, ctypes.byref(pt), ctypes.byref(size),
                                           self.mem_dc, ctypes.byref(src), 0,
                                           ctypes.byref(blend), ULW_ALPHA):
                raise OSError("UpdateLayeredWindow failed (%d)" % ctypes.get_last_error())
        finally:
            U32.ReleaseDC(None, screen)

    def free(self):
        if self.mem_dc:
            if self.old:
                G32.SelectObject(self.mem_dc, self.old)
            if self.hbmp:
                G32.DeleteObject(self.hbmp)
            G32.DeleteDC(self.mem_dc)
        self.mem_dc = self.hbmp = self.old = None


# ---------------- 움직임 ----------------
ENTER_MS, EXIT_MS, MOVE_MS = 360, 220, 220
SLIDE = 28                           # 등장할 때 오른쪽에서 미끄러지는 거리 (100% 기준)
FRAME_MS, IDLE_MS = 15, 400          # 움직일 때만 빠르게 (Windows 타이머 해상도 ≈ 15.6ms)


def _bezier(x1, y1, x2, y2):
    """CSS cubic-bezier 와 같은 곡선. 앱 화면과 알림 카드가 같은 속도로 움직이게 한다."""
    def bx(t):
        return 3 * (1 - t) ** 2 * t * x1 + 3 * (1 - t) * t ** 2 * x2 + t ** 3

    def by(t):
        return 3 * (1 - t) ** 2 * t * y1 + 3 * (1 - t) * t ** 2 * y2 + t ** 3

    def dbx(t):
        return 3 * (1 - t) ** 2 * x1 + 6 * (1 - t) * t * (x2 - x1) + 3 * t ** 2 * (1 - x2)

    def ease(x):
        if x <= 0:
            return 0.0
        if x >= 1:
            return 1.0
        t = x
        for _ in range(8):                           # 뉴턴법, 안 되면 이분법
            err = bx(t) - x
            if abs(err) < 1e-5:
                return by(t)
            d = dbx(t)
            if abs(d) < 1e-6:
                break
            t = min(1.0, max(0.0, t - err / d))
        lo, hi = 0.0, 1.0
        t = x
        for _ in range(30):
            if bx(t) < x:
                lo = t
            else:
                hi = t
            t = (lo + hi) / 2
        return by(t)

    return ease


EASE = _bezier(.2, .8, .2, 1)

def _open_app():
    """[열기] · 접힌 줄. 창 프로세스를 띄우는 데 시간이 걸리므로 메시지 루프를 막지 않는다."""
    fn = _open_handler
    if fn is not None:
        threading.Thread(target=lambda: _safe(fn, "open"), daemon=True).start()


class Card:
    """알림 카드 하나 = 레이어드 창 하나.

    자리(tx, ty)가 정해지면 매 틀 frame() 이 지금 위치 · 투명도를 계산해 넘긴다.
    등장: 오른쪽에서 미끄러지며 나타남 / 자리 이동: 새 자리로 부드럽게 / 퇴장: 투명도만.
    """

    def __init__(self, item):
        self.item = item
        self.hover = None
        self.over = False
        self.born = time.time()
        self.life = None if item.get("fold") else _life(item)
        self.grace_until = 0.0
        self.closing = False
        self.dead = False
        self.surface = _Surface()
        self.img, self.hits = _card_rgba(item)
        self.w, self.h = self.img.size
        self.hwnd = U32.CreateWindowExW(
            WS_EX_LAYERED | WS_EX_TOOLWINDOW | WS_EX_TOPMOST | WS_EX_NOACTIVATE,
            _CLASS_NAME, paths.APP_NAME + " 알림", WS_POPUP,
            0, 0, self.w, self.h, None, None, None, None)
        if not self.hwnd:
            raise OSError("CreateWindowEx 실패 (%d)" % ctypes.get_last_error())
        _cards[self.hwnd] = self
        self.surface.load(self.img)
        self.x = self.y = self.tx = self.ty = None
        self.from_xy = None
        self.move_t0 = self.enter_t0 = self.exit_t0 = None
        self.shown = None                    # 마지막으로 넘긴 (x, y, alpha)

    # --- 자리 ---
    def target(self, x, y, now):
        if self.tx is None:                  # 처음 자리: 여기서 등장한다
            self.x, self.y, self.tx, self.ty = x, y, x, y
            self.enter_t0 = now
            U32.ShowWindow(self.hwnd, SW_SHOWNOACTIVATE)
        elif (x, y) != (self.tx, self.ty):   # 다른 카드가 사라지거나 들어와서 자리가 바뀜
            self.from_xy = (self.x, self.y)
            self.tx, self.ty = x, y
            self.move_t0 = now

    def frame(self, now, motion):
        """이번 틀의 위치 · 투명도를 창에 넘긴다. 아직 움직이는 중이면 True."""
        if self.tx is None or self.dead:
            return False
        busy = False
        slide, alpha = 0.0, 255.0
        if self.enter_t0 is not None:
            p = min(1.0, (now - self.enter_t0) * 1000 / ENTER_MS) if motion else 1.0
            slide = (1 - EASE(p)) * s(SLIDE)
            alpha = 255 * EASE(min(1.0, p / 0.7))
            if p >= 1:
                self.enter_t0 = None
            else:
                busy = True
        if self.move_t0 is not None:
            p = min(1.0, (now - self.move_t0) * 1000 / MOVE_MS) if motion else 1.0
            e = EASE(p)
            fx, fy = self.from_xy
            self.x, self.y = fx + (self.tx - fx) * e, fy + (self.ty - fy) * e
            if p >= 1:
                self.move_t0 = None
            else:
                busy = True
        else:
            self.x, self.y = self.tx, self.ty
        if self.exit_t0 is not None:
            p = min(1.0, (now - self.exit_t0) * 1000 / EXIT_MS) if motion else 1.0
            alpha *= 1 - EASE(p)
            if p >= 1:
                self.dead = True
                return False
            busy = True
        state = (round(self.x + slide), round(self.y), round(alpha))
        if state != self.shown:
            try:
                self.surface.present(self.hwnd, *state)
                self.shown = state
            except Exception:
                paths.log("toast.present 실패: " + traceback.format_exc())
        return busy

    def redraw(self):
        """마우스 올림 · 건수 변화처럼 그림이 바뀔 때만."""
        try:
            self.img, self.hits = _card_rgba(self.item, self.hover)
            self.surface.load(self.img)
            self.shown = None
        except Exception:
            paths.log("toast.redraw 실패: " + traceback.format_exc())

    # --- 마우스 ---
    def _hit(self, x, y):
        cx, cy = x - PAD, y - PAD
        for name, (bx, by, bw, bh) in self.hits.items():
            if name != "fold" and bx <= cx <= bx + bw and by <= cy <= by + bh:
                return name
        if "fold" in self.hits:
            bx, by, bw, bh = self.hits["fold"]
            if bx <= cx <= bx + bw and by <= cy <= by + bh:
                return "fold"
        return None

    def on_move(self, x, y):
        if not self.over:
            self.over = True
            tme = TRACKMOUSEEVENT(ctypes.sizeof(TRACKMOUSEEVENT), TME_LEAVE, self.hwnd, 0)
            U32.TrackMouseEvent(ctypes.byref(tme))
        t = self._hit(x, y)
        if t != self.hover:
            self.hover = t
            self.redraw()
            self.frame(time.time(), _motion())

    def on_leave(self):
        self.over = False
        self.grace_until = time.time() + LEAVE_GRACE_S
        if self.hover is not None:
            self.hover = None
            self.redraw()
            self.frame(time.time(), _motion())

    def on_click(self, x, y):
        t = self._hit(x, y)
        cb = {"done": self.item.get("on_done"), "snooze": self.item.get("on_snooze")}.get(t)
        if cb:
            _safe(cb, "toast " + t)
        if t in ("open", "fold"):
            _open_app()
            if t == "fold":
                del _pending[:]
        # 버튼이 없는 카드(브리핑 · 안내)는 아무 데나 눌러도 닫힌다
        if t is not None or not any(k in self.hits for k in ("done", "snooze", "open")):
            self.close()

    # --- 수명 ---
    def close(self):
        if not self.closing:
            self.closing = True
            self.exit_t0 = time.time()

    def destroy(self):
        _cards.pop(self.hwnd, None)
        if self in _live:
            _live.remove(self)
        self.surface.free()
        try:
            U32.DestroyWindow(self.hwnd)
        except Exception:
            pass

def _wndproc(hwnd, msg, wp, lp):
    if msg == WM_TIMER:
        if hwnd == _ctrl:
            _pump()
        return 0
    card = _cards.get(hwnd)
    if card is not None:
        if msg == WM_MOUSEMOVE:
            card.on_move(_lo(lp), _lo(lp >> 16))
            return 0
        if msg == WM_LBUTTONDOWN:
            card.on_click(_lo(lp), _lo(lp >> 16))
            return 0
        if msg == WM_MOUSELEAVE:
            card.on_leave()
            return 0
        if msg == WM_SETCURSOR:
            U32.SetCursor(_cursor(IDC_HAND if card.hover else IDC_ARROW))
            return 1
        if msg == WM_DESTROY:
            _cards.pop(hwnd, None)
            return 0
    return U32.DefWindowProcW(hwnd, msg, wp, lp)


_WNDPROC_REF = WNDPROC(_wndproc)      # 살려 둬야 한다. 가비지가 되면 즉시 죽는다
_CLASS_NAME = "LazySchedulerToast"


def _register():
    wc = WNDCLASS()
    wc.style = 0x0020                  # CS_OWNDC 아님: CS_HREDRAW/VREDRAW 불필요
    wc.lpfnWndProc = _WNDPROC_REF
    wc.hInstance = None
    wc.hCursor = _cursor(IDC_ARROW)
    wc.lpszClassName = _CLASS_NAME
    if not U32.RegisterClassW(ctypes.byref(wc)):
        err = ctypes.get_last_error()
        if err != 1410:                # ERROR_CLASS_ALREADY_EXISTS
            raise OSError("RegisterClass 실패 (%d)" % err)


# ---------------- 어느 화면에 · 지금 띄워도 되는가 ----------------

MONITOR_DEFAULTTONEAREST = 2
QUNS_ACCEPTS_NOTIFICATIONS = 5     # 이 값일 때만 "지금 알려도 된다"

# 핸들을 돌려주는 함수는 restype 을 밝혀 둬야 한다.
# 기본값(c_int)이면 64비트에서 핸들 위쪽 절반이 잘려 엉뚱한 값이 된다.
try:
    U32.GetForegroundWindow.restype = wintypes.HWND
    U32.GetShellWindow.restype = wintypes.HWND
    U32.MonitorFromWindow.restype = ctypes.c_void_p
    U32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    U32.MonitorFromPoint.restype = ctypes.c_void_p
except AttributeError:
    pass


_monitor_info = win32.monitor_info


def _active_monitor():
    """지금 보고 있는 화면. 앞에 있는 창의 모니터, 없으면 마우스가 있는 모니터."""
    try:
        h = U32.GetForegroundWindow()
        if h:
            return U32.MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST)
        pt = wintypes.POINT()
        if U32.GetCursorPos(ctypes.byref(pt)):
            return U32.MonitorFromPoint(pt, MONITOR_DEFAULTTONEAREST)
    except Exception:
        pass
    return None


def _work_area():
    """작업표시줄을 뺀 화면 영역. 화면 크기로 계산하면 카드가 작업표시줄에 가린다.

    예전에는 SPI_GETWORKAREA 로 주 모니터만 봤다. 노트북에 외장 모니터를 붙이면
    지금 보고 있는 화면이 아니라 늘 주 모니터에 카드가 떠서, 다른 화면을 보고
    있으면 알림을 통째로 놓쳤다. 이제는 활성 창이 있는 모니터에 띄운다.
    """
    try:
        mi = _monitor_info(_active_monitor())
        if mi is not None:
            w = mi.rcWork
            if w.right > w.left and w.bottom > w.top:
                return w.left, w.top, w.right, w.bottom
    except Exception:
        pass
    try:
        r = wintypes.RECT()
        if U32.SystemParametersInfoW(0x0030, 0, ctypes.byref(r), 0):   # SPI_GETWORKAREA
            return r.left, r.top, r.right, r.bottom
    except Exception:
        pass
    return 0, 0, U32.GetSystemMetrics(0), U32.GetSystemMetrics(1)


def _foreground_is_fullscreen():
    """앞에 있는 창이 모니터를 통째로 덮고 있는가 (발표 · 영상 · 게임)."""
    try:
        h = U32.GetForegroundWindow()
        if not h or h == U32.GetShellWindow():
            return False
        cls = ctypes.create_unicode_buffer(64)
        U32.GetClassNameW(h, cls, 64)
        # 바탕화면 · 작업표시줄은 전체 화면이어도 방해가 아니다
        if cls.value in ("Progman", "WorkerW", "Shell_TrayWnd", "Windows.UI.Core.CoreWindow"):
            return False
        r = wintypes.RECT()
        if not U32.GetWindowRect(h, ctypes.byref(r)):
            return False
        mi = _monitor_info(U32.MonitorFromWindow(h, MONITOR_DEFAULTTONEAREST))
        if mi is None:
            return False
        m = mi.rcMonitor
        return (r.left <= m.left and r.top <= m.top
                and r.right >= m.right and r.bottom >= m.bottom)
    except Exception:
        return False


def _should_hold():
    """지금 카드를 띄우면 안 되는 상황인가.

    발표 중에 개인 일정이 화면에 뜨는 것이 이 프로그램에서 가장 곤란한 사고다.
    화면 공유 · 전체 화면 발표 · 집중 지원(방해 금지) · 잠금 화면이 모두 여기 걸린다.
    Windows 가 알려주는 상태를 먼저 믿고, 그것이 없으면 직접 전체 화면을 본다.
    """
    if not HOLD_WHEN_BUSY:
        return False
    try:
        st = ctypes.c_int()
        if ctypes.windll.shell32.SHQueryUserNotificationState(ctypes.byref(st)) == 0:
            return st.value != QUNS_ACCEPTS_NOTIFICATIONS
    except Exception:
        pass
    return _foreground_is_fullscreen()

# ---------------- 쌓기 · 수명 · 보류 ----------------
# 카드가 떠 있는 시간 (초). 11초였는데 "보기도 전에 사라진다" 는 말을 들었다.
LIFE_S = 30                   # 보통 알림
LIFE_LIST_S = 45              # 여러 건을 묶은 카드 (아침 브리핑 · 놓친 알림 · 보류했던 알림)
LEAVE_GRACE_S = 5             # 마우스를 뗀 뒤 다시 셀 때까지의 여유
# 마감이 지난 알림은 저절로 닫지 않는다 - 완료 · 10분 뒤 · ✕ 중 하나를 누를 때까지 남는다.


def _life(item):
    """이 알림이 저절로 닫히기까지의 초. None 이면 직접 닫을 때까지."""
    if item.get("rows") is not None:
        return LIFE_LIST_S
    if item.get("late"):
        return None
    return LIFE_S


MAX_CARDS = 3
# 발표 · 화면 공유 중에는 카드를 띄우지 않고 모아 둔다. 설정에서 끌 수 있다.
HOLD_WHEN_BUSY = True
_held = []                    # 보류해 둔 알림 (버리지 않는다)
_live = []                    # 화면에 떠 있는 카드 (접힌 줄은 따로)
_pending = []                 # 3장이 차서 기다리는 알림 → 접힌 줄의 +N
_fold = None                  # "밀린 알림 펼치기" 줄


def _safe(fn, tag):
    try:
        fn()
    except Exception:
        paths.log("toast %s 실패: %s" % (tag, traceback.format_exc()))


def _flush_held():
    """보류해 둔 알림을 한 장으로 묶는다. 밀린 것을 한꺼번에 쏟아내지 않는다."""
    global _held
    items, _held = _held, []
    if not items:
        return
    rows = [(it.get("hold_at", ""), it.get("title", ""), bool(it.get("late")))
            for it in items[:LIST_MAX]]
    paths.log("toast: 보류했던 알림 %d건을 묶어 띄운다" % len(items))
    _queue.put({
        "title": "자리를 비운 동안 %d건" % len(items),
        "sub": "", "late": False, "on_done": None,
        "key": "held-%d" % int(time.time()),
        "label": "밀린 알림", "rows": rows,
        "more": max(0, len(items) - LIST_MAX),
    })


def held_count():
    """보류 중인 알림 수 (트레이 아이콘 표시용)."""
    return len(_held)


def _system_scale():
    """시스템 화면 배율. 프로세스가 DPI 를 안다고 선언했을 때만 실제 값이 나온다."""
    try:
        dpi = U32.GetDpiForSystem()               # Windows 10 1607+
        if dpi:
            return dpi / 96.0
    except (AttributeError, OSError):
        pass
    return 1.0


_motion_state = {"at": 0.0, "on": True}


def _motion():
    """Windows '애니메이션 효과' 설정. 끄면 카드는 미끄러지지 않고 곧바로 나타난다."""
    now = time.time()
    if now - _motion_state["at"] > 5:
        _motion_state["at"] = now
        try:
            v = wintypes.BOOL()
            if U32.SystemParametersInfoW(0x1042, 0, ctypes.byref(v), 0):   # SPI_GETCLIENTAREAANIMATION
                _motion_state["on"] = bool(v.value)
        except Exception:
            pass
    return _motion_state["on"]


def _layout(now):
    """오른쪽 아래에서 위로 쌓는다. 가장 새 카드가 가장 아래(눈에 가까운 쪽), 접힌 줄은 맨 위.

    닫히는 카드는 자리에서 빼서, 남은 카드가 사라지는 카드와 함께 미끄러져 내려오게 한다.
    """
    left, top, right, bottom = _work_area()
    y = bottom - s(12)
    stack = [c for c in reversed(_live) if not c.closing]
    if _fold is not None and not _fold.closing:
        stack.append(_fold)
    for card in stack:
        y -= card.h - PAD * 2
        card.target(right - card.w + PAD - s(16), y - PAD, now)
        y -= GAP


def _set_rate(ms):
    """타이머 간격. 놀 때까지 틀 단위로 돌 이유가 없다."""
    global _rate
    if ms == _rate:
        return
    if _rate:
        U32.KillTimer(_ctrl, PVOID(1))
    U32.SetTimer(_ctrl, PVOID(1), ms, None)
    _rate = ms


def _sync_fold():
    """기다리는 알림 수에 맞춰 접힌 줄을 만들고 · 고치고 · 닫는다. 바뀌었으면 True."""
    global _fold
    n = len(_pending)
    if _fold is None:
        if n:
            _fold = Card({"fold": True, "count": n})
            return True
        return False
    if _fold.closing:
        return False
    if n == 0:
        _fold.close()
        return True
    if _fold.item.get("count") != n:
        _fold.item["count"] = n
        _fold.redraw()
    return False


def _pump():
    """큐 처리 + 쌓기 + 수명 + 틀 그리기. 무슨 일이 있어도 죽지 않는다."""
    global _fold
    if not getattr(_pump, "_logged", False):
        _pump._logged = True
        paths.log("toast._pump: 첫 실행")
    try:
        now = time.time()
        changed = False
        # 발표 · 전체 화면 · 방해 금지 중에는 띄우지 않고 모아 둔다 (1초에 한 번 확인)
        if now - getattr(_pump, "_hold_at", 0) > 1.0:
            _pump._hold_at = now
            _pump._holding = _should_hold()
        holding = getattr(_pump, "_holding", False)

        while True:                                     # 새 알림
            try:
                item = _queue.get_nowait()
            except queue.Empty:
                break
            if holding and not item.get("rows"):
                # 묶음 카드(rows)는 이미 보류를 푼 뒤에 만든 것이라 다시 잡지 않는다
                item.setdefault("hold_at", time.strftime("%H:%M"))
                _held.append(item)
                if len(_held) > 40:                     # 무한히 쌓이지 않게
                    del _held[:-40]
                continue
            _pending.append(item)

        if not holding and _held:                       # 평소 화면으로 돌아왔으면 한 장으로
            _flush_held()

        while _pending and sum(1 for c in _live if not c.closing) < MAX_CARDS:
            try:
                _live.append(Card(_pending.pop(0)))
                changed = True
            except Exception:
                paths.log("toast: " + traceback.format_exc())
        if _sync_fold():
            changed = True

        for card in list(_live):                        # 수명
            if card.closing:
                continue
            age = now - card.born
            # 마우스를 올려 둔 동안은 닫지 않는다. 뗀 뒤에는 잠깐 여유를 둔다.
            if card.life is not None and age > card.life and not card.over and now > card.grace_until:
                card.close()
                changed = True

        if changed:
            _layout(now)

        motion = _motion()
        busy, gone = False, False
        for card in list(_live) + ([_fold] if _fold is not None else []):
            if card.frame(now, motion):
                busy = True
            if card.dead:
                card.destroy()
                if card is _fold:
                    _fold = None
                gone = True
        if gone:
            _layout(now)
            busy = True
        _set_rate(FRAME_MS if busy else IDLE_MS)
    except Exception:
        paths.log("toast: " + traceback.format_exc())


def prewarm():
    """처음 뜨는 카드가 멈칫하지 않게 무거운 준비를 미리 해 둔다.

    글꼴을 처음 여는 순간(FreeType 을 깨우는 일)에만 0.2초가 넘게 걸린다. 결 · 그림자
    본을 짓는 데도 수십 ms 가 든다. 예전에는 이것이 첫 알림 때 메시지 루프 안에서
    일어나, 그 사이 이미 떠 있던 카드의 움직임이 멈췄다.
    세 가지 카드를 한 번씩 그려 버리면 쓰는 글꼴 · 결 · 그림자 본이 모두 준비된다.
    """
    started = time.perf_counter()
    samples = (
        {"title": "알림", "when": "10:00", "rel": "10분 뒤", "meta": "루틴",
         "on_done": _noop, "on_snooze": _noop, "can_open": True},
        {"title": "알림", "when": "10:00", "rel": "지남", "late": True, "on_done": _noop},
        {"title": "알림", "sub": "안내"},
        {"title": "알림", "label": "브리핑", "rows": [("10:00", "알림", True)], "more": 1},
        {"fold": True, "count": 1},
    )
    for item in samples:
        _card_rgba(item)
    for ch in "0123456789":                      # 시각의 첫 글자 (왼쪽 빈 자리를 재 둔다)
        _lsb(300, N_TIME_PX, ch)
    paths.log("toast.prewarm: %.0f ms" % ((time.perf_counter() - started) * 1000))


def _noop():
    pass


def run_forever(on_ready=None):
    """메인 스레드에서 호출. Win32 메시지 루프를 돈다."""
    global _ctrl
    set_scale(_system_scale())
    paths.log("toast.run_forever: 창 클래스 등록 (배율 %.2f)" % SCALE)
    _register()
    _ctrl = U32.CreateWindowExW(0, _CLASS_NAME, paths.APP_NAME, WS_POPUP,
                                0, 0, 0, 0, None, None, None, None)
    if not _ctrl:
        raise OSError("타이머용 창 생성 실패 (%d)" % ctypes.get_last_error())
    _set_rate(IDLE_MS)
    # 준비는 따로 돈다. 메시지 루프(트레이 · 창 열기)를 그만큼 늦추지 않는다.
    # 준비가 끝나기 전에 알림이 오더라도 그림은 같다 - 기억해 둔 것을 나눠 쓸 뿐이다.
    threading.Thread(target=lambda: _safe(prewarm, "prewarm"), daemon=True).start()
    if on_ready:
        _safe(on_ready, "on_ready")
    paths.log("toast.run_forever: 메시지 루프 진입")
    msg = MSG()
    while U32.GetMessageW(ctypes.byref(msg), None, 0, 0) > 0:
        U32.TranslateMessage(ctypes.byref(msg))
        U32.DispatchMessageW(ctypes.byref(msg))
