# -*- coding: utf-8 -*-
"""GitHub Actions 전용: 명령을 돌리고, 실패하면 출력 끝부분을 annotation 으로 남긴다.

    python tools/ci_tail.py <이름> -- <명령...>

단계 로그는 로그인해야 보이지만 annotation 은 공개 API 로 읽힌다 (Mac 이 없어 macOS 빌드는
CI 에서만 볼 수 있다 - .github/workflows/mac.yml).
"""
import subprocess
import sys


def main():
    name, cmd = sys.argv[1], sys.argv[sys.argv.index("--") + 1:]
    p = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    out = p.stdout.decode("utf-8", "replace")
    sys.stdout.write(out)
    if p.returncode:
        tail = ("exit %d\n" % p.returncode + out)[-3500:]
        print("::error title=%s::%s" % (name, tail.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")))
    return p.returncode


if __name__ == "__main__":
    sys.exit(main())
