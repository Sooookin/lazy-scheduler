# Sync design: PC ↔ phone through Firebase

Status: design, not implemented yet. Written so a Play Store release can use the
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

`id` is the document ID (a uuid made on the device, so creating works offline).
A deleted item keeps only `id`, `deleted: true`, `updated`, `schema`
(the tombstone `store.remove` already writes, plus `schema`).

### Settings

| Shared (`meta/settings`) | Stays on each device |
|---|---|
| `notify_min`, `brief_time`, `business_only`, `holidays` (extra dates) | `hold_when_busy`, autostart, `show_weekend`, `show_routines`, fired-alert records (`state.json`) |

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

Every change in `store.py` also appends an operation to `sync-outbox.json`
(same fsync-and-replace writing as `data.json`):

```json
{"op": "patch", "task": "3f2a…", "set": {"title": "보고서"}, "delete": [], "at": "2026-09-18T01:02:03Z"}
{"op": "patch", "task": "3f2a…", "set": {"done_dates.`2026-09-18`": true}, "delete": [], "at": "…"}
```

Operations stay in the outbox until Firestore confirms them, so a crash or a
lost connection never loses a change.

### One sync round

1. **Push:** send the outbox as one Firestore `commit` (at most 500 writes per commit),
   each write with its `updateMask` and `updated` set to the server time.
   Remove the operations the server confirmed.
2. **Pull:** query `users/{uid}/tasks` where `updated >= cursor`, ordered by `updated`.
   `>=` rather than `>` so a document sharing the cursor's exact timestamp is not
   skipped; documents already applied at that timestamp are recognised by
   `(id, updated)` and ignored.
3. **Apply** each pulled document to `data.json` inside one `store.transaction()`.
   A field that still has a pending outbox operation keeps the local value; it will
   be pushed on the next round.
4. Save the new cursor (the largest `updated` seen) in `sync-state.json`.

### When it runs

- right after any local change (push, then pull)
- every 60 s while the window is visible, every 5 min in the background
- right away when the network comes back or the PC wakes from sleep

Cost: a query that finds nothing still counts as 1 read. 5-min rounds in the
background and 60-s rounds while the window is open stay far below the free
50,000 reads per day.

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
   `%APPDATA%\LazyScheduler\auth.bin`. Get a fresh 1-hour ID token with
   `POST securetoken.googleapis.com/v1/token` when needed.
4. Sign-out deletes `auth.bin`, `sync-outbox.json` and `sync-state.json`, and keeps `data.json`.

The Firebase web API key and the OAuth desktop client ID are placed in the app.
They are not secrets: access is decided by the security rules and the signed-in user.

## 7. Security rules

In `firebase/firestore.rules`:

- `users/{uid}/**`: read and write only when signed in as that `uid`.
- `config/**`: signed-in users may read; nobody may write from an app.
- Task writes must keep `id` equal to the document ID and stay under size limits
  (title ≤ 200, note ≤ 2000 characters), matching `store.clean_task`.

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
2. PC: outbox + field-level change records in `store.py` (testable without Firebase).
3. PC: sign-in, then push/pull against Firestore.
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
