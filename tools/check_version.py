# -*- coding: utf-8 -*-
"""릴리스 태그가 version.py 와 같은지 본다 (GitHub Actions 가 빌드 전에 부른다).

    python tools/check_version.py v2.4.0

다르면 1 로 끝난다. 태그만 올리고 version.py 를 안 고치면, 받은 앱이 자기를 옛 버전으로
알아 같은 업데이트를 끝없이 다시 받는다 - 그래서 빌드 전에 막는다.
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
import version  # noqa: E402


def main(argv):
    tag = (argv[0] if argv else "").strip()
    want = "v" + version.VERSION
    if tag != want:
        print("태그 %r 가 version.py (%s) 와 다르다 - version.py 를 고치고 다시 태그를 달아라" % (tag, want))
        return 1
    print("ok", want)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
