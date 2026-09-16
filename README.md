# lazy scheduler

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
app.py           HTTP service, scheduler, notification decisions
ui.py            the native WebView2 window process
store.py         reading/writing data.json, backups, the overview payload
recur.py         recurrence rules, business days, Korean holidays
toast.py         the notification cards (drawn with Pillow)
tray.py          tray icon, badge, menu
paths.py         where every file lives (resources vs. user data)
autostart.py     "run at login" and the desktop shortcut
tokens.py        colours, weights, metrics — the one place they are defined

assets/          things the app ships with: app.ico, fonts/Paperlogy-*.ttf
web/             the window itself: index.html, app.js, style.css, fonts/*.woff2
tools/           things you run while developing (see below)
tests/           pytest; tests/vectors holds the recurrence cases
docs/            screenshots for this file
```

Your own schedule never lives here — it is in `%APPDATA%\lazy scheduler\`.

## Development

```
python -m pytest                  run the tests
python tools/build.py             build release/lazy scheduler(.zip)
python tools/gen_tokens.py        rewrite the :root block in web/style.css
python tools/build_fonts.py       assets/fonts/*.ttf  ->  web/fonts/*.woff2
python tools/gen_icon.py          redraw assets/app.ico and web/icon*.png
```

`gen_tokens.py` and `build_fonts.py` both take `--check`, which exits non-zero
when the generated files are out of date; the test suite runs them that way.
