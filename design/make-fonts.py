# -*- coding: utf-8 -*-
"""디자인 아트보드에 심을 Paperlogy 글꼴을 만든다.

    python design/make-fonts.py

원본 TTF 는 한 벌에 680KB 다. 한글 글자를 다 담고 있어서 그렇다.
아트보드는 캔버스 안에 통째로 들어가므로(바깥에서 파일을 못 불러온다)
화면에 실제로 쓰인 글자만 추려서 27KB 로 줄인 뒤 base64 로 심는다.

만드는 것
  design/fonts/paperlogy-*.woff2   추려낸 글꼴
  design/_fontface.css             base64 @font-face 두 줄

쓰는 법
  .dc.html 의 <style> 첫 줄에 /*__FONTFACE__*/ 를 두면
  아래 splice() 가 그 자리에 _fontface.css 내용을 넣는다.
  (이미 넣은 파일은 자리표시자가 없으므로 건너뛴다)

필요한 것: fonttools, brotli   →   python -m pip install fonttools brotli
"""
import base64
import glob
import io
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)

SOURCES = [
    (300, os.path.join(ROOT, "Paperlogy-3Light.ttf"), "paperlogy-light.woff2"),
    (500, os.path.join(ROOT, "Paperlogy-5Medium.ttf"), "paperlogy-medium.woff2"),
]

# 아트보드에 없더라도 앞으로 쓸 만한 낱말은 미리 넣어 둔다.
# 빠진 글자는 조용히 네모(두부)로 나오므로 넉넉히 잡는 편이 낫다.
EXTRA = (
    "월화수목금토일요년도분초오늘내일모레어제지남임박완료예정반복마감메모알림설정저장취소삭제추가수정"
    "항목전체관리자동연결끊김서비스새다가오는업무영업일다음실행날짜시각기본브리핑아침발표화면공유"
    "주간월간분기말초매번째마지막건남음그외개시작종료도움말바로가기바탕화면윈도우실행중보류"
    "0123456789:/.,-·—＋+()[]%~"
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ"
    "가나다라마바사아자차카타파하"
)


def charset():
    """아트보드에 쓰인 글자 + EXTRA."""
    chars = set(EXTRA)
    for f in glob.glob(os.path.join(HERE, "*.dc.html")):
        chars |= set(io.open(f, encoding="utf-8").read())
    return {c for c in chars if ord(c) >= 32 and ord(c) != 0xFFFD}


def build():
    from fontTools import subset

    text = "".join(sorted(charset()))
    os.makedirs(os.path.join(HERE, "fonts"), exist_ok=True)
    faces = []
    for weight, src, name in SOURCES:
        if not os.path.exists(src):
            sys.exit("원본 글꼴이 없다: %s" % src)
        out = os.path.join(HERE, "fonts", name)
        subset.main([src, "--text=" + text, "--flavor=woff2", "--layout-features=*",
                     "--output-file=" + out, "--no-hinting", "--desubroutinize"])
        b64 = base64.b64encode(open(out, "rb").read()).decode("ascii")
        faces.append(
            "@font-face{font-family:'Paperlogy';font-style:normal;font-weight:%d;"
            "font-display:swap;src:url(data:font/woff2;base64,%s) format('woff2')}"
            % (weight, b64))
        print("%-26s %6.1f KB" % (name, os.path.getsize(out) / 1024))

    css = "\n".join(faces)
    io.open(os.path.join(HERE, "_fontface.css"), "w", encoding="utf-8").write(css)
    print("글자 %d자 · _fontface.css %.1f KB" % (len(text), len(css.encode()) / 1024))
    return css


def splice(css):
    """자리표시자가 남아 있는 아트보드에 글꼴을 심는다."""
    for f in sorted(glob.glob(os.path.join(HERE, "*.dc.html"))):
        s = io.open(f, encoding="utf-8").read()
        if "/*__FONTFACE__*/" not in s:
            continue
        io.open(f, "w", encoding="utf-8").write(s.replace("/*__FONTFACE__*/", css, 1))
        print("심음: %s" % os.path.basename(f))


if __name__ == "__main__":
    splice(build())
