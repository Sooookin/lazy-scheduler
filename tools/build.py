# -*- coding: utf-8 -*-
"""배포용 패키지를 만든다.

    python build.py

결과: release/To-Do Manager.zip  (공유 폴더에 올릴 파일 하나)
      release/To-Do Manager/    (압축 전 폴더)

패키지 안에는 파이썬도 라이브러리도 없어도 되는 실행 파일 하나와
아주 짧은 안내문만 들어간다. 내 일정(data.json)은 %APPDATA% 에 있어 절대 포함되지 않는다.
"""
import os
import shutil
import subprocess
import sys
import zipfile

# 이 파일은 tools/ 안에 있고, 아래 경로는 모두 저장소 뿌리를 기준으로 한다
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
RELEASE = os.path.join(ROOT, "release")
OUT_NAME = "LazyScheduler"

READ_ME = r"""LazyScheduler  -  할 일 · 루틴 · 메모
==========================================

■ 시작하기
  1. 이 폴더를 내 PC로 복사하세요. (공유 폴더에서 바로 실행하면 느립니다)
  2. "LazyScheduler.exe" 를 두 번 클릭하면 끝입니다. 설치할 것은 없습니다.
     * 처음 실행할 때 Windows 보안 경고가 나오면
       [추가 정보] -> [실행] 을 누르세요. (서명이 없는 배포본입니다)
  3. 창 오른쪽 위 톱니바퀴에서
       - "바탕화면에 바로가기 만들기"  -> 다음부터 아이콘으로 실행
       - "Windows 시작할 때 자동 실행" -> 켜두면 항상 알림을 받습니다

■ 기억할 것 하나
  창의 X 는 창만 닫습니다. 프로그램은 뒤에서 계속 돌며 알림을 띄웁니다.
  (닫을 때 안내 카드가 한 번 떠오릅니다)

  다시 열기   바탕화면 아이콘을 누르면 1초 안에 다시 열립니다.
              작업표시줄 알림영역의 체크 아이콘을 눌러도 됩니다.
  완전히 끄기 그 아이콘 우클릭 -> "완전히 종료"

  * Windows 11 은 새 알림영역 아이콘을 기본으로 숨깁니다. 안 보이면
    작업표시줄 오른쪽의 ^ 를 누르면 있습니다. 항상 보이게 하려면
    ^ 를 눌러 나온 아이콘을 작업표시줄로 끌어다 놓으세요.

■ 항목 추가   [+ 새 항목]
  세 종류입니다. 창의 크기와 이름 · 메모 칸은 어느 종류에서나 같은 자리입니다.

  · 할 일   달력에서 마감 날짜를 고릅니다. 오른쪽에 그 날짜와 "내일" 같은
            남은 날짜, 그리고 같은 날에 이미 있는 마감이 함께 보입니다.
  · 루틴    되풀이되는 일입니다. 고르는 것은 셋뿐입니다.
              기준 날짜   이 일을 하는 날 하루 (달력에서)
              단위 · 간격 일 · 주 · 월 · 년, 그리고 매달 · 분기 · 반기 (주는 격주)
              규칙 제안   그 날을 읽는 방법들. 고르면 됩니다.
            예) 매월 말일 · 매월 마지막 영업일 · 매월 셋째 목요일
                매월 말일 3영업일 전 · 3·6·9·12월 말일
            제안에 나오는 규칙은 모두 기준 날짜에 실제로 도는 것들이라,
            골라 둔 날이 빠지는 일이 없습니다. 줄마다 다음 날짜 셋이 보입니다.
            주말 · 공휴일에 걸릴 때 어떻게 할지는 아래 한 줄에서 바꿉니다.
  · 메모    기한 없이 목록에만 남습니다. 메모 칸이 창을 채웁니다.

  시각은 누르면 시 -> 분 두 번에 고릅니다. 930 · 21 · 930p 처럼 쳐도 됩니다.
  알림은 10분 · 30분 · 1시간 · 3시간 전 중에서 고릅니다.

■ 화면  [오늘] / [달력]  (왼쪽 위 탭)

  오늘
    왼쪽     밀린 것 + 오늘 할 일을 시간순으로. 동그라미를 눌러 완료.
    오른쪽   다가오는 7일의 마감 · 메모 · 루틴
    한 줄에 항목 하나입니다. 줄을 누르면 수정 창이 열립니다.
    항목 왼쪽 색 띠   진한색 = 마감,  중간색 = 루틴,  연한색 = 메모
    건너뛰기 · 내일로 · 삭제는 묻지 않고 처리하고, 5초 동안 되돌릴 수 있습니다.

  달력
    일요일이 맨 왼쪽입니다. 토요일은 청록, 일요일과 공휴일은 빨강입니다.
    머리의 [주말] 을 누르면 주말 칸을 켜고 끕니다. 끄면 칸이 5개로 넓어져
    제목이 더 많이 보입니다. [루틴] 은 루틴 줄을 켜고 끕니다.
    색: 진한색 = 지남,  중간색 = 오늘,  연한색 = 예정,  테두리만 = 완료
    날짜를 누르면 그날 전체가 목록으로 열립니다 (거기서 완료 · 수정 가능).
    빈 날을 누르면 그 날짜로 추가 창이 열립니다.
    칸에는 3건까지 보이고, 넘으면 "+N건 더" 로 표시됩니다.
    < > 또는 좌우 화살표 키로 달을 넘깁니다.

■ 전체 항목
  왼쪽 아래 "전체 항목 관리" 에서 등록한 모든 항목을 봅니다. 누르면 수정됩니다.

■ 알림
  마감 전(기본 30분, 설정에서 변경)에 화면 우측 하단에 카드가 떠오릅니다.
  카드의 "완료" 를 누르면 그 자리에서 처리됩니다.
  아침 08:30(설정에서 변경)에 오늘 할 일 요약이 한 번 뜹니다.

■ 휴대폰과 같이 쓰기
  설정 -> 동기화 -> "Google 계정으로 로그인" 을 누르면, 같은 계정으로 로그인한
  PC 와 휴대폰의 일정이 같아집니다. 처음 로그인할 때는 양쪽 것을 합칩니다
  (어느 쪽도 지우지 않습니다).

  * 이 배포본에 동기화 설정이 들어 있지 않다면, 로그인 단추가 동작하지 않습니다.
    firebase/config.local.json 을 LazyScheduler.exe 옆의 firebase 폴더에 넣으면
    됩니다. (firebase/config.example.json 참고)

■ 내 일정이 저장되는 곳
  %APPDATA%\LazyScheduler\data.json      (이 파일만 백업하면 됩니다)
  새 버전으로 폴더를 덮어써도 일정과 설정은 그대로 남습니다.
"""


def _imports(path):
    """PE 임포트 테이블에 적힌 DLL 이름들."""
    import pefile
    pe = pefile.PE(path, fast_load=True)
    try:
        pe.parse_data_directories(
            directories=[pefile.DIRECTORY_ENTRY["IMAGE_DIRECTORY_ENTRY_IMPORT"]])
        return [e.dll.decode().lower()
                for e in getattr(pe, "DIRECTORY_ENTRY_IMPORT", [])]
    finally:
        pe.close()


def extra_binaries():
    """인터프리터가 표준 위치에 두지 않는 DLL 을 자동으로 찾아 담는다.

    Anaconda 는 확장 모듈이 요구하는 DLL 을 Library\bin 에 둔다.
    PyInstaller 는 그 경로를 스캔하지 않으므로, 넣어주지 않으면 빌드본이
    실행 즉시 "DLL load failed while importing _ctypes / PIL._imaging" 으로 죽는다.
    이름을 박아두면 파이썬 버전이 바뀔 때 또 깨지므로, .pyd 의 임포트 테이블을
    직접 읽어서 필요한 것만 담는다. DLL 이 또 다른 DLL 을 부르므로
    (tiff -> zstd, freetype -> libpng ...) 더 나올 것이 없을 때까지 따라간다.
    """
    import glob

    libbin = os.path.join(sys.base_prefix, "Library", "bin")
    dll_dir = os.path.join(sys.base_prefix, "DLLs")
    pil_dir = os.path.join(sys.base_prefix, "Lib", "site-packages", "PIL")
    if not os.path.isdir(libbin):
        return []                       # python.org 배포판 등은 이미 정상
    try:
        import pefile                   # noqa: F401
    except ImportError:
        return []

    # _tkinter 는 일부러 뺐다 (toast 는 Win32 로 그린다. 넣으면 tcl/tk 6MB).
    # _ssl · _hashlib 은 넣는다 - 동기화가 Firebase 와 HTTPS 로 이야기한다 (docs/sync.md).
    seeds = [os.path.join(dll_dir, m + ".pyd")
             for m in ("_ctypes", "_socket", "select", "_queue", "_ssl", "_hashlib")]
    # PIL 의 확장도 씨앗에 넣는다. 예전에는 이 DLL(zlib·libjpeg·freetype ...)이
    # 다른 패키지 덕에 우연히 따라 들어왔고, 그 패키지를 빼자 PIL.Image 가
    # "DLL load failed while importing _imaging" 으로 죽었다.
    seeds += glob.glob(os.path.join(pil_dir, "_imaging.cp*.pyd"))
    seeds += glob.glob(os.path.join(pil_dir, "_imagingft.cp*.pyd"))

    # OS·VC 런타임이 제공하는 것은 담지 않는다 (시스템 것과 충돌할 수 있다)
    skip = ("api-ms-win", "vcruntime", "msvcp", "ucrtbase", "python3", "kernel32",
            "user32", "gdi32", "advapi32", "shell32", "ole32", "oleaut32",
            "ws2_32", "crypt32", "bcrypt", "shlwapi", "comdlg32", "rpcrt4",
            "setupapi", "cfgmgr32", "dbghelp", "mfplat", "winmm", "imm32",
            "version", "psapi", "userenv", "secur32", "iphlpapi", "netapi32")

    need, out = [], []
    queue = [p for p in seeds if os.path.exists(p)]
    while queue:
        cur = queue.pop()
        for name in _imports(cur):
            if name.startswith(skip) or name in need:
                continue
            need.append(name)
            cand = os.path.join(libbin, name)
            if os.path.exists(cand):
                queue.append(cand)

    for name in need:
        cand = os.path.join(libbin, name)
        if os.path.exists(cand):
            out += ["--add-binary", f"{cand}{os.pathsep}."]
            print(f"  + 누락 DLL 포함: {name}")
    return out


# 쓰지 않는데 크게 들어오는 것들. PIL 은 플러그인 임포트를 try/except 로 감싸므로
# 코덱 .pyd 를 지워도 안전하다 (해당 포맷만 못 읽게 된다).
PRUNE = [
    "_internal/PIL/_avif.cp*.pyd",        # AVIF 코덱 7.5MB - 안 씀
    "_internal/PIL/_webp.cp*.pyd",        # WebP  0.4MB - 안 씀
    "_internal/PIL/_imagingcms.cp*.pyd",  # 컬러 매니지먼트 0.3MB - 안 씀
    "_internal/PIL/_imagingmath.cp*.pyd",
    "_internal/PIL/_imagingmorph.cp*.pyd",
    # tcl/tk 는 이제 안 쓴다 (혹시 딸려 들어오면 지운다)
    "_internal/_tcl_data", "_internal/_tk_data", "_internal/tcl8",
    "_internal/tcl86t.dll", "_internal/tk86t.dll", "_internal/_tkinter.pyd",
    # libcrypto · libssl · _ssl · _hashlib 은 지우면 안 된다. 예전에는 ssl 껍데기로
    # 5.8MB 를 아꼈지만, 동기화가 HTTPS 를 쓴다.
    # runtimes/win-arm64 · win-x86 은 지우면 안 된다. pywebview 의
    # edgechromium.py 가 세 폴더 모두를 Path 에 넣으려고 존재를 확인하고,
    # 하나라도 없으면 FileNotFoundError 로 창이 통째로 Edge 폴백이 된다.
    # 문서·디버그 부산물
    "_internal/pythonnet/runtime/*.xml",
    "_internal/**/*.pdb",
]


def prune(root):
    """빌드 결과에서 쓰지 않는 큰 파일을 지운다."""
    import glob
    freed = 0
    for pat in PRUNE:
        for p in glob.glob(os.path.join(root, pat.replace("/", os.sep)), recursive=True):
            if os.path.isdir(p):
                for r, _, fs in os.walk(p):
                    freed += sum(os.path.getsize(os.path.join(r, f)) for f in fs)
                shutil.rmtree(p, ignore_errors=True)
            elif os.path.exists(p):
                freed += os.path.getsize(p)
                os.remove(p)
    print(f"  - 불필요 파일 정리: {freed / 1024 / 1024:.1f} MB")


def run(cmd):
    print(">", " ".join(cmd))
    if subprocess.call(cmd, cwd=ROOT) != 0:
        sys.exit("빌드 실패")


def main():
    for d in ("build", "dist", RELEASE):
        path = os.path.join(ROOT, d)
        shutil.rmtree(path, ignore_errors=True)
        if os.path.exists(path):
            # 배포본이 실행 중이면 exe 가 잠겨 있어 지워지지 않는다.
            # 예전에 여기서 조용히 넘어가 copytree 가 엉뚱한 곳에서 터졌다.
            sys.exit(f"'{path}' 를 지울 수 없습니다."
                     f"\n실행 중인 {OUT_NAME} 를 먼저 완전히 종료하세요."
                     f'\n  taskkill /F /IM "{OUT_NAME}.exe"')
    for f in (OUT_NAME + ".spec",):
        p = os.path.join(ROOT, f)
        if os.path.exists(p):
            os.remove(p)

    args = [sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean",
            "--windowed",                       # 콘솔 창 없음
            "--noupx",
            "--name", OUT_NAME,
            "--icon", os.path.join(ROOT, "assets", "app.ico"),
            "--add-data", f"web{os.pathsep}web",
            "--add-data", f"assets/app.ico{os.pathsep}.",
            # 알림 카드(toast.py)가 Pillow 로 직접 그리므로 글꼴 파일이 필요하다 (SIL OFL 1.1)
            "--add-data", f"assets/fonts/Paperlogy-3Light.ttf{os.pathsep}fonts",
            "--add-data", f"assets/fonts/Paperlogy-5Medium.ttf{os.pathsep}fonts",
            "--add-data", f"assets/fonts/Paperlogy-4Regular.ttf{os.pathsep}fonts",
            ]
    # 동기화 설정 (저장소에는 없다. 없으면 동기화 없이 빌드된다)
    cloud = os.path.join(ROOT, "firebase", "config.local.json")
    if os.path.exists(cloud):
        args += ["--add-data", f"firebase/config.local.json{os.pathsep}firebase"]
    else:
        print("  ! firebase/config.local.json 이 없다 - 동기화를 쓸 수 없는 빌드가 된다")
    # 지연 임포트되는 것들
    for m in ("pystray._win32", "clr",
              "webview.platforms.winforms", "webview.platforms.edgechromium"):
        args += ["--hidden-import", m]
    # pywebview 는 WebView2 DLL 을 자기 패키지 안에 들고 있다
    args += ["--collect-data", "webview", "--collect-binaries", "webview",
             "--collect-data", "clr_loader", "--collect-binaries", "clr_loader"]
    # 안 쓰는 무거운 것들 (깨끗한 venv 로 빌드해도 한 번 더 막아둔다)
    for m in ("numpy", "pandas", "scipy", "matplotlib", "IPython", "jupyter",
              "notebook", "nbformat", "sklearn", "sympy", "numba", "llvmlite",
              "PyQt5", "PyQt6", "PySide2", "PySide6", "qtpy", "cv2", "zmq",
              "tornado", "dask", "bokeh", "pytest", "setuptools", "pip",
              # 창은 Win32 로 직접 그린다 (toast.py). tcl/tk 6MB 를 뺀다.
              "tkinter", "_tkinter", "PIL.ImageTk", "PIL.ImageQt",
              # ssl 은 이제 뺄 수 없다 - 동기화가 HTTPS 를 쓴다
              # 우리가 쓰지 않는 표준 모듈. asyncio·concurrent·multiprocessing·
              # distutils 는 일부러 남겼다 - 다른 패키지가 몰래 쓸 수 있고,
              # 빠져 있으면 창이 통째로 Edge 폴백으로 떨어진다.
              "unittest", "doctest", "pydoc", "pydoc_data", "lib2to3",
              "sqlite3", "xmlrpc", "pickletools", "ftplib", "imaplib",
              "poplib", "smtplib", "turtle", "turtledemo", "idlelib",
              # unicodedata 는 빼면 안 된다 - bottle 이 쓰고, bottle 이 죽으면
              # pywebview 가 통째로 못 올라온다 (--selftest 로 확인)
              # decimal·bz2·lzma 도 빼면 안 된다. decimal 을 뺐더니
              # PIL.PngImagePlugin 이 못 올라와서 PNG·ICO 를 읽지 못했고,
              # 그 결과 트레이 아이콘이 조용히 사라졌다 (--selftest 가 잡아 줬다)
              "ensurepip", "venv", "zoneinfo",
              # PyInstaller 훅이 cryptography 를 끌어와 _rust.pyd 4MB 가 들어와
              # 있었다. HTTPS 는 표준 ssl 로 충분하다.
              # jinja2·markupsafe 도 쓰는 곳이 없다 (bottle 은 자체 템플릿).
              "cryptography", "jinja2", "markupsafe"):
        args += ["--exclude-module", m]
    args += extra_binaries()
    args.append("main.py")
    run(args)

    prune(os.path.join(ROOT, "dist", OUT_NAME))

    src = os.path.join(ROOT, "dist", OUT_NAME)
    dst = os.path.join(RELEASE, OUT_NAME)
    os.makedirs(RELEASE, exist_ok=True)
    shutil.copytree(src, dst)

    with open(os.path.join(dst, "먼저 읽어주세요.txt"), "w", encoding="utf-8-sig") as f:
        f.write(READ_ME)

    zip_path = os.path.join(RELEASE, OUT_NAME + ".zip")
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED, compresslevel=9) as z:
        for root, _, files in os.walk(dst):
            for name in files:
                full = os.path.join(root, name)
                z.write(full, os.path.relpath(full, RELEASE))

    for d in ("build", "dist"):
        shutil.rmtree(os.path.join(ROOT, d), ignore_errors=True)
    spec = os.path.join(ROOT, OUT_NAME + ".spec")
    if os.path.exists(spec):
        os.remove(spec)

    size = os.path.getsize(zip_path) / 1024 / 1024
    print(f"\n완료: {zip_path}  ({size:.1f} MB)")
    print(f"      {dst}")


if __name__ == "__main__":
    main()
