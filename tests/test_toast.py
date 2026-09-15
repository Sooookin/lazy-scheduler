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


# ---------- 발표 중 알림 보류 ----------

def test_hold_switch_off_means_never_hold(monkeypatch):
    """설정을 끄면 전체 화면이든 아니든 묻지 않고 띄운다."""
    monkeypatch.setattr(toast, "HOLD_WHEN_BUSY", False)
    monkeypatch.setattr(toast, "_foreground_is_fullscreen", lambda: True)
    assert toast._should_hold() is False


def test_work_area_is_a_sane_rectangle():
    """모니터를 못 찾아도 화면 크기로 되돌아와야 한다 (0 넓이를 돌려주면 카드가 사라진다)."""
    left, top, right, bottom = toast._work_area()
    assert right > left and bottom > top


def test_held_notifications_are_kept_not_dropped(monkeypatch):
    """보류는 버리는 것이 아니다. 묶음 카드 한 장으로 다시 나와야 한다."""
    monkeypatch.setattr(toast, "_held", [
        {"title": "보고서 제출", "hold_at": "10:20"},
        {"title": "회의 준비", "hold_at": "10:35"},
    ])
    toast._flush_held()
    assert toast._held == []
    item = toast._queue.get_nowait()
    assert item["rows"][0][1] == "보고서 제출"
    assert "2건" in item["title"]
