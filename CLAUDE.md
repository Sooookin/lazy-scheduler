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
- PC design grammar (2026-11 "XX", from the Claude Design board `design/handoff` · `LazyScheduler XX.html`; 2026-11 readability
  pass = board D "절충" on the canvas "LazyScheduler 가독성"): readability is a contrast hierarchy region > head > row > glyph,
  each carried by a different means. Regions by depth: every pane is a white card (`--surface`, `--card` shadow tinted by
  `--shade`) floating on a sky-mist ground (`--ground` = `--bg-top` → `--bg`, `fixed`, shared by body and header), 8px
  `--gut` around and between them; the shelves are one step bluer (`--shelfbg`). The header has no bar of its own - it sits
  on the clearest part of the ground. The lens under the next task is the one inverted surface (`--lensa`: sky-tinted
  graphite `lens-a` by day with paper text, light sky paper `lens-a-n` by night with ink text; `sky.js` sets
  `--lensa-text/-text2/-teal/-late` from its brightness). Four type sizes (26 clock in weight 300 · 16 the lens
  task · 13 task names and the day in date labels · 11 everything else, the floor for Hangul and the pane heads; 2.9 took
  one step off each - separation comes from the head band, day rules and label columns, not size); Korean and digits in Paperlogy (its digits are already equal-width, so time columns line up),
  Latin letters only in Inter (`web/fonts/inter-latin.woff2`, `unicode-range` letters A–Z a–z + Latin-1, `size-adjust` to
  Paperlogy's cap height; built by `tools/build_fonts.py` from `assets/fonts/Inter[opsz,wght].ttf`). English pane heads
  and dates stay ("TODAY", "FRI 6 NOV", "TUE 3"), uppercase, .1em tracking (date labels .06em); pane and group heads are
  weight 500 in ink with a count of what is left beside them (`.pc`, empty at 0). Corners are 0 everywhere; the only round thing is the task dot (empty ring = open, red ring = late,
  filled = done, dashed = being typed). One red (late = holiday = danger). The signature is the sky
  `teal-lit` #9ccbcd and every other colour comes from its hue (183°): sky itself where it sits on graphite (the lens's
  time / time left / now line), `--accent` #529fa3 for lines and fills
  (underlines, picked-row edge, focus; 3:1), `--teal` #347074 for text and white-on-teal fills (parsed words, links, the
  primary button, today's date square; 4.5:1), and the faint sky of the ground and shelves. Ink #283034 (13:1 on the cards),
  ink2 #5c6569; important = a yellow highlighter under the name (also the Form's 중요 value: the word 보통 / 중요,
  no switch). No shadows on controls: a picked segment is a 1px `--text2` ring, buttons a flat 1px hairline - except the view
  tabs, which are a segmented well on the ground whose picked chip rises as a white card (the depth grammar: card · lens · tab).
  Materials (2026-11 "재료와 대답", canvas boards 질감 넷 · 움직임 여섯): one light from above. Cards are porcelain - a 1px
  top highlight (`--hi`), a faint top-to-bottom face (`--face`) and a two-layer shadow (`--card`); the lens stays matte (one
  surface, one sky line, one shadow - a gloss / digit glow / gauge / glint layer was tried and removed as cheap); the ground
  carries a 3% grain only under `.main` (never under text) and a sundial light behind the header whose x follows the day from
  `brief_time` to `day_end` in 10-min steps, warming for the last hour (`sunTo`, `--sun-x` · `--sun`). Motion answers only
  a person or the clock, ≤ 0.5 s, never looping, off with reduced motion (`calm()`): the clock's changed digits roll up
  (`clockTo`), 끝냄 fills the ring sky with a white check and one ripple (`donef`), the view tabs' 2px ink bar slides to the picked
  word (`.tabline`, hidden on settings), and the first open of the day deals the three cards in 80 ms apart (`.deal`, in `morningDoor`).
  2026-11 "통합 2" (canvas "LazyScheduler 깊이와 움직임", board 통합 2) adds one physics, one curve (`--move`; 0.26 s for what follows
  the hand, 0.48 s for the rest), nothing new on the resting screen: the hand's ruler (`ruleTo`: in #drum / #any-list / #up one `.ruler`
  - accent 8% + a 1px accent line under the hovered row - glides from row to row instead of each row lighting up; hidden on the lens and
  day heads; `patchKids` leaves it in place); lifted and settled cards (`liftTo`, today view only: the hovered card's shadow deepens, the
  others flatten and take a 16% `--bg` veil - shadows and a veil only, text never moves; a mouse-following light, tilt, blur and scale
  were tried and dropped as invisible or shaky); the fuse (`fuseTick`: when the lens task is ≤ 10 min away the now line splits into a
  faint track and a sky line of the minutes left with a 2 × 8 needle at its end, burning from the right; at its time the full line
  breathes for a minute; the breathing is a class `fuseTick` flips every 1.2 s from a timer that skips hidden windows, never a CSS
  loop); head counts roll their changed digits like the clock, down when they shrink (`countTo`); and the TODAY head's bottom edge is a
  2px sky gauge of today's timed items done (`#t-prog`). The drum still rolls back to now 3.2 s after a wheel.
  Use frequency drives the layout (2026-11 UX pass): finishing and scanning are daily, adding and editing are occasional.
  So a click on any home row (today, lens, Anytime, Upcoming, the day sheet) is 끝냄 with the undo line; editing is Enter,
  the context menu's 고치기, or the 고치기 text button at the end of the hover read-out strip. Calendar items and 전체 keep
  click = edit / select (planning views).
  Pane heads (40) are inverted like the lens: a `--lensa` band with `--lensa-text` names, `--lensa-text2` counts and
  `--lensa-late` (graphite + white by day, light paper + ink by night). Their text is never sky - sky stays the lens's own
  light (time, now line), which with its 16 type keeps the lens the signature (faint sky / grey / 12% graphite bands were
  tried and didn't separate heads from the ground). The signature (graphite + sky) marks only what the eye is on: the lens, today's date in
  the calendar and the undo line are small lenses (graphite, sky text); a hovered row and the selected row in 전체 take a
  sky tint (accent 8% / 13%, the selected one with a 2px sky edge); the hover read-out strip has the lens's 2px sky top line.
  In Upcoming (D3, canvas "LazyScheduler 깊이와 움직임") each day is a `section.ud` = a 28-high day head (`.dh`: day 13 ·
  weekday 11, both days of a folded weekend, holiday names) + its rows, which carry no date label. Only days with items
  get a band (ground-mixed frosted glass, lines above and below, a soft shade); empty days and days off are a bare top line, so a band
  reads as "a day with work"; a Monday head's top line is ink 55% (`.wk`), cutting the four weeks into four. Heads are sticky under
  the pane head (`top:0` - Chromium measures sticky from the scroller's padding, which holds the 40 for the pane head) and the
  next day's section pushes them out; heads are faint frosted glass, the pane head is graphite glass (`--lensa` 93% +
  backdrop blur) with the list sliding under it. A head click opens the day sheet; heads are drop targets. Rows still press
  and fold (D6): `:active` sinks a row 1px with an inner shade (release elsewhere = no click = cancelled), and outside the
  drum a finished row folds to height 0 after its ripple (`.fold`), the drum's rows slide to the past instead. Head counts always say what they count, in the "늦음 n" voice:
  TODAY / ANYTIME "남은 n", UPCOMING carries no count at all - a bare "20", "이번 주 n" and a scrolling "3주 뒤 7"
  were all tried and gave the reader nothing to do.
  When today's timed items are done the lens stays on today ("언제든 n 남음" / "오늘 남은 일 없음"); it no longer jumps to
  Upcoming's first item, which skipped tomorrow's daily routines. Instead that item is the lens's echo in Upcoming
  (`.nx`: sky left edge, faint sky tint, "내일" / "n일 뒤" at the row end like the lens's "4시간 뒤").
  A row click is 끝냄 anywhere on the row, so hovering a row (not the lens's time or handles) fills its dot solid sky (`--lensa-teal` on
  the lens; a check inside a 10px dot read as a smudge) - the dot speaks for the whole row. Clicking the
  Today or Upcoming pane head returns that pane to its rest: the drum to the lens (next task), Upcoming to the top ("늦음 n" keeps its door). Ink is a matte grey (#4a5156 8:1, ink2 #6a7277 4.85:1).
  Lines: 1px `--hair` between rows, running edge to edge of the pane (rows,
  settings, details). Hover has one grammar: a 1px line drawn once from the left (`--t-move`) - under a row its
  hairline darkens to `--text2`, under the lens words in teal; calendar cells get a ring.
- PC layout (XX): header 56, weight at the centre and light things at the ends: + as a thin glyph (14 × 1.5,
  ink; hover fills its 28 square with accent 12% and turns it teal) whose left end stands on the left text column, centred at 28 like the
  view words, settings glyph and window buttons - everything else in the header is type and hairline glyphs, so a filled graphite
  square (and then a tab hanging into the Today head) floated alone in the sky; adding is occasional (Ctrl N, typing anywhere) | clock (28, weight 300), 16, date - starting on the left card's name column
  (`--namex`), so the header is set in the same two columns as a row; 2px low (digits sit high in their line box) | 오늘 · 달력 · 전체 as bare words 24 apart from the right text column,
  the picked one ink 500 over a word-wide 2px ink bar (boxes - a well, a white chip - read as a button strip and looked cheap) | settings as a sliders glyph in a 46 slot joined to the window buttons 46×56 (views are words,
  settings is window chrome). Two cards split at 50% with the 8 `--gut` between and around them; text columns sit
  `--doc` (24) inside each card on both sides (so 32 from the window edge and 28 from the centre; the Form's two columns too). In the capture window the sentence field spans the header instead. Rows are 36 (`--rh`, JS `RH`) = time column `--tmw` 56 (measured: Upcoming's "30 MON") | 12 | dot `--dotw` 10 | 12 |
  name, so names stand at `--namex` from the text column (the read-out strip, Details and the Form's values use it too).
  Date labels are one form everywhere (`lblOf` = {day, weekday}): the day first, 14, right-aligned in 16 so the units line up,
  8, then the weekday 11 in `--text2` - numerals that differ in shape from the Hangul names, in a fixed column, are why
  Today's time column reads well. In Upcoming each day's first row carries a `--hair2` line above; a day with items has an
  ink date, an empty day a grey one, a day off a faint one (no shaded band); folded days off repeat the same label.
  Anytime rows have no time column (the dot stands on the text column). Pane, shelf, group heads and the read-out strip are all
  `--ph` 40 (JS `PH`).
  Every row in both upper cards sits on one 36 grid (ruled like a notebook across the gap): the lens is 72 (two rows),
  Upcoming's empty days are 36, Upcoming fills the whole right column, looks `upcoming_days` (28) ahead and scrolls one stop per wheel step
  like the drum (`upStops`: each day section's top and each row standing just under its stuck day head; 480 ms, `upScrollTo`)
  (clicking a date or an empty day opens that day's sheet with its routines - `openDay` - never a new item), and the drum moves one row (36) per wheel
  step on a flat track (`proj` is linear since 2026-11; the old 320px cylinder bent rows off the right pane's lines).
  Today = the drum: the next task sits on the lens (its top edge is the 2px "now" line; its name wraps to two lines
  rather than being cut - `w2`, time · dot then stand on the first line), past tasks above, remaining ones below.
  Anytime is one shelf card under Today holding today's untimed items and the dateless memos (Notes was folded in,
  2026-11); five rows tall by default (less if Today would lose its lens and two rows each side), or what the gap above
  it was dragged to (row steps, per device, localStorage). Scrollbars are one 2px line in an 8px gutter, shown only on the
  hovered pane (`::-webkit-scrollbar`; never `scrollbar-width`, which makes Chromium drop back to the stock bar). Hovering a
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
  hover draws a teal underline), its dot (14) is 끝냄 (every dot fills solid on hover). The lens's light: its time and the time left at its right
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
  anywhere (the key lands in the name), and an empty calendar day open it (a row click is 끝냄). Its layout is the 2.7 form
  in XX grammar (opened with the date of the place the pointer was resting on - an Upcoming day, a calendar cell: `addHere`; a time used before for the same name is pre-filled in teal: `guessTime`; the 반복 row offers "매주 X" when
  the same name was added on that weekday twice in five weeks: `sugWeek`): left column = name (18) + the value list (rows 40: label 11 in the `--namex` column = home's time column · 12 · dot
  · 12, so values stand on the list's name line, value 13, relative day / × at the end; the picked row is shaded with a 2px teal left edge), right column = the
  tool for the picked row under a 40 head with a 1px `--text2` line (calendar "2026년 11월" · 일 월 … · days 14, quick
  days as one line of text buttons; the 2.7 clock dial + six frequent times; frequency; alerts) and one "그날 n건 · …" line.
  The two columns sit on the home panes' text columns (gap 2 × 38). A sentence typed in the name still fills date / time
  / rule visibly in the rows (one text button "이름에 두기" undoes it). The header sentence field (`readSentence`, kind by
  shape: no date = memo, time only = today, date = deadline, range = span, rule = routine, `!` = important) now lives
  only in the global-hotkey capture window; in the main window the header shows just the + glyph. Spacing still comes only from
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
