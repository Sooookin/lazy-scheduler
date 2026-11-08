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
  `LazyScheduler-win.zip`, `LazyScheduler-mac.zip`) and its `.sha256`. Renaming an asset strands every install that
  looks for the old name, silently (a missing hash reads as "no release"), and installs that stay off for weeks
  miss any one-release overlap: so every release keeps carrying old names (`LazyScheduler.zip` for Windows ≤ 2.5.0).
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

The web UI is plain scripts sharing globals, loaded in order: `when.js` (sentence parser), `app.js` (header sentence
field · today drum · upcoming · calendar · all items · settings · the detailed editor `Form` · API), `sky.js` (day/night
light: `relight`/`themeTo`). The first `load()` waits for `DOMContentLoaded` so a fast API reply can't render before
`sky.js` exists. Nothing may run a CSS animation forever (it keeps the whole window
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
- **Sentence parser**: `tests/vectors/when.json` is the spec for `web/when.js` *and* its line-for-line port
  `android/.../core/When.kt` (JS quirks copied on purpose: UTF-16 offsets, JS `\s`, `new Date` overflow). The editors'
  "이름 = 문장" reading (`readName` in `app.js`, `Draft.readName` in `Editor.kt`) must stay in step.
- **Design tokens**: `tokens.py` is the only source of colours/weights/metrics. `web/style.css`'s `:root`
  block is generated (don't hand-edit between the markers), `desktop/toast.py`/trays read it directly, and
  `android/.../ui/Theme.kt` is hand-copied but checked by `tests/test_theme_kt.py`.
  `tests/test_design.py` also rejects off-scale font sizes/spacing in `style.css`.
- PC design grammar (2026-11 "XX", from the Claude Design board `design/handoff` · `LazyScheduler XX.html`): one paper
  colour for every pane; depth only twice — the 4px groove between panes (`--bg`) and the lens under the next task
  (`--lensa`: the one inverted surface - graphite `lens-a` by day with paper text, light paper `lens-a-n` by night with
  ink text; `sky.js` sets `--lensa-text/-text2/-teal/-late` from its brightness); the header floats with one soft shadow. Four type sizes (28 clock in weight 300 · 18 the lens
  task · 13 task names · 11 everything else; 2026-11 polish, one step down from 24 · 20 · 14 · 12, hierarchy by weight
  and tracking rather than size, after the Junghans max bill dial); Korean and digits in Paperlogy (its digits are already equal-width, so time columns line up),
  Latin letters only in Inter (`web/fonts/inter-latin.woff2`, `unicode-range` letters A–Z a–z + Latin-1, `size-adjust` to
  Paperlogy's cap height; built by `tools/build_fonts.py` from `assets/fonts/Inter[opsz,wght].ttf`). English pane heads
  and dates stay ("TODAY", "FRI 6 NOV", "TUE 3"), uppercase, weight 400, .1em tracking (date labels .06em). Corners are 0 everywhere; the only round thing is the task dot (empty ring = open, red ring = late,
  filled = done, dashed = being typed). One red (late = holiday = danger), one teal in two roles: `--accent`
  (surfaces and lines - now line, the + square, underlines, picked-row edge, focus; 3:1 is enough, so it is light and soft)
  and `--teal` (teal text and white-on-teal fills: parsed words, links, the primary button, today's date square; kept at
  4.5:1 with low saturation). 2026-11 palette: warm paper #fbfaf7, charcoal ink #3b3e43, slate night #353840 - softer than
  the old #fdfdfc / #303236 / #2a2c30; important = a yellow highlighter under the name (also the Form's 중요 value: the word 보통 / 중요,
  no switch). No shadows on controls: a picked segment is a 1px `--text2` ring, buttons a flat 1px hairline.
  Lines: 1px `--text2` under pane/group heads, 1px `--hair` between rows, running edge to edge of the pane (rows,
  settings, details). Hover has one grammar: a 1px line drawn once from the left (`--t-move`) - under a row its
  hairline darkens to `--text2`, under a tab from the centre, under the lens words in teal; calendar cells get a ring.
- PC layout (XX): header 56, weight at the centre and light things at the ends: + (teal square) on the left text
  column | date · clock (28, weight 300) right-aligned on the left pane's text-column end, facing | 오늘 · 달력 · 전체 on
  the right text column | settings as a sliders glyph in a 46 slot joined to the window buttons 46×56 (views are words,
  settings is window chrome). Two panes split at 50% with a 4px groove; text columns sit `--doc` (24) from the outer
  edge and `--doc` + 4 from the groove. In the capture window the sentence field spans the header instead. Rows are 40 = time column `--tmw` 52 (measured: "MON 30" at 11px) | 12 | dot `--dotw` 10 | 12 |
  name, so names stand at `--namex` from the text column (the read-out strip, Details and the Form's values use it too).
  Date labels: weekday in a fixed slot, day number right-aligned in 16 so the units line up. Anytime / Notes rows
  have no time column (the dot stands on the text column). Pane, shelf, group heads and the read-out strip are all
  `--ph` 40 (JS `PH`).
  Every row in both upper panes sits on one 40 grid (ruled like a notebook across the groove): the lens is 80 (two rows),
  Upcoming's empty days are 40, Upcoming scrolls with `scroll-snap` per row, and the drum moves one row (40) per wheel
  step on a flat track (`proj` is linear since 2026-11; the old 320px cylinder bent rows off the right pane's lines).
  Today = the drum: the next task sits on the lens (its top edge is the 2px "now" line; its name wraps to two lines
  rather than being cut - `w2`, time · dot then stand on the first line), past tasks above, remaining ones below.
  Anytime / Notes are shelves whose height the horizontal groove drags in 40 steps (per device, localStorage). Hovering a
  row drops the 40-high read-out strip over the pane heads with every value of that task as label · value pairs (the
  same words as 전체's Details); lists show names only. Spans: in Upcoming a vertical line per span in the left margin
  (overlaps step 6 left, ends turn toward the row); in the calendar one labelled strand per week under the date row
  (name ─── end tick), at most two, the rest listed by name on their start day; a strand starting in the narrow Sunday
  column writes its name from Monday, a one-day continuation has no name.
  Conveniences add nothing to the resting screen (2026-11: an attempt to put them on screen - day ruler, pebble, week
  strip, row-end values, hover buttons - was rolled back as clutter), and nothing explains itself in words: no how-to
  hints, no key names on screen (keys only in the ? sheet), no question heads ("언제까지?"), settings rows are a bare name
  (a second line only for a problem/status). They live in places that already exist:
  the lens has no word handles at rest: its time is set like the name (18, weight 300) and is the 미루기 control (click,
  hover draws a teal underline), its dot (14) is 끝냄 (every dot shows a thin check on hover). The lens's light: its time and the time left at its right
  end ("4시간 뒤", `leftWord`) are in lume teal (`--lensa-teal`: `teal-lit` on graphite, `teal-deep` on the night paper).
  Door and lens keys only act on the 오늘 view. Settings closes back to the view it was opened from (`PREV_V`): 닫기 at the
  bottom right, the settings glyph again, or Esc; 앱 종료 is a quiet text link beside the version (it still confirms). 미루기 opens destinations
  at the lens's right end (`lensActs`): the next free slot
  today (`gapAfter`: each timed item holds its learned length, else 30 min; first gap that fits the moved item, ≥ 30 min
  after max(now, its time), none past `day_end`), 내일 only when it differs from the next business day, and the next business day (`laterDate`).
  Morning door: the first open of the day (localStorage `ls.morn`) or a click on "늦음 n" turns the lens into a one-by-one
  queue of past-day items (`TRI`, head shows "1 / 4"; 오늘 · next business day · 끝냄, keys T → Space Esc).
  Evening door: after `day_end` (setting, default 18:00) with no timed item left, the lens offers "남은 n" → next business
  day for all (`moveAll`, one undo) · 하나씩 (the same queue) · ×; once a day (`ls.eve`). Moving shows no red next day.
  The hover read-out strip edits in place: a deadline's date label and time are buttons (`.ro .e`) opening a one-row
  picker (`#rop`; time ±30/60, wheel ±5; dates 오늘 · 내일 · next business day · +7); the strip waits 180 ms before switching
  rows and 500 ms before hiding so the pointer can reach it. The context menu keeps 오늘로 · 다음 영업일로 · 내일로, keys on a
  focused row ↑↓ Space Enter → ⇧→ T S ! Del (`rowKey`); for a routine its moves sit under one grey "이번 회차" head row.
  Learned lengths (`store.learn_done` on every `set_done`, device-local `state.json` `dur`/`last`, never synced): a timed
  item done today took from max(its time, the previous done today) to now; 3–180 min kept, the median of the last 5 per
  `dur_key(name)` once there are 3 (`store.durations`, 5-min steps, cap 120), sent as overview `durations`. Used by
  `gapAfter` / `app.next_gap`, the read-out strip ("걸림 · 약 25분") and the evening lens ("약 2시간 40분", only if
  something was learned). In the capture window's sentence field a one-row panel
  (`paintPop`) shows an item with that name (Tab opens it) or the last time used for it (Tab appends), ↑↓ nudge.
  New items and edits open the `Form` sheet (2026-11: sentence-only entry misread dates too often). `+`, Ctrl N, typing
  anywhere (the key lands in the name), an empty calendar day and clicking a name all open it. Its layout is the 2.7 form
  in XX grammar (opened with the date of the place the pointer was resting on - an Upcoming day, a calendar cell, Notes =
  memo: `addHere`; a time used before for the same name is pre-filled in teal: `guessTime`; the 반복 row offers "매주 X" when
  the same name was added on that weekday twice in five weeks: `sugWeek`): left column = name (18) + the value list (rows 40: label 11 in the `--namex` column = home's time column · 12 · dot
  · 12, so values stand on the list's name line, value 13, relative day / × at the end; the picked row is shaded with a 2px teal left edge), right column = the
  tool for the picked row under a 40 head with a 1px `--text2` line (calendar "2026년 11월" · 일 월 … · days 14, quick
  days as one line of text buttons; the 2.7 clock dial + six frequent times; frequency; alerts) and one "그날 n건 · …" line.
  The two columns sit on the home panes' text columns (gap 2 × 38). A sentence typed in the name still fills date / time
  / rule visibly in the rows (one text button "이름에 두기" undoes it). The header sentence field (`readSentence`, kind by
  shape: no date = memo, time only = today, date = deadline, range = span, rule = routine, `!` = important) now lives
  only in the global-hotkey capture window; in the main window the header shows just the + square. Spacing still comes only from
  `tokens.SPACE`; optical exceptions are `calc()` with the reason.
- The phone has not moved to XX yet: `Theme.kt` copies `tokens.LIGHT_PHONE` / `TYPE_PHONE` / `COLOR` (the 2026-10
  "덜어냄" grammar: five sizes 44 · 20 · 15 · 13 · 11, 6.dp corners, 48dp rows). When the phone follows, fold those
  into `LIGHT` / `TYPE` and delete the `_PHONE` copies. `tokens.SPAN` (phone range bands) never uses a red hue.
- Screen colours come from `tokens.LIGHT` mixed between day and night by `applyLight(dk)` in `web/sky.js`
  (auto = Windows app mode, or fixed 낮 / 밤); names must match 1:1 between `tokens.py` and the `LIT` list in `sky.js`.
- `tools/shots.py` screen names must match `shotHook` in `web/app.js`.
- Holidays: `core/recur.py`'s table is hand-written and ends 2027. `.github/workflows/holidays.yml` (weekly; repo secret
  `HOLIDAY_API_KEY` = data.go.kr 특일 정보 key) runs `tools/fetch_holidays.py` and commits `docs/holidays.json` + `.sha256`
  only when they change. The service (`desktop/holidays.py`, every 20 h) downloads them from raw.githubusercontent.com,
  checks the hash and shape (`parse`), sets names (`recur.set_holiday_names`) and adds new dates to `data.json`
  `holidays` (so they sync to the phone), taking back only dates it added itself (device-local cache `holidays.json`).
  Settings shows "공휴일 YYYY년까지 · 받은 날" under 영업일 기준.
- Outside the window: reminder cards (`desktop/toast.py`) use the same grammar - corners 0, a 2px top line (teal / red
  late), 24-hour times, buttons 끝냄 · the next free slot today ("16:30", `app.next_gap` = the window's `gapAfter`; 10분 뒤
  when there is none) · 다음 영업일 (`app._later`; 열기 only when a card can't move). The tray icon
  carries the late count (red square) and the lens sentence as its tooltip (`app.glance`); the window's taskbar button
  gets the same count (`window.set_overlay`, ITaskbarList3; Dock badge on macOS). The global hotkey (setting `hotkey`,
  default ctrl+alt+space, per device) is registered on the card message loop (`cards.set_hotkey`, WM_HOTKEY); pressing it
  asks the window process for a small always-on-top `#capture` window (`ui.open_capture`, body.capture shows only the
  field + panel); Enter adds and hides it, returning focus. macOS has no global hotkey yet (`hotkey_state().unsupported`).

### Config and secrets
`firebase/config.local.json` and `android/firebase.local.properties` are gitignored (copy the `.example`
files). The release zip deliberately bundles `config.local.json`: the desktop OAuth client is a public
client (PKCE), and access control is the per-uid Firestore rules. Don't strip it from builds.

`design/` holds throwaway HTML design explorations and screenshots; it is not part of any build.
