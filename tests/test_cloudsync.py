# -*- coding: utf-8 -*-
"""동기화 엔진을 가짜 Firestore 에 붙여 두 기기가 번갈아 고치는 상황을 흉내 낸다.

가짜 Firestore 는 진짜와 같은 규칙으로 움직인다:
  · commit 은 전부 되거나 전부 안 된다 · 한 commit 의 서버 시각은 하나다
  · updateMask 에 든 경로만 바꾼다 (값이 없으면 지운다)
  · 항목은 보안 규칙처럼 확인한다 (id 가 자리와 같고, 흔적이 아니면 제목이 있어야 한다)
  · 질의는 (updated, 이름) 순서, startAt 은 "그 뒤부터", limit 만큼
"""
import pytest

import cloudauth
import cloudsync
import store
import syncdoc

UID = "uid-1"
CONF = {"project_id": "demo", "api_key": "k", "client_id": "c", "client_secret": "s"}
ROOT = "projects/demo/databases/(default)/documents/users/%s/" % UID
DAILY = {"title": "매일 점검", "kind": "routine", "due_time": "09:00",
         "rule": {"period": "day", "business_only": False}}


class FakeFirestore:
    def __init__(self):
        self.docs = {}              # 전체 이름 → (파이썬 필드, updated)
        self.clock = 0
        self.commits = 0
        self.queries = 0

    def now(self):
        self.clock += 1
        return "2026-09-18T00:%02d:%02d.%06dZ" % (self.clock // 3600, self.clock // 60 % 60, self.clock)

    # --- commit ---
    def commit(self, writes):
        stamp = self.now()
        staged = {}
        for w in writes:
            name = w["update"]["name"]
            fields = cloudsync.decode_fields(w["update"].get("fields"))
            before = staged.get(name, self.docs.get(name, (None, None)))[0]
            base = dict(before or {})
            if "updateMask" in w:
                for path in w["updateMask"]["fieldPaths"]:
                    parts = syncdoc.split_path(path)
                    src, dst = fields, base
                    for p in parts[:-1]:
                        src = src.get(p, {}) if isinstance(src, dict) else {}
                        dst = dst.setdefault(p, {})
                    if isinstance(src, dict) and parts[-1] in src:
                        dst[parts[-1]] = src[parts[-1]]
                    else:
                        dst.pop(parts[-1], None)
            else:
                base = fields
            self._rules(name, before, base)
            staged[name] = (base, stamp)
        self.docs.update(staged)
        self.commits += 1
        return {"commitTime": stamp}

    def _rules(self, name, before, d):
        """firebase/firestore.rules 의 validTask · keepsTombstone 과 같은 확인."""
        if "/tasks/" not in name:
            return
        tid = name.rsplit("/", 1)[-1]
        ok = d.get("id") == tid and isinstance(d.get("schema"), int) and (
            d.get("deleted") is True or (isinstance(d.get("title"), str) and d["title"]))
        if before and before.get("deleted") is True and not set(d) <= {"id", "deleted", "schema", "updated"}:
            ok = False
        if not ok:
            raise cloudsync.Rejected("PERMISSION_DENIED Missing or insufficient permissions.")

    # --- runQuery ---
    def run_query(self, collection, q):
        self.queries += 1
        prefix = ROOT + collection + "/"
        rows = sorted((upd, name) for name, (_, upd) in self.docs.items()
                      if name.startswith(prefix) and "/" not in name[len(prefix):])
        if "startAt" in q:
            ts = q["startAt"]["values"][0]["timestampValue"]
            nm = q["startAt"]["values"][1]["referenceValue"]
            rows = [r for r in rows if r > (ts, nm)]
        rows = rows[:q["limit"]]
        out = []
        for upd, name in rows:
            fields = cloudsync.encode_fields(self.docs[name][0])
            fields["updated"] = {"timestampValue": upd}
            out.append({"document": {"name": name, "fields": fields}})
        return out

    def handle(self, method, url, body=None, _retry=True):
        if url.endswith(":commit"):
            return self.commit(body["writes"])
        if url.endswith(":runQuery"):
            return self.run_query(body["structuredQuery"]["from"][0]["collectionId"], body["structuredQuery"])
        raise AssertionError(url)

    # --- 다른 기기 (휴대폰) 가 직접 쓴다 ---
    def phone_put(self, doc, data):
        self.commit([{"update": {"name": ROOT + doc, "fields": cloudsync.encode_fields(data)}}])

    def phone_patch(self, doc, sets, deletes=()):
        self.commit([{"update": {"name": ROOT + doc, "fields": cloudsync.encode_fields(cloudsync._nest(sets))},
                      "updateMask": {"fieldPaths": list(sets) + list(deletes)}}])

    def get(self, doc):
        return self.docs[ROOT + doc][0]


@pytest.fixture
def cloud(monkeypatch):
    fake = FakeFirestore()
    monkeypatch.setattr(cloudsync, "_call", fake.handle)
    monkeypatch.setattr(cloudauth, "config", lambda: CONF)
    monkeypatch.setattr(cloudauth, "id_token", lambda: "token")
    store.sync_enable(UID)
    return fake


def local(tid):
    return next(t for t in store.load()["tasks"] if t.get("id") == tid)


# ---------- 처음 맞추기 ----------

def test_first_sync_uploads_what_only_this_pc_has(cloud):
    store.sync_disable()                       # 로그인 전에 만든 항목
    t = store.add(DAILY)
    store.update_settings({"notify_min": 15})
    store.sync_enable(UID)
    assert cloudsync.sync_once()
    doc = cloud.get("tasks/" + t["id"])
    assert doc["title"] == "매일 점검" and doc["id"] == t["id"]
    assert cloud.get("meta/settings")["notify_min"] == 15
    assert store.outbox_pending() == [] and store.sync_state()["initialized"]


def test_first_sync_downloads_what_only_the_cloud_has(cloud):
    cloud.phone_put("tasks/p1", {"id": "p1", "title": "휴대폰에서 만든 일", "kind": "floating",
                                 "schema": 2, "done_dates": {}, "skip_dates": {}})
    cloud.phone_put("meta/settings", {"notify_min": 45, "brief_time": "07:30", "business_only": False,
                                      "holidays": ["2026-12-24"]})
    cloudsync.sync_once()
    assert local("p1")["title"] == "휴대폰에서 만든 일"
    st = store.settings()
    assert st["notify_min"] == 45 and st["brief_time"] == "07:30" and st["business_only"] is False
    assert store.load()["holidays"] == ["2026-12-24"]


# ---------- 두 기기가 번갈아 ----------

def test_completing_different_days_on_two_devices_keeps_both(cloud):
    t = store.add(DAILY)
    cloudsync.sync_once()
    doc = "tasks/" + t["id"]
    cloud.phone_patch(doc, {syncdoc.field_path("done_dates", "2026-09-17"): True})   # 휴대폰: 9/17
    store.set_done(t["id"], "2026-09-18", True)                                        # PC: 9/18
    cloudsync.sync_once()
    assert set(cloud.get(doc)["done_dates"]) == {"2026-09-17", "2026-09-18"}
    assert local(t["id"])["done_dates"] == ["2026-09-17", "2026-09-18"]


def test_phone_title_edit_and_pc_completion_both_survive(cloud):
    t = store.add(DAILY)
    cloudsync.sync_once()
    doc = "tasks/" + t["id"]
    cloud.phone_patch(doc, {"title": "아침 점검"})
    store.set_done(t["id"], "2026-09-18", True)
    cloudsync.sync_once()
    assert local(t["id"])["title"] == "아침 점검" and local(t["id"])["done_dates"] == ["2026-09-18"]
    assert cloud.get(doc)["title"] == "아침 점검"


def test_an_unsent_local_edit_is_not_overwritten_by_an_older_pull(cloud):
    """받기만 하고 아직 못 보낸 사이에 화면의 값이 되돌아가면 안 된다."""
    t = store.add(DAILY)
    cloudsync.sync_once()
    cloud.phone_patch("tasks/" + t["id"], {"title": "휴대폰 제목"})
    store.update(t["id"], {"title": "PC 제목"})
    cloudsync.pull(CONF, UID)                          # 보내기 전에 받기만
    assert local(t["id"])["title"] == "PC 제목"
    cloudsync.sync_once()
    assert cloud.get("tasks/" + t["id"])["title"] == "PC 제목"      # 나중에 도착한 쪽


def test_a_deletion_on_the_phone_wins_over_a_pending_pc_edit(cloud):
    t = store.add(DAILY)
    cloudsync.sync_once()
    doc = "tasks/" + t["id"]
    cloud.phone_put(doc, {"id": t["id"], "deleted": True, "schema": 2})
    store.update(t["id"], {"title": "고쳤는데"})
    cloudsync.sync_once()
    assert store.tasks() == []
    assert cloud.get(doc) == {"id": t["id"], "deleted": True, "schema": 2}
    assert store.outbox_pending() == []


def test_settings_changed_on_the_phone_arrive(cloud):
    cloudsync.sync_once()
    cloud.phone_patch("meta/settings", {"notify_min": 5})
    cloudsync.sync_once()
    assert store.settings()["notify_min"] == 5


# ---------- 잃지 않고 · 막히지 않고 · 조용히 ----------

def test_a_rejected_change_is_set_aside_and_does_not_block_the_rest(cloud):
    good = store.add(DAILY)
    cloudsync.sync_once()
    # 서버에 없는 항목을 고치는 변경 → 제목 없는 반쪽 문서가 되어 규칙에 걸린다
    store.outbox_add([{"doc": "tasks/ghost", "kind": "patch", "set": {"note": "x"}, "delete": []}])
    store.update(good["id"], {"title": "잘 가는 변경"})
    cloudsync.sync_once()
    assert cloud.get("tasks/" + good["id"])["title"] == "잘 가는 변경"
    box = store._read_outbox()
    assert box["ops"] == [] and box["rejected"][-1]["doc"] == "tasks/ghost"


def test_our_own_changes_coming_back_do_not_rewrite_the_file_again(cloud):
    t = store.add(DAILY)
    cloudsync.sync_once()
    cloudsync.sync_once()                              # 되돌아온 updated 를 한 번 받아 둔다
    rev = store.snapshot()[1]
    cloudsync.sync_once()
    cloudsync.sync_once()
    assert store.snapshot()[1] == rev, "바뀐 것이 없는데 일정 파일을 다시 썼다"
    assert local(t["id"])["title"] == "매일 점검"


def test_many_documents_with_the_same_server_time_are_all_received(cloud, monkeypatch):
    """한 commit 은 서버 시각이 하나다. 한 페이지보다 많으면 이름으로 이어 받아야 끝난다."""
    monkeypatch.setattr(cloudsync, "PAGE", 3)
    writes = [{"update": {"name": ROOT + "tasks/p%02d" % i, "fields": cloudsync.encode_fields(
        {"id": "p%02d" % i, "title": "일 %d" % i, "kind": "floating", "schema": 2})}} for i in range(8)]
    cloud.commit(writes)
    cloudsync.sync_once()
    assert len(store.tasks()) == 8
    before = cloud.queries
    cloudsync.sync_once()
    assert cloud.queries - before == 2, "받을 것이 없는데 페이지를 계속 넘겼다"


def test_a_late_edit_cannot_put_content_back_onto_a_tombstone(cloud):
    """받고 나서 보내기 직전에 휴대폰이 지우면, 늦은 고침은 규칙에 걸려 옆으로 빠진다."""
    t = store.add(DAILY)
    cloudsync.sync_once()
    doc = "tasks/" + t["id"]
    store.update(t["id"], {"title": "늦은 고침"})
    cloud.phone_put(doc, {"id": t["id"], "deleted": True, "schema": 2})
    cloudsync.push(CONF, UID)                          # 받기를 건너뛴 채 보낸다 (경합)
    assert cloud.get(doc) == {"id": t["id"], "deleted": True, "schema": 2}
    assert store._read_outbox()["rejected"][-1]["doc"] == doc
    cloudsync.sync_once()
    assert store.tasks() == []


def test_signed_out_means_no_network_calls(cloud):
    store.sync_disable()
    store.add(DAILY)
    assert cloudsync.sync_once() is False and cloud.commits == 0 and cloud.queries == 0


def test_local_changes_wake_the_sync_loop(cloud):
    cloudsync._wake.clear()
    if cloudsync.kick not in store.LISTENERS:
        store.LISTENERS.append(cloudsync.kick)
    try:
        store.add(DAILY)
        assert cloudsync._wake.is_set()
    finally:
        store.LISTENERS.remove(cloudsync.kick)


# ---------- 값 모양 ----------

@pytest.mark.parametrize("value", [None, True, False, 0, -3, 1.5, "", "한글",
                                   [], [1, "a", None], {}, {"a": {"b": [True]}}])
def test_values_round_trip_through_firestore_form(value):
    assert cloudsync.decode(cloudsync.encode(value)) == value
    if isinstance(value, bool):
        assert "booleanValue" in cloudsync.encode(value)          # int 로 새지 않는다
