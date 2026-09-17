# -*- coding: utf-8 -*-
"""보낼 목록(outbox): 무엇이 바뀌었는지를 필드 단위로, 잃어버리지 않게 적는다.

다른 기기와 합칠 때 이 목록이 곧 "이 기기가 한 일" 이다. 필드를 넓게 적으면
다른 기기의 변경을 덮고, 빠뜨리면 이 기기의 변경이 사라진다. 설계: docs/sync.md.
"""
import json
import os

import pytest

import paths
import store
import syncdoc

DAILY = {"title": "매일 점검", "kind": "routine", "due_time": "09:00",
         "rule": {"period": "day", "business_only": False}}
DEADLINE = {"title": "보고서", "kind": "deadline", "due_date": "2026-09-18", "due_time": "10:00"}


@pytest.fixture
def signed_in():
    store.sync_enable("user-1")


def ops():
    return store.outbox_pending()


# ---------- 언제 적는가 ----------

def test_nothing_is_recorded_before_sign_in():
    store.add(DAILY)
    assert ops() == [] and not os.path.exists(paths.SYNC_OUTBOX_FILE)


def test_changes_received_from_the_server_are_not_sent_back(signed_in):
    with store.transaction(record=False) as d:
        d["tasks"].append({"id": "from-phone", "title": "휴대폰에서", "kind": "floating"})
    assert ops() == []


# ---------- 무엇을 적는가 ----------

def test_a_new_item_is_sent_whole_in_cloud_form(signed_in):
    t = store.add(DAILY)
    (op,) = ops()
    assert op["doc"] == "tasks/" + t["id"] and op["kind"] == "put"
    data = op["data"]
    assert data["title"] == "매일 점검" and data["schema"] == store.SCHEMA_VERSION
    assert data["done_dates"] == {} and data["skip_dates"] == {}
    assert "updated" not in data                          # 서버 시각이 대신한다
    assert data["id"] == t["id"], "보안 규칙은 문서 안의 id 가 자리와 같은지 본다"
    assert op["seq"] == 1 and op["at"]


def test_editing_sends_only_the_changed_fields(signed_in):
    t = store.add(DAILY)
    store.outbox_confirm(99)
    store.update(t["id"], {"title": "아침 점검"})
    (op,) = ops()
    assert op["kind"] == "patch" and op["set"] == {"title": "아침 점검"} and op["delete"] == []


def test_completing_different_days_touches_only_that_day(signed_in):
    """휴대폰에서 9/17, PC 에서 9/18 을 완료해도 서로를 지우지 않는 까닭."""
    t = store.add(DAILY)
    store.outbox_confirm(99)
    store.set_done(t["id"], "2026-09-18", True)
    store.set_done(t["id"], "2026-09-18", False)
    done, undone = ops()
    assert done["set"] == {"done_dates.`2026-09-18`": True} and done["delete"] == []
    assert undone["set"] == {} and undone["delete"] == ["done_dates.`2026-09-18`"]


def test_skipping_a_day_is_its_own_field(signed_in):
    t = store.add(DAILY)
    store.outbox_confirm(99)
    store.skip(t["id"], "2026-09-21")
    (op,) = ops()
    assert op["set"] == {"skip_dates.`2026-09-21`": True}


def test_completing_a_deadline_sends_done_and_done_at(signed_in):
    t = store.add(DEADLINE)
    store.outbox_confirm(99)
    store.set_done(t["id"], None, True)
    (op,) = ops()
    assert set(op["set"]) == {"done", "done_at"} and op["set"]["done"] is True


def test_deleting_replaces_the_item_with_a_tombstone(signed_in):
    t = store.add(DEADLINE)
    store.outbox_confirm(99)
    store.remove(t["id"])
    (op,) = ops()
    assert op["kind"] == "put" and op["data"] == {"id": t["id"], "deleted": True,
                                                  "schema": store.SCHEMA_VERSION}


def test_only_shared_settings_are_sent(signed_in):
    store.update_settings({"hold_when_busy": False, "show_weekend": False})
    assert ops() == [], "기기마다 다른 설정이 다른 기기로 건너갔다"
    store.update_settings({"notify_min": 15})
    (op,) = ops()
    assert op["doc"] == "meta/settings" and op["set"] == {"notify_min": 15}


def test_saving_without_a_change_records_nothing(signed_in):
    t = store.add(DAILY)
    store.outbox_confirm(99)
    store.set_done(t["id"], "2026-09-18", True)
    store.set_done(t["id"], "2026-09-18", True)       # 이미 완료 - 값이 그대로다
    assert len(ops()) == 1


# ---------- 잃어버리지 않는가 ----------

def test_confirmed_changes_leave_and_numbering_keeps_going(signed_in):
    store.add(DAILY)
    store.add(DEADLINE)
    first, second = ops()
    store.outbox_confirm(first["seq"])
    assert [o["seq"] for o in ops()] == [second["seq"]]
    store.add({"title": "메모", "kind": "floating"})
    assert ops()[-1]["seq"] == second["seq"] + 1, "번호가 되풀이되면 서버 확인이 엉뚱한 변경을 지운다"


def test_outbox_survives_a_restart(signed_in):
    store.add(DAILY)
    with open(paths.SYNC_OUTBOX_FILE, encoding="utf-8") as f:
        on_disk = json.load(f)["ops"]
    assert on_disk == ops() and len(on_disk) == 1


def test_a_failed_save_does_not_leave_a_phantom_change(signed_in, monkeypatch):
    store.add(DAILY)
    before = ops()
    real = store._write_json

    def failing(path, obj):
        if path == store.DATA:
            raise store.StoreError("디스크가 가득 찼다")
        return real(path, obj)

    monkeypatch.setattr(store, "_write_json", failing)
    with pytest.raises(store.StoreError):
        store.add(DEADLINE)
    monkeypatch.setattr(store, "_write_json", real)
    assert ops() == before, "저장하지 못한 변경이 보낼 목록에 남았다"
    assert len(store.tasks()) == 1


def test_a_corrupt_outbox_is_kept_aside_not_silently_dropped(signed_in):
    with open(paths.SYNC_OUTBOX_FILE, "w", encoding="utf-8") as f:
        f.write("{not json")
    store.add(DAILY)
    assert len(ops()) == 1
    kept = [n for n in os.listdir(paths.DATA_DIR) if n.startswith("sync-outbox.json.corrupt-")]
    assert kept, "깨진 보낼 목록을 흔적 없이 버렸다"


# ---------- 로그인 · 로그아웃 ----------

def test_sign_out_clears_sync_records_but_keeps_the_schedule(signed_in):
    store.add(DAILY)
    store.sync_disable()
    assert not store.sync_enabled() and ops() == []
    assert len(store.tasks()) == 1


def test_signing_in_as_someone_else_starts_clean(signed_in):
    store.add(DAILY)
    store.sync_enable("user-2")
    assert ops() == [], "앞 계정의 변경이 다른 계정으로 올라갈 뻔했다"
    assert store.sync_state() == {"uid": "user-2"}


# ---------- 클라우드 모양 (휴대폰 앱이 옮겨 구현할 약속) ----------

@pytest.mark.parametrize("parts, path", [
    (("title",), "title"),
    (("done_dates", "2026-09-18"), "done_dates.`2026-09-18`"),
    (("a b",), "`a b`"),
    (("we`ird",), "`we\\`ird`"),
])
def test_field_paths_are_quoted_when_needed(parts, path):
    assert syncdoc.field_path(*parts) == path


def test_cloud_form_round_trips():
    t = store.add(dict(DAILY, note="메모", tag="업무"))
    store.set_done(t["id"], "2026-09-18", True)
    store.skip(t["id"], "2026-09-21")
    (saved,) = store.tasks()
    back = syncdoc.from_remote(saved["id"], syncdoc.to_remote(saved), updated=saved["updated"])
    assert back == saved


def test_tombstone_round_trips():
    tomb = {"id": "x", "deleted": True, "updated": "2026-09-18T00:00:00+00:00"}
    assert syncdoc.from_remote("x", syncdoc.to_remote(tomb), updated=tomb["updated"]) == tomb


def test_pending_paths_protect_unsent_local_edits():
    box = [{"doc": "tasks/a", "kind": "patch", "set": {"title": "새 이름"}, "delete": ["note"]},
           {"doc": "tasks/b", "kind": "put", "data": {}}]
    assert syncdoc.pending_paths(box, "tasks/a") == {"title", "note"}
    assert syncdoc.pending_paths(box, "tasks/b") == {"*"}
    assert syncdoc.pending_paths(box, "tasks/c") == set()
