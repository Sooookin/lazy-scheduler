"""운영체제마다 다른 부분. win/ 은 Windows, mac/ 은 macOS.

두 쪽은 같은 이름 · 같은 함수를 갖는다:

    system     프로세스 · 중복 실행 막기 · 비밀 보관 · 배포본 모양 (자동 업데이트)
    cards      알림 카드를 올릴 투명 창 · 이벤트 루프 · 화면 정보 (그림은 desktop/toast.py)
    tray       알림영역(Windows) · 메뉴 막대(macOS) 아이콘
    window     앱 창 옮기기 · 크기 · 숨기기 · 확대 (창 프로세스, desktop/ui.py 가 부른다)
    autostart  로그인할 때 켜기 · 바로가기

쓰는 쪽은 `from platforms import cards` 처럼 부르면 지금 운영체제의 것이 온다. 처음 쓸 때
불러오므로 창 프로세스가 트레이를, 서비스가 창 모듈을 괜히 불러오지 않는다.
(빌드는 이 import 를 보지 못하므로 tools/build.py 가 platforms.<os> 를 통째로 담는다.)
"""
import importlib
import sys

MAC = sys.platform == "darwin"
OS = "mac" if MAC else "win"
PARTS = ("system", "cards", "tray", "window", "autostart")


def __getattr__(name):
    if name not in PARTS:
        raise AttributeError(name)
    mod = importlib.import_module("%s.%s.%s" % (__name__, OS, name))
    globals()[name] = mod
    return mod
