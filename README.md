# LazyScheduler

A small Windows desktop app for people whose work is mostly recurring: it keeps
track of routine tasks that land on business days rather than plain calendar
dates — the second business day of the month, the last Thursday, three business
days before month end — and quietly shifts anything that falls on a weekend or a
Korean public holiday. Alongside those you can drop in one-off deadlines and
loose notes with no date at all. Close the window and it keeps running in the
background, sliding a soft notification card into the corner of the screen a
little before something is due, so the whole thing stays out of your way until
it actually has something to say.

![Overview](docs/home.png)

Adding a routine — pick how often, pick the rule, and it shows you the next five
dates before you commit.

## Layout

```
main.py          entry point (--ui opens the window, --selftest checks a build)

  core — no Windows here; a phone app reuses these rules and this data format
store.py         reading/writing data.json, backups, revision, the client payloads
recur.py         recurrence rules, business days, Korean holidays
tokens.py        colours, weights, metrics — the one place they are defined

  desktop — Windows only
app.py           HTTP API (see "API contract"), scheduler, notification decisions
ui.py            the native WebView2 window process
toast.py         the notification cards (drawn with Pillow)
tray.py          tray icon, badge, menu
autostart.py     "run at login" and the desktop shortcut
win32.py         shared Win32 structures (monitors)
ipc.py           how the service and the window process reach each other
paths.py         where every file lives (resources vs. user data)

assets/          things the app ships with: app.ico, fonts/Paperlogy-*.ttf
web/             the window itself: index.html, app.js, style.css, fonts/*.woff2
tools/           things you run while developing (see below)
tests/           pytest; tests/vectors holds the recurrence cases
docs/            screenshots for this file
```

Your own schedule never lives here — it is in `%APPDATA%\LazyScheduler\`.

## API contract

The window talks to the service only through the HTTP API, and any other client
(a phone app) should do the same.

- `GET /api/ping` → `{api, schema}`. `api` goes up only on a breaking change
  (a field removed or its meaning changed); adding fields is not breaking.
- `GET /api/overview` → today's view. Items in `tasks` carry only
  `store.PUBLIC_TASK_FIELDS`; storage-only fields such as `done_dates` stay on disk.
- `GET /api/occurrences?from=YYYY-MM-DD&to=YYYY-MM-DD[&kind=routine,...]` →
  `{rev, items: [{id, date, time, done}]}`. Join with overview items by `id`.
- `rev` is a fingerprint of `data.json`. It changes whenever the data changes and
  only then, so a client can keep what it fetched until `rev` moves.

## Development

```
python -m pytest                  run the tests
python tools/build.py             build release/LazyScheduler(.zip)
python tools/gen_tokens.py        rewrite the :root block in web/style.css
python tools/build_fonts.py       assets/fonts/*.ttf  ->  web/fonts/*.woff2
python tools/gen_icon.py          redraw assets/app.ico and web/icon*.png
```

`gen_tokens.py` and `build_fonts.py` both take `--check`, which exits non-zero
when the generated files are out of date; the test suite runs them that way.
