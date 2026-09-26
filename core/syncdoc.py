# -*- coding: utf-8 -*-
"""동기화의 순수한 부분: 항목이 클라우드(Firestore)에서 어떤 모양인지, 무엇이 바뀌었는지.

파일도 네트워크도 건드리지 않는다. 그래서 휴대폰 앱이 같은 약속을 그대로
옮겨 구현할 수 있고, 여기 테스트가 그 약속의 명세가 된다. 설계: docs/sync.md.

바뀐 것을 "필드 단위" 로 적는 이유
  항목을 통째로 덮어쓰면, 휴대폰에서 9/18 을 완료하는 사이 PC 에서 제목을
  고쳤을 때 늦게 도착한 쪽이 다른 쪽의 변경을 지운다. 바뀐 필드만 보내면
  서버가 필드별로 적용하므로 둘 다 남는다.
  완료 · 건너뛴 날짜를 목록이 아니라 날짜별 필드(map)로 두는 것도 같은 까닭이다.
"""
import json
import re

SCHEMA = 2                      # store.SCHEMA_VERSION 과 같다 (store 가 확인한다)
MAP_FIELDS = ("done_dates", "skip_dates")        # 저장은 목록, 클라우드는 {날짜: true}
# 클라우드가 정하거나 문서 자리로 대신하는 필드. 변경으로 보내지 않는다.
MANAGED = ("id", "updated", "schema")
# 모든 기기가 같이 쓰는 설정. 나머지(발표 중 보류 · 달력 보기 방식 등)는 기기마다 따로다.
SHARED_SETTINGS = ("notify_min", "brief_time", "business_only")
SETTINGS_DOC = "meta/settings"

_SIMPLE = re.compile(r"^[A-Za-z_][A-Za-z_0-9]*$")


def field_path(*parts):
    """Firestore 필드 경로. 날짜처럼 '-' 가 든 이름은 백틱으로 감싼다.

    field_path("done_dates", "2026-09-18") -> "done_dates.`2026-09-18`"
    """
    out = []
    for p in parts:
        p = str(p)
        out.append(p if _SIMPLE.match(p) else "`" + p.replace("\\", "\\\\").replace("`", "\\`") + "`")
    return ".".join(out)


def task_doc(task_id):
    return "tasks/%s" % task_id


def to_remote(task):
    """저장 형식의 항목 → 클라우드 문서. updated 는 서버가 채운다.

    id 는 문서 자리(tasks/<id>)와 같지만 필드로도 싣는다. 보안 규칙이 "문서 자리와
    안의 id 가 같은가" 를 확인해서, 남의 자리에 항목을 끼워 넣는 실수를 막는다.
    """
    if task.get("deleted"):
        return {"id": task["id"], "deleted": True, "schema": SCHEMA}
    doc = {k: v for k, v in task.items() if k not in MANAGED}
    for k in MAP_FIELDS:
        doc[k] = {d: True for d in (task.get(k) or []) if isinstance(d, str)}
    doc["id"] = task["id"]
    doc["schema"] = SCHEMA
    return doc


def from_remote(task_id, doc, updated=None):
    """클라우드 문서 → 저장 형식의 항목. updated 는 서버 시각(UTC ISO 문자열)."""
    t = {k: v for k, v in doc.items() if k != "schema"}
    t["id"] = task_id
    if updated is not None:
        t["updated"] = updated
    if t.get("deleted"):
        return {"id": task_id, "deleted": True, "updated": t.get("updated")}
    for k in MAP_FIELDS:
        m = doc.get(k) or {}
        t[k] = sorted(d for d, on in m.items() if on) if isinstance(m, dict) else []
    return t


def _same(a, b):
    """JSON 으로 같은 값인가 (1 과 True, 1 과 1.0 을 다르게 본다)."""
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


def diff(old, new):
    """두 클라우드 문서의 차이 → (set: {경로: 값}, delete: [경로]).

    날짜 필드는 날짜 하나하나를 따로 적는다. 나머지는 필드 전체를 바꾼다
    (반복 규칙 rule 은 부분이 아니라 통째로 한 값이다).
    """
    sets, deletes = {}, []
    for k in sorted(set(old) | set(new)):
        if k in MANAGED:
            continue
        if k in MAP_FIELDS:
            om, nm = old.get(k) or {}, new.get(k) or {}
            for day in sorted(set(om) | set(nm)):
                if day in nm and (day not in om or not _same(om[day], nm[day])):
                    sets[field_path(k, day)] = nm[day]
                elif day not in nm:
                    deletes.append(field_path(k, day))
        elif k in new:
            if k not in old or not _same(old[k], new[k]):
                sets[field_path(k)] = new[k]
        else:
            deletes.append(field_path(k))
    return sets, deletes


def _valid(t):
    return isinstance(t, dict) and isinstance(t.get("id"), str) and t["id"]


def snapshot(data):
    """비교용 사본: 항목(id → 항목), 같이 쓰는 설정, 추가 휴일."""
    tasks = {t["id"]: t for t in data.get("tasks", []) if _valid(t)}
    settings = data.get("settings") if isinstance(data.get("settings"), dict) else {}
    return json.loads(json.dumps({
        "tasks": tasks,
        "settings": {k: settings[k] for k in SHARED_SETTINGS if k in settings},
        "holidays": [h for h in (data.get("holidays") or []) if isinstance(h, str)],
    }, ensure_ascii=False))


def changes(before, after):
    """저장 전후 사본 → 보낼 변경 목록.

    {"doc": "tasks/<id>", "kind": "put", "data": {...}}         새 항목 · 지운 항목(흔적으로 덮는다)
    {"doc": "tasks/<id>", "kind": "patch", "set": {...}, "delete": [...]}
    {"doc": "meta/settings", "kind": "patch", ...}

    이 기기에서 오래된 흔적을 치운 것(항목이 목록에서 사라짐)은 보내지 않는다.
    서버의 흔적은 서버가 따로 치운다.
    """
    ops = []
    old_tasks = before["tasks"]
    for tid, t in after["tasks"].items():
        prev = old_tasks.get(tid)
        if prev is not None and _same(prev, t):
            continue
        if prev is None or (t.get("deleted") and not prev.get("deleted")):
            ops.append({"doc": task_doc(tid), "kind": "put", "data": to_remote(t)})
            continue
        sets, deletes = diff(to_remote(prev), to_remote(t))
        if sets or deletes:
            ops.append({"doc": task_doc(tid), "kind": "patch", "set": sets, "delete": deletes})

    sets, deletes = diff(before["settings"], after["settings"])
    if not _same(before["holidays"], after["holidays"]):
        sets[field_path("holidays")] = after["holidays"]
    if sets or deletes:
        ops.append({"doc": SETTINGS_DOC, "kind": "patch", "set": sets, "delete": deletes})
    return ops


def split_path(path):
    """field_path 의 반대. "done_dates.`2026-09-18`" -> ["done_dates", "2026-09-18"]"""
    parts, cur, quoted, i = [], "", False, 0
    while i < len(path):
        ch = path[i]
        if quoted and ch == "\\" and i + 1 < len(path):
            cur += path[i + 1]
            i += 2
            continue
        if ch == "`":
            quoted = not quoted
        elif ch == "." and not quoted:
            parts.append(cur)
            cur = ""
        else:
            cur += ch
        i += 1
    parts.append(cur)
    return parts


def merge_task(local, incoming, pending):
    """받아 온 항목 위에, 아직 보내지 않은 이 기기의 변경을 다시 얹는다.

    받아 온 것이 서버의 최신이지만, 이 기기에서 방금 고치고 아직 못 보낸 필드는
    곧 서버로 간다. 그 필드까지 받아 온 값으로 덮으면 화면에서 방금 한 일이
    되돌아갔다가, 보낸 뒤에야 다시 나타난다.
    """
    if local is None or not pending:
        return incoming
    if "*" in pending:
        return local
    out = json.loads(json.dumps(incoming, ensure_ascii=False))
    for path in pending:
        parts = split_path(path)
        if len(parts) == 1:
            k = parts[0]
            if k in local:
                out[k] = json.loads(json.dumps(local[k], ensure_ascii=False))
            else:
                out.pop(k, None)
        elif len(parts) == 2 and parts[0] in MAP_FIELDS:
            k, day = parts
            days = set(out.get(k) or [])
            (days.add if day in (local.get(k) or []) else days.discard)(day)
            out[k] = sorted(days)
    return out


def pending_paths(ops, doc):
    """아직 보내지 않은 변경이 건드리는 경로. 받아 온 값이 이 경로를 덮으면 안 된다.

    "put" 이 있으면 문서 전체가 아직 이 기기 것이므로 {"*"}.
    """
    out = set()
    for op in ops:
        if op.get("doc") != doc:
            continue
        if op.get("kind") == "put":
            return {"*"}
        out.update(op.get("set") or {})
        out.update(op.get("delete") or [])
    return out
