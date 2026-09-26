# -*- coding: utf-8 -*-
"""디자인 값이 눈금 위에 있는지 지킨다.

예전에는 서로 다른 글자 크기가 열여덟 가지, 여백이 스물여덟 가지였다.
10.5 와 11 과 11.5 가 따로 있었는데 눈으로는 구별되지 않고, 고칠 때마다
"여긴 몇이었지" 를 다시 정하게 만들었다. 한 번 정리해도 손으로 지키는 한
언젠가 또 늘어난다. 여기서 막는다.

크기 · 모서리는 var() 로 쓰므로 px 가 남아 있으면 안 되고, 여백은 값을 네 개씩
쓰는 자리라 var() 로 감싸면 오히려 읽기 나빠지므로 숫자로 두되 눈금 위에 둔다.
"""
import io
import os
import re

import pytest

import tokens

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CSS = os.path.join(ROOT, "web", "style.css")


@pytest.fixture(scope="module")
def css():
    """:root 블록은 뺀 나머지. 거기에는 눈금 자체가 정의돼 있다."""
    return io.open(CSS, encoding="utf-8").read().split("/* <<< tokens.py */", 1)[1]


def where(text, idx):
    """몇 번째 줄인지 (틀렸을 때 찾아가기 쉽게)."""
    return text.count("\n", 0, idx) + 1


def test_every_font_size_comes_from_the_scale(css):
    left = [(m.group(0), where(css, m.start()))
            for m in re.finditer(r"font-size:\s*[\d.]+(px|em|rem)", css)]
    assert not left, "글자 크기는 var(--fs-…) 로 쓴다. 남은 곳: %s" % left


def test_every_letter_spacing_travels_with_its_size(css):
    """--fs-x 를 썼으면 --tr-x 도 같이 쓴다. 자간은 크기에 딸린 값이다."""
    bad = []
    for m in re.finditer(r"font-size:var\(--fs-(\w+)\)[^;}]*;\s*([^;}]*)", css):
        step, nxt = m.group(1), m.group(2)
        if "letter-spacing" not in nxt:
            bad.append((step, where(css, m.start())))
        elif "var(--tr-%s)" % step not in nxt and "em" not in nxt:
            bad.append((step, where(css, m.start())))
    assert not bad, "크기 옆에 짝이 되는 자간이 없다: %s" % bad


def test_every_radius_comes_from_the_scale(css):
    """2~6px 은 잔 모양(띠 · 점)이고 999px 은 알약이다. 그 사이는 눈금을 쓴다."""
    bad = []
    for m in re.finditer(r"border-radius:\s*([^;}]+)", css):
        for v in re.findall(r"([\d.]+)px", m.group(1)):
            if 6 < float(v) < 999:
                bad.append((m.group(0).strip(), where(css, m.start())))
    assert not bad, "모서리는 var(--r-…) 로 쓴다. 남은 곳: %s" % bad


SPACE_PROPS = r"(?:margin|padding|gap|row-gap|column-gap)(?:-top|-bottom|-left|-right)?"


def test_every_gap_sits_on_the_grid(css):
    """여백은 눈금 위에 둔다. 0 · 1px 은 눈금이 아니라 선 두께라 뺀다."""
    grid = {int(v) for v in tokens.SPACE} | {0, 1}
    bad = []
    for m in re.finditer(r"\b" + SPACE_PROPS + r":\s*([^;}]+)", css):
        val = m.group(1)
        if "var(" in val or "calc(" in val or "%" in val:
            continue                      # 문서 여백처럼 이름으로 쓰는 것
        for v in re.findall(r"-?([\d.]+)px", val):
            if float(v) != int(float(v)) or int(float(v)) not in grid:
                bad.append((v, m.group(0).strip()[:48], where(css, m.start())))
    assert not bad, "눈금(%s)에 없는 여백: %s" % (", ".join(tokens.SPACE), bad)


def test_the_document_margin_is_one_number(css):
    """땅 위의 것은 모두 같은 왼쪽 선에서 시작한다.

    예전에는 왼쪽 끝이 48 · 44 · 56 셋이었다. 12px 안에 세 줄이 있으면
    맞춘 것도 아니고 벌린 것도 아니라, 어긋난 것처럼만 보인다.
    """
    for sel in (r"\.home\{", r"\.foot\{"):
        rule = re.search(sel + r"[^}]*\}", css, re.S)
        assert rule, sel
        assert "var(--doc" in rule.group(0), "%s 가 문서 여백을 쓰지 않는다" % sel


def test_colours_in_the_stylesheet_all_have_names(css):
    """색은 tokens.py 에서만 나온다. 여기 #rrggbb 를 적으면 언젠가 어긋난다."""
    ok = {"#fff", "#000"}            # 알약 위 글자처럼 순수한 흰검은 그대로 둔다
    found = set(re.findall(r"#[0-9a-fA-F]{3,6}\b", css)) - ok
    # 데이터 URI(체크 표시 · 화살표 SVG) 안의 색은 CSS 변수를 쓸 수 없다
    inline = set()
    for m in re.finditer(r"url\(\"data:[^\"]*\"\)", css):
        inline |= set(re.findall(r"#[0-9a-fA-F]{3,6}\b", m.group(0)))
    assert not (found - inline), "이름 없는 색: %s" % sorted(found - inline)


def test_the_light_ingredients_match_app_js():
    """tokens.LIGHT 의 이름과 sky.js 의 LIT 목록은 1:1 이다.

    sky.js 는 :root 의 --lit-* 를 읽어 해 높이로 섞는다. 이름이 하나라도
    빠지면 그 재료는 undefined 가 되고, 섞는 함수가 그 자리에서 터져
    하늘이 통째로 안 그려진다 - 실제로 능선을 더할 때 그랬다. 조용히
    빈 하늘이 나올 뿐이라 눈으로는 원인을 못 찾는다.
    """
    src = io.open(os.path.join(ROOT, "web", "sky.js"), encoding="utf-8").read()
    m = re.search(r"const LIT = \(\(\) => \{.*?\n\s*\.forEach", src, re.S)
    assert m, "sky.js 에서 LIT 를 찾지 못했다"
    listed = set(re.findall(r"'([a-z0-9-]+)'", m.group(0)))
    assert listed == set(tokens.LIGHT), (
        "하늘 재료 이름이 어긋났다: sky.js 에만 %s / tokens.py 에만 %s"
        % (sorted(listed - set(tokens.LIGHT)), sorted(set(tokens.LIGHT) - listed)))
