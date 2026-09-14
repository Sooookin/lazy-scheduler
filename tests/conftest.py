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
SANDBOX = tempfile.mkdtemp(prefix="todo-manager-tests-")
os.environ["APPDATA"] = SANDBOX
sys.path.insert(0, ROOT)

import paths  # noqa: E402

assert paths.DATA_DIR.startswith(SANDBOX), "테스트가 실제 데이터 폴더를 가리키고 있다"


@pytest.fixture(autouse=True)
def fresh_data():
    """테스트마다 빈 데이터 폴더와 초기 상태에서 시작한다."""
    import app
    import store
    import toast

    shutil.rmtree(paths.DATA_DIR, ignore_errors=True)
    os.makedirs(paths.DATA_DIR)
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
