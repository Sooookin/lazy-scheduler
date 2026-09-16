# -*- coding: utf-8 -*-
"""원본 TTF 에서 창 화면이 쓸 woff2 를 만든다.

    python tools/build_fonts.py
    python tools/build_fonts.py --check    다시 만들어야 하면 1 로 끝난다

글꼴이 두 벌 필요하다.

    Paperlogy-*.ttf        알림 카드(toast.py)와 트레이(tray.py)가 PIL 로 직접
                           그릴 때 쓴다. PIL 은 woff2 를 읽지 못한다.
    web/fonts/*.woff2      창 화면(WebView2)이 쓴다. TTF 를 그대로 물리면
                           한 벌에 660KB 라 첫 그림이 늦다. woff2 는 160KB.

글자를 추려내지 않는다. 일정 제목에는 어떤 한글이든 들어올 수 있고, 없는
글자는 조용히 네모로 나온다. 한글 11,172자를 통째로 담고 압축만 한다.

예전에는 이 변환을 그때그때 손으로 했다. 무엇으로 만들었는지 남지 않아
Bold 를 더할 때 앞의 두 벌과 같은 방법인지 확인할 길이 없었다.
"""
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
OUT = os.path.join(ROOT, "web", "fonts")

# (원본, 내놓을 이름, CSS 의 font-weight)
FACES = [
    ("Paperlogy-3Light.ttf",   "paperlogy-300.woff2", 300),
    ("Paperlogy-4Regular.ttf", "paperlogy-400.woff2", 400),
    ("Paperlogy-5Medium.ttf",  "paperlogy-500.woff2", 500),
]


def convert(src, dst):
    from fontTools.ttLib import TTFont
    f = TTFont(src)
    f.flavor = "woff2"
    f.save(dst)
    f.close()


def main():
    check = "--check" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    stale = []
    for name, out_name, weight in FACES:
        src = os.path.join(ROOT, name)
        dst = os.path.join(OUT, out_name)
        if not os.path.exists(src):
            sys.exit("원본 글꼴이 없다: %s" % src)
        fresh = os.path.exists(dst) and os.path.getmtime(dst) >= os.path.getmtime(src)
        if check:
            if not fresh:
                stale.append(out_name)
            continue
        if fresh:
            print("%-22s 그대로 (원본이 더 새것이 아니다)" % out_name)
            continue
        convert(src, dst)
        print("%-22s %6.0f KB  (weight %d)" % (out_name, os.path.getsize(dst) / 1024, weight))

    if check:
        if stale:
            print("다시 만들어야 한다: %s → python tools/build_fonts.py" % ", ".join(stale))
            return 1
        print("web/fonts 는 최신이다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
