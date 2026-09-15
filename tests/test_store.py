# -*- coding: utf-8 -*-
import json
import os
import threading
from datetime import date

import pytest

import paths
import store


def raw():
    with open(store.DATA, encoding="utf-8") as f:
        return json.load(f)


def write_raw(obj_or_text):
    os.makedirs(paths.DATA_DIR, exist_ok=True)
    with open(store.DATA, "w", encoding="utf-8") as f:
        f.write(obj_or_text if isinstance(obj_or_text, str) else json.dumps(obj_or_text))


def deadline(**kw):
    t = {"title": "보고서", "kind": "deadline", "due_date": "2026-09-15", "due_time": "10:00"}
    t.update(kw)
    return t


# ---------- 검증 ----------

@pytest.mark.parametrize("patch", [
    {"title": ""},
    {"title": "   "},
    {"title": 123},
    {"title": "x" * 201},
    {"note": "x" * 2001},
    {"kind": "event"},
    {"due_time": "abc"},
    {"due_time": "24:00"},
    {"due_time": "9:30"},
    {"due_time": "<img src=x onerror=alert(1)>"},
    {"due_date": "2026-02-30"},
    {"due_date": "20260915"},
    {"due_date": 20260915},
    {"notify_min": "30"},
    {"notify_min": -5},
    {"notify_min": True},
    {"muted": "yes"},
    {"kind": "routine", "rule": {"period": "week", "weekdays": []}},
    {"kind": "routine", "rule": None},
])
def test_add_rejects_invalid_input_and_writes_nothing(patch):
    with pytest.raises(store.ValidationError):
        store.add(deadline(**patch))
    assert not os.path.exists(store.DATA)


def test_add_ignores_managed_and_unknown_fields():
    t = store.add(deadline(id="mine", created="1999-01-01", done=True,
                           done_dates=["2026-01-01"], deleted=True, hacker="x"))
    assert t["id"] != "mine" and len(t["id"]) == 32
    assert t["created"] != "1999-01-01" and t["done"] is False and t["done_dates"] == []
    assert "deleted" not in t and "hacker" not in t
    assert t["updated"].endswith("+00:00")


def test_kind_normalizes_irrelevant_fields():
    t = store.add({"title": "메모", "kind": "floating", "due_date": "2026-09-15",
                   "due_time": "10:00", "rule": {"period": "day"}})
    assert (t["due_date"], t["due_time"], t["rule"]) == (None, "", None)


# ---------- 저장 안전 ----------

def test_corrupt_file_is_recovered_from_backup_not_wiped():
    for k in range(3):
        store.add(deadline(title="task%d" % k))
    with open(store.DATA, "r+", encoding="utf-8") as f:
        f.truncate(40)                          # 쓰다가 전원이 나간 상황

    titles = [t["title"] for t in store.tasks()]
    assert titles == ["task0", "task1"]         # 직전 저장본(.bak)에서 되살림
    assert store.NOTICE and "백업" in store.NOTICE
    kept = [n for n in os.listdir(paths.DATA_DIR) if n.startswith("data.json.corrupt-")]
    assert len(kept) == 1
    assert raw()["tasks"][0]["title"] == "task0"   # 되살린 내용이 제자리에 저장됨


def test_corrupt_file_without_backup_is_kept_aside():
    write_raw('{"tasks": [{"title": "소중한 일정"')
    assert store.tasks() == []
    kept = [n for n in os.listdir(paths.DATA_DIR) if n.startswith("data.json.corrupt-")]
    with open(os.path.join(paths.DATA_DIR, kept[0]), encoding="utf-8") as f:
        assert "소중한 일정" in f.read()
    assert "보관" in store.NOTICE


def test_unreadable_file_is_never_overwritten():
    os.makedirs(store.DATA)                     # 열 수 없는 "파일" (잠김·권한 없음과 같은 경로)
    with pytest.raises(store.StoreError):
        store.add(deadline())
    assert os.path.isdir(store.DATA)


def test_file_from_newer_app_is_refused():
    write_raw({"version": 99, "tasks": [{"id": "a", "title": "미래"}]})
    with pytest.raises(store.StoreError):
        store.add(deadline())
    assert raw()["version"] == 99


def test_write_leaves_daily_backup_and_bak():
    store.add(deadline(title="one"))
    store.add(deadline(title="two"))
    with open(store.DATA + ".bak", encoding="utf-8") as f:
        assert [t["title"] for t in json.load(f)["tasks"]] == ["one"]
    assert os.path.exists(os.path.join(paths.BACKUP_DIR, "data-%s.json" % date.today()))


def test_migrates_v1_file():
    write_raw({
        "tasks": [{"id": "r1", "title": "격주 회의", "kind": "routine", "created": "2026-03-04T09:00:00",
                   "rule": {"kind": "weekly", "weekdays": [2], "interval": 2}}],
        "fired": ["r1:2026-09-15:10:00", "brief:2026-09-15"],
        "holidays": [], "settings": {"notify_min": 15},
    })
    d = store.load()
    assert d["version"] == 2 and "fired" not in d
    t = d["tasks"][0]
    assert t["rule"]["anchor"] == "2026-03-04" and t["updated"]
    assert d["settings"]["notify_min"] == 15 and d["settings"]["brief_time"] == "08:30"
    assert "brief:2026-09-15" in store.fired_keys()
    assert "fired" not in raw() and raw()["version"] == 2
    with open(store.DATA + ".bak", encoding="utf-8") as f:
        assert "fired" in json.load(f)                 # 옮기기 전 원본을 남김


# ---------- 동시성 ----------

def test_concurrent_writers_do_not_lose_updates():
    """예전에는 한 스레드가 읽어 둔 옛 내용을 저장하면서 다른 스레드의 변경을 지웠다."""
    ids = [store.add(deadline(title="t%d" % k))["id"] for k in range(24)]
    errors = []

    def complete(chunk):
        try:
            for tid in chunk:
                store.set_done(tid, None, True)
        except Exception as e:                        # pragma: no cover
            errors.append(e)

    def noise():
        try:
            for k in range(30):
                store.update_settings({"notify_min": k})
                store.mark_fired("k%d" % k)
        except Exception as e:                        # pragma: no cover
            errors.append(e)

    threads = [threading.Thread(target=complete, args=(ids[k::4],)) for k in range(4)]
    threads.append(threading.Thread(target=noise))
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert not errors
    assert all(t["done"] for t in store.tasks())


def test_exception_inside_transaction_writes_nothing():
    store.add(deadline(title="before"))
    with pytest.raises(RuntimeError):
        with store.transaction() as d:
            d["tasks"].clear()
            raise RuntimeError("boom")
    assert [t["title"] for t in store.tasks()] == ["before"]


# ---------- 항목 동작 ----------

def test_set_done_is_idempotent():
    tid = store.add(deadline())["id"]
    store.set_done(tid, None, True)                   # 창에서 완료
    store.set_done(tid, "2026-09-15", True)           # 알림 카드에서 또 [완료]
    assert store.tasks()[0]["done"] is True
    store.set_done(tid, None, False)
    assert store.tasks()[0]["done"] is False and store.tasks()[0]["done_at"] is None


def test_set_done_routine_is_per_date():
    tid = store.add({"title": "r", "kind": "routine", "rule": {"period": "day"}})["id"]
    store.set_done(tid, "2026-09-15", True)
    store.set_done(tid, "2026-09-15", True)
    store.set_done(tid, "2026-09-16", True)
    store.set_done(tid, "2026-09-16", False)
    assert store.tasks()[0]["done_dates"] == ["2026-09-15"]


def test_remove_leaves_tombstone_without_content():
    tid = store.add(deadline(title="비밀 일정", note="개인 메모"))["id"]
    store.remove(tid)
    assert store.tasks() == []
    (tomb,) = raw()["tasks"]
    assert set(tomb) == {"id", "deleted", "updated"} and tomb["deleted"] is True
    assert store.instances(data=store.load()) == []
    with pytest.raises(store.NotFoundError):
        store.update(tid, {"title": "부활"})
    with pytest.raises(store.NotFoundError):
        store.remove(tid)


def test_skip_and_unskip():
    tid = store.add({"title": "r", "kind": "routine", "rule": {"period": "day"}})["id"]
    store.skip(tid, "2026-09-15")
    assert store.tasks()[0]["skip_dates"] == ["2026-09-15"]
    store.unskip(tid, "2026-09-15")
    assert store.tasks()[0]["skip_dates"] == []
    with pytest.raises(store.ValidationError):
        store.skip(store.add(deadline())["id"], "2026-09-15")


def test_new_weekly_rule_gets_anchor_and_edits_keep_it():
    """예전에는 옛 형식(kind == 'weekly')만 확인해서 새 격주 규칙에 기준 주가 없었다."""
    t = store.add({"title": "격주", "kind": "routine",
                   "rule": {"period": "week", "weekdays": [0], "interval": 2}})
    anchor = t["rule"]["anchor"]
    assert anchor == t["created"][:10]
    with store.transaction() as d:                    # 기준 주를 과거로 옮겨 둔다
        d["tasks"][0]["rule"]["anchor"] = "2026-01-05"
    store.update(t["id"], {"rule": {"period": "week", "weekdays": [0, 2], "interval": 2}})
    assert store.tasks()[0]["rule"]["anchor"] == "2026-01-05"


def test_updated_changes_on_every_edit(monkeypatch):
    stamps = iter(["2026-09-15T00:00:01+00:00", "2026-09-15T00:00:02+00:00"])
    monkeypatch.setattr(store, "_now_utc", lambda: next(stamps))
    tid = store.add(deadline())["id"]
    store.update(tid, {"title": "고침"})
    assert store.tasks()[0]["updated"] == "2026-09-15T00:00:02+00:00"


# ---------- 설정 ----------

def test_settings_are_validated():
    with pytest.raises(store.ValidationError):
        store.update_settings({"notify_min": "abc"})
    with pytest.raises(store.ValidationError):
        store.update_settings({"brief_time": "8:30"})
    out = store.update_settings({"notify_min": 10, "brief_time": "", "whatever": 1})
    assert out["notify_min"] == 10 and out["brief_time"] == "" and "whatever" not in out


def test_hold_when_busy_defaults_on_and_is_validated():
    """발표 중 알림 미룰기. 기본값은 켜져 있어야 한다
    (사고가 나는 쪽이 기본이 되면 안 된다)."""
    assert store.settings()["hold_when_busy"] is True
    with pytest.raises(store.ValidationError):
        store.update_settings({"hold_when_busy": "yes"})
    assert store.update_settings({"hold_when_busy": False})["hold_when_busy"] is False


def test_old_file_without_hold_setting_gets_the_default():
    """이전 버전이 적은 파일에는 이 항목이 없다. 읽을 때 채워 넣는다."""
    write_raw({"version": 2, "tasks": [], "holidays": [],
               "settings": {"notify_min": 15}})
    assert store.settings()["hold_when_busy"] is True


def test_settings_reader_survives_bad_stored_values():
    write_raw({"version": 2, "tasks": [], "holidays": [],
               "settings": {"notify_min": "abc", "brief_time": None, "business_only": False}})
    st = store.settings()
    assert st["notify_min"] == 30 and st["brief_time"] == "08:30" and st["business_only"] is False


# ---------- 계산 ----------

def test_one_bad_record_does_not_break_the_overview():
    write_raw({"version": 2, "holidays": [], "settings": {}, "tasks": [
        {"id": "good", "title": "정상", "kind": "deadline", "due_date": "2026-09-15", "due_time": "10:00"},
        {"id": "bad1", "title": "시각 깨짐", "kind": "deadline", "due_date": "2026-09-15", "due_time": "abc"},
        {"id": "bad2", "title": "날짜 깨짐", "kind": "deadline", "due_date": "someday"},
        {"id": "bad3", "title": "규칙 깨짐", "kind": "routine", "created": "2026-01-01",
         "rule": {"period": "week", "weekdays": [0], "interval": "x"}},
    ]})
    o = store.overview()
    ids = {i["id"] for i in o["todays"] + o["overdue"] + o["upcoming"] + o["later"]}
    assert "good" in ids or o["today"] != "2026-09-15"
    assert {i["id"] for i in store.instances(back=3650, ahead=3650)} == {"good"}


def test_mark_fired_once_and_prunes_old_keys():
    from datetime import datetime
    assert store.mark_fired("a", datetime(2026, 9, 1, 9, 0))
    assert not store.mark_fired("a", datetime(2026, 9, 1, 9, 1))
    assert store.mark_fired("b", datetime(2026, 9, 10, 9, 0))   # 3일 넘은 "a" 는 정리됨
    assert store.fired_keys() == {"b"}
