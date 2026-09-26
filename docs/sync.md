# Sync design: PC ↔ phone through Firebase

Status: being built — see section 11 for what is done. Written so a Play Store release can use the
same design later; for now it serves one person with a PC and a phone.

## 1. Goals

- The PC app and the Android app show the same items, settings and completions.
- Both work **offline**. Changes go up when a connection comes back.
- Only the signed-in person can read or write their data.
- The free Firebase plan is enough for one person, and for a small public app.
- Reminders keep working on each device on its own (the phone does not need the PC).

Not goals: sharing between people, real-time co-editing, a web version.

## 2. Pieces

```
PC app (Python)                      Android app (Kotlin)
  local data.json  ◄─ sync engine      Firestore SDK (own offline cache)
        │              │                       │
        └──── REST ────┼───────────────────────┘
                       ▼
        Firebase Auth (Google sign-in)
        Cloud Firestore  users/{uid}/...
```

| Piece | PC | Phone |
|---|---|---|
| Sign-in | Google sign-in in the browser → Firebase Auth REST | Firebase Auth SDK |
| Database access | Firestore REST API | Firestore SDK (offline cache is built in) |
| Local copy | `data.json` (unchanged format) | SDK cache |
| Reminders | the existing scheduler + cards | AlarmManager, rebuilt after reboot |

The PC keeps `data.json` as its source of truth for the screen and the
scheduler. Sync is a layer beside it: nothing else in the PC app talks to Firebase.

## 3. Data in Firestore

```
users/{uid}/tasks/{taskId}        one document per item (including deleted ones)
users/{uid}/meta/settings         settings shared by all devices
config/holidays_kr                public-holiday list, read-only for apps
```

### Task document

Same fields as a task in `data.json` (see `store.py`), with two changes that make
merging safe:

| Field | In `data.json` | In Firestore | Why |
|---|---|---|---|
| `done_dates` | list `["2026-09-18", ...]` | map `{"2026-09-18": true}` | two devices completing different days must both survive |
| `skip_dates` | list | map `{"2026-09-18": true}` | same |
| `updated` | UTC ISO string | server timestamp | the pull cursor must use one clock |
| `schema` | — (file has `version`) | `2` | a newer app's documents are not rewritten by an older app |

`id` is the document ID (a uuid made on the device, so creating works offline). It is
also stored as a field, so the security rules can check that it matches the document ID.
A deleted item keeps only `id`, `deleted: true`, `updated`, `schema`
(the tombstone `store.remove` already writes, plus `schema`).

### Settings

| Shared (`meta/settings`) | Stays on each device |
|---|---|
| `notify_min`, `brief_time`, `business_only`, `holidays` (extra dates) | `hold_when_busy`, autostart, `show_weekend`, `show_routines`, `theme`, fired-alert records (`state.json`) |

View preferences stay local because a phone calendar and a PC calendar are
laid out differently.

### Holidays

`config/holidays_kr` holds `{ "years": { "2026": {"2026-01-01": "신정", ...} } }`.
Apps ship with a built-in list and use this document when it is newer. The
list can then be updated once a year from the Firebase console, without a new
app release. (The built-in list in `recur.py` ends in 2027.)

## 4. How writes merge

**Rule: never overwrite a whole document. Send only the fields that changed.**

Firestore applies field updates one by one, so edits to different fields on
different devices both survive. If two devices change the *same* field, the one
that reaches the server last wins. For one person that is the expected result.

| User action | Fields sent |
|---|---|
| add item | the whole new document (it did not exist) |
| edit title / time / rule | only those fields + `updated` |
| complete a routine on 9/18 | `done_dates.\`2026-09-18\`: true` + `updated` |
| undo that | `done_dates.\`2026-09-18\`: delete` + `updated` |
| complete a deadline | `done`, `done_at` + `updated` |
| delete | the tombstone (all content fields removed) |

Date keys contain `-`, so field paths quote them with backticks
(REST `updateMask`), or use `FieldPath.of("done_dates", "2026-09-18")` on Android.

## 5. PC sync engine

The Android SDK does all of this by itself. The PC does it by hand.

### Outbox

*Implemented: `syncdoc.py` (cloud form, diff) and the outbox functions in `store.py`.*

After sign-in, every `store.transaction()` compares the data before and after and
appends what changed to `sync-outbox.json` (same fsync-and-replace writing as
`data.json`). Before sign-in nothing is recorded: the first sign-in joins
everything by `id` anyway (see below).

```json
{"version": 1, "next_seq": 4, "ops": [
  {"seq": 1, "doc": "tasks/3f2a…", "kind": "put", "data": {"title": "매일 점검", "done_dates": {}, "schema": 2, "…": "…"}, "at": "…"},
  {"seq": 2, "doc": "tasks/3f2a…", "kind": "patch", "set": {"done_dates.`2026-09-18`": true}, "delete": [], "at": "…"},
  {"seq": 3, "doc": "meta/settings", "kind": "patch", "set": {"notify_min": 15}, "delete": [], "at": "…"}
]}
```

- `put` replaces the whole document: a new item, or a deleted item's tombstone.
- `patch` changes only the listed field paths.
- The outbox is written **before** `data.json`. If writing `data.json` then fails,
  the outbox is put back, so the outbox never lists a change that was not saved.
- Operations leave only when Firestore confirms them (`outbox_confirm(seq)`), so a
  crash or a lost connection never loses a change. `seq` never repeats.
- Changes pulled from the server are applied with `transaction(record=False)` so
  they are not sent back.
- Cost measured on a heavy dataset (90 items): a save takes ~21 ms instead of ~10 ms
  while signed in (the second fsync).

### One sync round

*Implemented: `cloudsync.py`, `store.apply_remote`. Checked live against Firestore.*

1. **Pull first:** query `users/{uid}/tasks` and `users/{uid}/meta`, ordered by
   `(updated, __name__)`, starting **after** the saved cursor `(updated, name)`,
   300 per page. Ordering by name as well matters: every document in one commit
   gets the same server time, so a cursor on time alone would repeat a full page forever.
2. **Apply** with `store.apply_remote`: a field with a pending outbox operation keeps
   the local value; a tombstone always wins and removes pending patches for that item;
   documents with a higher `schema` are left alone; nothing is written when nothing changed.
3. **Push:** send the outbox as Firestore `commit`s (≤ 450 writes each), each write with
   its `updateMask` and `updated` set to the server time. A commit is all-or-nothing, so
   if one is refused the operations are retried one by one, and any that the server
   still refuses move to `rejected` (with the reason) instead of blocking the rest.
4. Save the new cursors in `sync-state.json`.

Pull comes before push so that an item deleted on the other device is known before
this device sends an edit for it. A deletion that lands between the two is caught by
the `keepsTombstone` security rule.

### When it runs

- 2 s after any local change (changes in a burst are sent together)
- every 2 minutes otherwise; "지금 동기화" in Settings asks for a round right away
- after a network error: 15 s, 30 s, 1 min … up to 10 min between tries

Cost: every round is 2 queries (tasks, meta), and a query that finds nothing still
counts as 1 read: about 1,440 reads a day, well below the free 50,000.

### First sign-in on a device

- Cloud empty, device has items → upload every item.
- Cloud has items, device empty → download everything.
- Both have items → join by `id`; for the same `id` the newer `updated` wins.
  Nothing is deleted without a tombstone.

## 6. Sign-in

**Android:** Firebase Auth with Google (Credential Manager).

**PC** (a desktop app cannot use the Android SDK):

1. Open the system browser for Google sign-in: OAuth 2.0 "Desktop app" client,
   loopback redirect `http://127.0.0.1:<random port>`, PKCE.
2. Exchange the Google ID token for a Firebase session:
   `POST identitytoolkit.googleapis.com/v1/accounts:signInWithIdp`.
3. Keep the Firebase **refresh token** encrypted with Windows DPAPI in
   `%APPDATA%\LazyScheduler\auth.json`. Get a fresh 1-hour ID token with
   `POST securetoken.googleapis.com/v1/token` when needed.
4. Sign-out deletes `auth.json`, `sync-outbox.json` and `sync-state.json`, and keeps `data.json`.

*Implemented: `cloudauth.py`, `win32.protect/unprotect`, `/api/sync` endpoints, and the
"동기화" section in Settings.*

The Firebase web API key and the OAuth desktop client ID/secret are placed in the app
(`firebase/config.local.json`, not in git; `firebase/config.example.json` shows the shape;
the build bundles it). They are not secrets: access is decided by the security rules and
the signed-in user. The build now keeps `ssl` (about 6 MB) because sync uses HTTPS.

## 7. Security rules

In `firebase/firestore.rules`:

- `users/{uid}/**`: read and write only when signed in as that `uid`.
- `config/**`: signed-in users may read; nobody may write from an app.
- Task writes must keep `id` equal to the document ID and stay under size limits
  (title ≤ 200, note ≤ 2000 characters), matching `store.clean_task`.
- A tombstone stays a bare tombstone (`keepsTombstone`): a late edit cannot put
  content back onto a deleted item.

## 8. Reminders on two devices

Each device decides and shows its own reminders from its own copy, like the PC
does today. Completing an item on one device syncs and stops the reminder on the
other, if the other has synced by then.

Both devices can alert for the same item. A switch "알림을 이 기기에서 받기",
stored on each device only, lets you pick. A shared "already alerted"
record is left out on purpose: it would cost a write per reminder and a delay.

## 9. Shared rules between Python and Kotlin

The recurrence rules are implemented twice. They must give the same dates.
`tests/vectors/recurrence.json` is the contract: the Python tests already run it,
and the Kotlin unit tests will run the same file. A rule change is not done until
both pass.

## 10. Versions

- Firestore task documents carry `schema`. An app that reads a higher `schema`
  shows the item but does not write to it, and asks for an update.
- The PC HTTP API keeps its own version (`/api/ping`), separate from `schema`.

## 11. Build order

1. Firebase project (by the owner), rules deployed.
2. PC: outbox + field-level change records in `store.py` (testable without Firebase). **Done.**
3. PC: sign-in, then push/pull against Firestore. **Done** (live-checked).
4. Android: list, add, complete, recurrence (vectors pass).
5. Android: sign-in + Firestore.
6. Android: reminders.
7. Use it daily; then Play Store (closed test, listing, privacy policy, account deletion).

## 12. Before a public release

- Account deletion in the app and on a web page (Play requirement when accounts exist).
- Privacy policy and the Data safety form.
- Budget alerts on the Firebase project; stay on the free plan until needed.
- Firestore TTL policy (or a cleanup job) for tombstones older than 180 days.
- App Check to make abuse of the API key harder.
