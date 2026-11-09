# -*- coding: utf-8 -*-
"""테스트 공통 준비.

모듈들은 import 되는 순간 %APPDATA% 로 데이터 경로를 정한다. 그래서 무엇보다 먼저
APPDATA 를 임시 폴더로 바꾼다 - 테스트가 실제 일정을 건드리는 일은 절대 없어야 한다.
"""
import os
import shutil
import sys
import tempfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SANDBOX = tempfile.mkdtemp(prefix="lazy-scheduler-tests-")
os.environ["APPDATA"] = SANDBOX
sys.path.insert(0, ROOT)

from desktop import paths  # noqa: E402

assert paths.DATA_DIR.startswith(SANDBOX), "테스트가 실제 데이터 폴더를 가리키고 있다"


@pytest.fixture
def server():
    """실제 서비스 핸들러를 빈 포트에 띄운다. 값은 포트 번호."""
    import threading

    from desktop import app
    srv = app.Server(("127.0.0.1", 0), app.Handler)
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    yield srv.server_address[1]
    srv.shutdown()
    srv.server_close()


def _empty(d):
    """d 를 빈 폴더로. Windows 에서는 앞 테스트의 스레드(서버 · 카드)가 파일을 아직 쥐고 있으면 지우기가 조용히 실패하고
    폴더가 남는다 - CI 에서 가끔 'FileExistsError' 로 릴리스가 멈췄다 (v2.8.0 · v2.9.0). 잠깐씩 기다리며 몇 번 더 지운다."""
    import time
    for _ in range(20):
        shutil.rmtree(d, ignore_errors=True)
        if not os.path.exists(d):
            break
        time.sleep(0.05)
    os.makedirs(d, exist_ok=True)
    assert not os.listdir(d), "앞 테스트의 데이터가 지워지지 않았다: %s" % os.listdir(d)


@pytest.fixture(autouse=True)
def fresh_data():
    """테스트마다 빈 데이터 폴더와 초기 상태에서 시작한다."""
    from desktop import app
    from core import store
    from desktop import toast

    _empty(paths.DATA_DIR)
    store.NOTICE = None
    paths._token = None
    toast._seen.clear()
    while not toast._queue.empty():
        toast._queue.get_nowait()
    app.tick._ran = False
    yield
    toast.set_scale(1.0)


def pytest_sessionfinish(session, exitstatus):
    shutil.rmtree(SANDBOX, ignore_errors=True)
