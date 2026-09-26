# -*- coding: utf-8 -*-
"""휴대폰의 색이 tokens.py 와 같은지 지킨다.

tokens.py 의 머리말은 "나중에 다른 형태의 앱을 붙일 때도 사본을 하나 더 만들지
말고 여기서 읽는다" 고 적어 두었지만, 코틀린은 파이썬을 읽을 수 없어 Theme.kt 는
값을 손으로 옮겨 적는다. 손으로 옮기는 한 언젠가 어긋난다 - 실제로 어긋나 있었다:

    sheet2   PC #DEE4E3   휴대폰 #E6EBEA   (책상 색을 바꿀 때 PC 만 고쳤다)
    sheet3   PC #D5DCDB   휴대폰 #DEE4E3
    danger   PC #9D4038   휴대폰 #9A3B2E

나란히 놓고 보기 전에는 아무도 모른다. 여기서 막는다.
"""
import io
import os
import re

import pytest

import tokens

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
THEME = os.path.join(ROOT, "android", "app", "src", "main", "java", "com",
                     "lazyscheduler", "app", "ui", "Theme.kt")

# Theme.kt 의 이름 → tokens.py 의 이름. 코틀린은 낙타등, 파이썬은 붙임표다.
NAMES = {
    "bg": "bg", "card": "card", "dark": "dark", "light": "light", "pale": "pale",
    "sheet2": "sheet2", "sheet3": "sheet3",
    "ink2": "ink2", "body": "body", "muted": "muted", "faint": "faint", "dim": "dim",
    "mint": "mint", "mid": "mid", "midInk": "mid-ink",
    "deep": "deep", "onMid": "onmid",
    "danger": "danger", "hol": "hol", "warm": "warm",
}


@pytest.fixture(scope="module")
def phone():
    """Theme.kt 의 object Ink 안에 적힌 색들."""
    if not os.path.exists(THEME):
        pytest.skip("휴대폰 소스가 없다")
    src = io.open(THEME, encoding="utf-8").read()
    block = re.search(r"object Ink \{(.*?)\n\}", src, re.S)
    assert block, "object Ink 를 찾지 못했다"
    return {m.group(1): "#" + m.group(2).lower()
            for m in re.finditer(r"val (\w+)\s*=\s*Color\(0xFF([0-9A-Fa-f]{6})\)", block.group(1))}


def test_every_shared_colour_matches(phone):
    bad = []
    for kt, py in NAMES.items():
        if kt not in phone:
            bad.append("%s 가 Theme.kt 에 없다 (tokens: %s)" % (kt, tokens.COLOR[py]))
        elif phone[kt] != tokens.COLOR[py].lower():
            bad.append("%s: 휴대폰 %s ≠ tokens %s" % (kt, phone[kt], tokens.COLOR[py]))
    assert not bad, "색이 어긋났다:\n  " + "\n  ".join(bad)


def test_the_phone_does_not_invent_colours(phone):
    """Theme.kt 에만 있는 색이 있으면, 그것도 tokens.py 로 올려야 한다."""
    known = set(tokens.COLOR.values())
    extra = {k: v for k, v in phone.items()
             if k not in NAMES and v not in {c.lower() for c in known}}
    assert not extra, "tokens.py 에 없는 색: %s" % extra


def test_the_type_scale_is_the_shared_one():
    """글자 크기도 tokens.py 의 일곱 단에서만 나온다."""
    if not os.path.exists(THEME):
        pytest.skip("휴대폰 소스가 없다")
    src = io.open(THEME, encoding="utf-8").read()
    steps = {v[0].rstrip("px") for v in tokens.TYPE.values()}
    sizes = set(re.findall(r"val \w+ = ([\d.]+)\.sp", src))
    assert sizes <= steps, "스케일에 없는 크기: %s (눈금 %s)" % (sorted(sizes - steps), sorted(steps))
    # Typography 안에서 숫자를 바로 쓰면 스케일을 비켜 간 것이다
    typo = re.search(r"private val type = Typography\((.*?)\n\)", src, re.S)
    assert typo, "Typography 를 찾지 못했다"
    raw = re.findall(r"fontSize = ([\d.]+)\.sp", typo.group(1))
    assert not raw, "Typography 에 숫자를 바로 적었다: %s" % raw
