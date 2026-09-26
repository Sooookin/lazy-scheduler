# -*- coding: utf-8 -*-
"""앱 아이콘을 각 크기마다 새로 그린다 (python tools/gen_icon.py).

참고 도안 'LazyScheduler 앱 아이콘' 확정안(8a)을 그대로 옮긴다 - 저녁 하늘에 뜬
청록 달(속에 체크), 겹겹의 언덕 둘과 땅, 그 앞에 무게중심을 아래로 내린 흰 돌멩이
(게으름뱅이). 좌표는 도안의 160×160 자 그대로이고, 판은 22.5% 둥근 사각형이다.

도안은 크기마다 그림을 따로 둔다. 큰 그림을 줄이면 작은 크기에서 선이 뭉개지고
눈이 사라지기 때문이다.
  full  (96px 이상)  달과 돌의 그림자 · 달의 옅은 테 · 언덕 윗날 1.4
  mid   (40 ~ 64px)  테를 빼고 윗날을 2 로 굵힌다 · 돌의 그림자는 뺀다
  small (32px 이하)  그림자 · 윗날을 모두 빼고, 달 · 체크 · 돌 · 눈을 키운다 (흰자 없이 검은 눈)
각 크기를 8배로 그린 뒤 LANCZOS 로 줄인다.

색은 tokens.ICON 에서 가져온다.
결과: assets/app.ico (16~256 다중 해상도) · web/icon*.png (창 · 트레이용)
"""
import os
import re
import sys

from PIL import Image, ImageDraw, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)
import tokens  # noqa: E402

SIZES = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256]
C = tokens.ICON

# ── 도안의 도형 (160 자) ──
MOON = (80, 62)
CHECK = "M58 60 L74 76 L104 44"
CHECK_S = "M56 60 L74 78 L106 42"                       # small: 더 크고 굵은 체크
HILL1 = "M0 100 C40 84 100 114 160 94"
HILL2 = "M0 122 C50 108 110 134 160 116"
GROUND_Y = 142
STONE = "M48 130 C48 108 61 97 80 97 S112 108 112 130 C112 140 99 146 80 146 S48 140 48 130Z"
STONE_S = "M46 130 C46 106 60 94 80 94 S114 106 114 130 C114 141 100 147 80 147 S46 141 46 130Z"


def _rgb(h, a=255):
    h = h.lstrip("#")
    return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4)) + (a,)


def _path(d, steps=48):
    """M · L · C · S · Z (절대 좌표)만 쓰는 SVG 경로를 점 목록으로."""
    tok = re.findall(r"[MLCSZ]|-?\d*\.?\d+", d)
    pts, i, cur, last_c2, cmd = [], 0, (0.0, 0.0), None, None
    while i < len(tok):
        if tok[i].isalpha():
            cmd = tok[i]; i += 1
            if cmd == "Z":
                continue
        nums = lambda k: [float(v) for v in tok[i:i + k]]   # noqa: E731
        if cmd == "M" or cmd == "L":
            cur = tuple(nums(2)); i += 2; pts.append(cur); last_c2 = None
        elif cmd in "CS":
            if cmd == "C":
                v = nums(6); i += 6
                c1, c2, end = (v[0], v[1]), (v[2], v[3]), (v[4], v[5])
            else:
                v = nums(4); i += 4
                c1 = (2 * cur[0] - last_c2[0], 2 * cur[1] - last_c2[1]) if last_c2 else cur
                c2, end = (v[0], v[1]), (v[2], v[3])
            p0 = cur
            for k in range(1, steps + 1):
                t = k / steps; u = 1 - t
                pts.append((u ** 3 * p0[0] + 3 * u * u * t * c1[0] + 3 * u * t * t * c2[0] + t ** 3 * end[0],
                            u ** 3 * p0[1] + 3 * u * u * t * c1[1] + 3 * u * t * t * c2[1] + t ** 3 * end[1]))
            cur, last_c2 = end, c2
    return pts


class Canvas:
    """160 자의 도안을 n×n 화판 위의 box 에 옮겨 그린다."""

    def __init__(self, n, box):
        self.n, self.x0, self.y0 = n, box[0], box[1]
        self.u = (box[2] - box[0]) / 160.0
        self.im = Image.new("RGBA", (n, n), (0, 0, 0, 0))

    def P(self, pts):
        return [(self.x0 + x * self.u, self.y0 + y * self.u) for x, y in pts]

    def layer(self):
        return Image.new("RGBA", (self.n, self.n), (0, 0, 0, 0))

    def put(self, lay, shadow=None):
        """lay 를 얹는다. shadow = (dy, 흐림, 짙기) - 도안의 feDropShadow (도안 자 단위)."""
        if shadow:
            dy, std, op = shadow
            src = lay.getchannel("A").point(lambda v: int(v * op))
            a = Image.new("L", lay.size, 0)                  # 밀어낸 자리는 비운다 (감아 돌리지 않는다)
            a.paste(src, (0, int(round(dy * self.u))))
            a = a.filter(ImageFilter.GaussianBlur(std * self.u))
            sh = Image.new("RGBA", lay.size, _rgb(C["shadow"]))
            sh.putalpha(a)
            self.im.alpha_composite(sh)
        self.im.alpha_composite(lay)

    def fill(self, pts, color, shadow=None):
        lay = self.layer()
        ImageDraw.Draw(lay).polygon(self.P(pts), fill=color)
        self.put(lay, shadow)

    def circle(self, c, r, color, shadow=None, width=0):
        lay = self.layer()
        x, y = self.x0 + c[0] * self.u, self.y0 + c[1] * self.u
        R = r * self.u
        d = ImageDraw.Draw(lay)
        if width:
            d.ellipse([x - R, y - R, x + R, y + R], outline=color, width=max(1, round(width * self.u)))
        else:
            d.ellipse([x - R, y - R, x + R, y + R], fill=color)
        self.put(lay, shadow)

    def stroke(self, pts, color, width, caps=True):
        lay = self.layer()
        d, q, w = ImageDraw.Draw(lay), self.P(pts), max(1, round(width * self.u))
        d.line(q, fill=color, width=w, joint="curve")
        if caps:
            for x, y in (q[0], q[-1]):
                d.ellipse([x - w / 2, y - w / 2, x + w / 2, y + w / 2], fill=color)
        self.im.alpha_composite(lay)


def _land(line):
    """언덕 윗날 아래를 판 끝까지 채운 도형"""
    return _path(line) + [(160, 160), (0, 160)]


def draw(px):
    S = 8                                            # 수퍼샘플링 배수
    n = px * S
    tier = "small" if px <= 32 else "mid" if px <= 64 else "full"
    # 작업 표시줄 · 바탕화면에서 옆 아이콘과 크기가 맞게 판 둘레에 조금 여백을 둔다.
    # 작은 크기는 여백을 줄여야 실제로 커 보인다.
    pad = round(n * (0.03 if px <= 24 else 0.05))
    box = (pad, pad, n - pad, n - pad)
    cv = Canvas(n, box)
    SH = None if tier == "small" else (5, 3.5, .55)         # 달 · 돌이 드리우는 그림자 (f-sh)
    PA = None if tier == "small" else (-6, 5, .6)           # 언덕이 뒤로 드리우는 그림자 (f-pa)
    edge = {"full": 1.4, "mid": 2.0}.get(tier)              # 언덕 윗날

    cv.fill([(0, 0), (160, 0), (160, 160), (0, 160)], _rgb(C["sky"]))
    if tier == "small":
        cv.circle(MOON, 56, _rgb(C["moon"]))
        cv.stroke(_path(CHECK_S), _rgb(C["check"]), 14)
    else:
        cv.circle(MOON, 54, _rgb(C["moon"]), SH)
        if tier == "full":
            cv.circle(MOON, 54, (255, 255, 255, 102), width=1.5)
        cv.stroke(_path(CHECK), _rgb(C["check"]), 11)
    for line, color, op in ((HILL1, "hill1", .5), (HILL2, "hill2", .45)):
        cv.fill(_land(line), _rgb(C[color]), PA)
        if edge:
            cv.stroke(_path(line), (255, 255, 255, round(255 * op)), edge, caps=False)
    cv.fill([(0, GROUND_Y), (160, GROUND_Y), (160, 160), (0, 160)], _rgb(C["ground"]), PA)
    if edge:
        cv.stroke([(0, GROUND_Y), (160, GROUND_Y)], (255, 255, 255, 115), edge, caps=False)
    tiny = px <= 24
    if tier == "small":
        cv.fill(_path(STONE_S), _rgb(C["stone"]))
        if not tiny:
            for x in (71, 89):
                cv.circle((x, 118), 4.6, _rgb(C["eye"]))
    else:
        cv.fill(_path(STONE), _rgb(C["stone"]), SH if tier == "full" else None)
        for x in (71, 89):
            cv.circle((x, 119), 5, _rgb(C["white"]))
            cv.circle((x + .6, 118.4), 2.8, _rgb(C["eye"]))

    # 판: 22.5% 둥근 사각형 (도안의 마스크). 그 밖으로는 아무것도 나가지 않는다.
    mask = Image.new("L", (n, n), 0)
    side = box[2] - box[0]
    ImageDraw.Draw(mask).rounded_rectangle(box, radius=side * .225, fill=255)
    out = Image.new("RGBA", (n, n), (0, 0, 0, 0))
    out.paste(cv.im, (0, 0), mask)
    out = out.resize((px, px), Image.LANCZOS)
    if tiny:
        # 24px 이하에서는 두 눈의 사이가 2px 남짓이라, 줄이면 한 줄의 검은 띠로
        # 뭉친다. 눈만은 화면 픽셀에 맞춰 한 점씩, 사이를 2px 띄워 찍는다.
        cx = (box[0] + 80 * cv.u) / S
        cy = int((box[1] + 118 * cv.u) / S)
        for x in (int(cx - 1.5), int(cx + 1.5)):
            out.putpixel((x, cy), _rgb(C["eye"]))
    return out


# 화면에서 직접 쓰는 크기는 PNG 로도 따로 내보낸다.
# 큰 PNG 하나를 브라우저나 트레이가 축소하면 흐려지기 때문.
WEB_PNGS = [16, 32, 256]


def main():
    frames = [draw(s) for s in SIZES]
    by_size = dict(zip(SIZES, frames))
    for n in WEB_PNGS:
        img = by_size.get(n) or draw(n)
        name = "icon.png" if n == 256 else f"icon-{n}.png"
        img.save(os.path.join(ROOT, "web", name))
        print("web/" + name)
    # Pillow 의 ICO 저장은 sizes 로 넘긴 크기를 스스로 축소하므로,
    # 크기별로 따로 그린 프레임을 append_images 로 직접 넣는다.
    frames[-1].save(os.path.join(ROOT, "assets", "app.ico"), format="ICO",
                    sizes=[(s, s) for s in SIZES],
                    append_images=frames[:-1])
    print("app.ico:", ", ".join(str(s) for s in SIZES))


def preview(path):
    """밝은 · 어두운 작업 표시줄 위에 크기별로 늘어놓은 시안 한 장."""
    sizes = [16, 24, 32, 48, 64, 128, 256]
    W = sum(sizes) + 20 * (len(sizes) + 1)
    sheet = Image.new("RGBA", (W, 2 * 276), (0, 0, 0, 255))
    for row, bg in enumerate([(243, 243, 243, 255), (32, 32, 32, 255)]):
        band = Image.new("RGBA", (W, 276), bg)
        x = 20
        for s in sizes:
            band.alpha_composite(draw(s), (x, 138 - s // 2))
            x += s + 20
        sheet.paste(band, (0, row * 276))
    sheet.save(path)


if __name__ == "__main__":
    if len(sys.argv) > 2 and sys.argv[1] == "--preview":
        preview(sys.argv[2])
    else:
        main()
