# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

LazyScheduler: a Korean business-day-aware to-do/routine app. Two clients share one data model:
a **desktop app** for Windows and macOS (Python, pywebview window + HTTP service, repo root) and an **Android app**
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
python tools/smoke.py [--exe <built exe>]  launch the app for real (temp data, ports 18777/18779) and screenshot window + card
python tools/site_demo.py                  rebuild docs/demo (homepage view-only preview: web/ copy + fake read API) and docs/card.png; rerun after UI changes before a release
.venv-build/Scripts/python.exe tools/build.py   release build (PyInstaller lives only in .venv-build)
git tag -a vX.Y.Z -m "..." && git push origin main vX.Y.Z   publish: GitHub Actions tests, builds, releases

cd android && ./gradlew test               Kotlin unit tests (incl. the shared recurrence vectors)
cd android && ./gradlew installPerf        release-equivalent build on the phone (debug builds are laggy; judge speed on perf)
cd android && ./gradlew testDebugUnitTest --tests '*ScreenShots'   phone screens rendered on the JVM (Robolectric) -> android/app/build/shots/
```

- `tools/dev.py` only hot-reloads `web/`; after changing any `.py` file, rerun it.
- Releases come only from `.github/workflows/release.yml` (tag `v*`): bump `version.py` first
  (`tools/check_version.py` fails the run otherwise). The annotated tag message becomes the release notes
  and the in-app "새 버전으로 바꿨습니다" popup. Never upload a release by hand: installed apps
  (`desktop/updater.py`) only take releases that carry both the zip (`platforms/<os>/system.ASSET`:
  `LazyScheduler-win.zip`, `LazyScheduler-mac.zip`) and its `.sha256`. Windows installs up to 2.5.0
  look for `LazyScheduler.zip`, so the release also carries the Windows zip under that name.
  The workflow needs the repo secret `FIREBASE_CONFIG` (contents of `firebase/config.local.json`).
- Before `tools/build.py`, the running exe must be stopped via the API (`tools/dev.py --stop`, or
  `POST /api/quit` with the `X-TM-Token` header from `%APPDATA%\LazyScheduler\ipc.key`), not by killing the process.
- `tests/conftest.py` redirects `%APPDATA%` to a temp sandbox before any import, because modules resolve
  data paths at import time (`desktop/paths.py` honours `APPDATA` on macOS too). Any new test entry point or
  script that imports app modules must do the same; the user's real schedule is in `%APPDATA%\LazyScheduler\`
  and must never be touched. `LS_PORT_BASE` moves the service/window ports so a second copy can run beside
  the installed app (`tools/smoke.py` uses both).
- macOS builds only happen on a Mac: `.github/workflows/mac.yml` (branch `mac` or manual run) tests, builds
  `LazyScheduler.app` and smoke-tests it; results are annotations + artifacts. There is no Mac here.

## Architecture

### Processes (desktop)
`main.py` is the single entry point for every role, which matters because the release is one exe:
- no args → background **service** (`desktop/app.py`): HTTP API + static `web/` on `127.0.0.1:8777`, the reminder
  scheduler, the toast-card loop (`desktop/toast.py` on the main thread: Win32 message loop / AppKit run loop),
  tray, the sync thread (`cloudsync.py`), and the auto-updater (`updater.py`: checks GitHub Releases, stages +
  `--probe`s the new build, swaps it in only when no window use / reminder / card is near).
- `--probe`, `--apply-update` → the updater's roles, run from the *new* staged build (it replaces the app folder —
  the `.app` on macOS — keeps `<folder>.old`, rolls back if the new service doesn't open its port).
  `updater.PROBE_MODULES` + `system.PROBE_MODULES` must name real modules or every install refuses the update.
- `--ui` → the **window** process (`desktop/ui.py`, pywebview) on port 8779, which only renders the web UI.
- `--selftest` → writes a diagnostics file for broken builds.

The two processes talk only through `desktop/ipc.py` (ports, token header). The web UI talks to the service only
through the HTTP API (contract in README "API contract"; bump `app.API_VERSION` only on breaking changes).
The service injects a per-install token (and `data-os`, for macOS button order/wording) into `index.html`;
mutating requests must carry the token.

The web UI is three plain scripts sharing globals, loaded in order: `app.js` (lists · calendar · forms · API),
`sky.js` (sun, light mixing, orbit, night transition), `pebble.js` (the sky character's behaviour; rulebook in
`design/references/LS 돌멩이 행동.dc.html`). The first `load()` waits for `DOMContentLoaded` so a fast API reply
can't render before `sky.js` exists. Nothing may run a CSS animation forever (it keeps the whole window
compositing at 60fps); slow ambient motion is stepped from JS timers that stop while the window is hidden.

### Layers
- **`core/`, platform-free** (`store`, `recur`, `syncdoc`, `tokens`): no OS imports here.
  The Android app re-implements these rules and data format in `android/.../core/`.
- **`desktop/`**: the PC app shared by Windows and macOS (`app`, `ui`, `toast`, `updater`, `cloudauth`,
  `cloudsync`, `ipc`, `paths`). No `ctypes`/AppKit here — ask `platforms`.
- **`platforms/win/`, `platforms/mac/`**: the same five modules each — `system` (processes, single instance,
  secrets, release zip layout), `cards` (transparent card windows + event loop + screen info; the drawing stays
  in `desktop/toast.py`), `tray`, `window` (move/max/hide/zoom of the pywebview window), `autostart`.
  `from platforms import cards` lazily loads the current OS's module; `tools/build.py` bundles the package whole.
  Only macOS can import `platforms.mac` (PyObjC), only Windows `platforms.win.window/cards/autostart`.

### Data and sync invariants (`core/store.py`, `docs/sync.md`)
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
  block is generated (don't hand-edit between the markers), `desktop/toast.py`/trays read it directly, and
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
