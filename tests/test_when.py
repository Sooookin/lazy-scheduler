# -*- coding: utf-8 -*-
"""web/when.js (글에서 날짜 · 시각 알아듣기) 를 tests/vectors/when.json 으로 검사한다.

자바스크립트를 돌릴 것이 브라우저뿐이라, 헤드리스 크롬(없으면 엣지)에 when.js 와 문장들을 실은
쪽을 열고 --dump-dom 으로 결과를 받아 온다. 브라우저가 없는 곳에서는 건너뛴다."""
import io
import json
import os
import re
import subprocess
import tempfile

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
BROWSERS = (r"C:\Program Files\Google\Chrome\Application\chrome.exe",
            r"C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe")


def run_cases(vec):
    exe = next((p for p in BROWSERS if os.path.exists(p)), None)
    if not exe:
        pytest.skip("브라우저가 없다")
    js = io.open(os.path.join(ROOT, "web", "when.js"), encoding="utf-8").read()
    page = """<!doctype html><meta charset="utf-8"><pre id="out"></pre><script>%s</script><script>
const V = %s;
const isBiz = k => { const w = new Date(k + 'T12:00').getDay(); return w > 0 && w < 6; };
const out = V.cases.map(([t]) => { try { return whenParse(t, {today: V.today, isBiz}); } catch(e) { return {error: String(e)}; } });
const rules = (V.rules || []).map(([t]) => { try { return whenRule(t); } catch(e) { return {error: String(e)}; } });
document.getElementById('out').textContent = JSON.stringify({out, rules});
</script>""" % (js, json.dumps(vec, ensure_ascii=False))
    d = tempfile.mkdtemp(prefix="ls-when-")
    f = os.path.join(d, "when.html")
    io.open(f, "w", encoding="utf-8").write(page)
    r = subprocess.run([exe, "--headless=new", "--disable-gpu", "--no-first-run", "--user-data-dir=" + os.path.join(d, "p"),
                        "--dump-dom", "file:///" + f.replace("\\", "/")], capture_output=True, timeout=60)
    m = re.search(r'<pre id="out">(.*?)</pre>', r.stdout.decode("utf-8", "replace"), re.S)
    assert m, "브라우저가 결과를 내지 않았다"
    import html
    return json.loads(html.unescape(m.group(1)))


def check(pairs, got):
    bad = []
    for (text, want), g in zip(pairs, got):
        if want is None:
            if g is not None:
                bad.append((text, "아무것도 아니어야 한다", g))
            continue
        if g is None or "error" in (g or {}):
            bad.append((text, want, g))
            continue
        diff = {k: (v, g.get(k)) for k, v in want.items() if g.get(k) != v}
        if diff:
            bad.append((text, diff))
    assert not bad, "%d / %d 틀림:\n" % (len(bad), len(pairs)) + "\n".join(map(repr, bad))


@pytest.fixture(scope="module")
def ran():
    vec = json.load(io.open(os.path.join(ROOT, "tests", "vectors", "when.json"), encoding="utf-8"))
    return vec, run_cases(vec)


def test_every_sentence_is_read_as_written_down(ran):
    vec, got = ran
    check(vec["cases"], got["out"])


def test_every_repeat_phrase_becomes_the_stored_rule(ran):
    """반복 말(매달 넷째 목 · 격주 화 …)은 저장 형식 그대로의 규칙이 된다 - 새 항목 창의 날짜 줄이 쓴다"""
    vec, got = ran
    check(vec["rules"], got["rules"])
