# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

LazyScheduler: a Korean business-day-aware to-do/routine app. Two clients share one data model:
a **Windows desktop app** (Python, WebView2 window + HTTP service, repo root) and an **Android app**
(Kotlin/Compose/Firestore, `android/`). They sync through Firebase; the design is in `docs/sync.md`
and is the reference for anything touching sync, data shape, or merging.

Code comments, docstrings, UI strings and commit messages are in Korean. Match that. Commit subjects
are short Korean summaries, often tagged with the platforms touched, e.g. `… (PC · 휴대폰)`.

## Commands

```
python -m pytest                           all Python tests
python -m pytest tests/test_recur.py -k <name>   one test
python tools/dev.py                        restart the app from source with web/ hot reload (LS_DEV=1)
python tools/dev.py --stop                 stop the running service + window cleanly
python tools/gen_tokens.py [--check]       regenerate the :root block in web/style.css from tokens.py
python tools/build_fonts.py [--check]      assets/fonts/*.ttf -> web/fonts/*.woff2
python tools/shots.py [home cal ...]       screenshot screens into design/shots/ using seeded temp data
.venv-build/Scripts/python.exe tools/build.py   release build (PyInstaller lives only in .venv-build)

cd android && ./gradlew test               Kotlin unit tests (incl. the shared recurrence vectors)
cd android && ./gradlew installPerf        release-equivalent build on the phone (debug builds are laggy; judge speed on perf)
```

- `tools/dev.py` only hot-reloads `web/`; after changing any `.py` file, rerun it.
- Before `tools/build.py`, the running exe must be stopped via the API (`tools/dev.py --stop`, or
  `POST /api/quit` with the `X-TM-Token` header from `%APPDATA%\LazyScheduler\ipc.key`), not by killing the process.
- `tests/conftest.py` redirects `%APPDATA%` to a temp sandbox before any import, because modules resolve
  data paths at import time. Any new test entry point or script that imports app modules must do the same;
  the user's real schedule is in `%APPDATA%\LazyScheduler\` and must never be touched.

## Architecture

### Processes (desktop)
`main.py` is the single entry point for every role, which matters because the release is one exe:
- no args → background **service** (`app.py`): HTTP API + static `web/` on `127.0.0.1:8777`, the reminder
  scheduler, the toast-card loop (`toast.py`), tray (`tray.py`), and the sync thread (`cloudsync.py`).
- `--ui` → the **window** process (`ui.py`, pywebview/WebView2) on port 8779, which only renders the web UI.
- `--selftest` → writes a diagnostics file for broken builds.

The two processes talk only through `ipc.py` (ports, token header). The web UI talks to the service only
through the HTTP API (contract in README "API contract"; bump `app.API_VERSION` only on breaking changes).
The service injects a per-install token into `index.html`; mutating requests must carry it.

The web UI is three plain scripts sharing globals, loaded in order: `app.js` (lists · calendar · forms · API),
`sky.js` (sun, light mixing, orbit, night transition), `pebble.js` (the sky character's behaviour; rulebook in
`design/references/LS 돌멩이 행동.dc.html`). The first `load()` waits for `DOMContentLoaded` so a fast API reply
can't render before `sky.js` exists. Nothing may run a CSS animation forever (it keeps the whole window
compositing at 60fps); slow ambient motion is stepped from JS timers that stop while the window is hidden.

### Layers
- **Core, platform-free** (`store.py`, `recur.py`, `syncdoc.py`, `tokens.py`): no Windows imports here.
  The Android app re-implements these rules and data format in `android/.../core/`.
- **Desktop-only**: everything else at the root (`app.py`, `ui.py`, `toast.py`, `tray.py`, `win32.py`,
  `cloudauth.py`, `cloudsync.py`, `autostart.py`, `paths.py`).

### Data and sync invariants (`store.py`, `docs/sync.md`)
- `data.json` is the PC's source of truth; `state.json` is device-local (fired alerts) and never synced.
  Some settings are shared (`syncdoc.SHARED_SETTINGS`), view preferences stay per-device.
- Items have stable uuid `id`, UTC `updated`, and deletes leave tombstones — never hard-delete.
- All read-modify-write goes through `store.transaction()`. When signed in, it diffs before/after and
  appends **field-level** ops to `sync-outbox.json` (written before `data.json`, rolled back if the save fails).
  Remote changes are applied with `transaction(record=False)` / `store.apply_remote` so they aren't echoed back.
- Never overwrite whole cloud documents; send only changed field paths. `done_dates`/`skip_dates` are lists
  on disk but `{date: true}` maps in Firestore.
- `store.SCHEMA_VERSION` must equal `syncdoc.SCHEMA`; a higher remote `schema` is shown but not written.
- Firestore rules (`firebase/firestore.rules`) mirror `store.clean_task` limits; change both together.

### Cross-platform contracts enforced by tests
- **Recurrence**: `tests/vectors/recurrence.json` and `suggest.json` are the spec for `recur.py` *and*
  `android/.../core/Recur.kt` / suggestions. A rule change isn't done until both `pytest` and `./gradlew test` pass.
- **Design tokens**: `tokens.py` is the only source of colours/weights/metrics. `web/style.css`'s `:root`
  block is generated (don't hand-edit between the markers), `toast.py`/`tray.py` read it directly, and
  `android/.../ui/Theme.kt` is hand-copied but checked by `tests/test_theme_kt.py`.
  `tests/test_design.py` also rejects off-scale font sizes/spacing in `style.css`.
- Screen colours are mixed at runtime from `tokens.LIGHT` by time of day (`applyLight` in `web/sky.js`);
  names must match 1:1 between `tokens.py` and the `LIT` list in `sky.js`.
- `tools/shots.py` screen names must match `shotHook` in `web/app.js`.

### Config and secrets
`firebase/config.local.json` and `android/firebase.local.properties` are gitignored (copy the `.example`
files). The release zip deliberately bundles `config.local.json`: the desktop OAuth client is a public
client (PKCE), and access control is the per-uid Firestore rules. Don't strip it from builds.

`design/` holds throwaway HTML design explorations and screenshots; it is not part of any build.
