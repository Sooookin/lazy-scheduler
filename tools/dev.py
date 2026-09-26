# -*- coding: utf-8 -*-
"""고치면서 볼 때 쓰는 실행기.

    python tools/dev.py          돌고 있는 것을 내리고, 소스에서 다시 띄운다
    python tools/dev.py --stop   내리기만 한다

배포본(exe)과 다른 점은 하나뿐이다: LS_DEV 를 켜고 띄운다. 그러면 창이
1.5초마다 web/ 의 지문을 보고, 바뀌었으면 스스로 다시 읽는다(ui.watch_web).
고치고 저장하면 그걸로 끝이다 - 트레이를 누르거나 껐다 켤 일이 없다.

파이썬 쪽(app.py · store.py · toast.py …)을 고쳤을 때만 이걸 다시 돌린다.
그쪽은 프로세스가 들고 있는 코드라 페이지를 다시 읽어도 바뀌지 않는다.

데이터는 평소와 같은 %APPDATA%\\LazyScheduler\\data.json 을 쓴다.
"""
import os
import socket
import subprocess
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, ROOT)

import ipc  # noqa: E402

PORTS = (ipc.SERVICE_PORT, ipc.UI_PORT)


def busy(port):
    with socket.socket() as s:
        s.settimeout(0.3)
        return s.connect_ex((ipc.HOST, port)) == 0


def stop():
    """돌고 있는 것에 곱게 내려가라고 한다. 없으면 그냥 넘어간다."""
    if not any(busy(p) for p in PORTS):
        print("돌고 있는 것 없음")
        return True
    # 서비스가 창까지 함께 내린다. 창만 떠 있으면 그쪽에 직접 말한다.
    if busy(ipc.SERVICE_PORT):
        ipc.post(ipc.SERVICE_PORT, "/api/quit", body={}, timeout=1.0)
    elif busy(ipc.UI_PORT):
        ipc.post(ipc.UI_PORT, "/quit", timeout=1.0)
    for _ in range(40):                      # 최대 8초
        time.sleep(0.2)
        if not any(busy(p) for p in PORTS):
            print("내렸다")
            return True
    print("아직 포트를 놓지 않았다:", [p for p in PORTS if busy(p)])
    return False


def start():
    env = dict(os.environ, LS_DEV="1")
    subprocess.Popen([sys.executable, os.path.join(ROOT, "main.py")], cwd=ROOT, env=env)
    for _ in range(50):                      # 창이 뜰 때까지 (최대 10초)
        time.sleep(0.2)
        if busy(ipc.UI_PORT):
            print("떴다 - 이제 web/ 을 고치면 창이 알아서 다시 읽는다")
            return True
    print("서비스는 떴는데 창이 아직이다. %APPDATA%\\LazyScheduler\\app.log 를 봐라")
    return busy(ipc.SERVICE_PORT)


def main():
    if not stop():
        return 1
    if "--stop" in sys.argv:
        return 0
    return 0 if start() else 1


if __name__ == "__main__":
    sys.exit(main())
