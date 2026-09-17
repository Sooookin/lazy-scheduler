# -*- coding: utf-8 -*-
"""서비스와 앱 창이 서로를 부르는 약속: 주소 · 비밀값 머리글 · 요청 한 번.

예전에는 포트 번호를 app.py 와 ui.py 가 각자 적어 뒀고, 요청 문장도 세 군데서
손으로 지었다. 한쪽만 고치면 창이 서비스를 못 찾거나 서비스가 창을 못 부른다.
이제 여기서만 정한다.

다른 형태의 앱(휴대폰)은 이 파일을 쓰지 않는다. 그쪽은 HTTP API(app.py)와
데이터 형식(store.py)으로 만난다. 이 파일은 이 PC 안의 두 프로세스 사이 약속이다.
"""
import json
import socket

import paths

HOST = "127.0.0.1"
SERVICE_PORT = 8777             # 서비스 (API + 화면 파일)
UI_PORT = 8779                  # 앱 창 프로세스 (앞으로 부르기 · 닫기)
TOKEN_HEADER = "X-TM-Token"
_CRLF = b"\r\n"


def post(port, path, body=None, timeout=1.0):
    """127.0.0.1:port 에 POST 한 번. 상태 코드를 돌려주고, 연결하지 못하면 None.

    상태줄만 읽는다. 본문까지 기다리면 안 된다 - recv 한 번은 머리글만 담고
    끝나기도 하고, 상대가 본문을 늦게 보내면 그만큼 부른 쪽이 묶인다.
    """
    data = b"" if body is None else json.dumps(body).encode("utf-8")
    head = ["POST %s HTTP/1.0" % path,
            "Host: %s:%d" % (HOST, port),
            "%s: %s" % (TOKEN_HEADER, paths.ipc_token()),
            "Content-Length: %d" % len(data)]
    if body is not None:
        head.append("Content-Type: application/json")
    try:
        with socket.create_connection((HOST, port), timeout) as sock:
            sock.sendall(("\r\n".join(head) + "\r\n\r\n").encode("ascii") + data)
            status = sock.recv(64).split(_CRLF, 1)[0].split(b" ")
    except OSError:
        return None
    return int(status[1]) if len(status) > 1 and status[1].isdigit() else 0
