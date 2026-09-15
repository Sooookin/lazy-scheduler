# -*- coding: utf-8 -*-
import toast

CARD = {"title": "보고서 제출", "sub": "20분 뒤 마감 · 10:20", "on_done": lambda: None,
        "on_snooze": lambda: None, "can_open": True}
LIST = {"title": "9월 15일 화요일", "sub": "", "label": "아침 브리핑",
        "rows": [("10:00", "보고서", False), ("09/12", "지난 일", True)], "more": 2}


def test_hovering_close_mark_renders():
    """예전에는 Image import 가 빠져 ✕ 강조가 NameError 로 조용히 실패했다."""
    plain, _ = toast._card_rgba(CARD, None)
    hover, _ = toast._card_rgba(CARD, "x")
    assert plain.size == hover.size and plain.tobytes() != hover.tobytes()


def test_hover_on_each_button_changes_only_the_picture(monkeypatch):
    monkeypatch.setattr(toast, "_open_handler", lambda: None)
    base, hits = toast._card_rgba(CARD, None)
    assert {"x", "done", "snooze", "open"} <= set(hits)
    for name in ("done", "snooze", "open"):
        img, again = toast._card_rgba(CARD, name)
        assert img.size == base.size and again == hits and img.tobytes() != base.tobytes()


def test_open_button_needs_a_handler(monkeypatch):
    monkeypatch.setattr(toast, "_open_handler", None)
    _, hits = toast._card_rgba(CARD)
    assert "open" not in hits and "done" in hits


def test_cards_are_redrawn_at_display_scale_not_stretched():
    """150% 화면에서는 1.5배 픽셀로 새로 그린다 (늘려서 흐리게 만들지 않는다)."""
    base_card, hits = toast._card_rgba(CARD)
    base_list, _ = toast._card_rgba(LIST)
    toast.set_scale(1.5)
    big_card, big_hits = toast._card_rgba(CARD)
    big_list, _ = toast._card_rgba(LIST)
    assert big_card.width == 340 * 3 // 2 + 2 * 39
    for small, big in ((base_card, big_card), (base_list, big_list)):
        assert abs(big.height - small.height * 1.5) <= 6
    assert abs(big_hits["done"][3] - hits["done"][3] * 1.5) <= 1


def test_shadow_fades_out_inside_the_window():
    """그림자가 창 가장자리에서 네모나게 잘리면 밝은 바탕에서 사각형이 보인다."""
    for scale in (1.0, 1.5, 2.0):
        toast.set_scale(scale)
        a = toast._card_rgba(CARD)[0].getchannel("A")
        w, h = a.size
        border = [a.getpixel((x, h - 1)) for x in range(w)] + [a.getpixel((w - 1, y)) for y in range(h)]
        assert max(border) <= 2, scale


def test_texture_is_stable_between_redraws():
    """마우스를 올려 다시 그려도 종이 결이 바뀌어 반짝이면 안 된다."""
    one, _ = toast._card_rgba(LIST)
    two, _ = toast._card_rgba(LIST)
    assert one.tobytes() == two.tobytes()


def test_fold_row_is_one_click_target():
    img, hits = toast._card_rgba({"fold": True, "count": 3})
    assert list(hits) == ["fold"] and img.height < toast._card_rgba(CARD)[0].height


def test_easing_matches_css_curve():
    e = toast.EASE
    assert e(0) == 0 and e(1) == 1
    samples = [e(x / 20) for x in range(21)]
    assert all(b >= a for a, b in zip(samples, samples[1:]))          # 되돌아가지 않는다
    assert 0.7 < e(0.25) < 0.85                                         # 빨리 출발해 부드럽게 선다 (CSS 와 같은 곡선)


def test_legacy_accent_maps_to_late(monkeypatch):
    toast._seen.clear()
    toast.notify("지난 알림", "마감 시간 지남", accent="#08202b", key="legacy-late")
    item = toast._queue.get_nowait()
    assert item["late"] is True


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
        {"title": "보고서 제출", "hold_at": "10:20", "late": True},
        {"title": "회의 준비", "hold_at": "10:35"},
    ])
    assert toast.held_count() == 2
    toast._flush_held()
    assert toast._held == [] and toast.held_count() == 0
    item = toast._queue.get_nowait()
    assert item["rows"][0][1] == "보고서 제출" and item["rows"][0][2] is True
    assert "2건" in item["title"]
