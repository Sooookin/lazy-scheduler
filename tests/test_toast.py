# -*- coding: utf-8 -*-
import toast

CARD = {"title": "보고서 제출", "sub": "20분 뒤 마감 · 10:20", "accent": "#4d7572",
        "on_done": lambda: None}
LIST = {"title": "9월 15일 화요일", "sub": "", "accent": "#85bdb3", "label": "아침 브리핑",
        "rows": [("10:00", "보고서", False), ("09/12", "지난 일", True)], "more": 2}


def test_hovering_close_mark_renders():
    """예전에는 Image import 가 빠져 ✕ 강조가 NameError 로 조용히 실패했다."""
    plain, _ = toast._card_rgba(CARD, None)
    hover, _ = toast._card_rgba(CARD, "x")
    assert plain.size == hover.size and plain.tobytes() != hover.tobytes()


def test_cards_scale_with_display_dpi():
    base_card, hits = toast._card_rgba(CARD)
    base_list, _ = toast._card_rgba(LIST)
    toast.set_scale(1.5)
    big_card, big_hits = toast._card_rgba(CARD)
    big_list, _ = toast._card_rgba(LIST)
    assert big_card.width == 340 * 3 // 2 + 2 * 6
    for small, big in ((base_card, big_card), (base_list, big_list)):
        assert abs(big.height - small.height * 1.5) <= 4
    assert big_hits["btn"][2] == round(hits["btn"][2] * 1.5)
