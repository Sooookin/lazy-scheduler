# -*- coding: utf-8 -*-
"""web/paper.png · web/paper-fine.png - 하늘 디오라마와 일정 판(땅)에 까는 종이 결을 만든다.

    python tools/make_paper.py

중목 도화지(미술용 종이)의 '이'다: 높이 지도(굵기가 다른 잡음 세 겹)를 만들고 왼쪽 위에서
비스듬히 비춘 명암만 남긴다. 한지처럼 섬유는 넣지 않는다 - 깨끗한 종이로 읽혀야 한다.
가운데 회색(128) 둘레로만 오르내리므로 화면에서 soft-light 로 섞으면 빛깔은 그대로이고
결만 드러난다 (web/style.css 의 "종이", web/sky.js 의 pPaper).

paper.png 는 디오라마(하늘 · 능선 · 궤도 띠)의 결이고, paper-fine.png 는 글자를 읽는 일정 판의
결이다 - 훨씬 곱고 옅어서 "종이 위" 라는 느낌만 남긴다 (굵은 결은 글자 둘레를 소란하게 했다).
paper-fine 은 세기까지 구워 둔다 - 화면에서 투명도 없이 바탕색과 바로 섞는다(background-blend-mode).
판 위에 반투명 층을 따로 얹으면 그 층이 합성 레이어가 되어 글자가 회색조로 그려질 수 있다.
256px 이음매 없는 타일이다(잡음을 감싸 흐린다). 씨앗을 고정해 두어 다시 만들어도 같다.
numpy · scipy 가 필요하다 (앱 실행에는 필요 없다 - 결과물만 web/ 에 들어간다).
"""
import os

import numpy as np
from PIL import Image
from scipy.ndimage import gaussian_filter

N = 256
WEB = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "web")


def tooth(seed, radii, amp, mott_r, mott_amp):
    """높이 지도(굵기가 다른 잡음 몇 겹)를 왼쪽 위에서 비춘 명암 + 아주 넓은 얼룩"""
    rng = np.random.default_rng(seed)
    g = lambda a, r: gaussian_filter(a, r, mode="wrap")
    h = sum(g(rng.normal(0, 1, (N, N)), r) * w for r, w in radii)
    h /= h.std()
    dx = (np.roll(h, -1, 1) - np.roll(h, 1, 1)) / 2
    dy = (np.roll(h, -1, 0) - np.roll(h, 1, 0)) / 2
    shade = -(dx * .7 + dy * .7)
    shade /= shade.std()
    v = shade * amp
    if mott_amp:
        mott = g(rng.normal(0, 1, (N, N)), mott_r)
        v += mott / mott.std() * mott_amp
    return np.clip(128 + v, 0, 255).astype(np.uint8)


def main():
    for name, img in [("paper.png", tooth(11, [(.85, 1), (2.1, 1.6), (.5, .35)], 10, 10, 2.5)),
                      ("paper-fine.png", tooth(12, [(.45, 1), (.9, .6)], 3, 0, 0))]:
        out = os.path.join(WEB, name)
        Image.fromarray(img, "L").save(out, optimize=True)
        print(out, os.path.getsize(out), "bytes")


if __name__ == "__main__":
    main()
