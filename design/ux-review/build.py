# -*- coding: utf-8 -*-
"""Builds the UX review boards: src/*.dc.html -> *.dc.html with the app's real tokens,
a shared base stylesheet and the Paperlogy faces (subset to the characters used, woff2).

    python design/ux-review/build.py
"""
import base64
import glob
import io
import os
import sys

from fontTools import subset
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(HERE))
sys.path.insert(0, ROOT)
import tokens  # noqa: E402  (the app's single source of colours)

SHOTS = r"C:\Users\rnjsi\AppData\Local\Temp\claude\C--Users-rnjsi-Desktop-todo-manager\ba1e7ca4-239d-4354-b60c-5de96681c4be\scratchpad\qa"
FACES = [(300, "Paperlogy-3Light.ttf"), (400, "Paperlogy-4Regular.ttf"), (500, "Paperlogy-5Medium.ttf")]

GRAIN = ("url(\"data:image/svg+xml," + "%3Csvg xmlns='http://www.w3.org/2000/svg' width='220' height='220'%3E"
         "%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='2' stitchTiles='stitch'/%3E"
         "%3CfeColorMatrix values='0 0 0 0 .22  0 0 0 0 .19  0 0 0 0 .14  0 0 0 .55 0'/%3E%3C/filter%3E"
         "%3Crect width='220' height='220' filter='url(%23n)'/%3E%3C/svg%3E\")")

BASE = """
    *{box-sizing:border-box}
    html,body{margin:0}
    body{background:var(--bg); color:var(--body); font-family:"Paperlogy","Malgun Gothic",sans-serif;
      font-weight:500; letter-spacing:-.2px; -webkit-font-smoothing:antialiased; font-feature-settings:"tnum" 1}
    .paper{position:relative; overflow:hidden; background:var(--bg); background-image:var(--wash)}
    /* paper grain on top of everything, multiplied, so it never changes how anything is laid out */
    .grain{position:absolute; inset:0; pointer-events:none; opacity:.16; background-image:__GRAIN__; background-size:220px 220px;
      z-index:50; mix-blend-mode:multiply}
    .card{background:var(--card); border-radius:18px; box-shadow:4px 4px 10px var(--dark), -4px -4px 10px var(--light)}
    .chip{display:inline-flex; align-items:center; gap:6px; height:32px; padding:0 13px; border-radius:16px;
      background:var(--pale); color:var(--muted); font-size:12.5px; white-space:nowrap}
    .chip.on{background:var(--mid); color:var(--onmid)}
    .chip.ghost{background:transparent; box-shadow:inset 0 0 0 1px var(--rule2)}
    .btn{display:inline-flex; align-items:center; justify-content:center; gap:6px; height:38px; padding:0 18px;
      border-radius:19px; font-size:13px; background:var(--light); color:var(--ink2);
      box-shadow:2px 2px 6px var(--dark), -2px -2px 6px var(--light)}
    .btn.primary{background:var(--mid); color:var(--onmid); box-shadow:0 4px 10px var(--midshadow)}
    .chk{width:20px; height:20px; flex:none; border-radius:50%; box-shadow:inset 0 0 0 1.7px var(--mid); position:relative}
    .chk.done{background:var(--mid)}
    .chk.done::after{content:""; position:absolute; left:6.5px; top:3.5px; width:5px; height:9px;
      border:solid var(--onmid); border-width:0 2px 2px 0; transform:rotate(45deg)}
    .pill{display:inline-flex; align-items:center; height:20px; padding:0 8px; border-radius:10px; font-size:11px; white-space:nowrap}
    .pill.late{background:var(--deep); color:var(--onmid)}
    .pill.soon{background:var(--mint); color:var(--deep)}
    .pill.tag{box-shadow:inset 0 0 0 1px var(--dark); color:var(--faint)}
    .tm{font-size:12.5px; color:var(--mid-ink); white-space:nowrap}
    .done-t{color:var(--dim); text-decoration:line-through}
    .num{display:inline-grid; place-items:center; width:20px; height:20px; border-radius:50%;
      background:#c2410c; color:#fff; font-size:11px; font-weight:500; letter-spacing:0; flex:none;
      box-shadow:0 0 0 2px rgba(255,255,255,.9)}
    .pin{position:absolute; z-index:9}
    /* the PC app's neumorphic language: raised = holds something, inset = takes input */
    .raise{background:var(--card); box-shadow:4px 4px 10px var(--dark), -4px -4px 10px var(--light)}
    .raise-s{background:var(--card); box-shadow:2px 2px 5px var(--dark), -2px -2px 5px var(--light)}
    .inset{background:var(--bg); box-shadow:inset 2px 2px 5px var(--dark), inset -2px -2px 5px var(--light)}
    .k{font-size:12px; color:var(--mid-ink)}
    .cap{font-size:12px; color:var(--faint); font-weight:400; line-height:1.6}
"""


def subset_face(path, text):
    opts = subset.Options()
    opts.flavor = "woff2"
    opts.layout_features = ["*"]
    font = subset.load_font(path, opts)
    s = subset.Subsetter(opts)
    s.populate(text=text)
    s.subset(font)
    buf = io.BytesIO()
    subset.save_font(font, buf, opts)
    return base64.b64encode(buf.getvalue()).decode("ascii")


def thumb(src, dst, width):
    im = Image.open(src).convert("RGB")
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    for q in (72, 64, 56, 48):
        buf = io.BytesIO()
        im.save(buf, "JPEG", quality=q, optimize=True, progressive=True)
        if buf.tell() <= 68_000:
            break
    open(dst, "wb").write(buf.getvalue())
    return buf.tell()


def main():
    sources = sorted(glob.glob(os.path.join(HERE, "src", "*.dc.html")))
    texts = {p: open(p, encoding="utf-8").read() for p in sources}
    chars = set("".join(texts.values())) | set(
        "".join(chr(c) for c in range(32, 127))) | set("·…→←↩⏎✓✎⋯—–“”‘’")
    faces = []
    for weight, name in FACES:
        b64 = subset_face(os.path.join(ROOT, "assets", "fonts", name), "".join(sorted(chars)))
        faces.append('@font-face{font-family:"Paperlogy";font-weight:%d;font-display:block;'
                     'src:url(data:font/woff2;base64,%s) format("woff2")}' % (weight, b64))
    fontface = "\n".join(faces)
    root = ":root{\n" + tokens.css_root() + "\n}"
    base = BASE.replace("__GRAIN__", GRAIN)
    for p, src in texts.items():
        for key in ("/*__FONTFACE__*/", "/*__TOKENS__*/", "/*__BASE__*/"):
            assert src.count(key) == 1, (p, key)
        out = src.replace("/*__FONTFACE__*/", fontface).replace("/*__TOKENS__*/", root).replace("/*__BASE__*/", base)
        dst = os.path.join(HERE, os.path.basename(p))
        open(dst, "w", encoding="utf-8", newline="\n").write(out)
        print("%-26s %4d KB" % (os.path.basename(p), len(out.encode()) // 1024))
    for src, dst, w in (("01-home.png", "home-now.jpg", 560), ("06-add-routine.png", "add-now.jpg", 560)):
        n = thumb(os.path.join(SHOTS, src), os.path.join(HERE, dst), w)
        print("%-26s %4d KB" % (dst, n // 1024))


if __name__ == "__main__":
    main()
