# -*- coding: utf-8 -*-
"""tokens.py 의 값을 web/style.css 의 :root 블록에 써 넣는다.

    python tools/gen_tokens.py            바꿔 쓴다
    python tools/gen_tokens.py --check    다른 곳이 있으면 1 로 끝난다 (테스트용)

표시한 두 줄 사이만 건드린다. 그 바깥(종이 결처럼 CSS 에만 있는 값)은 그대로 둔다.
"""
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import tokens  # noqa: E402

CSS = os.path.join(ROOT, "web", "style.css")
BEGIN = "  /* >>> tokens.py 가 만든다. 여기서 직접 고치지 말 것 (tools/gen_tokens.py) */"
END = "  /* <<< tokens.py */"


def render():
    return "\n".join([BEGIN, tokens.css_root(), END])


def swap(text):
    """표시 사이를 새 내용으로 바꾼 전체 문서를 돌려준다."""
    try:
        i = text.index(BEGIN)
        j = text.index(END) + len(END)
    except ValueError:
        sys.exit("style.css 에서 표시를 찾지 못했다. BEGIN/END 주석이 남아 있어야 한다.")
    return text[:i] + render() + text[j:]


def main():
    cur = io.open(CSS, encoding="utf-8").read()
    new = swap(cur)
    if "--check" in sys.argv:
        if cur != new:
            print("style.css 가 tokens.py 와 다르다. python tools/gen_tokens.py 를 실행해라.")
            return 1
        print("style.css 는 tokens.py 와 같다.")
        return 0
    if cur == new:
        print("바뀐 것 없음.")
        return 0
    io.open(CSS, "w", encoding="utf-8", newline="").write(new)
    print("web/style.css 의 :root 를 다시 썼다.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
