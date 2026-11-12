const $ = s => document.querySelector(s);
/* 전역 단축키로 뜨는 작은 창 (ui.open_capture) 인지 - 아래 '어디서든 문장 칸' */
const CAPTURE = location.hash === '#capture';
if(CAPTURE) document.documentElement.classList.add('capture');
const $$ = s => [...document.querySelectorAll(s)];
/* 서비스는 비밀값이 없는 요청을 거절한다 (다른 웹 페이지가 일정을 건드리지 못하게).
   값은 서비스가 index.html 을 내줄 때 meta 태그에 심어 준다. */
/* 화면 갈무리(tools/shots.py) 중에만 값이 들어간다. 파일 끝에서 let 으로 선언하면
   tickClock 이 먼저 읽어 TDZ 로 스크립트가 통째로 죽는다 - var 로 맨 위에 둔다. */
var SHOT_MIN = null;
/* 찍는 화면(#shot=…)에서는 아침 · 저녁 문이 저절로 열리지 않는다 (그 문을 찍을 때만 연다) */
var SHOT_NODOOR = /^#shot=/.test(location.hash);

/* ── 움직임 ──
   Windows 의 '애니메이션 효과' 를 끄면 CSS 는 style.css 끝에서 멈추지만, 자바스크립트로
   돌리는 것(Web Animations · 빛의 흐름)은 여기서 묻고 건너뛴다. 갈무리 중에도 멈춘다. */
const RM = matchMedia('(prefers-reduced-motion: reduce)');
const calm = () => RM.matches || SHOT_MIN != null;
/* 한 번 도는 CSS 움직임(cls)을 처음부터 다시 튼다. 끝나면 이름표를 뗀다 - 붙은 채로
   두면 다음에 같은 이름표를 붙여도 움직이지 않는다. */
function replay(el, cls){
  if(!el || calm()) return;
  el.classList.remove(cls);
  void el.offsetWidth;
  el.classList.add(cls);
  if(!el.getAnimations().length){ el.classList.remove(cls); return; }   /* 움직임이 꺼져 있다 */
  const off = e => { if(e.target !== el) return; el.classList.remove(cls); el.removeEventListener('animationend', off); };
  el.addEventListener('animationend', off);
}
const EASE = 'cubic-bezier(.2,.8,.2,1)', EASE_EXIT = 'cubic-bezier(.4,0,1,1)';

const TOKEN = (document.querySelector('meta[name="tm-token"]') || {}).content || '';
/* 실패하면 서버가 보낸 문장으로 reject 한다. 예전에는 500 도 성공처럼 처리해서
   저장이 안 됐는데도 "추가됨" 이 뜨고 입력한 내용이 사라졌다. */
const api = (u, b) => fetch(u, {
    method: b ? 'POST' : 'GET',
    headers: Object.assign({'X-TM-Token': TOKEN}, b ? {'Content-Type': 'application/json'} : {}),
    body: b ? JSON.stringify(b) : undefined,
  })
  .catch(() => {
    setOffline(true);
    throw new Error('프로그램에 연결할 수 없습니다. 잠시 후 다시 시도하세요.');
  })
  .then(r => r.json().catch(() => ({})).then(d => {
    setOffline(false);          /* 답이 왔다는 것만으로 연결은 살아 있다 */
    if(!r.ok) throw new Error(d.error || ('요청을 처리하지 못했습니다 (' + r.status + ')'));
    return d;
  }));
const WD = ['월','화','수','목','금','토','일'];
/* 달력은 일요일이 맨 왼쪽이다 (Date.getDay() 와 같은 차례).
   규칙(rule.weekdays)은 예전대로 월요일이 0 이므로 둘을 섞지 않는다. */
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
  c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const mins = t => +t.slice(0,2)*60 + +t.slice(3);

/* 아이콘은 모두 SVG. 글꼴 기호(✎ ▲ ✓)는 Paperlogy 에 없어 다른 글꼴로 바뀌고, 배율에 따라 흐려진다 */
const ICON = {
  max: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>',
  restore: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1.5" y="3" width="5.5" height="5.5" rx="1"/><path d="M3.5 3v-.5a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H7"/></svg>',
  check: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plusBig: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path pathLength="1" d="M12 5v14"/><path pathLength="1" d="M5 12h14"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};

/* ══════════ 시각 칸 ══════════
   칸을 누르면 시계판이 뜬다. 바깥 고리가 시, 안쪽 고리가 분이라 판을 바꾸지 않고 둘이 한 번에 보인다
   (시험장에서 버튼 격자 · 드럼보다 맞추는 데 걸린 시간과 손놀림이 가장 적었다).
     바깥 고리를 누르면 그 시의 정각, 이어서 안쪽 고리를 누르면 분까지 정하고 닫힌다. 누른 채 돌려도 된다.
     휠은 바깥 고리 위에서 1시간, 안쪽 · 가운데에서 5분 - 오전 · 오후는 넘어가며 저절로 바뀐다.
     오전 · 오후는 판 옆의 단추로도 바꾼다. 비어 있을 때 처음 누른 시는 업무 시간으로 읽는다 (1~7시는 오후).

   판을 열지 않아도 된다: 칸 위에서 휠을 굴리거나 ↑↓ 로 5분씩 (Shift · PageUp/Down 은
   한 시간씩), 칸 아래의 자주 쓰는 시각을 한 번 누르거나, 그냥 쳐도 된다:
     930 · 0930 · 9:30 → 09:30     21 → 21:00     930p · 오후 930 → 21:30
   값은 늘 "HH:MM" 또는 "" (시각 없음) 으로 칸에 남는다. */
const STEP = 5;
const pad2 = n => String(n).padStart(2, '0');
const hhmm = m => pad2(Math.floor(m/60)) + ':' + pad2(m%60);

/* 사람이 친 글 → "HH:MM". 비우면 "", 알아볼 수 없으면 null */
function parseTime(raw){
  let s = String(raw || '').trim().toLowerCase().replace(/\s+/g, '');
  if(!s) return '';
  let pm = null;
  if(/^(오후|pm|p)/.test(s)){ pm = true; s = s.replace(/^(오후|pm|p)/, ''); }
  else if(/^(오전|am|a)/.test(s)){ pm = false; s = s.replace(/^(오전|am|a)/, ''); }
  if(/(오후|pm|p)$/.test(s)){ pm = true; s = s.replace(/(오후|pm|p)$/, ''); }
  else if(/(오전|am|a)$/.test(s)){ pm = false; s = s.replace(/(오전|am|a)$/, ''); }
  s = s.replace(/시$/, '').replace(/시/, ':').replace(/분$/, '');
  let h, m;
  const c = s.match(/^(\d{1,2})[:.](\d{1,2})$/);
  if(c){ h = +c[1]; m = +c[2]; }
  else if(/^\d{1,2}$/.test(s)){ h = +s; m = 0; }
  else if(/^\d{3,4}$/.test(s)){ h = +s.slice(0, s.length - 2); m = +s.slice(-2); }
  else return null;
  if(pm === true && h < 12) h += 12;
  if(pm === false && h === 12) h = 0;
  if(h > 23 || m > 59) return null;
  const t = Math.min(1435, Math.round((h*60 + m)/STEP)*STEP);
  return hhmm(t);
}
const TP = {input:null};
const tpShown = () => $('#tp').classList.contains('on');
/* 칸에 든 값 → [시, 분]. 비었거나 알아볼 수 없으면 null */
function tpCur(){
  const v = TP.input && parseTime(TP.input.value);
  return v ? [+v.slice(0, 2), +v.slice(3)] : null;
}
/* 시계판의 자리. 바깥 고리(시)와 안쪽 고리(분)는 반지름 R_SPLIT 으로 나뉜다 */
const DIAL = {c:110, rh:88, rm:56, split:72};
const dialAt = (r, k) => [DIAL.c + r * Math.sin(Math.PI * k / 6), DIAL.c - r * Math.cos(Math.PI * k / 6)];

/* 판의 뼈대는 열 때 한 번 짓는다 (누른 채 돌리는 동안 다시 지으면 손을 놓친다). 값이 바뀌면 tpDraw 가 바늘만 옮긴다 */
function tpBuild(){
  const box = $('#tp'), el = TP.input;
  const none = el.hasAttribute('data-req') ? '' : '<button type="button" data-tp="none">없음</button>';
  let face = '<circle cx="110" cy="110" r="106" class="tp-face"/><circle cx="110" cy="110" r="' + DIAL.split + '" class="tp-ring"/>' +
    '<line class="tp-hand h" x1="110" y1="110"/><circle class="tp-knob h" r="14"/>' +
    '<line class="tp-hand m" x1="110" y1="110"/><circle class="tp-knob m" r="10"/>';
  for(let k = 0; k < 12; k++){
    const [x, y] = dialAt(DIAL.rh, k), [mx, my] = dialAt(DIAL.rm, k);
    face += '<text class="tp-hn" data-k="' + k + '" x="' + x.toFixed(1) + '" y="' + (y + 5).toFixed(1) + '">' + (k || 12) + '</text>' +
            '<text class="tp-mn" data-k="' + k + '" x="' + mx.toFixed(1) + '" y="' + (my + 4).toFixed(1) + '">' + pad2(k * 5) + '</text>';
  }
  box.innerHTML =
    '<div class="tp-h"><span class="tp-t">시각</span><span class="tp-v"></span><span class="sp"></span>' + none + '</div>' +
    '<div class="tp-b"><svg class="tp-dial" viewBox="0 0 220 220" aria-label="시계판: 바깥은 시, 안쪽은 분">' + face +
      '<circle cx="110" cy="110" r="3.5" class="tp-pin"/></svg>' +
    '<div class="tp-side"><div class="seg tp-ap"><button type="button" data-ap="0">오전</button><button type="button" data-ap="1">오후</button></div>' +
      '<p class="tp-f">바깥은 시 · 안쪽은 분<br>휠: 바깥 1시간 · 안쪽 5분<br>쳐도 됩니다 · 930 · 21 · 930p</p></div></div>';
}
function tpDraw(){
  const box = $('#tp'), el = TP.input;
  if(!el || !box.querySelector('.tp-dial')) return;
  const cur = tpCur(), typed = el.value.trim();
  const v = box.querySelector('.tp-v');
  v.textContent = typed || '시각 없음';
  v.classList.toggle('ph', !typed);
  box.querySelector('.tp-dial').classList.toggle('empty', !cur);
  const h = cur ? cur[0] % 12 : 0, m = cur ? cur[1] / 5 : 0;
  [['h', DIAL.rh, h], ['m', DIAL.rm, m]].forEach(([k, r, i]) => {
    const [x, y] = dialAt(r, i);
    const hand = box.querySelector('.tp-hand.' + k), knob = box.querySelector('.tp-knob.' + k);
    hand.setAttribute('x2', x.toFixed(1)); hand.setAttribute('y2', y.toFixed(1));
    knob.setAttribute('cx', x.toFixed(1)); knob.setAttribute('cy', y.toFixed(1));
  });
  box.querySelectorAll('.tp-hn').forEach(t => t.classList.toggle('on', !!cur && +t.dataset.k === h));
  box.querySelectorAll('.tp-mn').forEach(t => t.classList.toggle('on', !!cur && +t.dataset.k === m));
  box.querySelectorAll('.tp-ap button').forEach(b => b.classList.toggle('on', !!cur && +b.dataset.ap === (cur[0] >= 12 ? 1 : 0)));
}
/* 판은 시각 칸을 덮고 뜬다 (도안 4f). 판 위의 값 칸(.tp-v)이 시각 칸과 같은 자리에
   오게 놓아, 칸이 판으로 부풀어 오른 것처럼 읽힌다. 아래가 모자라면 위로 올리되,
   하늘이 펼쳐져 있으면 그 아래에서 멈춘다 - 점선 구슬을 가리면 하늘을 펼친 까닭이 없다. */
function tpPlace(slide){
  const box = $('#tp'), r0 = TP.input.getBoundingClientRect();
  /* 종이가 아직 미끄러지는 중이면, 다 내려온 뒤의 칸 자리에 맞춘다 */
  const r = {left:r0.left, top:r0.top + (slide || 0), height:r0.height};
  const w = box.offsetWidth || 330, h = box.offsetHeight || 240;
  const v = box.querySelector('.tp-v'), b0 = box.getBoundingClientRect();
  const dx = v ? v.getBoundingClientRect().left - b0.left : 56;
  const dy = v ? v.getBoundingClientRect().top - b0.top : 14;
  const top = 8;
  let x = Math.min(Math.max(8, r.left - dx), innerWidth - w - 16);
  let y = r.top + (r.height - 34) / 2 - dy;
  if(y + h > innerHeight - 8) y = innerHeight - h - 8;
  y = Math.max(top, y);
  box.style.left = x + 'px';
  box.style.top = y + 'px';
}
function tpOpen(el){
  if(TP.input === el && tpShown()) return;
  TP.input = el;
  el.dataset.last = el.value;
  tpBuild();
  tpDraw();
  $('#tp').classList.add('on');
  tpPlace(0);
}
function tpClose(){
  $('#tp').classList.remove('on');
  TP.input = null;
}

document.addEventListener('input', e => { if(e.target === TP.input) tpDraw(); });
/* 칸의 값을 정한다. 알아볼 수 없는 글이면 예전 값으로 되돌리고 알린다 */
function tfCommit(el){
  const v = parseTime(el.value);
  if(v === null || (v === '' && el.hasAttribute('data-req'))){
    if(el.value.trim()) say('시각을 알아볼 수 없습니다 (예: 930 · 21 · 930p)');
    el.value = el.dataset.last || '';
  }else el.value = v ? tmText(v) : '';         /* 칸에도 화면과 같은 12시간으로 (03:00 PM) */
  el.dataset.last = el.value;
  el.dispatchEvent(new Event('tf-change', {bubbles:true}));
}
function tfSet(v){
  const el = TP.input;
  if(!el) return;
  el.value = v;
  tfCommit(el);
  tpClose();
}
$('#tp').addEventListener('mousedown', e => e.preventDefault());   /* 칸의 초점을 뺏지 않는다 */
/* 칸에 시각을 넣고 판을 다시 그린다 */
function tpSet(min){
  const el = TP.input;
  if(!el) return;
  el.value = hhmm(((Math.round(min / STEP) * STEP) % 1440 + 1440) % 1440);
  tfCommit(el);
  tpDraw();
}
/* 비어 있을 때 바깥 고리에서 처음 고른 시: 1~7 시는 오후, 나머지는 오전 (12 는 낮 12시) */
const workHour = k => k === 0 ? 12 : k <= 7 ? k + 12 : k;
/* 판 위의 한 점 → 고리와 눈금 (시계 방향, 12 시가 0) */
function tpHit(e){
  const svg = $('#tp .tp-dial'), r = svg.getBoundingClientRect();
  const x = (e.clientX - r.left) / r.width * 220 - DIAL.c, y = (e.clientY - r.top) / r.height * 220 - DIAL.c;
  let a = Math.atan2(x, -y) / (2 * Math.PI);
  if(a < 0) a += 1;
  return {outer: Math.hypot(x, y) > DIAL.split, k: Math.round(a * 12) % 12};
}
let TP_RING = null;                        /* 누른 채 돌리는 고리: 'h' · 'm' */
function tpTurn(e, start){
  const p = tpHit(e), cur = tpCur();
  if(start) TP_RING = p.outer ? 'h' : 'm';
  if(TP_RING === 'h'){
    const h = cur ? (cur[0] >= 12 ? 12 : 0) + p.k : workHour(p.k);
    tpSet(h * 60 + (cur ? cur[1] : 0));
  }else tpSet((cur ? cur[0] : 9) * 60 + p.k * 5);
}
$('#tp').addEventListener('pointerdown', e => {
  if(!e.target.closest('.tp-dial') || e.button !== 0) return;
  e.target.closest('.tp-dial').setPointerCapture(e.pointerId);
  tpTurn(e, true);
});
$('#tp').addEventListener('pointermove', e => { if(TP_RING) tpTurn(e, false); });
/* 분을 고르고 손을 떼면 더 고를 것이 없다 - 닫는다 */
$('#tp').addEventListener('pointerup', () => { const m = TP_RING === 'm'; TP_RING = null; if(m) tpClose(); });
$('#tp').addEventListener('pointercancel', () => { TP_RING = null; });
$('#tp').addEventListener('wheel', e => {
  if(!e.target.closest('.tp-dial')) return;
  e.preventDefault();
  const cur = tpCur(), up = (e.deltaY || e.deltaX) < 0 ? 1 : -1;
  const base = cur ? cur[0] * 60 + cur[1] : 9 * 60 - (tpHit(e).outer ? 60 : 5) * up;
  tpSet(base + up * (tpHit(e).outer ? 60 : STEP));
}, {passive:false});
$('#tp').addEventListener('click', e => {
  const b = e.target.closest('button');
  if(!b) return;
  if(b.dataset.tp === 'none') return tfSet('');
  if(b.dataset.ap != null){
    const cur = tpCur(), pm = +b.dataset.ap;
    tpSet(((cur ? cur[0] % 12 : 9) + pm * 12) * 60 + (cur ? cur[1] : 0));
  }
});
document.addEventListener('focusin', e => { if(e.target.matches && e.target.matches('input[data-tf]')) tpOpen(e.target); });
document.addEventListener('click', e => { if(e.target.matches && e.target.matches('input[data-tf]')) tpOpen(e.target); });
document.addEventListener('mousedown', e => {
  if(tpShown() && !e.target.closest('#tp') && e.target !== TP.input) tpClose();
});
/* 칸의 시각을 d 분 옮긴다. 비어 있으면 지금 다음 정시에서 시작한다 */
function tfStep(el, d){
  const v = parseTime(el.value);
  let m = v ? mins(v) + d : (new Date().getHours() + 1) * 60;
  m = (Math.round(m / STEP) * STEP % 1440 + 1440) % 1440;
  el.value = hhmm(m);
  tfCommit(el);
  if(TP.input === el) tpDraw();
}
const STEPS = {ArrowUp:STEP, ArrowDown:-STEP, PageUp:60, PageDown:-60};
document.addEventListener('keydown', e => {
  const el = e.target;
  if(!(el.matches && el.matches('input[data-tf]'))) return;
  if(e.key === 'Enter'){ e.preventDefault(); tfCommit(el); tpClose(); }
  else if(e.key === 'Tab') tpClose();
  else if(STEPS[e.key]){ e.preventDefault(); tfStep(el, e.shiftKey ? Math.sign(STEPS[e.key]) * 60 : STEPS[e.key]); }
}, true);
/* 휠: 위로 굴리면 늦게. Shift 를 누르면 창이 가로 휠로 바꿔 보내므로 deltaX 도 본다 */
document.addEventListener('wheel', e => {
  const el = e.target;
  if(!(el.matches && el.matches('input[data-tf]'))) return;
  const dy = e.deltaY || e.deltaX;
  if(!dy) return;
  e.preventDefault();
  tfStep(el, (dy < 0 ? 1 : -1) * (e.shiftKey ? 60 : STEP));
}, {passive:false});
document.addEventListener('change', e => {
  const el = e.target;
  if(!el.matches) return;
  if(el.matches('input[data-tf]')) tfCommit(el);
  else if(el.matches('input.min5') && el.value !== '')
    el.value = Math.max(0, Math.round(+el.value/STEP)*STEP);
}, true);
addEventListener('resize', () => { if(tpShown()) tpPlace(); });
document.addEventListener('scroll', () => { if(tpShown()) tpPlace(); }, true);   /* 창 안에서 스크롤해도 칸에 붙어 있게 */
const tfHtml = (f, v, title) => '<input class="tf" data-tf data-f="' + f + '" autocomplete="off" placeholder="시각 없음" value="' +
  esc(v ? tmText(v) : '') + '" title="' + (title || '예: 930 · 21 · 930p') + '">';
let STATE = null, HOL = new Set();

/* ══════════ 알림 띠 ══════════
   상태줄(say)은 2.8초 뒤 사라진다. 계속 알려야 하는 일 - 연결이 끊겼다,
   손상된 파일을 되살렸다 - 은 창 위쪽 띠에 남긴다. */
function strip(msg, opt){
  const el = $('#strip');
  if(!el) return;
  if(!msg){ el.hidden = true; return; }
  opt = opt || {};
  $('#strip-msg').textContent = msg;
  el.classList.toggle('bad', !!opt.bad);
  const b = $('#strip-btn');
  if(opt.action){
    b.hidden = false;
    b.textContent = opt.action;
    b.onclick = opt.onClick || null;
  }else b.hidden = true;
  el.hidden = false;
}

/* 연결이 끊긴 동안에는 목록을 그대로 두되 손대지 못하게 막는다.
   낙관적으로 그려 두면 저장되지 않은 완료 표시가 조용히 사라진다. */
let OFFLINE = false;
function setOffline(on){
  if(OFFLINE === on) return;
  OFFLINE = on;
  document.body.classList.toggle('offline', on);
  clearInterval(setOffline._t);
  if(on){
    strip('서비스와 연결이 끊겼습니다. 아래 내용은 마지막으로 읽은 것입니다.',
      { bad: true, action: '다시 연결', onClick: () => load().catch(() => {}) });
    setOffline._t = setInterval(() => load().catch(() => {}), 5000);
  }else{
    strip('');
  }
}

/* ══════════ 창 버튼 ══════════ */

/* 최대화 여부는 창에 직접 물어본다(Win32 IsZoomed). 창 크기를 재서 짐작해
   봤더니 테두리 없는 창은 최대화 범위가 작업 영역과 딱 맞지 않아 어긋났다.
   Win+Up 이나 제목줄 두 번 누르기로 최대화해도 resize 는 오므로 여기서 잡힌다. */
function paintMax(m){
  document.body.classList.toggle('maxed', !!m);
  const b = $('#w-max');
  b.innerHTML = m ? ICON.restore : ICON.max;
  b.title = m ? '창 화면으로' : '최대화';
}
function syncMax(){
  const a = window.pywebview && window.pywebview.api;
  if(a && a.is_max) a.is_max().then(paintMax).catch(() => {});
  else paintMax(false);                 /* 브라우저에서 열어 볼 때 */
}
function wireWindow(){
  const has = () => window.pywebview && window.pywebview.api;
  $('#w-min').onclick = () => has() && window.pywebview.api.minimize();
  $('#w-max').onclick = () => {
    if(has()) window.pywebview.api.toggle_max();
    setTimeout(syncMax, 80);            /* 창이 실제로 움직인 뒤에 본다 */
  };
  $('#w-close').onclick = () => {
    setHidden(true);                    /* 숨어 있는 동안 새로 읽기 · 움직임을 멈춘다 (아래 "새로 읽기") */
    flushGone();                        /* 되돌리기를 기다리던 삭제는 지금 보낸다 */
    has() ? window.pywebview.api.close() : window.close();
  };
  syncMax();
}
wireWindow();

/* 창 가장자리 손잡이. 테두리 없는 창이라 Windows 의 크기 조절 테두리가 없다 -
   가장자리 여덟 곳에 보이지 않는 띠를 깔고, 누르면 창(ui.py)이 마우스를 따라
   크기를 바꾼다. 늘리면 보이는 것이 늘고, 기준보다 줄이면 화면이 줄어든다 (ui.apply_zoom). */
['t','r','b','l','tl','tr','bl','br'].forEach(e => {
  const g = document.createElement('div');
  g.className = 'grip g-' + e;
  g.onpointerdown = ev => {
    if(ev.button !== 0) return;
    ev.preventDefault();
    const a = window.pywebview && window.pywebview.api;
    if(a && a.begin_resize) a.begin_resize(e);
  };
  document.body.appendChild(g);
});
/* 제목줄 끌기 · 두 번 누르기. 창을 옮기는 일은 ui.py 가 마우스 자리만 보고 한다
   (pywebview 의 끌기는 화면 배율을 몰라 창이 튀었다). */
$('#titlebar').addEventListener('pointerdown', ev => {
  if(ev.button !== 0 || ev.target.closest('button, input, .field')) return;
  const a = window.pywebview && window.pywebview.api;
  if(a && a.begin_move){ ev.preventDefault(); a.begin_move(); }
});
$('#titlebar').addEventListener('dblclick', ev => {
  if(!ev.target.closest('button, input, .field')) $('#w-max').click();
});
const pvOn = () => { if(window.pywebview && window.pywebview.api) document.body.classList.add('pv'); };
window.addEventListener('pywebviewready', () => { pvOn(); syncMax(); });
pvOn();
window.addEventListener('pywebviewready', wireWindow);
/* 창 가장자리를 끄는 동안 resize 는 1초에 수십 번 온다. 그때마다 파이썬에 최대화
   여부를 물으면 다리(pywebview) 왕복이 줄을 선다. 멈춘 뒤에 한 번만 묻는다. */
let _maxT = 0;
window.addEventListener('resize', () => { clearTimeout(_maxT); _maxT = setTimeout(syncMax, 120); });

/* ══════════ 날짜 · 영업일 ══════════ */
const iso = d => new Date(d.getTime() - d.getTimezoneOffset()*60000).toISOString().slice(0,10);
const dObj = s => new Date(s+'T12:00');
const bizOn = () => STATE.settings.business_only !== false;
function isBiz(s){ const w = dObj(s).getDay(); return w>=1 && w<=5 && !HOL.has(s); }
function rollBiz(s, dir){
  if(!bizOn()) return s;
  let d = dObj(s);
  for(let i=0; i<40 && !isBiz(iso(d)); i++) d.setDate(d.getDate() + (dir||1));
  return iso(d);
}
function shift(days){ const d = dObj(STATE.today); d.setDate(d.getDate()+days); return rollBiz(iso(d), 1); }
/* 시각은 24시간 그대로 (15:00). 2026-11 XX: 오전 · 오후를 덧붙인 12시간은 열 폭을 흔들고 한 번 더 읽게 했다 */
const tmText = t => t || '';
const tmHTML = t => esc(t || '');
/* 요일 한 글자 (자세히 종이의 빠른 날) */

function fmtDay(s){
  if(!s) return '';
  const diff = Math.round((dObj(s) - dObj(STATE.today))/864e5);
  if(diff===0) return '오늘';
  if(diff===1) return '내일';
  if(diff===2) return '모레';
  if(diff===-1) return '어제';
  if(diff<0) return (-diff)+'일 지남';
  const d = dObj(s);
  return (d.getMonth()+1)+'/'+d.getDate()+' ('+WD[(d.getDay()+6)%7]+')';
}

/* ══════════ 그리기 ══════════ */
let RAW = null;
function hideGone(o){
  if(!GONE.size) return o;
  const keep = x => !GONE.has(x.id);
  return Object.assign({}, o, {
    overdue: (o.overdue || []).filter(keep), todays: (o.todays || []).filter(keep),
    upcoming: (o.upcoming || []).filter(keep), floating: (o.floating || []).filter(keep),
    routines: (o.routines || []).filter(keep), tasks: (o.tasks || []).filter(keep),
  });
}
const repaint = () => { if(RAW) render(RAW); };
function render(o){
  RAW = o;
  o = hideGone(o);
  STATE = o;
  HOL = new Set(o.holidays || []);
  THEME = (o.settings && o.settings.theme) || 'auto';
  /* 일정 파일이 손상돼 백업에서 되살렸다면, 조용히 넘어가지 않고 한 번 알린다 */
  if(o.notice && o.notice !== render._notice){
    render._notice = o.notice;
    strip(o.notice, { action: '확인', onClick: () => strip('') });
  }
  $('#date').textContent = fullE(o.today);
  relight();
  if(view === 'today') drawToday();
  if(view === 'cal') drawCal();
  if(view === 'all') drawAll();
  if(view === 'set') fillSettings();
  if(DAY_KEY && $('#m-day').classList.contains('on')) dayModal(DAY_KEY, dayItems(DAY_KEY));
  flashRows();
  tellBadge();
}
/* 작업 표시줄 단추의 빨간 수 = 늦은 일 (ui.py → window.set_overlay). 바뀔 때만 알린다 */
function tellBadge(){
  if(!STATE || CAPTURE) return;
  const n = (STATE.overdue || []).length + (STATE.todays || []).filter(i => isLate(i)).length;
  const a = window.pywebview && window.pywebview.api;
  if(a && a.set_badge && tellBadge._n !== n){ tellBadge._n = n; a.set_badge(n).catch(() => {}); }
}

/* 시계. 분이 바뀌면 시간의 자도 다시 놓는다 - 지금 선이 내려가고, 지금이 지나간 일은 늦음이 된다 */
function tickClock(){
  if(SHOT_MIN != null) return;
  const n = new Date(), v = pad2(n.getHours()) + ':' + pad2(n.getMinutes());
  const el = $('#clock');
  if(el._v === v) return;
  const was = el._v;
  el._v = v; clockTo(el, v, was);
  sunTo();
  if(was && STATE && view === 'today' && !DRAG && !document.hidden) drawToday();
}
/* 시계 숫자 굴림: 바뀐 자리의 숫자만 위로 한 칸 (옛 숫자는 data-o 로 새 숫자 위 칸에 붙는다). 움직임을 껐으면 그냥 바꾼다 */
function clockTo(el, v, was){
  if(!was || calm() || document.hidden || was.length !== v.length){ el.textContent = v; return; }
  el.innerHTML = [...v].map((c, k) => c === was[k] ? c : '<span class="dg"><i data-o="' + was[k] + '">' + c + '</i></span>').join('');
}
/* 머리말 옆의 수 (E1): 바뀐 자리의 숫자만 시계처럼 굴러간다 - 줄면 위에서 내려오고, 늘면 아래에서 올라온다.
   keep 이면 0 일 때도 말은 남긴다 (다가올 날의 '다음 주' 처럼 지금 보는 곳을 알리는 말) */
function countTo(el, w, n, keep){
  if(el._w === w && el._n === n) return;
  const was = el._w === w && el._n ? String(el._n) : '', v = String(n), up = n > el._n;
  el._w = w; el._n = n;
  if(!n){ el.innerHTML = keep ? w : ''; return; }
  const b = !was || was.length !== v.length || calm() || document.hidden ? v
    : [...v].map((c, k) => c === was[k] ? c : '<span class="dg' + (up ? '' : ' dn') + '"><i data-o="' + was[k] + '">' + c + '</i></span>').join('');
  el.innerHTML = w + ' <b>' + b + '</b>';
}
/* 해시계 하늘: 머리 뒤 하늘의 가장 밝은 곳이 아침 브리핑 → 하루 끝 사이를 왼쪽에서 오른쪽으로 옮겨 간다.
   10분 단위로만 옮긴다 (뿌리 변수를 쓰면 화면 전체 스타일을 다시 센다). 하루 끝 한 시간 전부터는 옅게 따뜻한 빛 */
let _sun = '';
function sunTo(){
  if(!STATE) return;
  const a = mins((STATE.settings && STATE.settings.brief_time) || '08:30'), b = dayEnd(), n = Math.floor(nowMin() / 10) * 10;
  const p = Math.max(0, Math.min(1, (n - a) / Math.max(60, b - a)));
  const x = (6 + 88 * p).toFixed(1) + '%', c = n >= b - 60 ? 'var(--sun-eve)' : 'var(--sun-day)';
  if(_sun === x + c) return;
  _sun = x + c;
  document.documentElement.style.setProperty('--sun-x', x);
  document.documentElement.style.setProperty('--sun', c);
}
tickClock();
setInterval(tickClock, 5000);
/* 문장 칸의 왼끝 = 시계 묶음 끝 + 24. 묶음 폭은 글꼴이 들어온 뒤에 한 번 잰다 (시각 · 날짜는 고정폭이라 그 뒤로 변하지 않는다) */
const clkW = () => document.documentElement.style.setProperty('--clk-w', $('.clk').getBoundingClientRect().width + 'px');
clkW();
if(document.fonts) document.fonts.ready.then(clkW);

let lastLoad = 0;                   /* 마지막으로 새로 읽은 때 (ms) */
/* 받은 개요를 그린다. 지난번과 글자 하나까지 같으면 그리지 않는다 (45초마다 새로 읽을 때 대개는 그대로다) */
let lastSeen = '';
function take(o){
  lastLoad = Date.now();
  const seen = JSON.stringify(o);
  if(seen === lastSeen && RAW) return;
  lastSeen = seen;
  render(o);
  updNotice(o.update);
  sunTo();
  morningDoor();
  if(!load._first){
    load._first = true;
    const h = /^#(cal|all|set)$/.exec(location.hash || '');
    setView(h ? h[1] : 'today');
    shotHook();
  }
}
const load = () => api('/api/overview').then(take);
/* 바꾸는 요청. 서버가 바뀐 뒤의 개요를 같이 실어 보내므로(?ov=1) 곧이어 또 묻지 않는다 */
const change = (u, b) => api(u + '?ov=1', b).then(d => {
  if(d && d.overview) take(d.overview); else load();
  return d;
});

/* ══════════ 아래 가운데 한 줄: 되돌리기 · 알림말 ══════════
   완료 · 건너뛰기 · 옮기기 · 삭제는 묻지 않고 곧바로 하고, 3초 동안 되돌릴 수 있다 (Ctrl+Z 도 같다).
   알림말(저장 실패 · 연결 끊김 등)도 같은 자리에 되돌리기 없이 뜬다. */
const UNDO_MS = 3000;
function undoToast(verb, title, undo){
  const el = $('#undo');
  const stop = () => { clearTimeout(undoToast._t); clearInterval(undoToast._c); };
  const hide = () => { el.classList.remove('on'); stop(); };
  $('#undo-verb').textContent = verb || '';
  $('#undo-verb').hidden = !verb;
  $('#undo-msg').textContent = title || '';
  const b = $('#undo-btn'), sec = $('#undo-sec');
  b.hidden = !undo;
  b.onclick = () => { hide(); if(undo) undo(); };
  stop();
  const end = Date.now() + (undo ? UNDO_MS : 2800);
  drain(sec, undo ? UNDO_MS : null);
  el.classList.add('on');
  undoToast._t = setTimeout(hide, end - Date.now());
}
/* 남은 때의 선: null = 없음 · 0 = 가득 (멈춤) · ms = 가득에서 ms 동안 줄어든다 */
function drain(el, ms){
  el.style.transition = 'none'; el.style.transform = ms == null ? 'scaleX(0)' : 'none';
  if(!ms) return;
  void el.offsetWidth;
  el.style.transition = 'transform ' + ms + 'ms linear'; el.style.transform = 'scaleX(0)';
}
$('#undo').addEventListener('mouseenter', () => { clearTimeout(undoToast._t); if(!$('#undo-btn').hidden) drain($('#undo-sec'), 0); });
$('#undo').addEventListener('mouseleave', () => {
  undoToast._t = setTimeout(() => $('#undo').classList.remove('on'), 2000);
  if(!$('#undo-btn').hidden) drain($('#undo-sec'), 2000);
});
const say = m => undoToast('', m, null);
/* 처리하지 않은 요청 실패는 아래 한 줄에 보여준다 (조용히 삼키지 않는다) */
addEventListener('unhandledrejection', e => {
  e.preventDefault();
  say((e.reason && e.reason.message) || '요청을 처리하지 못했습니다');
});

/* ══════════ 창 (모달) ══════════
   자세히 종이(.sheet)는 머리 아래를 통째로 덮는다 - 가림막이 없다. 떠 있는 것(그날 전체 · 확인 · 새 버전)만 뒤를 옅게 가린다. */
function openM(id){
  const el = $(id);
  if(!el.classList.contains('sheet')) $('#veil').classList.add('on');
  el.classList.add('on');
  roHide(); riseClose(true);
}
function closeM(id){
  if(id === '#m-update') updSeen();
  if(id === '#m-day') riseClose(true);
  $(id).classList.remove('on');
  if(!$$('.modal.on:not(.sheet)').length) $('#veil').classList.remove('on');
}
function closeAll(){
  if($('#m-update').classList.contains('on')) updSeen();
  $('#veil').classList.remove('on');
  $$('.modal').forEach(m => m.classList.remove('on'));
}
const closeSheets = () => $$('.modal.sheet.on').forEach(m => m.classList.remove('on'));
$('#veil').onclick = () => $$('.modal.on:not(.sheet)').forEach(m => closeM('#' + m.id));
$$('[data-close]').forEach(b => b.onclick = e => closeM('#' + e.target.closest('.modal').id));
document.addEventListener('keydown', e => {
  if(e.key === 'Escape'){
    if(ctxShown()){ ctxClose(); return; }
    if(tpShown()){ tpClose(); return; }
    const pop = $$('.modal.on:not(.sheet)');
    if(pop.length){ closeM('#' + pop[pop.length - 1].id); return; }
    if($$('.modal.sheet.on').length){ closeSheets(); return; }
    if(view === 'set') closeSet();
    else if(view !== 'today') setView('today');
    return;
  }
  /* 설명 칸은 여러 줄이 될 수 있다 - 그 칸에서 Enter 는 줄바꿈이고, 저장은 Ctrl+Enter */
  const multi = e.target.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey;
  if(e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !multi && !e.defaultPrevented && !e.isComposing){
    if($('#m-add').classList.contains('on')) $('#a-save').click();
    else if($('#m-edit').classList.contains('on')) $('#e-save').click();
  }
});

const taskUrl = i => '/api/task/' + encodeURIComponent(i.id);

/* 완료 / 완료 취소. 뒤집기가 아니라 "누른 사람이 본 상태의 반대" 를 보낸다 - 알림 카드에서
   이미 완료했는데 화면이 늦게 갱신됐어도 결과가 누른 사람의 뜻대로 나온다. */
function setDone(i, done, after){
  /* after(달력 회차 고치기)는 새 개요를 그리기 전에 - 그래야 다시 그린 달력에 곧바로 보인다 */
  const send = v => api(taskUrl(i) + '/done?ov=1', {date: i.date, done: v}).then(d => {
    if(after) after();
    if(d && d.overview) take(d.overview); else load();
  });
  return send(done).then(() => {
    if(done) undoToast('끝냄', i.title, () => send(false));
  });
}

/* 루틴의 그 회차만 건너뛴다 */
function skipOnce(i){
  const day = i.date || i.next_date || STATE.today;
  return change(taskUrl(i) + '/skip', {date: day}).then(() => {
    undoToast(fmtDay(day) + ' 건너뜀', i.title, () =>
      change(taskUrl(i) + '/unskip', {date: day}));
  });
}

/* 할 일을 하루 미룬다. 오늘 · 지난 것은 "내일로", 앞으로의 것은 그 날짜에서 하루 뒤로.
   영업일만 쓰면 주말 · 공휴일을 건너뛴다. */
function laterDate(i){
  const base = i.date && i.date > STATE.today ? i.date : STATE.today;
  const d = dObj(base);
  d.setDate(d.getDate() + 1);
  return rollBiz(iso(d), 1);
}
function later(i){ return moveTo(i, laterDate(i)); }
/* 오늘 · 지난 일의 '내일' (영업일과 상관없이 바로 다음 날) */
const tomorrowOf = i => addDay(i.date && i.date > STATE.today ? i.date : STATE.today, 1);
/* 옮기기. 할 일은 날짜를 바꾸고(기간이면 끝 날을, 시작이 그 뒤로 밀리면 하루짜리로), 메모는 그 날의 할 일이 된다.
   tm 을 주면 시각도 (빈 때로 미루기). 루틴은 한 회차만 옮긴다 (laterOnce) */
function moveTo(i, to, tm){
  if(!i || !to || OFFLINE) return;
  if(i.kind === 'routine') return laterOnce(i, to, tm);
  const verb = toWord(tm && to === STATE.today ? tm : fmtDay(to)), at = tm ? {due_time:tm} : {};
  if(i.kind === 'floating' || !i.date){
    return change(taskUrl(i), Object.assign({kind:'deadline', due_date:to, start_date:null}, at)).then(() =>
      undoToast(verb, i.title, () => change(taskUrl(i), {kind:'floating', due_date:null, start_date:null})));
  }
  if(to === i.date && (!tm || tm === i.time)) return;
  const from = i.date, st = i.start || null, ft = i.time || '';
  return change(taskUrl(i), Object.assign({due_date:to, start_date:st && st < to ? st : null}, at)).then(() =>
    undoToast(verb, i.title, () => change(taskUrl(i), {due_date:from, start_date:st, due_time:ft})));
}
/* '15:30으로' · '모레로' - 시각은 끝자리 소리(영 · 삼 · 육 = 받침)에 따라 */
const toWord = w => w + (/[036]$/.test(w) ? '으로' : '로');
/* 여럿을 한 날로 (저녁 문). 되돌리면 모두 제 날로. 루틴 회차는 내일 또 돌므로 넘기지 않는다 */
function moveAll(list, to){
  list = list.filter(i => i.id && i.kind !== 'routine' && !i.done);
  if(!list.length || OFFLINE) return Promise.resolve();
  const back = list.map(i => ({i, from:i.date, st:i.start || null}));
  return Promise.all(list.map(i => api(taskUrl(i), {due_date:to, start_date:i.start && i.start < to ? i.start : null})))
    .then(() => load()).then(() => undoToast(fmtDay(to) + '로', list.length + '개', () =>
      Promise.all(back.map(b => api(taskUrl(b.i), {due_date:b.from, start_date:b.st}))).then(() => load())))
    .catch(e => { say(e.message); load(); });
}
/* 하루 끝 (설정, 기본 18:00) */
const dayEnd = () => mins((STATE && STATE.settings && STATE.settings.day_end) || '18:00');
/* 빈 때: 오늘 시각 있는 일마다 30분을 잡고, 기준(지금과 그 일의 시각 중 늦은 것) 30분 뒤부터 처음으로 30분 넘게 비는 때.
   하루 끝을 넘으면 없다. 알림 카드의 가운데 단추(desktop/app.py next_gap)와 같은 셈 */
/* 걸린 시간: 이 PC 가 배운 값 (store.durations, 같은 이름 최근 5번의 가운데값). 모르면 0 */
const durKey = t => (t || '').split(/\s+/).filter(Boolean).join(' ').toLowerCase();
const durOf = x => (STATE.durations || {})[durKey(x && x.title)] || 0;
const durWord = m => m < 60 ? m + '분' : Math.floor(m / 60) + '시간' + (m % 60 ? ' ' + m % 60 + '분' : '');
/* 빈 때: 시각 있는 일마다 그 일의 길이(배운 값, 없으면 30분)를 잡는다. 카드의 app.next_gap 과 같은 셈 */
function gapAfter(i){
  const busy = (STATE.todays || []).filter(x => x.time && !doneNow(x) && keyOf(x) !== keyOf(i)).map(x => [mins(x.time), durOf(x) || 30]);
  const own = durOf(i) || 30;
  const c0 = Math.ceil((Math.max(nowMin(), i.time && i.date === STATE.today ? mins(i.time) : 0) + 30) / 5) * 5;
  const cands = [c0].concat(busy.map(([b, n]) => b + n).filter(b => b > c0)).sort((a, b) => a - b);
  for(const t of cands){
    if(t + own > dayEnd()) return null;
    if(busy.every(([b, n]) => t + own <= b || t >= b + n)) return hhmm(t);
  }
  return null;
}

/* 루틴의 한 회차를 미룬다. 루틴에는 "이 회차만 다른 날" 이라는 자리가 없으므로, 그 회차를
   건너뛰고 미룬 날에 같은 이름 · 시각의 할 일을 하나 만든다. 되돌리면 둘 다 거둔다. */
function laterOnce(i, to, tm){
  const day = i.date;
  to = to || laterDate(i);
  if(!day) return;
  let made = null;
  return change(taskUrl(i) + '/skip', {date: day})
    .then(() => change('/api/task', {title: i.title, kind: 'deadline', due_date: to, due_time: tm || i.time || '', note: i.note || ''}))
    .then(d => {
      made = d && d.id;
      undoToast(toWord(tm && to === STATE.today ? tm : fmtDay(to)), i.title, () =>
        (made ? change('/api/task/' + encodeURIComponent(made) + '/delete', {}) : Promise.resolve())
          .then(() => change(taskUrl(i) + '/unskip', {date: day})));
    });
}

/* 삭제: 화면에서는 곧바로 빼고, 서버에는 3초 뒤에 보낸다 */
const GONE = new Map();               /* id → {t: 타이머} */
function sendDelete(id){
  return change('/api/task/' + encodeURIComponent(id) + '/delete', {});
}
function removeSoon(i){
  if(GONE.has(i.id)) return;
  const go = () => {
    GONE.delete(i.id);
    sendDelete(i.id).catch(e => { say(e.message); load(); });
  };
  GONE.set(i.id, {t: setTimeout(go, UNDO_MS)});
  /* 줄이 제자리에서 접히며 빠지고, 그 아래 줄들이 올라와 메운다. 개요(STATE)에서는
     곧바로 빼고, 다시 그리는 것만 접힌 뒤로 미룬다. */
  const rows = calm() ? [] : $$('.r[data-id]').filter(el => el.dataset.id === i.id);
  if(rows.length){
    STATE = hideGone(RAW);
    Promise.all(rows.map(el => {
      el.style.overflow = 'hidden';
      return el.animate([{opacity: 1, height: el.offsetHeight + 'px'},
                         {opacity: 0, height: '0px'}],
                        {duration: 200, easing: EASE_EXIT, fill: 'forwards'}).finished;
    })).then(repaint, repaint);
  } else repaint();
  undoToast('삭제', i.title, () => {
    const g = GONE.get(i.id);
    if(!g) return;                    /* 이미 보냈다 */
    clearTimeout(g.t);
    GONE.delete(i.id);
    repaint();
  });
}
/* 창을 닫거나 페이지가 내려갈 때: 기다리던 삭제를 지금 보낸다 (되돌릴 기회는 지났다) */
function flushGone(){
  GONE.forEach((g, id) => {
    clearTimeout(g.t);
    fetch('/api/task/' + encodeURIComponent(id) + '/delete', {
      method: 'POST', keepalive: true, body: '{}',
      headers: {'X-TM-Token': TOKEN, 'Content-Type': 'application/json'},
    }).catch(() => {});
  });
  GONE.clear();
}
addEventListener('pagehide', flushGone);

function rowAct(a, i){
  if(a === 'later') return later(i);
  if(a === 'tom') return moveTo(i, tomorrowOf(i));
  if(a === 'today') return moveTo(i, STATE.today);
  if(a === 'skip') return skipOnce(i);
  if(a === 'del') return removeSoon(i);
  if(a === 'done') return setDone(i, !i.done);
  if(a === 'edit') return openEdit(i);
  if(a === 'imp') return setImp(i, !i.pinned);
}
/* 중요 표시 (저장 칸은 pinned - 메모는 예전부터 이 값으로 위에 고정됐다). 루틴은 모든 회차가 같이 바뀐다 */
function setImp(i, on){
  return change(taskUrl(i), {pinned: on}).then(() =>
    undoToast(on ? '중요로 표시' : '중요 표시 끔', i.title, () => change(taskUrl(i), {pinned: !on})));
}

/* ══════════ 오른쪽 단추 차림표 ══════════
   마우스를 올리면 뜨는 단추는 줄 위에서만 보이고, 무엇이 있는지 미리 알 수 없다.
   Windows 의 어느 목록에서나 그렇듯 오른쪽 단추로도 같은 것을 할 수 있게 한다.
   지우기는 되돌릴 수 없는 유일한 항목이라 빨간 글씨로 맨 아래에 따로 둔다 -
   손이 미끄러져도 다른 것을 누르게 되는 자리다. */
function ctxRows(i, where){
  const r = [['edit', '고치기']];
  if(!(i.kind === 'routine' && where === 'routines'))
    r.push(['done', i.done ? '끝냄 취소' : '끝냄']);
  if(!i.done){
    /* 다음 영업일이 곧 내일이면 한 줄로 ('내일로'), 다르면 둘 다 (금요일의 '내일' 은 토요일이다) */
    const nb = laterDate(i), tm = tomorrowOf(i), nbL = nb === tm ? '내일로' : '다음 영업일로 · ' + fmtDay(nb);
    if(i.kind === 'routine'){
      /* 움직이는 것은 이 회차뿐 - 그 말은 머리 한 줄로 한 번만 */
      if(i.date || i.next_date) r.push(['', '이번 회차', 'head']);
      if(i.date){ r.push(['later', nbL]); if(nb !== tm) r.push(['tom', '내일로']); }
      if(i.date || i.next_date) r.push(['skip', '건너뛰기']);
    }else if(i.kind === 'floating' || !i.date){
      if(i.id) r.push(['today', '오늘 할 일로']);
    }else{
      if(i.date < STATE.today) r.push(['today', '오늘로']);
      r.push(['later', nbL]);
      if(nb !== tm) r.push(['tom', '내일로']);
    }
  }
  if(i.id) r.push(['imp', i.pinned ? '중요 표시 끄기' : '중요로 표시']);
  /* 오늘 목록의 루틴 회차에서 지우면 그 날짜가 아니라 루틴 자체가 없어진다.
     막지 않되 글자로 밝혀 둔다 - 매번 루틴 칸까지 찾아가게 할 일은 아니다 */
  r.push(['del', i.kind === 'routine' && where !== 'routines' ? '루틴 전체 삭제' : '삭제', 'danger']);
  return r;
}
function ctxOpen(x, y, i, where){
  if(!i || i.ghost || i._inert) return;
  ctxMenu(x, y, ctxRows(i, where), a => rowAct(a, i));
}
function ctxMenu(x, y, rows, on){
  const el = $('#ctx');
  if(OFFLINE) return;
  el.innerHTML = rows.map(([a, label, cls]) => cls === 'head' ? '<div class="ctx-h">' + esc(label) + '</div>' :
    (cls === 'danger' ? '<div class="ctx-sep"></div>' : '') +
    '<button type="button" role="menuitem" data-a="' + a + '"' +
    (cls ? ' class="' + cls + '"' : '') + '>' + esc(label) + '</button>').join('');
  el.onclick = e => {
    const b = e.target.closest('[data-a]');
    if(!b) return;
    ctxClose();
    on(b.dataset.a);
  };
  /* 먼저 보여 줘야 크기를 잴 수 있다. 화면 밖으로 나가면 커서 위쪽 · 왼쪽으로 뒤집는다 */
  el.classList.add('on');
  const w = el.offsetWidth, h = el.offsetHeight;
  el.style.left = Math.max(6, Math.min(x, innerWidth - w - 6)) + 'px';
  el.style.top = (y + h > innerHeight - 6 ? Math.max(6, y - h) : y) + 'px';
  const first = el.querySelector('button');
  if(first) first.focus();
}
function ctxClose(){ if(SHOT_MIN != null) return; $('#ctx').classList.remove('on'); }
const ctxShown = () => $('#ctx').classList.contains('on');
$('#t-late').addEventListener('click', () => { if(TRI) return; triStart('am', amPool()); });
document.addEventListener('mousedown', e => { if(ctxShown() && !e.target.closest('#ctx')) ctxClose(); });
document.addEventListener('scroll', ctxClose, true);
addEventListener('resize', ctxClose);
addEventListener('blur', ctxClose);

/* ══════════ 새 항목 · 고치기 ══════════
   정할 것은 셋이다: 무엇 (이름) · 언제 (날짜 · 시각 · 반복) · 알림. 창도 그 순서다 - 위에서 아래로 한 줄기.

     이름   문장으로 친다. "교보생명 자료 수요일 3시 매주" 의 날짜 · 시각 · 반복은 바로 읽어 아래 값 줄에 채운다
     값 줄  날짜 · 시각 · 반복 · 알림 (+ 중요 · 설명) 을 가로 한 줄에. 이 줄이 곧 "무엇이 만들어질지" 다
     도구   값 줄 아래, 지금 고르는 칸의 도구 하나. 날짜를 고르면 다음은 시각 쪽으로 좁혀 간다
            날짜 → 빠른 날 + 달력 · 시각 → 그날의 시간표 + 자주 쓰는 시각 · 반복 → 빈도와 규칙 · 알림 → 알림 고르기

   (2026-10 덜어냄: 왼쪽 줄 여섯 + 오른쪽 판의 두 칸 구조, 시계판, 맨 아래 요약 문장을 걷었다. 요약 문장은 값 줄과
   같은 정보를 두 번 쓰고 있었고, 시계판은 두 번 정확히 눌러야 했다.)

   도구가 한 자리를 돌려 쓰므로 무엇을 고르든 창의 크기와 줄의 자리는 그대로다.
   종류(할 일 · 루틴 · 메모)는 고르지 않는다 - 언제를 정한 모양에서 따라 나온다:
     날짜 없음 → 메모   하루 → 할 일   이어진 날 → 기간 업무   반복 → 루틴
   그래서 미리 넣어 두는 날짜도, 오늘 · 내일 같은 추천도 없다. 비어 있으면 비어 있는 그대로다.
   (홈 달력의 어떤 날에서 열었으면 그 날이 들어간다 - 사람이 준 맥락이라 짐작이 아니다.)

   기간은 날짜를 고르는 방법이라 달력 판 머리의 "하루 / 여러 날" 에 있고 (끌어도 된다),
   반복은 날짜와 따로인 질문(얼마나 자주)이라 자기 줄을 갖는다. 반복을 켜면 날짜 줄은 "처음 언제" 가 된다.
   날짜 줄에는 칠 수도 있다 - "금 3시" · "다음주 월~금" · "매달 넷째 목 10시" 가 시각 · 반복 줄까지 채운다 (when.js).
   맨 아래 한 줄은 무엇이 만들어질지를 끝까지 풀어 쓴다. 해석이 틀렸으면 여기서 보인다. */
const KIND_NAME = {deadline:'할 일', routine:'루틴', floating:'메모'};
/* 얼마나 자주: 단위와 간격을 한 판에 펼친다 (단위를 고르고 다시 간격을 고르던 두 단계를 없앴다) */
const FREQ = [['day', 1, '매일'], ['week', 1, '매주'], ['week', 2, '격주'], ['month', 1, '매달'],
              ['month', 2, '격월'], ['month', 3, '분기'], ['month', 6, '반기'], ['year', 1, '매년']];
const SHIFTS = [['prev','앞 영업일로'], ['next','다음 영업일로'], ['none','그대로']];
/* 마감 알림: 몇 분 전. "끔" 은 muted 로 저장한다. 알약마다 "전" 을 붙이지 않고 줄 이름에 한 번 */
const LEADS = [[0,'정각'], [10,'10분'], [30,'30분'], [60,'1시간'], [180,'3시간']];
const leadLabel = m => !m ? '정각' : m % 60 === 0 ? (m / 60) + '시간' : m + '분';
/* 며칠 앞서 한 번 더 (early_days). 하루 전을 고르느라 30분 전 알림을 잃지 않게 따로 둔다 */
const EARLY = [[0,'없음'], [1,'하루'], [2,'이틀'], [3,'3일'], [7,'일주일']];
const EARLY_W = {1:'하루', 2:'이틀', 3:'3일', 7:'일주일'};
const defLead = () => STATE.settings.notify_min != null ? STATE.settings.notify_min : 30;

/* 저장된 규칙 → [단위, 간격] (고치기로 열었을 때 빈도 판의 어느 칸이 켜질지) */
function unitOf(rule){
  if(!rule) return ['month', 1];
  if(rule.period === 'day') return ['day', 1];
  if(rule.period === 'week') return ['week', rule.interval || 1];
  if(rule.period === 'quarter') return ['month', 3];     /* 예전 분기 규칙: 가장 가까운 자리 */
  const m = rule.months;
  if(!m || m.length >= 12) return ['month', 1];
  if(m.length === 1) return ['year', 1];
  return ['month', 12 % m.length === 0 ? 12 / m.length : 1];
}
/* 영업일로 세는 규칙은 주말 · 공휴일에 걸릴 일이 없다 */
const countsBizDays = r => !!r && (r.basis === 'business_day' || r.basis === 'before_end_bd' ||
  (r.period === 'day' && r.business_only));
const mdw = k => { const d = dObj(k); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + WD[(d.getDay() + 6) % 7] + ')'; };
const dOnlyW = k => { const d = dObj(k); return d.getDate() + '일 (' + WD[(d.getDay() + 6) % 7] + ')'; };
const offName = k => (STATE.holiday_names || {})[k] || (HOL.has(k) ? '공휴일' : dObj(k).getDay() === 0 ? '일요일' : '토요일');
const relW = k => { const n = dayDiff(STATE.today, k);
  return n === 0 ? '오늘' : n === 1 ? '내일' : n === 2 ? '모레' : n === -1 ? '어제' : n > 0 ? n + '일 뒤' : (-n) + '일 지남'; };
const XI = '<svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';

/* win: 창 (#m-add · #m-edit). 뼈대는 한 번 짓고, 열 때마다 render(item) 로 값만 채운다 */
function Form(win, pre){
  const body = win.querySelector('.cp'), Q = s => body.querySelector(s);
  body.innerHTML =
    '<div class="cp-l">' +
      '<div class="nbox"><div class="hl" aria-hidden="true"></div>' +
      '<input class="cp-name" id="' + pre + '-title" autocomplete="off" placeholder="이름" aria-label="이름"></div>' +
      '<div class="cp-move" hidden></div>' +
      '<div class="cp-props">' +
        '<div class="cp-p when" data-p="date"><span class="pl">날짜</span>' +
          '<div class="wbox"><div class="hl" aria-hidden="true"></div>' +
          '<input class="win" autocomplete="off" aria-label="날짜 (쳐도 됩니다)" placeholder="없음"></div><span class="tr" data-t="date"></span></div>' +
        '<div class="cp-say" aria-live="polite"></div>' +
        '<div class="cp-p" data-p="time"><span class="pl">시각</span>' +
          '<input class="tin" autocomplete="off" aria-label="시각" title="예: 930 · 21 · 930p · ↑↓ 5분"><span class="tr" data-t="time"></span></div>' +
        '<button type="button" class="cp-p" data-p="rule"><span class="pl">반복</span><span class="pv" data-v="rule"></span><span class="tr" data-t="rule"></span></button>' +
        '<button type="button" class="cp-p" data-p="alert"><span class="pl">알림</span><span class="pv" data-v="alert"></span><span class="tr"></span></button>' +
        '<button type="button" class="cp-p cp-imp" data-p="imp" aria-pressed="false"><span class="pl">중요</span><span class="pv" data-v="imp"></span><span class="tr"></span></button>' +
        '<div class="cp-note"></div>' +
      '</div>' +
    '</div>' +
    '<div class="cp-pane"><div class="cp-ph"></div><div class="pb"><div class="px"></div><div class="cp-cal"></div>' +
      '<div class="dialw" hidden></div><div class="dayt" hidden></div><p class="cp-ctx" hidden></p></div></div>';
  const name = Q('.cp-name'), when = Q('.win'), tin = Q('.tin'), pane = Q('.cp-pane'), cal = Q('.cp-cal');
  let S = null, I = {}, typing = null, parsed = null, snap = null, hover = null, drag = null;
  let lastGroup = null, sugSeq = 0, occSeq = 0, apLock = false, ring = null, moveP = null;
  const MC = {y:0, m:0};
  const showMonth = k => { const d = dObj(k || STATE.today); MC.y = d.getFullYear(); MC.m = d.getMonth(); };
  const self = {};

  /* ---------- 상태 ----------
     mode: none (날짜 없음 = 메모) · one · range · rule.  span: 달력이 "여러 날" 로 고르는 중.
     pending: 여러 날에서 시작만 누르고 끝을 기다리는 중. freq: [단위, 간격] - 날을 아직 안 고른 반복도 여기 남는다.
     items: 그 날 · 그 빈도로 도는 규칙들 (엔진이 준다). occ: 고른 규칙이 앞으로 도는 날 (달력의 표시). */
  const blank = () => ({mode:'none', date:null, end:null, span:false, pending:false, time:'', rule:null, ruleText:'', keep:null,
    freq:null, items:null, occ:new Set(), lead:null, muted:false, early:0, noteOpen:false, pane:'date', imp:false});
  const has = () => S.mode !== 'none';
  self.kind = () => S.mode === 'none' ? 'floating' : S.mode === 'rule' ? 'routine' : 'deadline';
  const kindWord = () => S.mode === 'none' ? '메모' : S.mode === 'rule' ? '루틴' : S.mode === 'range' && S.end ? '기간 업무' : '할 일';

  function setOne(k){ Object.assign(S, {mode:'one', date:k, end:null, pending:false, rule:null, ruleText:'', freq:null, items:null}); S.occ = new Set(); }
  function setRange(a, b){
    if(a > b) [a, b] = [b, a];
    if(a === b) return setOne(a);
    Object.assign(S, {mode:'range', date:a, end:b, pending:false, span:true, rule:null, ruleText:'', freq:null, items:null});
    S.occ = new Set();
  }
  function clearWhen(){ Object.assign(S, {mode:'none', date:null, end:null, pending:false, rule:null, ruleText:'', freq:null, items:null, time:'', span:false}); S.occ = new Set(); }

  /* 반복: 빈도를 고르면, 날이 있으면 그 날에 도는 규칙을 엔진에 묻는다. 날이 없으면 달력에서 하나 누르기를 기다린다 */
  function setFreq(f){
    if(!f){ if(S.mode === 'rule') S.mode = S.date ? 'one' : 'none'; Object.assign(S, {freq:null, rule:null, ruleText:'', items:null}); S.occ = new Set(); return; }
    S.freq = f; S.keep = null;
    if(f[0] === 'day'){
      S.rule = {period:'day', business_only:S.rule && S.rule.period === 'day' ? S.rule.business_only : bizOn()};
      S.ruleText = ''; S.mode = 'rule'; S.end = null; S.pending = false; S.span = false;
      loadOcc(true);
      return;
    }
    if(S.date){ S.end = null; S.pending = false; S.span = false; ruleDay(S.date); }
    else { S.rule = null; S.items = null; }
  }
  /* 반복의 날을 정한다. 주: 요일은 그 날을 따라간다 (여럿 골라 둔 것은 지킨다). 달 · 해: 엔진의 제안에서
     앞서 고른 것과 같은 종류(말일 · N번째 O요일 …)를 먼저, 없으면 첫 번째 것 */
  function ruleDay(k){
    const [unit, every] = S.freq;
    S.date = k; S.mode = 'rule'; S.keep = null;
    const wd = (dObj(k).getDay() + 6) % 7;
    if(unit === 'week'){
      const keep = S.rule && S.rule.period === 'week' && S.rule.weekdays.length > 1 && S.rule.weekdays.includes(wd) ? S.rule.weekdays : [wd];
      S.rule = {period:'week', weekdays:keep, interval:every, anchor:k, holiday_shift:S.rule && S.rule.holiday_shift || (wd < 5 ? 'prev' : 'none')};
      S.ruleText = '';
      loadOcc(false);
      return;
    }
    const prev = S.rule && S.rule.period === 'month' ? S.rule : null;
    S.items = null;
    const my = ++sugSeq;
    api('/api/suggest?date=' + k + '&unit=' + unit + '&every=' + every).then(r => {
      if(my !== sugSeq) return;
      S.items = r.items || [];
      const hit = prev && S.items.find(it => it.rule.basis === prev.basis && (it.rule.basis !== 'business_day' || (it.rule.n === -1) === (prev.n === -1)));
      const it = hit || S.items[0];
      S.rule = it ? it.rule : null; S.ruleText = it ? it.text : '';
      loadOcc(false);
      draw();
    }).catch(err => { if(my === sugSeq){ S.items = []; say(err.message); draw(); } });
  }
  /* 고른 규칙이 앞으로 도는 날 (달력의 표시 · 아래 줄의 "다음"). first: 날짜 줄을 첫 회차로 옮긴다
     (글로 친 규칙 · 매일 규칙은 기준 날짜가 따로 없다) */
  function loadOcc(first){
    const r = ruleOut();
    if(!r){ S.occ = new Set(); return; }
    const my = ++occSeq;
    api('/api/preview', {rule:r}).then(d => {
      if(my !== occSeq) return;
      S.occ = new Set(d.days || []);
      S.next = (d.days || [])[0] || null;
      if(!S.ruleText || first) S.ruleText = d.text || S.ruleText;
      if(first && S.next){ S.date = S.next; showMonth(S.date); }
      draw();
    }).catch(() => {});
  }
  /* 저장할 규칙. 주 규칙의 기준 주는 고른 날의 주다 */
  function ruleOut(){
    if(!S.rule) return null;
    const r = Object.assign({}, S.rule);
    if(r.period === 'week') r.anchor = r.anchor || S.date || STATE.today;
    return r;
  }
  /* 달력의 한 날을 눌렀다 */
  function pickDay(k){
    if(S.freq && S.freq[0] !== 'day') return ruleDay(k);
    if(S.freq) setFreq(null);
    if(S.span){
      if(S.pending && S.date) return setRange(S.date, k);
      Object.assign(S, {mode:'range', date:k, end:null, pending:true, rule:null, freq:null});
      return;
    }
    setOne(k);
    toTime();
  }
  /* 하루를 골랐고 시각이 비어 있으면 도구를 시각 쪽으로 좁힌다 */
  function toTime(){ if(S.mode === 'one' && !S.time) S.pane = 'time'; }

  /* ---------- 날짜 줄에 친 글 ---------- */
  function readWhen(t){
    const s = t.trim();
    if(!s) return {none:true, spans:[]};
    if(/^(날짜\s*없음|없음|메모|언젠가|나중에|기한\s*없음)$/.test(s)) return {none:true, spans:[[0, t.length]]};
    const opt = {today:STATE.today, isBiz:bizOn() ? isBiz : null};
    const rr = whenRule(t);
    let rest = t, spans = [];
    if(rr){ rest = t.slice(0, rr.span[0]) + ' '.repeat(rr.span[1] - rr.span[0]) + t.slice(rr.span[1]); spans.push(rr.span); }
    const p = whenParse(rest, opt);
    const out = {};
    if(p){ spans = spans.concat(p.spans); if(p.time) out.time = p.time; }
    if(rr){
      const base = (p && p.date) || S.date || STATE.today, d = dObj(base);
      let r = rr.rule;
      if(!r && rr.need === 'day') r = {period:'month', basis:'day', n:d.getDate()};
      if(r.period === 'week' && rr.need === 'wd') r = Object.assign({}, r, {weekdays:[(d.getDay() + 6) % 7]});
      if(r.period === 'month'){
        if(rr.every === 2){ const m0 = d.getMonth(); r = Object.assign({}, r, {months:[0, 2, 4, 6, 8, 10].map(i => (m0 + i) % 12 + 1).sort((a, b) => a - b)}); }
        if(rr.year) r = Object.assign({}, r, {months:[d.getMonth() + 1]});
      }
      if(r.period !== 'day') r = Object.assign({holiday_shift:'prev'}, r);
      out.rule = r; out.base = base;
    } else if(p && p.date){ if(p.start){ out.date = p.start; out.end = p.date; } else out.date = p.date; }
    else if(!p || !p.time) return null;
    out.spans = spans;
    return out;
  }
  function applyParsed(p){
    if(p.none){ clearWhen(); return; }
    if(p.rule){
      Object.assign(S, {mode:'rule', rule:p.rule, freq:unitOf(p.rule), ruleText:'', keep:null, items:null, end:null, pending:false, span:false});
      if(!S.date) S.date = p.base;
      loadOcc(true);
    }
    else if(p.end){ setRange(p.date, p.end); showMonth(p.date); }
    else if(p.date){ setOne(p.date); S.span = false; showMonth(p.date); }
    else if(!has()) return;                    /* 시각만 쳤는데 날짜가 없으면 시각도 둘 데가 없다 */
    if(p.time) S.time = p.time;
  }
  const sayParsed = p => {
    if(p.none) return '날짜 없이 메모로';
    const b = [];
    if(p.rule) b.push('반복');
    else if(p.end) b.push(mdw(p.date) + ' – ' + mdw(p.end));
    else if(p.date) b.push(mdw(p.date) + ' · ' + relW(p.date));
    if(p.time) b.push(tmText(p.time));
    return b.join(' · ');
  };

  /* ---------- 그리기: 줄 ---------- */
  function dateText(){
    if(S.mode === 'none') return '';
    if(S.mode === 'rule') return S.date ? '처음 ' + mdw(S.date) : '';
    if(S.mode === 'range'){
      if(!S.end) return mdw(S.date) + ' – ';
      return mdw(S.date) + ' – ' + (dObj(S.date).getMonth() === dObj(S.end).getMonth() ? dOnlyW(S.end) : mdw(S.end));
    }
    return mdw(S.date);
  }
  function dateTail(){
    if(!has() || !S.date) return '';
    let t;
    if(S.mode === 'range' && S.end){
      const n = dayDiff(S.date, S.end) + 1;
      let b = 0; for(let k = S.date; k <= S.end; k = addDay(k, 1)) if(isBiz(k)) b++;
      t = n + '일' + (bizOn() && b !== n ? ' · 영업일 ' + b : '');
    } else if(S.mode === 'range') t = '–';
    else t = relW(S.date);
    return '<span>' + t + '</span><span class="clr" role="button" data-clr="date" aria-label="날짜 지우기">' + XI + '</span>';
  }
  function alertText(){
    if(!has()) return '';
    if(S.muted) return '끔';
    const daily = S.rule && S.rule.period === 'day';
    const p = [S.time ? (S.lead != null ? S.lead : defLead()) ? leadLabel(S.lead != null ? S.lead : defLead()) + ' 전' : '정각에' : '아침 브리핑에서'];
    if(S.early && !daily) p.push(EARLY_W[S.early] ? EARLY_W[S.early] + ' 전에도' : S.early + '일 전에도');
    return p.join(' · ');
  }
  function drawProps(){
    if(typing == null){ when.value = dateText(); Q('.hl').innerHTML = ''; }
    Q('[data-t=date]').innerHTML = typing == null ? dateTail() : '';
    const lock = !has();
    if(document.activeElement !== tin) tin.value = S.time ? tmText(S.time) : '';
    tin.placeholder = '없음';
    tin.disabled = lock;
    Q('[data-t=time]').innerHTML = S.time ? '<span class="clr" role="button" data-clr="time" aria-label="시각 지우기">' + XI + '</span>' : '';
    const fq = S.freq && FREQ.find(f => f[0] === S.freq[0] && f[1] === S.freq[1]);
    const rv = S.rule ? (S.ruleText || '…') : fq ? fq[2] : '';
    const pv = (k, v, ph) => { const el = Q('[data-v=' + k + ']'); el.textContent = v || ph; el.classList.toggle('ph', !v); };
    pv('rule', rv, '안 함');
    const sw = sugWeek();
    Q('[data-t=rule]').innerHTML = S.freq ? '<span class="clr" role="button" data-clr="rule" aria-label="반복 끄기">' + XI + '</span>' :
      sw ? '<span class="tl" role="button" data-sugw>매주 ' + sw + '</span>' : '';
    Q('[data-p=time]').classList.toggle('gs', !!S.tGuess && S.time === S.tGuess);
    pv('alert', alertText(), lock ? '없음' : '');
    Q('[data-p=time]').classList.toggle('lock', lock);
    Q('[data-p=alert]').classList.toggle('lock', lock);
    Q('[data-p=alert]').setAttribute('aria-disabled', lock ? 'true' : 'false');
    pv('imp', S.imp ? '중요 · 목록에 음영' : '', '보통');
    Q('[data-p=imp]').classList.toggle('is', S.imp);
    Q('[data-p=imp]').setAttribute('aria-pressed', S.imp ? 'true' : 'false');
    body.querySelectorAll('.cp-p').forEach(p => p.classList.toggle('on', p.dataset.p === S.pane));
    /* 설명: 쓸 때만 칸이 열린다 */
    const w = Q('.cp-note');
    if(S.noteOpen || I.note){
      if(!w.querySelector('textarea')){
        w.innerHTML = '<textarea class="cp-memo" id="' + pre + '-note" rows="2" aria-label="설명"></textarea>';
        w.querySelector('textarea').value = I.note || '';
      }
    } else if(!w.querySelector('button')) w.innerHTML = '<button type="button" class="cp-p" data-p="note"><span class="pl">설명</span><span class="pv ph">없음</span><span class="tr"></span></button>';
  }
  function drawSay(){
    const el = Q('.cp-say');
    if(typing != null && typing.trim()){
      el.innerHTML = parsed ? '<span class="k">' + esc(sayParsed(parsed)) + '</span>' : '';
      Q('.wbox').classList.toggle('bad', !parsed);
      return;
    }
    if(bizOn() && S.mode === 'one' && !isBiz(S.date)){
      /* 쉬는 날을 골랐으면 앞뒤 영업일을 내민다. 그대로 둬도 된다 */
      const a = rollBiz(S.date, -1), b = rollBiz(S.date, 1);
      el.innerHTML = '<span class="warn">' + esc(offName(S.date)) + '</span>' +
        (a >= STATE.today ? '<button type="button" class="tl" data-go="' + a + '">' + dOnlyW(a) + '</button>' : '') +
        '<button type="button" class="tl" data-go="' + b + '">' + dOnlyW(b) + '</button>';
      return;
    }
    el.innerHTML = '';
    Q('.wbox').classList.remove('bad');
  }

  /* ---------- 그리기: 판 ---------- */
  function drawPane(){
    const P = S.pane, grp = P === 'time' ? 'dial' : P === 'alert' ? 'alert' : P === 'rule' ? 'rule' : 'cal';
    /* 반복 판에는 달력이 없다 - 처음 돌 날은 날짜 줄의 달력에서 고른다 (거기에 앞으로 돌 날도 찍힌다).
       날이 아직 없을 때만 여기서도 달력을 띄워 하나 누르게 한다 (빈도와 날은 어느 쪽을 먼저 골라도 된다).
       그래서 어느 판이든 기본 창 높이(960×592) 안에 든다 */
    const showCal = grp === 'cal' || (grp === 'rule' && !S.date && !(S.freq && S.freq[0] === 'day'));
    if(lastGroup && lastGroup !== grp){ pane.classList.remove('swap'); void pane.offsetWidth; pane.classList.add('swap'); }
    /* 반복 판은 대개 머리줄이 없다 - 고른 줄(반복)이 곧 제목이고, 끄는 것은 그 줄의 × 다. 그만큼 달력이 창 안에 든다.
       달력을 함께 띄울 때만 머리줄에 안내를 올린다 (빈도 | 달력 두 칸이라 안내 문단을 둘 자리가 없다) */
    lastGroup = grp;
    pane.dataset.p = P;
    let head = '', x = '';
    if(P === 'date'){
      if(S.mode === 'rule'){
        head = '';
        /* 달력 왼쪽 칸: 앞으로 돌 날 다섯 (날짜 판의 빠른 날 자리). 읽기만 하는 줄 - 처음 날은 달력에서 고른다 */
        const ks = [...new Set([S.date].concat([...S.occ].sort()).filter(Boolean))].filter(k => !S.date || k >= S.date).slice(0, 5);
        const nx = ks.filter(k => k !== S.date).slice(0, 4);
        if(nx.length) x = '<div class="nexts"><span>다음</span><b>' + nx.map(md).join(' · ') + '</b></div>';
      } else {
        head = '<div class="seg" role="group" aria-label="하루 또는 여러 날">' +
          '<button type="button" data-span="0"' + (!S.span ? ' class="on"' : '') + '>하루</button>' +
          '<button type="button" data-span="1"' + (S.span ? ' class="on"' : '') + '>여러 날</button></div>';
        /* 빠른 날: 자주 고르는 날 다섯. 달력을 읽고 누르는 것보다 이름 하나를 누르는 편이 빠르다 */
        if(!S.span) x = '<div class="qd">' + quickDays().map(([k, l, sub]) => '<button type="button" data-go="' + k + '"' +
          (S.mode === 'one' && S.date === k ? ' class="on"' : '') + '>' + l + '<small>' + sub + '</small></button>').join('') + '</div>';
      }
    } else if(P === 'rule'){
      x = '<div class="freq" role="group" aria-label="얼마나 자주">' + FREQ.map(([u, e, l]) => '<button type="button" data-fu="' + u + '" data-fe="' + e + '"' +
        (S.freq && S.freq[0] === u && S.freq[1] === e ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div>';
      if(S.freq){
        const [u, e] = S.freq;
        if(u === 'day') x += '<div class="cp-opt">' + [[false, '날마다'], [true, '영업일만']].map(([v, l]) =>
          '<button type="button" data-biz="' + v + '"' + (S.rule && !!S.rule.business_only === v ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div>';
        else if(!S.date){}
        else if(u === 'week') x += '<div class="cp-opt wds">' + WD.map((w, i) => '<button type="button" data-w="' + i + '"' +
          (S.rule && S.rule.weekdays.includes(i) ? ' class="on"' : '') + '>' + w + '</button>').join('') + '</div>';
        else {
          const list = (S.items || []).slice();
          /* 고치기로 연 규칙이 제안에 없으면(예전 분기 규칙 등) 맨 위에 그대로 남긴다 */
          if(S.keep && !list.some(it => it.text === S.keep.text)) list.unshift(S.keep);
          x += !S.items && !S.keep ? '<p class="hint">찾는 중…</p>' : '<div class="rcards">' + list.map((it, k) =>
            '<button type="button" class="rcard' + (it.text === S.ruleText ? ' on' : '') + '" data-r="' + k + '"><b>' + esc(it.text) + '</b>' +
            '<span>' + esc((it.dates || []).slice(1, 3).join(' · ')) + '</span></button>').join('') + '</div>';
          Q('.px')._list = list;
        }
        if(S.rule && S.rule.period !== 'day' && !countsBizDays(S.rule))
          x += '<p class="hint">쉬는 날에 걸리면 <select data-sh aria-label="쉬는 날에 걸리면">' + SHIFTS.map(([v, l]) =>
            '<option value="' + v + '"' + ((S.rule.holiday_shift || 'prev') === v ? ' selected' : '') + '>' + l + '</option>').join('') + '</select></p>';
        /* 앞으로 돌 날: 고른 규칙이 맞는지 여기서 본다. 처음 날을 바꾸려면 날짜 줄의 달력으로 */
        if(S.rule && S.occ.size) x += '<div class="nexts"><span>다음</span><b>' + [...S.occ].sort().slice(0, 4).map(md).join(' · ') + '</b>' +
          (u !== 'day' ? '<button type="button" class="tl" data-goto="date">처음 날 바꾸기</button>' : '') + '</div>';
      }

    } else if(P === 'time'){
      const t = S.time;
      head = '' +
        '<div class="seg" role="group" aria-label="오전 오후"><button type="button" data-ap="0"' + (t && mins(t) < 720 ? ' class="on"' : '') + '>오전</button>' +
        '<button type="button" data-ap="1"' + (t && mins(t) >= 720 ? ' class="on"' : '') + '>오후</button></div>';
    } else if(P === 'alert'){
      const daily = S.rule && S.rule.period === 'day';
      const cur = S.lead != null ? S.lead : defLead();
      const opts = LEADS.slice();
      if(!opts.some(o => o[0] === cur)) opts.push([cur, leadLabel(cur)]), opts.sort((a, b) => a[0] - b[0]);
      x = '<div class="alr"><div class="cp-opt">' +
        '<button type="button" data-mute="1"' + (S.muted ? ' class="on"' : '') + '>끔</button>' +
        (S.time ? opts.map(([v, l]) => '<button type="button" data-l="' + v + '"' + (!S.muted && cur === v ? ' class="on"' : '') + '>' + l + '</button>').join('')
                : '<button type="button" data-mute="0"' + (!S.muted ? ' class="on"' : '') + '>아침 브리핑에서</button>') + '</div></div>';
      if(!daily) x += '<div class="alr"><span>미리</span><div class="cp-opt">' + EARLY.map(([v, l]) =>
        '<button type="button" data-y="' + v + '"' + (S.early === v ? ' class="on"' : '') + (S.muted ? ' disabled' : '') + '>' + l + '</button>').join('') + '</div></div>';
    }
    Q('.cp-ph').innerHTML = head;
    Q('.cp-ph').hidden = !head;
    const px = Q('.px');
    px.innerHTML = x; px.hidden = !x;
    cal.hidden = !showCal;
    Q('.dayt').hidden = grp !== 'dial';
    Q('.dialw').hidden = grp !== 'dial';
    if(grp === 'dial') drawDial();
    if(showCal) drawCal();
    if(grp === 'dial') drawDayT();
    drawDay();
  }
  /* 그날: 고른 날에 이미 있는 일 (시각 있는 마감 · 루틴 회차, 시각 없는 마감)을 판 아래 한 줄로 - 날짜 · 시각 판에서만.
     겹치는지 보며 날과 시각을 고른다 (예전의 '같은 날 마감 2건 · …'). 손을 올리면 그날 전부 */
  function drawDay(){
    const box = Q('.cp-ctx');
    const P = S.pane;
    if(!S.date || S.mode === 'range' || (P !== 'date' && P !== 'time')){ box.hidden = true; return; }
    dayLoad(S.date);
    const loose = deadlines().filter(t => t.due_date === S.date && !t.due_time && !t.done && t.id !== I.id).map(t => ({time:'', title:t.title}));
    const all = dayList(S.date).concat(loose);
    box.hidden = false;
    box.innerHTML = !all.length ? '그날 0건' :
      '<b>그날 ' + all.length + '건</b>' + all.slice(0, 3).map(i => ' · ' + (i.time ? i.time + ' ' : '') + esc(i.title)).join('');
    box.title = all.map(i => (i.time ? i.time + ' ' : '') + i.title).join('\n');
  }
  /* 알림이 실제로 언제 뜨는지 한 문장 */
  function alertSay(){
    if(S.muted) return '이 항목은 알리지 않습니다.';
    const daily = S.rule && S.rule.period === 'day', lead = S.lead != null ? S.lead : defLead();
    const parts = [S.time ? (lead ? '마감 ' + leadLabel(lead) + ' 전' : '마감 시각') + '에 알립니다' : '시각이 없으면 아침 브리핑에서 알립니다'];
    const n = daily ? 0 : S.early;
    if(n){
      const at = S.time || STATE.settings.brief_time || '09:00';
      if(S.mode !== 'rule' && S.date){
        const due = S.mode === 'range' && S.end ? S.end : S.date;
        parts.push(mdw(addDay(due, -n)) + ' ' + tmText(at) + '에 미리 한 번 더');
      } else parts.push('회차마다 ' + (EARLY_W[n] || n + '일') + ' 전 ' + tmText(at) + '에 미리');
    }
    return parts.join(' · ') + '. 기본값은 설정에서 바꿉니다.';
  }
  /* 빠른 날 다섯: 오늘 · 내일 · 모레 · 이번 주 금(지났으면 다음 주 금) · 다음 주 월 */
  function quickDays(){
    const t = STATE.today, w = (dObj(t).getDay() + 6) % 7, md2 = k => { const d = dObj(k); return (d.getMonth() + 1) + '/' + d.getDate(); };
    const fri = addDay(t, (4 - w + 7) % 7 || 7), mon = addDay(t, 7 - w);
    const seen = new Set();
    return [[t, '오늘', wdE(t)], [addDay(t, 1), '내일', wdE(addDay(t, 1))], [addDay(t, 2), '모레', wdE(addDay(t, 2))],
            [fri, (w < 4 ? '이번 주' : '다음 주') + ' 금', md2(fri)], [mon, '다음 주 월', md2(mon)]]
      .filter(([k]) => !seen.has(k) && seen.add(k));
  }
  /* 시각 판: 그날의 시간표와 자주 쓰는 시각. 시간표는 그날 이미 있는 일(마감 · 루틴 회차)을 점으로 놓고,
     빈 곳을 누르면 30분 단위로 그 시각이 된다 - "비어 있는 때" 가 보이는 채로 고른다 */
  const dayCache = {};
  function dayLoad(k){
    if(dayCache[k] || !routinesOn()) return;
    dayCache[k] = {items:[]};
    api('/api/occurrences?kind=routine&from=' + k + '&to=' + k).then(d => {
      dayCache[k] = {items:d.items || []};
      if(S && S.date === k){ drawDay(); if(S.pane === 'time') drawDayT(); }
    }).catch(() => {});
  }
  function dayList(k){
    const defs = {};
    (STATE.routines || []).forEach(r => defs[r.id] = r);
    const out = deadlines().filter(t => t.due_date === k && t.due_time && !t.done && t.id !== I.id).map(t => ({time:t.due_time, title:t.title}));
    ((dayCache[k] || {}).items || []).forEach(o => { if(o.time && defs[o.id] && o.id !== I.id && !o.done) out.push({time:o.time, title:defs[o.id].title}); });
    return out.sort((a, b) => a.time.localeCompare(b.time));
  }
  /* 자주 쓰는 시각: 지금까지 넣은 일들의 시각 가운데 많이 쓴 n 개 (시간순) */
  function favTimes(n){
    const c = {};
    (STATE.tasks || []).forEach(t => { const v = t.due_time || t.time; if(v) c[v] = (c[v] || 0) + 1; });
    (STATE.routines || []).forEach(r => { const v = r.time || r.due_time; if(v) c[v] = (c[v] || 0) + 2; });
    const top = Object.keys(c).sort((a, b) => c[b] - c[a] || a.localeCompare(b)).slice(0, n || 8);
    return (top.length ? top : ['09:00', '10:00', '11:00', '14:00', '15:00', '17:00']).sort();
  }
  const DT0 = 8 * 60, DT1 = 20 * 60;
  /* 시각 판 아래: 자주 쓰는 시각 한 줄 (글자 단추) */
  function drawDayT(){
    Q('.dayt').innerHTML = favTimes(6).map(t => '<button type="button" class="tq' + (S.time === t ? ' on' : '') + '" data-qt="' + t + '">' + t + '</button>').join('');
  }
  /* ---------- 시계판: 판 안에 한 번 짓고, 값이 바뀌면 바늘만 옮긴다 ----------
     바깥 고리는 시, 안쪽 고리는 분 (5분). 누른 채 돌리거나 휠 (바깥 1시간 · 안쪽 5분).
     시를 처음 고를 때는 업무 시간으로 읽는다 (1~7시는 오후) - 오전 · 오후를 직접 누르기 전까지 */
  (function buildDial(){
    let f = '<circle cx="110" cy="110" r="106" class="d-face"/><circle cx="110" cy="110" r="' + (DIAL.split - 2) + '" class="d-in"/>' +
      '<line class="d-hand h" x1="110" y1="110" x2="110" y2="22"/><circle class="d-knob h" r="14" cx="110" cy="22"/>' +
      '<line class="d-hand m" x1="110" y1="110" x2="110" y2="54"/><circle class="d-knob m" r="10" cx="110" cy="54"/>';
    for(let k = 0; k < 12; k++){
      const [x, y] = dialAt(DIAL.rh, k), [mx, my] = dialAt(DIAL.rm, k);
      f += '<text class="d-hn" data-k="' + k + '" x="' + x.toFixed(1) + '" y="' + (y + 5).toFixed(1) + '">' + (k || 12) + '</text>' +
        '<text class="d-mn" data-k="' + k + '" x="' + mx.toFixed(1) + '" y="' + (my + 4).toFixed(1) + '">' + pad2(k * 5) + '</text>';
    }
    const w = Q('.dialw');
    w.innerHTML = '<svg viewBox="0 0 220 220" aria-label="시계판: 바깥은 시, 안쪽은 분">' + f + '<circle cx="110" cy="110" r="3" class="d-pin"/></svg>' +
      '';
    const svg = w.querySelector('svg');
    const hit = e => {
      const r = svg.getBoundingClientRect();
      const x = (e.clientX - r.left) / r.width * 220 - DIAL.c, y = (e.clientY - r.top) / r.height * 220 - DIAL.c;
      let a = Math.atan2(x, -y) / (2 * Math.PI); if(a < 0) a += 1;
      return {outer:Math.hypot(x, y) > DIAL.split, k:Math.round(a * 12) % 12};
    };
    const turn = (e, start) => {
      const p = hit(e), c = S.time ? mins(S.time) : null;
      if(start) ring = p.outer ? 'h' : 'm';
      if(ring === 'h') setT(((c != null && apLock ? (c >= 720 ? 12 : 0) + p.k : workHour(p.k)) * 60) + (c != null ? c % 60 : 0));
      else setT((c != null ? Math.floor(c / 60) : 9) * 60 + p.k * 5);
    };
    svg.addEventListener('pointerdown', e => { if(e.button !== 0 || !has()) return; svg.setPointerCapture(e.pointerId); turn(e, true); });
    svg.addEventListener('pointermove', e => { if(ring) turn(e, false); });
    svg.addEventListener('pointerup', () => { ring = null; });
    svg.addEventListener('pointercancel', () => { ring = null; });
    svg.addEventListener('wheel', e => {
      if(!has()) return;
      e.preventDefault();
      const up = (e.deltaY || e.deltaX) < 0 ? 1 : -1, outer = hit(e).outer, c = S.time ? mins(S.time) : null;
      setT((c == null ? 9 * 60 - (outer ? 60 : STEP) * up : c) + up * (outer ? 60 : STEP));
    }, {passive:false});
  })();
  function drawDial(){
    const c = S.time ? mins(S.time) : null, svg = Q('.dialw svg');
    svg.classList.toggle('empty', c == null);
    svg.classList.toggle('off', !has());
    const h = c == null ? 0 : Math.floor(c / 60) % 12, mi = c == null ? 0 : (c % 60) / 5;
    [['h', DIAL.rh, h], ['m', DIAL.rm, mi]].forEach(([k, r, i]) => {
      const [x, y] = dialAt(r, i);
      const hand = svg.querySelector('.d-hand.' + k), knob = svg.querySelector('.d-knob.' + k);
      hand.setAttribute('x2', x.toFixed(1)); hand.setAttribute('y2', y.toFixed(1));
      knob.setAttribute('cx', x.toFixed(1)); knob.setAttribute('cy', y.toFixed(1));
    });
    svg.querySelectorAll('.d-hn').forEach(t => t.classList.toggle('on', c != null && +t.dataset.k === h));
    svg.querySelectorAll('.d-mn').forEach(t => t.classList.toggle('on', c != null && +t.dataset.k === mi));
  }
  function drawCal(){
    const first = new Date(MC.y, MC.m, 1, 12), from = addDay(iso(first), -first.getDay());
    let rg = null;
    if(drag) rg = drag.a < drag.b ? [drag.a, drag.b] : [drag.b, drag.a];
    else if(S.mode === 'range' && S.end) rg = [S.date, S.end];
    else if(S.mode === 'range' && S.pending && hover) rg = hover < S.date ? [hover, S.date] : [S.date, hover];
    let h = '<div class="mtop"><b>' + MC.y + '년 ' + (MC.m + 1) + '월</b>' +
      '<button type="button" data-mc="-1" aria-label="이전 달"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
      '<button type="button" data-mc="1" aria-label="다음 달"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>' +
      '<div class="grid">' + '일월화수목금토'.split('').map((w, i) => '<i' + (i === 0 ? ' class="sun"' : '') + '>' + w + '</i>').join('');
    /* 이 달이 걸친 주만 (5주인 달에 다음 달 한 주를 더 그리지 않는다 - 창 높이 안에 달력이 다 든다) */
    const cells = Math.ceil((first.getDay() + new Date(MC.y, MC.m + 1, 0).getDate()) / 7) * 7;
    for(let i = 0, k = from; i < cells; i++, k = addDay(k, 1)){
      const d = dObj(k), c = [];
      if(d.getMonth() !== MC.m) c.push('out');
      if(HOL.has(k) || d.getDay() === 0) c.push('sun');
      if(k === STATE.today) c.push('now');
      if(rg && rg[0] !== rg[1] && k >= rg[0] && k <= rg[1]) c.push(k === rg[0] ? 'rs on' : k === rg[1] ? 're on' : 'ri');
      else if(S.mode === 'rule'){ if(k === S.date) c.push('on'); else if(S.occ.has(k)) c.push('oc'); }
      else if(S.mode !== 'none' && k === S.date) c.push('on');
      h += '<span data-d="' + k + '"' + (c.length ? ' class="' + c.join(' ') + '"' : '') +
        ((STATE.holiday_names || {})[k] ? ' title="' + esc(STATE.holiday_names[k]) + '"' : '') + '>' + d.getDate() + '</span>';
    }
    cal.innerHTML = h + '</div>';
  }

  function draw(){
    if(!S) return;
    win.querySelector('.f-kind').textContent = I.id ? kindWord() + ' 고치기' : '새 ' + kindWord();
    const sv = win.querySelector('.f-save');
    sv.textContent = I.id ? '저장' : kindWord() + ' 추가';
    drawProps(); drawSay(); drawPane(); paintName();
    win.querySelector('.rcpt').textContent = '';
    if(self.onDraw) self.onDraw();
  }
  function setPane(p){
    if(p === S.pane) return;
    S.pane = p;
    if((p === 'date' || p === 'rule') && S.date) showMonth(S.date);
    draw();
  }
  self.setPane = setPane;

  /* ---------- 날짜 줄 ---------- */
  when.addEventListener('focus', () => { fixName(); setPane('date'); setTimeout(() => { if(typing == null) when.select(); }, 0); });
  when.addEventListener('input', () => {
    if(typing == null) snap = JSON.stringify(Object.assign({}, S, {occ:[...S.occ]}));
    typing = when.value;
    parsed = readWhen(typing);
    if(parsed && !parsed.none) applyParsed(parsed);
    let h = '', at = 0;
    if(parsed) parsed.spans.slice().sort((a, b) => a[0] - b[0]).forEach(([a, b]) => {
      if(a < at) return; h += esc(typing.slice(at, a)) + '<mark>' + esc(typing.slice(a, b)) + '</mark>'; at = b; });
    Q('.hl').innerHTML = parsed ? h + esc(typing.slice(at)) : '';
    draw();
  });
  when.addEventListener('scroll', () => { Q('.hl').scrollLeft = when.scrollLeft; });
  const unsnap = () => { const o = JSON.parse(snap); o.occ = new Set(o.occ); return o; };
  /* 칸을 떠날 때: 비웠으면 날짜 없음 (메모), 못 알아들었으면 원래대로 */
  function commitWhen(){
    if(typing == null) return;
    if(parsed && parsed.none) clearWhen();
    else if(!parsed && snap) S = Object.assign(unsnap(), {pane:S.pane});
    typing = null; parsed = null; draw();
  }
  when.addEventListener('blur', commitWhen);
  when.addEventListener('keydown', e => {
    if(e.key === 'Escape' && typing != null){
      e.preventDefault(); e.stopPropagation();
      S = unsnap(); typing = null; parsed = null; showMonth(S.date); draw(); when.select(); return;
    }
    if((e.key === 'ArrowUp' || e.key === 'ArrowDown') && typing == null){
      e.preventDefault();
      const n = (e.key === 'ArrowUp' ? -1 : 1) * (e.shiftKey ? 7 : 1);
      if(!has()) setOne(STATE.today);
      else if(S.mode === 'range' && S.end){ S.date = addDay(S.date, n); S.end = addDay(S.end, n); }
      else if(S.mode === 'rule' && S.freq && S.freq[0] !== 'day') ruleDay(addDay(S.date, n));
      else if(S.mode !== 'rule') setOne(addDay(S.date, n));
      showMonth(S.date); draw(); when.select(); return;
    }
    if(e.key === 'Enter'){
      const bad = typing != null && !parsed;
      commitWhen();
      if(bad) e.preventDefault();           /* 못 알아들은 글로 저장하지 않는다. 아니면 창의 Enter (저장) 로 */
    }
  }, true);

  /* ---------- 시각 줄: 쳐도 되고 (930 · 21 · 930p), ↑↓ 로 5분씩, 판에서 골라도 된다 ---------- */
  tin.addEventListener('focus', () => { fixName(); setPane('time'); setTimeout(() => tin.select(), 0); });
  const tinCommit = () => {
    const v = parseTime(tin.value);
    if(v === null){ if(tin.value.trim()) say('시각을 알아볼 수 없습니다 (예: 930 · 21 · 930p)'); }
    else S.time = v;
    tin.value = S.time ? tmText(S.time) : '';
    draw();
  };
  tin.addEventListener('change', tinCommit);
  tin.addEventListener('keydown', e => {
    if(STEPS[e.key]){ e.preventDefault(); const c = S.time ? mins(S.time) : 9 * 60; setT(c + (e.shiftKey ? Math.sign(STEPS[e.key]) * 60 : STEPS[e.key])); tin.select(); }
    else if(e.key === 'Enter') tinCommit();
  });
  function setT(m){ m = ((Math.round(m / STEP) * STEP) % 1440 + 1440) % 1440; S.time = hhmm(m); tin.value = tmText(S.time); draw(); }

  /* ---------- 이름 = 문장 ----------
     이름 안에 적은 날짜 · 시각 · 반복("수요일 3시 매주")을 치는 대로 읽어 값 줄에 채운다. 읽은 말은 이름 칸에서
     옅게 칠해 보이고, 저장할 때 이름에서 빠진다. 잘못 읽었으면 "그대로 두기" 로 되돌린다 (그 말이 이름에 남아 있는
     동안은 다시 읽지 않는다 - 지우거나 이름을 통째로 바꾸면 다시 읽는다). 칠 때마다 읽기 전의 값으로 돌아간 뒤 새로 읽는다 - 치는 도중의 반쪽 낱말("수")이 남지 않게.
     값 줄 · 도구를 손으로 만지면 그때의 값이 굳는다. 비슷한 말로 짐작한 것(오타 고침)은 이름에서는 읽지 않는다.
     (예전에는 "옮길까요?" 를 묻고 눌러야 옮겼다) */
  let tBase = null, tSpans = [], tKeep = null;       /* tKeep: 그대로 두기로 한 말들 */
  const snapS = () => ({json:JSON.stringify(Object.assign({}, S, {occ:[]})), occ:[...S.occ]});
  const restoreS = b => Object.assign(JSON.parse(b.json), {occ:new Set(b.occ)});
  function readName(){
    const t = name.value;
    if(tKeep && !tKeep.every(w => t.includes(w))) tKeep = null;
    if(tBase){ S = restoreS(tBase); tBase = null; }
    tSpans = [];
    if(!tKeep && !I.id && t.trim().length >= 2){       /* 고치기에서는 읽지 않는다 - 이미 정리된 이름이고, 날짜는 값 칸에 있다 */
      const opt = {today:STATE.today, isBiz:bizOn() ? isBiz : null};
      const guess = whenParse(t, opt);
      const p = guess && (guess.notes || []).includes('비슷한 말로 읽음') ? null : readWhen(t);
      if(p && !p.none && p.spans.length && (p.date || p.rule || (p.time && has()))){
        tBase = snapS();
        applyParsed(p);
        tSpans = p.spans;
        toTime();
      }
    }
    guessTime();
    draw();
  }
  /* 지난번 시각: 같은 이름을 시각과 함께 넣은 적이 있으면 그 시각을 미리 (청록 = 앱이 채운 값). 손으로 바꾸면 그 값이 이긴다 */
  function guessTime(){
    if(I.id) return;
    if(S.tGuess && S.time === S.tGuess) S.time = '';
    S.tGuess = null;
    if(S.time || S.mode !== 'one' || !has()) return;
    const n = cleanName().toLowerCase();
    if(n.length < 2) return;
    const t = (STATE.tasks || []).filter(x => x.due_time && (x.title || '').trim().toLowerCase() === n)
      .sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''))[0];
    if(t){ S.time = t.due_time; S.tGuess = t.due_time; }
  }
  /* 되풀이: 같은 이름을 같은 요일에 다섯 주 안에 두 번 넣었으면 반복 줄 끝에 '매주 X' (누르면 그 규칙) */
  function sugWeek(){
    if(I.id || S.mode !== 'one' || !S.date || S.freq) return null;
    const n = cleanName().toLowerCase();
    if(n.length < 2) return null;
    const wd = dObj(S.date).getDay();
    const days = new Set((STATE.tasks || []).filter(x => x.due_date && (x.title || '').trim().toLowerCase() === n && x.due_date < S.date &&
      dayDiff(x.due_date, S.date) <= 35 && dObj(x.due_date).getDay() === wd).map(x => x.due_date));
    return days.size >= 2 ? WD[(wd + 6) % 7] : null;
  }
  const fixName = () => { tBase = null; };
  function paintName(){
    const t = name.value;
    let h = '', at = 0;
    tSpans.slice().sort((a, b) => a[0] - b[0]).forEach(([a, b]) => { if(a < at) return; h += esc(t.slice(at, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>'; at = b; });
    Q('.nbox .hl').innerHTML = tSpans.length ? h + esc(t.slice(at)) : '';
    const mv = Q('.cp-move');
    mv.hidden = !tSpans.length;
    if(tSpans.length) mv.innerHTML = '<button type="button" class="tl" data-keep>이름에 두기</button>';
  }
  /* 저장할 이름: 읽은 말을 뺀 것 (다 빼면 빈 이름이 되면 그대로) */
  function cleanName(){
    let t = name.value;
    tSpans.slice().sort((a, b) => b[0] - a[0]).forEach(([a, b]) => { t = t.slice(0, a) + ' ' + t.slice(b); });
    t = t.replace(/\s+/g, ' ').trim();
    return t || name.value.trim();
  }
  name.addEventListener('input', readName);
  name.addEventListener('scroll', () => { Q('.nbox .hl').scrollLeft = name.scrollLeft; });

  /* ---------- 누르기 ---------- */
  body.addEventListener('click', e => {
    if(e.target.closest('[data-sugw]')){ e.stopPropagation(); setFreq(['week', 1]); draw(); return; }
    const clr = e.target.closest('[data-clr]');
    if(clr){
      const c = clr.dataset.clr;
      if(c === 'date') clearWhen(); else if(c === 'time') S.time = ''; else if(c === 'rule') setFreq(null);
      draw(); return;
    }
    const b = e.target.closest('button');
    if(!b) return;
    const ds = b.dataset;
    if(ds.keep != null){
      if(tBase) S = restoreS(tBase);
      tKeep = tSpans.map(([a, b]) => name.value.slice(a, b));
      tBase = null; tSpans = []; draw(); name.focus(); return;
    }
    fixName();
    if(ds.goto){ setPane(ds.goto); return; }
    if(ds.p){
      if(ds.p === 'imp'){ S.imp = !S.imp; draw(); return; }
      if(ds.p === 'note'){ S.noteOpen = true; draw(); Q('.cp-memo').focus(); return; }
      if(b.classList.contains('lock')){ when.focus(); return; }
      setPane(ds.p); return;
    }
    if(ds.span != null){
      S.span = ds.span === '1';
      if(!S.span && S.mode === 'range') setOne(S.date);
      else if(S.span && S.mode === 'one'){ S.mode = 'range'; S.pending = true; }
    }
    else if(ds.go){ setOne(ds.go); S.span = false; showMonth(ds.go); toTime(); }
    else if(ds.qt){ S.time = ds.qt; }
    else if(ds.f === 'off') setFreq(null);
    else if(ds.fu){ setFreq([ds.fu, +ds.fe]); if(S.date) showMonth(S.date); }
    else if(ds.biz != null){ S.rule = {period:'day', business_only:ds.biz === 'true'}; S.ruleText = ''; loadOcc(true); }
    else if(ds.r != null){ const it = Q('.px')._list[+ds.r]; if(it.keep) return; S.rule = it.rule; S.ruleText = it.text; S.keep = null; loadOcc(false); }
    else if(ds.w != null){
      const i = +ds.w, w = S.rule.weekdays;
      S.rule = Object.assign({}, S.rule, {weekdays:(w.includes(i) ? (w.length > 1 ? w.filter(x => x !== i) : w) : w.concat(i)).sort((a, b) => a - b)});
      S.ruleText = ''; loadOcc(false);
    }
    else if(ds.l != null){ S.lead = +ds.l; S.muted = false; }
    else if(ds.mute != null) S.muted = ds.mute === '1';
    else if(ds.y != null) S.early = +ds.y;
    else if(ds.ap != null){ apLock = true; const c = S.time ? mins(S.time) : 9 * 60; setT((c % 720) + (+ds.ap) * 720); return; }
    else if(ds.mc){ const t = new Date(MC.y, MC.m + +ds.mc, 1); MC.y = t.getFullYear(); MC.m = t.getMonth(); drawCal(); return; }
    else return;
    draw();
  });
  body.addEventListener('change', e => {
    if(!e.target.matches('[data-sh]')) return;
    S.rule = Object.assign({}, S.rule, {holiday_shift:e.target.value});
    S.ruleText = ''; loadOcc(false);
  });
  /* 날짜 줄의 빈 곳을 눌러도 칸으로 */
  body.addEventListener('pointerdown', e => {
    const p = e.target.closest('.cp-p.when');
    if(p && e.target !== when && !e.target.closest('[data-clr]')){ e.preventDefault(); when.focus(); }
    const t = e.target.closest('.cp-p[data-p=time]');
    if(t && e.target !== tin && !e.target.closest('[data-clr]') && !tin.disabled){ e.preventDefault(); tin.focus(); }
  });
  /* Tab 으로 줄을 옮기면 판도 따라간다 */
  Q('.cp-props').addEventListener('focusin', e => {
    const p = e.target.closest('.cp-p');
    if(p && p.dataset.p && p.dataset.p !== 'note' && p.dataset.p !== 'imp' && !p.classList.contains('lock')) setPane(p.dataset.p);
  });

  /* ---------- 달력: 누르기 · 끌기 (기간) · 휠 (달 넘기기) ---------- */
  cal.addEventListener('pointerdown', e => {
    const c = e.target.closest('[data-d]');
    if(!c || e.button !== 0) return;
    e.preventDefault();
    fixName();
    drag = {a:c.dataset.d, b:c.dataset.d};
    cal.setPointerCapture(e.pointerId);
  });
  cal.addEventListener('pointermove', e => {
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const k = el && el.closest && el.closest('[data-d]');
    if(drag){ if(k && cal.contains(k) && k.dataset.d !== drag.b && !S.freq){ drag.b = k.dataset.d; drawCal(); } return; }
    const hv = k && cal.contains(k) ? k.dataset.d : null;
    if(S.pending && hv !== hover){ hover = hv; drawCal(); }
  });
  cal.addEventListener('pointerleave', () => { if(hover){ hover = null; drawCal(); } });
  cal.addEventListener('pointerup', () => {
    if(!drag) return;
    const {a, b} = drag; drag = null; hover = null;
    if(a !== b) setRange(a, b); else pickDay(a);
    if(document.activeElement === when) when.blur();
    draw();
  });
  cal.addEventListener('pointercancel', () => { drag = null; drawCal(); });
  Q('.dayt').addEventListener('click', e => {
    const dt = e.target.closest('.dt');
    if(!dt || e.target.closest('button')) return;
    const r = dt.getBoundingClientRect(), lo = +dt.dataset.lo, hi = +dt.dataset.hi;
    const m = lo + Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * (hi - lo);
    fixName(); S.time = hhmm(Math.round(m / 30) * 30 % 1440); draw();
  });
  cal.addEventListener('wheel', e => {
    if(!e.deltaY) return;
    e.preventDefault();
    const t = new Date(MC.y, MC.m + (e.deltaY > 0 ? 1 : -1), 1); MC.y = t.getFullYear(); MC.m = t.getMonth(); drawCal();
  }, {passive:false});

  /* ---------- 열기 · 읽기 ---------- */
  /* item: 고칠 항목 (asItem 모양) 또는 새 항목의 씨앗 {date, kind} */
  self.render = function(item){
    I = item || {};
    S = blank(); typing = null; parsed = null; hover = null; drag = null; apLock = false; moveP = null;
    tBase = null; tSpans = []; tKeep = null;
    name.value = I.title || '';
    Q('.cp-move').hidden = true;
    Q('.cp-note').innerHTML = '';
    if(I.kind === 'routine' && (I.rule_n || I.rule)){
      const r = I.rule_n || I.rule;
      Object.assign(S, {mode:'rule', rule:r, freq:unitOf(r), ruleText:I.rule_text || '', date:I.next_date || I.date || STATE.today});
      S.keep = I.rule_text ? {text:I.rule_text, rule:r, dates:[], keep:true} : null;
      if(S.freq[0] === 'month' || S.freq[0] === 'year'){
        const my = ++sugSeq;
        api('/api/suggest?date=' + S.date + '&unit=' + S.freq[0] + '&every=' + S.freq[1])
          .then(res => { if(my === sugSeq){ S.items = res.items || []; draw(); } }).catch(() => {});
      }
      loadOcc(false);
    } else if(I.kind === 'routine'){
      S.pane = 'rule';
    } else if(I.date && I.kind !== 'floating'){
      if(I.start && I.start < I.date) setRange(I.start, I.date); else setOne(I.date);
    }
    if(I.id){
      S.time = I.time || ''; S.lead = I.notify_min != null ? I.notify_min : null;
      S.muted = !!I.muted; S.early = I.early_days || 0;
    }
    S.imp = !!I.pinned;
    showMonth(S.date);
    lastGroup = null;
    draw();
  };
  /* 쳐 놓고 아직 확정하지 않은 글을 넣는다 (저장 직전) */
  self.commit = function(){
    if(document.activeElement === tin) tinCommit();
    commitWhen();
  };
  self.title = () => cleanName();
  self.note = () => { const t = Q('.cp-memo'); return t ? t.value.trim() : (I.note || '').trim(); };
  self.focusName = () => name.focus();
  self.read = function(){
    const k = self.kind(), p = {kind:k, pinned:!!S.imp};
    if(k === 'floating') return Object.assign(p, {due_date:null, start_date:null, due_time:'', rule:null, notify_min:null, muted:false, early_days:0});
    Object.assign(p, {due_time:S.time || '', notify_min:S.lead, muted:S.muted,
                      early_days:S.rule && S.rule.period === 'day' ? 0 : S.early});
    if(k === 'deadline'){
      const range = S.mode === 'range' && S.end;
      p.due_date = range ? S.end : S.date;
      p.start_date = range ? S.date : null;
      p.rule = null;
    } else { p.rule = ruleOut(); p.due_date = null; p.start_date = null; }
    return p;
  };
  self.valid = function(){
    if(S.mode === 'rule' && !S.rule){ say('반복할 날을 고르세요'); setPane('rule'); return false; }
    if(S.freq && !S.rule){ say('반복할 날을 달력에서 고르세요'); setPane('rule'); return false; }
    return true;
  };
  return self;
}

/* ══════════ 새 항목 ══════════ */
const addForm = Form($('#m-add'), 'a');
/* seed: {date} - 홈 달력의 어떤 날에서 열었으면 그 날. kind 'routine' 이면 반복 판부터 */
/* now: 키를 누른 그 순간에 이름 칸으로 (그 글자 · 한글 조합이 이름 칸에 들어가게) */
function openAdd(kind, seed, now){
  if(view === 'set') setView('today');
  addForm.render(Object.assign({kind: kind === 'routine' ? 'routine' : null}, seed || {}));
  openM('#m-add');
  if(now) addForm.focusName();
  else setTimeout(() => addForm.focusName(), 90);
}
$('#a-save').onclick = () => {
  addForm.commit();
  const title = addForm.title();
  if(!title){ say('이름을 입력하세요'); return addForm.focusName(); }
  if(!addForm.valid()) return;
  change('/api/task', Object.assign({title, note:addForm.note()}, addForm.read()))
    .then(d => { closeM('#m-add'); if(d && d.id) FLASH.add(d.id); flashRows();
      undoToast('추가', title, () => d && d.id && sendDelete(d.id)); });
};

/* ══════════ 고치기 ══════════ */
const editForm = Form($('#m-edit'), 'e');
let EDIT = null;
/* 건너뛰기 · 내일로는 열 때의 항목을 따른다 (종류를 바꾸는 중이어도 지금 저장된 것에 대한 일이다) */
function openEdit(i){
  EDIT = i;
  editForm.render(i);
  $('#e-skip').hidden = i.kind !== 'routine' || !(i.date || i.next_date);
  $('#e-later').hidden = i.kind !== 'deadline' || !i.date || !!i.done;
  if(!$('#e-later').hidden) $('#e-later').textContent = i.date > STATE.today ? '하루 뒤로' : '내일로';
  openM('#m-edit');
}
$('#e-save').onclick = () => {
  editForm.commit();
  const title = editForm.title();
  if(!title){ say('이름을 입력하세요'); return editForm.focusName(); }
  if(!editForm.valid()) return;
  change('/api/task/' + encodeURIComponent(EDIT.id), Object.assign({title, note:editForm.note()}, editForm.read()))
    .then(() => { closeM('#m-edit'); FLASH.add(EDIT.id); flashRows(); say('저장했습니다 · ' + title); });
};
/* 건너뛰기 · 내일로 · 삭제는 묻지 않는다. 창을 닫고 3초 동안 되돌릴 수 있다 */
$('#e-skip').onclick = () => { closeAll(); skipOnce(EDIT); };
$('#e-later').onclick = () => { closeAll(); later(EDIT); };
$('#e-del').onclick = () => { closeAll(); removeSoon(EDIT); };

/* 확인 단추의 글자는 하는 일을 그대로 말한다. 예전에는 늘 "삭제" 라서
   "완전히 종료할까요?" 에도 삭제 단추가 떴다. */
function confirmBox(title, msg, onOk, okLabel, extra, danger){
  $('#cf-title').textContent = title;
  $('#cf-msg').textContent = msg;
  $('#cf-extra').innerHTML = extra || '';       /* 여기 들어가는 것은 우리가 적은 것뿐이다 */
  $('#cf-ok').textContent = okLabel || '삭제';
  /* 빨강은 지우는 것에만. 로그아웃 · 종료까지 빨가면 무엇이 정말 위험한지 흐려진다 */
  $('#cf-ok').classList.toggle('bad', !!danger);
  $('#cf-ok').disabled = false;
  $('#cf-ok').onclick = onOk;
  /* 되돌릴 수 없는 일은 "확인했습니다" 를 체크해야 단추가 켜진다 (extra 안의 #cf-ack) */
  const ack = $('#cf-ack');
  if(ack){ $('#cf-ok').disabled = true; ack.onchange = () => { $('#cf-ok').disabled = !ack.checked; }; }
  openM('#m-confirm');
}



/* 달력에 얹을 반복 발생.
   규칙을 펼치는 일은 서버(recur.py)가 한다. 화면에서 또 구현하면 두 곳이
   언젠가 어긋나고, 어긋난 쪽이 달력이면 없는 날에 일이 있다고 말하게 된다.
   보고 있는 달을 덮을 만큼만 물어본다.

   받는 것은 회차(id · 날짜 · 시각 · 완료)뿐이다. 제목 · 규칙은 overview 의
   반복 업무 줄에 이미 있으므로 id 로 잇는다.

   다시 물을지는 "보고 있는 달 + 일정 파일의 지문(rev)" 으로 정한다. 예전에는
   달만 봐서, 달력에서 반복 회차를 완료해도 달을 넘기기 전까지 완료 전 모습이
   남았고, 한 번 더 누르면 되돌리는 대신 또 완료를 보냈다. */
let RT = {key:null, items:[], busy:null};
const routinesOn = () => !!STATE;          /* 2026-11: 달력은 반복 회차를 늘 싣는다 (매일 도는 것만 뺀다) */
let DAY_KEY = null;                 /* 열려 있는 하루 목록의 날짜 */

/* 회차에 반복 항목의 내용을 입힌다. overview 에 아직 없는 항목(방금 추가됨)은
   다음 새로 읽기에서 들어오므로 여기서는 건너뛴다. */
function routineItems(){
  const defs = {};
  (STATE.routines || []).forEach(r => defs[r.id] = r);
  const out = [];
  RT.items.forEach(o => {
    const def = defs[o.id];
    /* next_date 도 이 회차로: 수정 창의 "이번 회차 건너뛰기" 가 누른 날짜를 건너뛴다 */
    if(def) out.push(Object.assign({}, def, {date:o.date, time:o.time, done:o.done, next_date:o.date}));
  });
  return out;
}

const byWhen = (a, b) =>
  (a.done ? 1 : 0) - (b.done ? 1 : 0) ||
  (a._rt ? 1 : 0) - (b._rt ? 1 : 0) ||
  a.due_date.localeCompare(b.due_date) ||
  (a.due_time || '99:99').localeCompare(b.due_time || '99:99');

/* 반복 발생을 달력 칩과 같은 모양으로 맞춘다 */
const asRoutine = i => Object.assign({}, i, {due_date:i.date, due_time:i.time, _rt:true});

/* 이 칸(날짜)에 들어갈 것 전부. 달력과 하루 목록이 같은 것을 보게 한다 */
function dayItems(key){
  const out = deadlines().filter(t => !isSpan(t) && cellDate(t.due_date) === key);
  if(routinesOn())
    routineItems().forEach(i => { if(cellDate(i.date) === key) out.push(asRoutine(i)); });
  return out.sort(byWhen);
}

function ensureRoutines(from, to){
  if(!routinesOn()) return;
  const key = from + '~' + to + '@' + STATE.rev;
  if(RT.key === key || RT.busy === key) return;
  RT.busy = key;
  api('/api/occurrences?kind=routine&from=' + from + '&to=' + to).then(d => {
    if(RT.busy !== key) return;               /* 그 사이 더 새 것을 물었다 */
    RT = {key:key, items:d.items || [], busy:null};
    drawCal();
    if(DAY_KEY && $('#m-day').classList.contains('on')) dayModal(DAY_KEY, dayItems(DAY_KEY));
  }).catch(() => { if(RT.busy === key) RT.busy = null; });
}
function deadlines(){
  return (STATE.tasks || []).filter(t => (t.kind || 'deadline') === 'deadline' && t.due_date);
}

/* ══════════ 기간 업무 ══════════
   시작일(start_date)이 있는 할 일. 끝나는 날이 마감일이다 - 알림 · 다가오는 마감은
   그대로 끝나는 날에 걸린다. 달력에서는 칸 안의 줄 대신 띠(월) · 세로선(7일)으로 그린다.
   이름은 띠 위에 적지 않는다: 가는 띠에 글자를 얹으면 그 칸의 다른 일이 읽히지 않는다.
   무엇인지는 마우스를 올리면 나온다 (손끝 카드). */
const isSpan = t => !!(t && t.start_date && t.due_date && t.start_date < t.due_date);
const spanList = () => (STATE.tasks || []).filter(t => (t.kind || 'deadline') === 'deadline' && isSpan(t));
const SPAN_N = 4;                     /* tokens.SPAN 의 수 (--span1 ~ --span4) */

/* 색: 시작일 차례로 놓으며, 같은 때 겹치는 앞의 기간이 쓰는 색은 피한다. 데이터만으로
   정해지므로 월 · 7일 · 오른쪽 판 · 하루 목록 어디서나 같은 기간은 같은 색이다. */
let SPAN_C = {rev:null, map:{}};
function spanColor(t){
  if(SPAN_C.rev !== STATE.rev){
    const all = spanList().slice().sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id));
    const map = {}, placed = [];
    all.forEach(s => {
      const used = new Set(placed.filter(p => p.start_date <= s.due_date && s.start_date <= p.due_date).map(p => map[p.id]));
      let c = 0;
      while(used.has(c) && c < SPAN_N - 1) c++;
      map[s.id] = c;
      placed.push(s);
    });
    SPAN_C = {rev:STATE.rev, map:map};
  }
  return 'var(--span' + ((SPAN_C.map[t.id] || 0) + 1) + ')';
}

/* 보이는 구간에서 겹치지 않게 줄(lane)을 나눈다. 시작이 이른 것부터 빈 줄 맨 앞에 */
function spanLanes(list){
  const ends = [], out = new Map();
  list.slice().sort((a, b) => a.start_date.localeCompare(b.start_date) || a.id.localeCompare(b.id))
    .forEach(s => {
      let k = ends.findIndex(e => e < s.start_date);
      if(k < 0){ k = ends.length; ends.push(''); }
      ends[k] = s.due_date;
      out.set(s.id, k);
    });
  return out;
}

const md = k => { const d = dObj(k); return (d.getMonth() + 1) + '/' + d.getDate(); };
const spanRange = s => md(s.start_date) + ' – ' + md(s.due_date);
const dayDiff = (a, b) => Math.round((dObj(b) - dObj(a)) / 864e5);
/* 끝나는 날까지: 오늘 마감 · D-3 · 지남 */
function spanLeft(s, at){
  const n = dayDiff(at || STATE.today, s.due_date);
  return s.done ? '끝냄' : n === 0 ? '오늘 마감' : n > 0 ? 'D-' + n : (-n) + '일 지남';
}
function spanHov(s){
  const days = dayDiff(s.start_date, s.due_date) + 1;
  return {title: s.title, when: spanRange(s) + ' · ' + days + '일간 · ' + spanLeft(s) +
          (s.due_time ? ' · 끝나는 날 ' + tmText(s.due_time) : ''), note: s.note || ''};
}
/* 그 날 걸쳐 있는 기간들 */
const spansOn = key => spanList().filter(s => s.start_date <= key && key <= s.due_date)
  .sort((a, b) => a.due_date.localeCompare(b.due_date));

/* 달력의 항목을 수정 창에 넘길 형태로 맞춘다 (STATE.tasks 는 저장 형식) */
function asItem(t){
  return {id:t.id, title:t.title, note:t.note || '', kind:'deadline', rule:null,
          date:t.due_date || null, start:isSpan(t) ? t.start_date : null, time:t.due_time || '',
          notify_min:t.notify_min != null ? t.notify_min : null, early_days:t.early_days || 0,
          muted:!!t.muted, pinned:!!t.pinned, rule_text:'', done:!!t.done};
}

/* 주말에 걸린 마감을 어느 칸에 놓을지.

   주말 칸이 없으므로 그냥 두면 화면에서 사라진다. 가까운 영업일 칸에 얹고
   칩에 실제 날짜를 적어 준다. 앞 영업일이 다른 달로 넘어가는 경우(1일이 일요일 등)
   에는 뒤로 미뤄서, 반드시 자기 달 안에서 보이게 한다. */
function isWeekend(d){ const w = dObj(d).getDay(); return w === 0 || w === 6; }

/* 주말 칸을 보여줄지. 켜 두면 마감이 자기 날짜에 그대로 놓이고,
   끄면 칸이 5개로 넓어지는 대신 주말 마감을 앞 영업일 칸에 얹는다. */
const weekendOn = () => !!(STATE && STATE.settings && STATE.settings.show_weekend);

function cellDate(d){
  return d;                                   /* 2026-11: 달력은 주말 칸을 늘 그린다 (좁게) - 마감은 제 날짜에 */
  if(weekendOn() || !isWeekend(d)) return d;
  const m = d.slice(0, 7);
  const back = dObj(d), fwd = dObj(d);
  while(isWeekend(iso(back))) back.setDate(back.getDate() - 1);
  if(iso(back).slice(0, 7) === m) return iso(back);
  while(isWeekend(iso(fwd))) fwd.setDate(fwd.getDate() + 1);
  return iso(fwd);
}
const addDay = (k, n) => { const d = dObj(k); d.setDate(d.getDate() + n); return iso(d); };


/* ══════════ 글자 모양 ══════════
   날짜 · 요일 · 달은 영문 세 글자(Inter)로, 숫자와 이름은 Paperlogy 로. Paperlogy 숫자는 너비가 같아 시각 열이 흔들리지 않는다. */
const WDE = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const MON = ['JAN','FEB','MAR','APR','MAY','JUN','JUL','AUG','SEP','OCT','NOV','DEC'];
const MONTH = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const wdE = k => WDE[dObj(k).getDay()];
/* WED 28 (요일 · 날) - 줄의 왼쪽 열. 날은 두 자리로 맞춰 요일 끝이 한 선에 선다 */
/* 날짜표 [날 | 요일] - 날이 먼저 (style.css 의 날짜표) */
const lblOf = k => ({a:String(dObj(k).getDate()), b:wdE(k)});
const fullE = k => { const d = dObj(k); return WDE[d.getDay()] + ' ' + d.getDate() + ' ' + MON[d.getMonth()]; };
const shortE = k => { const d = dObj(k); return d.getDate() + ' ' + MON[d.getMonth()]; };

/* ══════════ 지금 ══════════ */
const nowMin = () => SHOT_MIN != null ? SHOT_MIN : (STATE && STATE.now ? mins(STATE.now) : new Date().getHours() * 60 + new Date().getMinutes());
const isLate = i => !!(i && !i.done && !i.ghost && i.date &&
  (i.date < STATE.today || (i.date === STATE.today && i.time && mins(i.time) < nowMin())));
/* 방금 끝낸 것은 0.6초 동안 제자리에 둔다 - 동그라미가 차는 것을 본 뒤에 위로 굴러간다 */
let HOLD = null;
const doneNow = i => i.done && !(HOLD && HOLD.key === keyOf(i) && Date.now() < HOLD.until);
const keyOf = i => (i.id || '') + '@' + (i.date || '');

/* ══════════ 줄 하나 ══════════
   [왼쪽 열 48: 시각 · 날짜] 12 [동그라미 12] 12 [이름]. 왼쪽 열 · 동그라미 · 이름의 자리는 화면 어디서나 같다.
   동그라미: 빈 테 = 할 것 · 빨간 테 = 늦음 · 칠함 = 끝냄 · 점선 = 쓰는 중(아직 없는 것). 중요한 일은 이름 아래에 형광펜. */
function rowEl(i, opt){
  opt = opt || {};
  const el = document.createElement('div');
  const late = isLate(i);
  el.className = 'r' + (i.done ? ' done' : '') + (late ? ' late' : '') + (i.ghost ? ' ghost' : '') +
                 (i.pinned && !i.done ? ' imp' : '') + (opt.cls ? ' ' + opt.cls : '');
  if(i.id) el.dataset.id = i.id;
  el.dataset.k = keyOf(i);
  const lab = opt.lab || {a:'', b:''};
  el.innerHTML =
    '<span class="tm"><span>' + esc(lab.a) + '</span><span>' + esc(lab.b) + '</span></span>' +
    (opt.noDot ? '<span class="dot nd"></span>' : '<span class="dot" role="checkbox" tabindex="-1" aria-checked="' + (i.done ? 'true' : 'false') + '" aria-label="' + (i.done ? '끝냄 취소' : '끝냄') + '"></span>') +
    '<div class="nm"><div class="n1"><span class="nt">' + esc(i.title) + '</span></div>' +
    (opt.meta ? '<div class="meta">' + opt.meta + '</div>' : '') + '</div>';
  if(RISE.k && RISE.k === keyOf(i) && !/lens/.test(opt.cls || '') && !i.ghost){ el.classList.add('rise'); el.insertAdjacentHTML('beforeend', exHTML(i)); }
  el._it = i;
  if(!i.ghost && !opt.inert) wireRow(el);
  return el;
}

/* 줄에 누르기 · 두 번 누르기 · 키보드 · 끌기를 잇는다 (떠오르기는 document mouseover) */
/* 줄은 다시 그릴 때 그대로 남기도 한다 - 그때 항목(el._it)만 새것으로 바뀌므로, 누를 때마다 el._it 을 읽는다 */
function wireRow(el){
  const I = () => el._it;
  el.tabIndex = 0;
  el.oncontextmenu = e => { e.preventDefault(); roHide(); ctxOpen(e.clientX, e.clientY, I()); };
  /* 2026-11: 줄을 누르면 끝냄. 매일 하는 일은 끝내기이고 고치기는 가끔이다 - 고치기는 두 번 누르기 · Enter · 오른쪽 단추 · 떠오른 줄의 '고치기'.
     잘못 눌러도 아래 되돌리기 한 줄(Ctrl Z)로 돌아온다 */
  el.addEventListener('click', e => {
    if(DRAG_END > Date.now() - 50 || e.target.closest('.ex') || e.detail > 1) return;
    toggleDone(I(), el);
  });
  el.onkeydown = e => {
    if(e.target !== el || e.ctrlKey || e.metaKey || e.altKey || e.isComposing) return;
    if(rowKey(e, el, I())){ e.preventDefault(); e.stopPropagation(); }
  };
  /* 두 번 누르면 고치기 (어디서나 같다). 첫 번째 누름이 끝낸 것은 되돌린다 - 두 번 누른 사람은 끝내려던 것이 아니다 */
  el.addEventListener('dblclick', e => {
    if(e.target.closest('.ex, .dot, [data-la], .la')) return;
    const i = I(), t = LAST_TOG;
    if(t && t.k === keyOf(i) && Date.now() - t.at < 700){
      LAST_TOG = null; HOLD = null;
      el.classList.remove('done', 'pop', 'fold');
      $('#undo').classList.remove('on');
      t.p.then(() => setDone(i, !t.to));
    }
    startEdit(i);
  });
  el.addEventListener('pointerdown', e => dragDown(e, I(), el));
}
/* 줄에 초점이 있을 때의 키. 모두 묻지 않고 곧바로, 몇 초 동안 되돌릴 수 있다 (Ctrl Z).
   쉬는 화면에는 아무것도 더하지 않는다 - 알고 싶으면 ? */
const KEYS = [
  ['줄에서', [['↑ ↓', '줄 고르기'], ['Space', '완료 · 완료 취소'], ['Enter', '고치기'], ['→', '다음 영업일로'], ['Shift →', '내일로'],
    ['T', '오늘로'], ['S', '이번 회차 건너뛰기'], ['!', '중요 표시'], ['Del', '삭제']]],
  ['어디서나', [['Ctrl Z', '되돌리기'], ['Ctrl N', '새 항목'], ['Ctrl Alt Space', '다른 창 위에서 새 항목'], ['?', '이 표']]],
  ['아침 · 저녁 문', [['T', '오늘'], ['→', '다음 영업일'], ['Space', '끝냄'], ['Esc', '그만']]],
];
function rowKey(e, el, i){
  const k = e.key;
  if(k === 'ArrowDown' || k === 'ArrowUp'){
    const rs = $$('#v-' + view + ' .r[tabindex="0"]').filter(r => r.offsetParent && r._it && !r._it.ghost);
    const n = rs.indexOf(el) + (k === 'ArrowDown' ? 1 : -1);
    if(rs[n]){ rs[n].focus({preventScroll:!!rs[n].closest('.drum')}); if(rs[n].closest('.drum')) drumShow(rs[n]); else rs[n].scrollIntoView({block:'nearest'}); }
    return true;
  }
  if(k === 'Enter'){ startEdit(i); return true; }
  if(k === ' '){ toggleDone(i, el); return true; }
  if(k === 'Delete'){ removeSoon(i); return true; }
  if(i.done || OFFLINE) return false;
  if(k === 'ArrowRight'){ if(i.kind === 'routine' ? i.date : i.date || i.kind === 'floating') rowAct(e.shiftKey ? 'tom' : 'later', i); return true; }
  if(k === 't' || k === 'T' || k === 'ㅅ'){ if(i.kind !== 'routine' && i.date !== STATE.today) rowAct('today', i); return true; }
  if(k === 's' || k === 'S' || k === 'ㄴ'){ if(i.kind === 'routine') rowAct('skip', i); return true; }
  if(k === '!'){ rowAct('imp', i); return true; }
  return false;
}
function keysSheet(){
  $('#keys-list').innerHTML = KEYS.map(([g, ks]) => '<div class="kg"><p class="kh">' + g + '</p>' +
    ks.map(([k, l]) => '<div class="kr"><span>' + k.split(' ').map(x => '<kbd>' + esc(x) + '</kbd>').join('') + '</span><b>' + esc(l) + '</b></div>').join('') + '</div>').join('');
  openM('#m-keys');
}

let LAST_TOG = null;                       /* 방금 누른 끝냄 - 두 번 누르기(고치기)가 되돌릴 수 있게 */
function toggleDone(i, el){
  if(OFFLINE) return;
  const to = !i.done;
  if(to){
    HOLD = {key:keyOf(i), until:Date.now() + 600};
    if(el) el.classList.add('done', 'pop');          /* 서버의 답을 기다리지 않고 동그라미부터 찬다 */
    /* 시간의 자 밖의 줄(언제든 · 다가올 날 · 그날 전체)은 물결이 퍼진 뒤 접힌다. 자의 줄은 제 시각에 끝낸 채로 남는다 */
    if(el && !el.closest('.drum') && !calm()) setTimeout(() => el.classList.add('fold'), 300);
    setTimeout(repaint, 640);
  }
  LAST_TOG = {k:keyOf(i), at:Date.now(), to, p:setDone(i, to)};
}

/* ══════════ 오늘 ══════════
   다음 일이 렌즈(72) 위에 선다. 지나온 일(끝낸 것 · 늦은 것)은 위로, 남은 일은 아래로 - 모두 제 시각 순서로 맞붙어 선다.
   2026-11 (캔버스 '과감한 두 방향' R2): 한때 한 시간 = 한 줄의 시간 자로 놓았는데, 아침 일과 오후 일이 빈 줄에 갈려
   하루가 한눈에 들지 않았다. 그래서 줄은 다시 맞붙이고, 두 일 사이가 두 시간 넘게 비는 곳에만 짧은 틈(16)을 둔다 -
   '여기서 하루가 끊긴다' 만 말한다 (얼마나 비는지는 양쪽 줄의 시각이 말한다).
   지금 선은 지난 일과 남은 일 사이 - 그 사이에 틈이 있으면 틈 안의 제 자리(분 비례)에 서고, 아니면 렌즈의 윗변이다.
   지난 날에 남은 일은 맨 위에 날짜를 달고. 아침 · 저녁 문과 대신 말(언제든 n 남음)은 지금 선 자리에 렌즈로 선다.
   휠 한 칸에 한 줄, 3초 손을 놓으면 처음 자리로 돌아온다. */
/* 줄 36 · 렌즈 72 (줄 둘). 모두 36 격자 - 오른쪽 카드의 줄과 같은 선에 선다 (CSS 의 --rh) */
const RH = 36, WH = 72;
let OFFT = 0, _wAcc = 0, _wBack = 0, DRUM_ROWS = {min:0, max:0};

/* 오늘의 모형: 지나온 것 · 렌즈 · 남은 것 · 시각 없는 것 */
function todayModel(o, gh){
  const tod = o.todays.filter(i => !FLD.edit || FLD.edit.id !== i.id || FLD.edit.date !== i.date);
  const over = o.overdue.filter(i => !FLD.edit || FLD.edit.id !== i.id || FLD.edit.date !== i.date);
  const nowM = nowMin(), byT = (a, b) => (a.time || '99:99').localeCompare(b.time || '99:99');
  const ghT = gh && gh.date === o.today ? gh : null;
  const pastDone = tod.filter(i => i.time && doneNow(i)).sort(byT);
  const pastLate = over.slice().sort((a, b) => a.date.localeCompare(b.date) || byT(a, b))
    .concat(tod.filter(i => i.time && !doneNow(i) && mins(i.time) < nowM).sort(byT));
  if(ghT && ghT.time && mins(ghT.time) < nowM) pastLate.push(ghT);
  const fut = tod.filter(i => i.time && !doneNow(i) && mins(i.time) >= nowM)
    .concat(ghT && ghT.time && mins(ghT.time) >= nowM ? [ghT] : []).sort(byT);
  const unt = tod.filter(i => !i.time).concat(ghT && !ghT.time ? [ghT] : []);
  let lens = fut[0] || null, alt = null;
  if(!lens){
    /* 2.10: 예전에는 다가올 날의 첫 일을 '다음 일' 로 올렸는데, 다가올 날에는 매일 도는 루틴이 없어 내일 아침의 루틴을 건너뛰고
       며칠 뒤의 마감을 '다음' 이라 했다. 렌즈는 오늘에 머물고, 다음 일은 다가올 날 판에서 렌즈의 메아리(.nx)로 보인다 */
    const none = !o.todays.length && !o.overdue.length && !(o.upcoming || []).length && !(o.floating || []).length && !(o.routines || []).length;
    const left = unt.filter(i => !i.ghost && !doneNow(i)).length + (o.floating || []).length;   /* 언제든 판 머리의 '남은 n' 과 같은 수 */
    alt = {id:'', title:none ? '적어 둔 일 없음' : left ? '언제든 ' + left + ' 남음' : '오늘 남은 일 없음', _alt:true, _inert:true, _none:none};
  }
  const past = pastDone.concat(pastLate), tc = triCur();
  if(tc){ const k = keyOf(tc.i); return {past:past.filter(x => keyOf(x) !== k), fut, unt, lens:Object.assign({}, tc.i, {_tri:TRI.mode}), alt:true}; }
  if(eveDue()){
    /* 걸릴 시간은 배운 값이 하나라도 있을 때만 (모두 30분으로 친 합은 지어낸 수다) */
    const pool = pmPool(), est = pool.some(durOf) ? pool.reduce((n, x) => n + (durOf(x) || 30), 0) : 0;
    return {past, fut, unt, lens:{id:'', title:'남은 ' + pool.length, _eve:true, _alt:true, _inert:true, _est:est}, alt:true};
  }
  return {past, fut, unt, lens:lens || alt, alt:!!alt};
}

/* ══════════ 아침 문 · 저녁 문 ══════════
   렌즈가 한 번에 하나씩 묻는다 (한 번에 하나의 결정 - '모두' 단추는 생각 없이 누르게 한다).
   아침: 지난 날에 남은 일. 그날 처음 창을 열 때, 또는 '늦음 n' 을 누르면. 오늘 · 다음 영업일 · 끝냄 (T · → · Space).
   저녁: 하루 끝이 지나고 시각 있는 일이 다 지나면, 오늘 남은 일을 다음 영업일로 한 번에 넘길지 (하나씩도). 하루 한 번 */
let TRI = null;                                  /* {mode:'am'|'pm', ks:[keyOf], n} */
let LENS_OPEN = null;                            /* 미루기를 펼친 렌즈 일의 keyOf */
const lsGet = k => { try{ return localStorage.getItem(k); }catch(e){ return null; } };
const lsSet = (k, v) => { try{ localStorage.setItem(k, v); }catch(e){} };
const amPool = () => (STATE.overdue || []).filter(i => !i.done);
function pmPool(){
  const nm = nowMin();
  return (STATE.todays || []).filter(i => i.kind !== 'routine' && !doneNow(i) && (!i.time || mins(i.time) < nm))
    .concat(amPool().filter(i => i.kind !== 'routine'));
}
function triStart(mode, list){
  if(!list.length) return;
  TRI = {mode, ks:list.map(keyOf), n:list.length};
  OFFT = 0; LENS_OPEN = null;
  drawToday();
}
function triCur(){
  if(!TRI || !STATE) return null;
  const pool = TRI.mode === 'am' ? amPool() : pmPool();
  const left = TRI.ks.map(k => pool.find(i => keyOf(i) === k)).filter(Boolean);
  if(!left.length){ TRI = null; return null; }
  return {i:left[0], at:TRI.n - left.length + 1};
}
function eveDue(){
  const nm = nowMin();
  return !CAPTURE && nm >= dayEnd() && lsGet('ls.eve') !== STATE.today && !SHOT_NODOOR &&
    !(STATE.todays || []).some(i => i.time && !doneNow(i) && mins(i.time) >= nm) && pmPool().length > 0;
}
/* 그날 처음: 지난 날에 남은 일이 있으면 아침 문 */
function morningDoor(){
  if(CAPTURE || TRI || !STATE || SHOT_NODOOR || lsGet('ls.morn') === STATE.today) return;
  lsSet('ls.morn', STATE.today);
  /* 아침 펼침: 하루를 여는 한 번 - 카드 셋이 80ms 씩 차례로 떠오른다 */
  if(view === 'today') ['#v-today .pane.L .card', '#v-today .pane.R .card', '#any'].forEach((q, k) => {
    const el = $(q); if(el){ el.style.animationDelay = k * 80 + 'ms'; replay(el, 'deal'); } });
  if(view === 'today' && amPool().length) triStart('am', amPool());
}
/* 렌즈 오른쪽 끝. 쉬는 때는 끝냄 · 미루기 둘, 미루기를 누르면 그 자리에서 갈 곳 (빈 때 · 내일 · 다음 영업일).
   문이 열려 있으면 그 문의 답. 다른 줄에는 없다 - 손잡이는 렌즈에만 */
function lensActs(i){
  const B = (a, l, x) => '<button type="button" data-la="' + a + '"' + (x || '') + '>' + l + '</button>';
  if(i._eve) return '<span class="la ch">' + B('allnb', esc(fmtDay(laterDate({date:STATE.today})))) + B('one', '하나씩') +
    B('x', '<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.3"/></svg>', ' aria-label="닫기"') + '</span>';
  if(i._tri){
    const nb = laterDate(i), tm = tomorrowOf(i);
    const o = i._tri === 'am' ? [B('today', '오늘'), B('nb', esc(fmtDay(nb)))]
      : [B('nb', esc(fmtDay(nb)))].concat(nb !== tm ? [B('tom', esc(fmtDay(tm)))] : []);
    return '<span class="la ch">' + o.join('') + B('done', '끝냄') + '</span>';
  }
  if(i._alt || i._inert || i.done || i.ghost || !i.id) return '';
  if(LENS_OPEN === keyOf(i)){
    const g = gapAfter(i), nb = laterDate(i), tm = tomorrowOf(i);
    return '<span class="la ch">' + (g ? B('gap', g, ' data-t="' + g + '"') : '') + (nb !== tm ? B('tom', esc(fmtDay(tm))) : '') + B('nb', esc(fmtDay(nb))) + '</span>';
  }
  /* 쉬는 때는 손잡이가 없다 (끝냄 = 동그라미, 미루기 = 시각). 오른끝에는 남은 때 한 낱말 - 렌즈의 빛 */
  return i.time && i.date === STATE.today ? '<span class="rel">' + leftWord(mins(i.time) - nowMin()) + '</span>' : '';
}
/* 남은 때: 1시간 안은 분, 3시간 안은 시간 · 5분 단위, 그 뒤는 시간 */
function leftWord(d){
  if(d <= 0) return '지금';
  if(d < 60) return d + '분 뒤';
  const h = Math.floor(d / 60), m = Math.floor(d % 60 / 5) * 5;
  return d < 180 && m ? h + '시간 ' + m + '분 뒤' : Math.round(d / 60) + '시간 뒤';
}
function lensAct(a, i, t){
  if(a === 'open'){ LENS_OPEN = LENS_OPEN === keyOf(i) ? null : keyOf(i); drawToday(); return; }
  LENS_OPEN = null;
  if(a === 'x'){ lsSet('ls.eve', STATE.today); drawToday(); return; }
  if(a === 'one'){ lsSet('ls.eve', STATE.today); triStart('pm', pmPool()); return; }
  if(a === 'allnb'){ lsSet('ls.eve', STATE.today); moveAll(pmPool(), laterDate({date:STATE.today})); return; }
  if(OFFLINE) return;
  if(a === 'done') return setDone(i, true);
  if(a === 'today') return moveTo(i, STATE.today);
  if(a === 'nb') return moveTo(i, laterDate(i));
  if(a === 'tom') return moveTo(i, tomorrowOf(i));
  if(a === 'gap') return moveTo(i, STATE.today, t);
}
$('#drum').addEventListener('click', e => {
  const b = e.target.closest('[data-la]');
  if(!b) return;
  e.stopPropagation();
  lensAct(b.dataset.la, b.closest('.r')._it, b.dataset.t);
}, true);
document.addEventListener('mousedown', e => { if(LENS_OPEN && !e.target.closest('.la, [data-la]')){ LENS_OPEN = null; drawToday(); } });
/* 문이 열려 있는 동안의 키 (보이지 않는다): T 오늘 · → 다음 영업일 · Shift → 내일 · Space 끝냄 · Esc 그만 */
document.addEventListener('keydown', e => {
  /* 렌즈 · 문의 키는 오늘 화면에서만 - 설정 · 달력에서 누른 Space 가 보이지 않는 일을 끝내지 않게 */
  if(view !== 'today' || e.ctrlKey || e.metaKey || e.altKey || e.isComposing || $$('.modal.on').length) return;
  const tg = e.target;
  if(tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
  if(LENS_OPEN && e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); LENS_OPEN = null; drawToday(); return; }
  const tc = TRI && triCur();
  if(!tc) return;
  const k = e.key;
  const a = k === 'Escape' ? 'esc' : k === ' ' ? 'done' : k === 'ArrowRight' ? (e.shiftKey && TRI.mode === 'pm' ? 'tom' : 'nb')
    : TRI.mode === 'am' && (k === 't' || k === 'T' || k === 'ㅅ') ? 'today' : null;
  if(!a) return;
  e.preventDefault(); e.stopPropagation();
  if(a === 'esc'){ TRI = null; drawToday(); return; }
  lensAct(a, tc.i);
}, true);

/* 오늘의 자리: 지난 날의 일 → 오늘의 시각 있는 일 (시각 순서). 문 · 대신 말은 지금 시각에 놓인 일로 친다 */
const GAP = 16, GAP_MIN = 120;
function rulerModel(m){
  const today = STATE.today, nowM = nowMin();
  const special = m.alt ? m.lens : null, skip = special && special.id ? keyOf(special) : null;
  const lensK = special ? null : keyOf(m.lens);
  const days = m.past.filter(i => i.date && i.date < today);
  const T = m.past.filter(i => !(i.date && i.date < today)).concat(m.fut)
    .filter(i => i.time && keyOf(i) !== skip).sort((a, b) => a.time.localeCompare(b.time));
  /* 일이 차지하는 때: 배운 길이, 없으면 30분 (gapAfter 와 같다) */
  const endOf = i => mins(i.time) + (durOf(i) || 30);
  const L = [];
  let y = 0, yNow = 0, prevEnd = null, nowSet = false;
  days.forEach(i => { L.push({i, y, h:liftH(i, RH), lab:lblOf(i.date)}); y += L[L.length - 1].h; });
  /* 앞의 일이 끝나고 t 까지 두 시간 넘게 비면 틈 하나. 지금이 그 사이면 지금 선은 틈 안에 */
  const gapTo = (t, nowHere) => {
    if(prevEnd == null || t - prevEnd < GAP_MIN) return false;
    L.push({gap:true, y, h:GAP, a:prevEnd, b:t});
    if(nowHere) yNow = y + GAP * Math.max(0, Math.min(1, (nowM - prevEnd) / (t - prevEnd)));
    y += GAP;
    return true;
  };
  const putNow = t => {
    nowSet = true;
    if(special){
      gapTo(nowM, false);
      L.push({i:special, y, h:WH, lens:true, lab:special._alt || (special._tri && special.date !== today) ? (special.date ? lblOf(special.date) : {a:'', b:''}) : {a:'', b:special.time || ''}});
      yNow = y; y += WH; prevEnd = nowM;
    } else if(!gapTo(t, true)) yNow = y;
    else prevEnd = null;                       /* 틈은 이미 놓았다 */
  };
  T.forEach(i => {
    const t = mins(i.time);
    if(!nowSet && t >= nowM) putNow(t);
    else gapTo(t, false);
    const lens = keyOf(i) === lensK, h = lens ? WH : liftH(i, RH);
    L.push({i, y, h, lens, lab:{a:'', b:i.time}});
    y += h; prevEnd = Math.max(prevEnd || 0, endOf(i));
  });
  if(!nowSet) putNow(Infinity);
  return {L, yNow, total:y};
}
/* 두 시간 넘게 빈 곳: 줄과 줄 사이의 짧은 틈 (바탕빛 띠). 마우스를 올리면 얼마나 비는지 */
function gapEl(e){
  const el = document.createElement('div');
  el.className = 'gp';
  el.title = durWord(e.b - e.a) + ' 빔';
  return el;
}

function drawDrum(m){
  const box = $('#drum');
  const H = box.clientHeight;
  const R = rulerModel(m), lz = R.L.find(e => e.lens);
  /* 처음 자리: 지금 선이 위에서 두세 줄 아래에 서되(지나온 일 둘 · 셋이 보이게), 렌즈는 한 줄 여유를 두고 늘 다 보인다.
     위 · 아래 끝을 넘지 않는다 (지나온 일이 없으면 렌즈가 맨 위에) */
  const Y0 = H >= 3 * RH + WH + 3 * RH ? 3 * RH : 2 * RH;
  const max = Math.max(0, R.total - H);
  const top0 = Math.max(0, Math.min(max, Math.max(R.yNow - Y0, lz ? lz.y + lz.h + RH - H : 0)));
  DRUM_ROWS = {min:-Math.ceil(top0 / RH), max:Math.ceil((max - top0) / RH)};
  OFFT = Math.max(DRUM_ROWS.min, Math.min(DRUM_ROWS.max, OFFT));
  const OFF = Math.max(0, Math.min(max, top0 + OFFT * RH));

  const keep = new Map();
  [...box.querySelectorAll('.r, .gp')].forEach(el => keep.set(el.dataset.k, el));
  const seen = new Set(), fresh = [];
  R.L.forEach(e => {
    let el, k;
    if(e.gap){ el = gapEl(e); k = 'g@' + e.b; }
    else {
      const i = e.i;
      k = keyOf(i) + (e.lens && i._alt ? '#alt' : '') + (i._tri ? '#tri' : '');
      let meta = '';
      if(e.lens){
        if(i._eve && i._est) meta = '<span class="mb">약 ' + durWord(i._est) + '</span>';
        else if(i._alt && !i._inert) meta = '<span class="ma">다음 일</span>';
        else if(i.rule_text && i.period !== 'day') meta = '<span class="mb">' + esc(i.rule_text) + '</span>';
        else if(i.start) meta = '<span class="mb">' + esc(shortE(i.start) + ' – ' + shortE(i.date)) + '</span>';
      }
      el = rowEl(i, {lab:e.lab, cls:e.lens ? 'lens' + (i._alt ? ' alt' : '') + (i._eve ? ' eve' : '') : '', meta, inert:!!i._inert, noDot:!!i._inert});
      if(e.lens) el.insertAdjacentHTML('beforeend', lensActs(i));
      /* 렌즈의 시각 = 미루기 (갈 곳은 그 자리 오른쪽에 펼친다) */
      if(e.lens && i.time && !(i._eve || i._tri || i._alt || i._inert || i.done || i.ghost || !i.id)){
        const t = el.querySelector('.tm');
        t.dataset.la = 'open'; t.title = '미루기'; t.setAttribute('role', 'button'); t.setAttribute('aria-label', '미루기 · ' + i.time);
        if(LENS_OPEN === keyOf(i)) el.classList.add('open');
      }
    }
    el.dataset.k = k;
    el.style.cssText = 'top:' + (e.y - OFF) + 'px; height:' + e.h + 'px; z-index:' + (e.lens ? 3 : 2);
    const old = keep.get(k);
    if(e.lens && old && old.classList.contains('w2') && old._it && old._it.title === e.i.title) el.classList.add('w2');
    if(old && old.outerHTML !== el.outerHTML){
      /* 같은 줄이면 자리만 옮긴다 (CSS 가 미끄러지게 한다) - 통째로 갈면 움직임이 끊긴다 */
      if(old.innerHTML === el.innerHTML && old.className === el.className){ old.style.cssText = el.style.cssText; old._it = el._it; fresh.push(old); }
      else { el.style.transition = 'none'; old.replaceWith(el); fresh.push(el); }
    } else if(old){ old._it = el._it; fresh.push(old); }
    else { el.classList.add('in'); box.appendChild(el); fresh.push(el); }
    seen.add(k);
  });
  keep.forEach((el, k) => { if(!seen.has(k)) el.remove(); });
  const lr = box.querySelector('.r.lens'), lzt = lr && lr.querySelector('.nt');
  if(lzt) lr.classList.toggle('w2', lzt.offsetHeight > 30);
  requestAnimationFrame(() => fresh.forEach(el => { el.classList.remove('in'); el.style.transition = ''; }));
  /* 렌즈의 바탕과 지금 선 */
  let lb = box.querySelector('.lensbg'), nl = box.querySelector('.nowl');
  if(!lb){ lb = document.createElement('i'); lb.className = 'lensbg'; box.prepend(lb); }
  if(!nl){ nl = document.createElement('i'); nl.className = 'nowl'; box.appendChild(nl); }
  lb.style.cssText = lz ? 'top:' + (lz.y - OFF) + 'px' : 'display:none';
  /* 렌즈의 윗변에 붙은 지금 선은 줄 끝에서 끝까지 (예전 그대로), 틈 안의 지금 선은 동그라미 열부터 */
  nl.style.top = (R.yNow - OFF - 1).toFixed(1) + 'px';
  nl.classList.toggle('free', !lz || Math.abs(R.yNow - lz.y) > .5);
  box.classList.toggle('rolled', OFFT !== 0);
  fuseTick();
}
/* 판 밖의 줄에 초점이 가면 (↑ ↓) 그 줄이 보이게 굴린다 */
function drumShow(el){
  const t = parseFloat(el.style.top), h = el.offsetHeight, H = $('#drum').clientHeight;
  const d = t < 0 ? Math.floor(t / RH) : t + h > H ? Math.ceil((t + h - H) / RH) : 0;
  if(d){ OFFT += d; clearTimeout(_wBack); drawToday(); }
}
$('#drum').addEventListener('wheel', e => {
  e.preventDefault();
  _wAcc += e.deltaY;
  let st = 0;
  while(_wAcc >= 100){ st++; _wAcc -= 100; }
  while(_wAcc <= -100){ st--; _wAcc += 100; }
  if(st){ ruleTo(null); riseClose(true); OFFT = Math.max(DRUM_ROWS.min, Math.min(DRUM_ROWS.max, OFFT + st)); drawToday(); }
  clearTimeout(_wBack);
  _wBack = setTimeout(() => { _wAcc = 0; if(OFFT){ OFFT = 0; drawToday(); } }, 3200);
}, {passive:false});

/* ══════════ 선반 (언제든 · 메모) ══════════ */
function fillList(box, list, opt){
  const f = document.createDocumentFragment();
  list.forEach(i => f.appendChild(rowEl(i, opt && opt(i))));
  patchKids(box, f);
}
/* 새로 지은 줄을 목록에 옮긴다 - 글자 하나까지 같은 줄은 그대로 둔다 (포커스 · 움직임이 끊기지 않게) */
function patchKids(node, frag){
  /* 손의 자(.ruler)는 줄이 아니다 - 세지 않고 그 자리에 둔다 */
  const ru = node.querySelector(':scope > .ruler');
  const b = [...frag.childNodes], a = [...node.children].filter(x => x !== ru);
  if(a.length !== b.length){ node.replaceChildren(...(ru ? [ru] : []), ...b); return; }
  a.forEach((x, k) => { if(x.outerHTML !== b[k].outerHTML) node.replaceChild(b[k], x); else x._it = b[k]._it; });
}

/* 선반 높이: 머리 PH + 줄 RH × n. 가운데 홈을 끌어 바꾸고, 이 PC 에만 기억한다. PH = CSS 의 --ph (판 · 선반 머리) */
const PH = 40;
let SHELF_N = (() => { try{ const v = +localStorage.getItem('ls.shelf'); return v >= 1 && v <= 8 ? v : 0; }catch(e){ return 0; } })();
function shelfN(){
  const H = $('#main').clientHeight - 2 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gut')) || 0);   /* 카드 아래 틈 · 카드와 선반 사이 틈 (CSS 의 --gut) */
  /* 끌어 둔 높이가 없으면 다섯 줄 (오늘 판에 지나온 일 둘 · 렌즈 · 남은 일 둘이 설 자리는 남긴다) */
  const auto = Math.max(2, Math.min(5, Math.floor((H - PH - 2 * RH - WH - 2 * RH - PH) / RH)));
  return Math.min(SHELF_N || auto, Math.max(1, Math.floor((H - PH - 2 * RH - WH - PH) / RH)));
}
function placeShelf(){
  const h = PH + shelfN() * RH;
  $('#v-today').style.setProperty('--shelf', h + 'px');
}
(function seamDrag(){
  const s = $('#seam');
  let st = null;
  s.addEventListener('pointerdown', e => {
    if(e.button !== 0) return;
    e.preventDefault(); s.setPointerCapture(e.pointerId);
    st = {y:e.clientY, n:shelfN()}; document.body.classList.add('seaming');
  });
  s.addEventListener('pointermove', e => {
    if(!st) return;
    const n = Math.max(1, Math.min(8, st.n + Math.round((st.y - e.clientY) / RH)));
    if(n !== shelfN()){ SHELF_N = n; placeShelf(); drawToday(); }
  });
  const end = () => { if(!st) return; st = null; document.body.classList.remove('seaming'); try{ localStorage.setItem('ls.shelf', String(SHELF_N)); }catch(e){} };
  s.addEventListener('pointerup', end); s.addEventListener('pointercancel', end);
  s.addEventListener('dblclick', () => { SHELF_N = 0; try{ localStorage.removeItem('ls.shelf'); }catch(e){} placeShelf(); drawToday(); });
})();

/* ══════════ 다가올 날 (내일부터 7일) ══════════
   네 주 (overview 의 upcoming_days), 스크롤. 날마다 [날 요일 | 동그라미 | 이름], 날의 첫 줄 위에 진한 선 하나.
   날짜(또는 일이 없는 날의 줄)를 누르면 그날 전체 - 새 항목이 아니다 (새 항목은 가끔 하는 일이다).
   일이 없는 영업일은 날만 한 줄, 일이 없는 쉬는 날은 이어지는 날끼리
   한 줄로 접고 공휴일 이름을 붙인다. 하루에 넷 이상이면 둘만 보이고 +n. 기간 업무는 시작한 날부터 끝나는 날까지
   왼쪽 여백에 가는 세로선으로 잇는다 (마우스를 올리면 청록). */
const EXP = new Set();
const upLab = lblOf;
/* 다가올 날의 날 머리 (D3): [날 · 요일] (이어지는 쉬는 날은 둘째 날까지 · 공휴일 이름). 판 머리 바로 아래에 붙어 서고(sticky),
   다음 날의 머리가 올라와 덮는다 - 지금 보는 줄이 며칠의 일인지 늘 맨 위에 쓰여 있다. 누르면 그날 전체, 끌어다 놓을 자리도 된다 */
function dayHead(d, cls, last, hol){
  const el = document.createElement('div'), l = upLab(d), L = last && upLab(last);
  el.className = 'dh ' + cls; el.dataset.drop = d;
  el.innerHTML = '<span class="tm"><span>' + esc(l.a) + '</span><span>' + l.b + '</span></span>' +
    (L ? '<span class="tm"><span>' + esc(L.a) + '</span><span>' + L.b + '</span></span>' : '') +
    (hol && hol.length ? '<span class="hn">' + esc(hol.join(' · ')) + '</span>' : '');
  el.onclick = () => openDay(d);
  return el;
}
/* 그날 전체: 그날의 할 일 · 루틴 회차 · 걸친 기간. 루틴 회차는 다가올 날 범위를 한 번에 불러 둔다 */
function openDay(d){
  ensureRoutines(addDay(STATE.today, 1), addDay(STATE.today, STATE.upcoming_days || 7));
  dayModal(d, dayItems(d));
}
function drawUp(o, gh){
  const box = $('#up');
  const items = (o.upcoming || []).filter(i => !FLD.edit || FLD.edit.id !== i.id);
  const by = {};
  items.forEach(i => (by[i.date] = by[i.date] || []).push(i));
  if(gh && gh.date && gh.date > o.today) (by[gh.date] = by[gh.date] || []).push(gh);
  /* 날마다 묶음(section) 하나: [날 머리 · 그날의 줄]. 날 머리는 묶음 안에서만 붙어 있어서, 다음 날의 묶음이 올라오면 밀려난다 */
  const f = document.createDocumentFragment();
  const rowAt = {}, dayAt = {};
  let k = 1, sec = null;
  const day = d => { sec = document.createElement('section'); sec.className = 'ud'; sec.dataset.drop = d; f.appendChild(sec); dayAt[d] = sec; return sec; };
  const add = el => { sec.appendChild(el); return el; };
  const UPD = o.upcoming_days || 7;
  while(k <= UPD){
    const d = addDay(o.today, k), its = (by[d] || []).slice().sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0) ||
      (a.ghost ? 1 : 0) - (b.ghost ? 1 : 0) || (a.time || '99:99').localeCompare(b.time || '99:99'));
    const biz = isBiz(d), wk = k > 1 && dObj(d).getDay() === 1 ? ' wk' : '';
    if(!its.length){
      if(!biz){
        let e = k;
        while(e + 1 <= UPD && !isBiz(addDay(o.today, e + 1)) && !(by[addDay(o.today, e + 1)] || []).length) e++;
        const hol = [];
        day(d);
        for(let j = k; j <= e; j++){ const x = addDay(o.today, j); dayAt[x] = sec; const h = (STATE.holiday_names || {})[x]; if(h && !hol.includes(h)) hol.push(h); }
        add(dayHead(d, 'off' + wk, e > k ? addDay(o.today, e) : null, hol)); k = e + 1; continue;
      }
      day(d);
      add(dayHead(d, 'blank' + wk)); k++; continue;
    }
    day(d);
    add(dayHead(d, (biz ? 'has' : 'off has') + wk));
    const many = its.length > 3, open = EXP.has(d);
    const shown = open || !many ? its : its.slice(0, 2);
    shown.forEach(i => {
      const el = rowEl(i, {cls:biz ? '' : 'offday'});
      el.dataset.drop = d;
      rowAt[i.id] = el;
      add(el);
    });
    if(many){
      const el = document.createElement('div');
      el.className = 'r more'; el.dataset.drop = d;
      el.innerHTML = '<span class="tm"></span><span class="dot nd"></span><div class="nm"><span class="mono">' + (open ? '접기' : '+' + (its.length - 2)) + '</span></div>';
      el.onclick = () => { open ? EXP.delete(d) : EXP.add(d); drawToday(); };
      add(el);
    }
    k++;
  }
  const nx = items.filter(i => !i.done && !i.ghost)[0];
  if(nx && rowAt[nx.id]){
    const el = rowAt[nx.id], dd = dayDiff(o.today, nx.date);
    el.classList.add('nx');
    el.insertAdjacentHTML('beforeend', '<span class="rel">' + (dd === 1 ? '내일' : dd + '일 뒤') + '</span>');
  }
  /* 기간 업무의 세로선: 그리기를 마친 뒤 줄의 자리를 재서. 묶음을 다시 그렸으면(patchKids) 새로 놓인 줄을 id 로 다시 찾는다 */
  box.querySelectorAll('.lane').forEach(x => x.remove());
  patchKids(box, f);
  const live = el => el && (el.isConnected ? el : box.querySelector('[data-k="' + el.dataset.k + '"]'));
  const liveDay = s => s && (s.isConnected ? s : box.querySelector('section[data-drop="' + s.dataset.drop + '"]'));
  /* 겹치는 선은 왼쪽으로 6씩 비켜 선다 (먼저 시작한 것이 안쪽) - 같은 자리에 겹쳐 하나로 보이지 않게 */
  const ends = [];
  items.filter(i => i.start && live(rowAt[i.id])).map(i => {
    const end = live(rowAt[i.id]), s = liveDay(dayAt[i.start]);
    /* 시작한 날은 그 묶음의 머리 가운데 (머리는 붙어 다니므로 묶음의 자리로 잰다) */
    const top = s ? s.offsetTop + 14 : 0;
    return {i, cap:!!s, top, bot:end.offsetTop + end.offsetHeight / 2};
  }).sort((a, b) => a.top - b.top || b.bot - a.bot).forEach(({i, cap, top, bot}) => {
    let n = ends.findIndex(e => e < top);
    if(n < 0){ n = ends.length; ends.push(0); }
    ends[n] = bot;
    const ln = document.createElement('i');
    ln.className = 'lane' + (cap ? ' cap' : '');
    ln.dataset.id = i.id;
    /* 여백(24) 안에서 글자 열 쪽부터 14 · 8 · 2 */
    ln.style.cssText = 'top:' + top + 'px; height:' + Math.max(0, bot - top) + 'px; --lx:' + (14 - 6 * n) + 'px';
    box.appendChild(ln);
  });
}

/* ══════════ 오늘 화면 전체 ══════════ */
function drawToday(){
  if(!STATE || view !== 'today') return;
  const o = STATE, gh = FLD.ghost;
  sunTo();
  const m = todayModel(o, gh);
  /* 언제든: 오늘 할 시각 없는 일 + 날짜 없는 메모. 둘 다 '시각 없이 언제든' 이라 한 판이다 (2026-11 Notes 를 합쳤다) */
  const notes = (o.floating || []).filter(i => !FLD.edit || FLD.edit.id !== i.id).concat(gh && gh.kind === 'floating' ? [gh] : []);
  const any = m.unt.concat(notes);
  placeShelf();
  drawDrum(m);
  const late = o.overdue.length + o.todays.filter(i => isLate(i)).length;
  const tc = TRI && triCur();
  $('#t-late').innerHTML = tc ? '<b>' + tc.at + '</b> / ' + TRI.n : late ? '늦음 <b>' + late + '</b>' : '';
  const moveable = o.overdue.filter(i => i.id && i.kind !== 'routine').length;
  $('#t-late').classList.toggle('act', !!moveable);
  $('#t-late').title = moveable ? '지난 날의 일 ' + moveable + '개를 오늘로' : '';
  fillList($('#any-list'), any, () => ({}));
  /* 머리말 옆의 수: 늘 [무엇 · 수] 로 - '늦음 n' 과 같은 말투. 오늘 · 언제든은 남은 것.
     다가올 날에는 수를 두지 않는다 (2026-11: '20' · '이번 주 n' · '3주 뒤 7' 모두 읽는 사람에게 할 일을 주지 않았다) */
  countTo($('#c-today'), '남은', o.todays.filter(i => i.time && !doneNow(i)).length);
  countTo($('#c-any'), '남은', any.filter(i => !i.ghost && !doneNow(i)).length);
  /* 오늘의 눈금 (E2): TODAY 머리 밑 2px 하늘 선이 오늘 시각 있는 일 중 끝낸 만큼 찬다 */
  const tt = o.todays.filter(i => i.time && !i.ghost);
  $('#t-prog').style.width = (tt.length ? tt.filter(i => i.done).length / tt.length * 100 : 0).toFixed(1) + '%';
  drawUp(o, gh);
}
/* 다가올 날도 줄 단위로 (2026-11): 휠 한 칸에 한 줄(또는 빈 날의 머리 하나)씩, 오늘 판(시간의 자)과 같은 길이 · 곡선으로 미끄러진다.
   멈출 자리는 날 묶음의 윗변(그날 머리가 판 머리에 닿는 곳)과, 그날의 각 줄이 붙어 선 날 머리 바로 밑에 오는 곳 -
   멈추면 머리 밑에 늘 온전한 줄이 선다. 스크롤 막대를 끄는 것은 그대로 자유롭다 */
const DH = 28;   /* 날 머리 높이 (CSS 의 .dh) */
let _uAcc = 0, _uTo = null, _uRaf = 0;
function upStops(box){
  const max = box.scrollHeight - box.clientHeight, s = [0];
  for(const sec of box.children){
    if(sec.tagName !== 'SECTION') continue;
    s.push(sec.offsetTop - PH);
    for(const r of sec.children) if(r.classList.contains('r') && !r.classList.contains('fold')) s.push(r.offsetTop - PH - DH);
  }
  return s.map(v => Math.min(max, Math.max(0, v))).sort((a, b) => a - b).filter((v, k, a) => !k || v - a[k - 1] > 1);
}
function upScrollTo(box, y){
  cancelAnimationFrame(_uRaf);
  if(calm()){ box.scrollTop = y; _uTo = null; return; }
  _uTo = y;
  const y0 = box.scrollTop, t0 = performance.now(), D = 480;
  const step = now => {
    const t = Math.min(1, (now - t0) / D);
    box.scrollTop = y0 + (y - y0) * (1 - Math.pow(1 - t, 4));
    if(t < 1) _uRaf = requestAnimationFrame(step); else _uTo = null;
  };
  _uRaf = requestAnimationFrame(step);
}
$('#up').addEventListener('wheel', e => {
  if(e.ctrlKey || !e.deltaY) return;
  e.preventDefault();
  const box = e.currentTarget;
  _uAcc += e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY;
  let st = 0;
  while(_uAcc >= 100){ st++; _uAcc -= 100; }
  while(_uAcc <= -100){ st--; _uAcc += 100; }
  if(!st) return;
  ruleTo(null); riseClose(true);
  const S = upStops(box), cur = _uTo != null ? _uTo : box.scrollTop;
  let k = st > 0 ? S.findIndex(v => v > cur + 1) + st - 1 : (S.length - 1 - [...S].reverse().findIndex(v => v < cur - 1)) + st + 1;
  if(st > 0 && S.findIndex(v => v > cur + 1) < 0) return;
  if(st < 0 && !S.some(v => v < cur - 1)) return;
  k = Math.max(0, Math.min(S.length - 1, k));
  upScrollTo(box, S[k]);
}, {passive:false});
/* 판 머리를 누르면 처음 자리로 (2026-11): 오늘은 시간의 자가 지금 시간으로, 다가올 날은 맨 위로 - 어디까지 굴려 두었든 한 번에.
   '늦음 n' 은 제 일(아침 문)을 한다 */
$('#v-today .pane.L .card > .ph').addEventListener('click', e => {
  if(e.target.closest('#t-late')) return;
  clearTimeout(_wBack); _wAcc = 0;
  if(OFFT){ ruleTo(null); OFFT = 0; drawToday(); }
});
$('#v-today .pane.R .card > .ph').addEventListener('click', () => { _uAcc = 0; ruleTo(null); upScrollTo($('#up'), 0); });

/* ══════════ 손 · 깊이 · 남은 시간 (2026-11 통합, 캔버스 '깊이와 움직임' 통합 2) ══════════
   한 물리: 곡선은 하나(--move), 손을 따라가는 것은 0.26초, 나머지는 0.48초. 화면에 더하는 것은 없고 이미 있는 것이 움직인다 */

/* 손의 자 (D1′): 손이 머문 줄 밑에 옅은 하늘 바탕과 1px 하늘 선. 줄마다 새로 칠하지 않고 한 물건이 미끄러져 옮겨 간다 -
   줄을 따라 읽는 눈의 자. 오늘 · 언제든 · 다가올 날에만 (렌즈 · 날 머리 위에서는 숨는다) */
const RULED = '#drum, #any-list, #up';
let RULE_BOX = null;
function ruleTo(r){
  const box = r && r.closest(RULED);
  const ok = !!box && !r.classList.contains('lens') && !r.classList.contains('fold');
  if(RULE_BOX && RULE_BOX !== (ok ? box : null)){ const o = RULE_BOX.querySelector(':scope > .ruler'); if(o) o.classList.remove('on'); }
  RULE_BOX = ok ? box : null;
  if(!ok) return;
  let ru = box.querySelector(':scope > .ruler');
  if(!ru){ ru = document.createElement('i'); ru.className = 'ruler'; box.prepend(ru); }
  /* 손이 판 밖에서 들어오면 미끄러지지 않고 그 자리에 놓인다 */
  const jump = !ru.classList.contains('on') || calm();
  if(jump) ru.style.transition = 'none';
  ru.style.top = r.offsetTop + 'px'; ru.style.height = r.offsetHeight + 'px';
  if(jump){ void ru.offsetWidth; ru.style.transition = ''; }
  ru.classList.add('on');
}
document.addEventListener('mouseover', e => ruleTo(e.target.closest ? e.target.closest('.r') : null));
$$(RULED).forEach(b => b.addEventListener('mouseleave', () => ruleTo(null)));

/* 든 카드와 내려앉은 카드 (D2): 손이 든 카드는 그림자가 깊고 길어지고, 나머지는 바닥에 붙으며 바탕빛이 얇게 덮여 물러난다.
   기울기 · 크기 · 흐림은 없다 - 글자는 한 픽셀도 움직이지 않는다 */
function liftTo(c){
  $$('#v-today .lift').forEach(x => { if(x !== c) x.classList.remove('lift'); });
  if(c) c.classList.add('lift');
  $('#v-today').classList.toggle('focusing', !!c);
}
$$('#v-today .card, #v-today .shelf').forEach(c => {
  c.addEventListener('mouseenter', () => liftTo(c));
  c.addEventListener('mouseleave', () => liftTo(null));
});

/* 남은 시간의 심지 (D5): 렌즈의 일이 10분 안으로 들어오면 지금 선이 남은 만큼만 남아 오른쪽부터 타들어 가고, 끝에 바늘 하나.
   그 시각이 되면 선이 다시 차서 1분 동안 '지금'. 숨(빛이 번졌다 잦아듦)은 CSS 고리가 아니라 이 타이머가 1.2초마다 한 번 바꾼다 -
   창이 숨으면 멈춘다 */
function fuseTick(){
  const box = $('#drum');
  if(!STATE || view !== 'today') return;
  const ln = box.querySelector('.r.lens'), i = ln && ln._it;
  let st = '', fw = 1;
  if(i && i.time && i.date === STATE.today && !i.done && !i.ghost && !i._alt && !i._inert && !i._tri && !i._eve && !OFFT){
    const n = new Date(), d = mins(i.time) - (n.getHours() * 60 + n.getMinutes() + n.getSeconds() / 60);
    if(d > 0 && d <= 10){ st = 'near'; fw = d / 10; }
    else if(d <= 0 && d > -1) st = 'now';
  }
  box.classList.toggle('near', st === 'near');
  box.classList.toggle('now', st === 'now');
  box.style.setProperty('--fw', (fw * 100).toFixed(2) + '%');
  box.classList.toggle('br', !!st && !calm() && !box.classList.contains('br'));
}
setInterval(() => { if(onScreen()) fuseTick(); }, 1200);
/* 선이 걸친 기간 업무에 마우스를 올리면 그 선이 청록이 된다 */
$('#up').addEventListener('mouseover', e => {
  const r = e.target.closest('.r'), id = r && r.dataset.id;
  $$('#up .lane').forEach(l => l.classList.toggle('hi', !!id && l.dataset.id === id));
});
$('#up').addEventListener('mouseleave', () => $$('#up .lane').forEach(l => l.classList.remove('hi')));

/* ══════════ 떠오르는 두 줄 (2026-11, 캔버스 '읽기 띠 대안' C) ══════════
   홈의 세 목록(오늘 · 언제든 · 다가올 날)과 그날 전체에서 한 줄에 손이 머물면 그 줄이 카드로 떠오르며 두 줄이 되고, 둘째 줄에 줄이
   말하지 않던 값(날짜 · 시각 · 반복 · 걸림 · 알림 · 설명)과 고치기가 선다. 예전의 읽기 띠는 판 머리(TODAY · UPCOMING)를 덮고,
   이미 보이는 값을 되풀이하고, 눈을 위로 끌고 갔다.
   덮지 않는다: 떠오른 줄이 36 만큼 자라고 아래 줄들이 한 줄(36) 밀려 내려간다 - 모든 줄이 격자 위에 그대로이고, 손에 닿지
   않는 줄이 없다. 줄은 아래로만 자라서 손이 놓인 첫 줄은 움직이지 않는다.
   기다림은 시간이 아니라 손의 속도로 정한다: 손이 느려지는 순간(0.35px/ms 아래) 곧바로 떠오르고, 빠르게 스쳐 가는 동안에는
   떠오르지 않다가 멈추면 0.05초 뒤에. 손이 다른 줄로 옮겨 가면 앞의 줄이 내려앉고 새 줄이 동시에 떠오른다. 아래로 옮길 때는
   그 줄이 손 밑에서 한 줄 올라오지만 둘째 줄이 손 밑에 오므로 손은 늘 같은 줄 위에 있다 (어느 쪽으로 가도 다른 줄로 튀지 않는다).
   스쳐 지나가는 줄은 떠오르지 않는다. 판 밖으로 손이 나가면 0.28초 뒤에, 휠을 굴리면 곧바로 내려앉는다.
   둘째 줄을 누르는 것은 끝냄이 아니다 (값을 고치려다 끝내지 않게). 렌즈는 떠오르지 않는다 (이미 떠 있다) */
const RISEN = '#drum, #any-list, #up, #day-list';
const RISE = {k:null, t:0, c:0, pin:false};
/* 손의 속도 (px/ms, 반씩 섞어 고르게). 0.1초 넘게 멈췄다 움직이면 0 에서 다시 */
const PTR = {x:0, y:0, t:0, v:0};
document.addEventListener('mousemove', e => {
  const dt = e.timeStamp - PTR.t, d = Math.hypot(e.clientX - PTR.x, e.clientY - PTR.y);
  PTR.v = dt > 100 ? 0 : dt > 0 ? PTR.v * .5 + d / dt * .5 : PTR.v;
  PTR.x = e.clientX; PTR.y = e.clientY; PTR.t = e.timeStamp;
  const r = e.target.closest && e.target.closest('.r'), box = r && r.closest(RISEN);
  if(box && (view === 'today' || box.id === 'day-list')) riseHover(r);
}, {passive:true});
function liftH(i, h){ return RISE.k && RISE.k === keyOf(i) ? h + RH : h; }
function exHTML(i){
  const {kv, ed} = roKV(i, true);
  return '<div class="ex">' + kvHTML(kv, ed) + (i.id ? '<button type="button" class="e go" data-e="edit">고치기</button>' : '') + '</div>';
}
function riseHover(r){
  clearTimeout(RISE.c);
  const i = r._it, k = r.dataset.k;
  if(RISE.k === keyOf(i)){ clearTimeout(RISE.t); return; }
  clearTimeout(RISE.t);
  if(DRAG || ROP || (!r.closest('.modal') && $$('.modal.on').length) || i._inert || i.ghost || r.classList.contains('lens')) return riseLeave();
  RISE.pin = false;
  const go = () => {
    const box = r.closest(RISEN), el = box && [...box.querySelectorAll('.r')].find(x => x.dataset.k === k);
    if(el && el.matches(':hover') && !DRAG && !ROP) riseOpen(el);
  };
  if(PTR.v < .35) return go();
  RISE.t = setTimeout(go, 50);
}
function riseLeave(){
  clearTimeout(RISE.t);
  if(!RISE.k || ROP || RISE.pin) return;
  clearTimeout(RISE.c);
  RISE.c = setTimeout(() => riseClose(), 280);
}
/* 제자리에서 바꾼다 (새로 그리면 높이가 단번에 바뀌어 움직임이 없다): 둘째 줄을 달고 한 박자 뒤에 자라게 한다 */
function riseOpen(el){
  const prev = $$('.r.rise');
  prev.forEach(x => { x.classList.remove('rise'); const ex = x.querySelector('.ex'); if(ex) ex.remove(); });
  RISE.k = keyOf(el._it);
  ruleTo(null);
  const box = el.closest(RISEN), k = el.dataset.k;
  el.insertAdjacentHTML('beforeend', exHTML(el._it));
  void el.offsetWidth;
  el.classList.add('rise');
  if(box.id === 'drum' || prev.some(x => x.closest('#drum'))){ drawToday(); el = [...box.querySelectorAll('.r')].find(x => x.dataset.k === k) || el; }
  /* 판 아래 끝에 걸려 둘째 줄이 잘리면 한 줄만큼 올려 보인다 (손은 여전히 같은 줄 위 - 둘째 줄이 손 밑에 온다) */
  const b = box.getBoundingClientRect(), r = el.getBoundingClientRect();
  if(r.top + 2 * RH > b.bottom + 1){
    if(box.id === 'drum'){ if(OFFT < DRUM_ROWS.max){ OFFT++; clearTimeout(_wBack); drawToday(); } }
    else if(box.id === 'up') upScrollTo(box, box.scrollTop + RH);
    else box.scrollBy({top:RH, behavior:calm() ? 'auto' : 'smooth'});
  }
}
function riseClose(now){
  clearTimeout(RISE.t); clearTimeout(RISE.c);
  if(!RISE.k) return;
  if(ROP && !now) return;
  RISE.k = null; RISE.pin = false;
  const was = $$('.r.rise');
  was.forEach(x => { x.classList.remove('rise'); const ex = x.querySelector('.ex'); if(ex) setTimeout(() => { if(!x.classList.contains('rise')) ex.remove(); }, 260); });
  if(was.some(x => x.closest('#drum'))) drawToday();
}
document.addEventListener('mouseover', e => {
  const r = e.target.closest && e.target.closest('.r'), box = r && r.closest(RISEN);
  if(box && (view === 'today' || box.id === 'day-list')) return riseHover(r);
  if(e.target.closest && e.target.closest('#rop')) return clearTimeout(RISE.c);
  riseLeave();
});
document.addEventListener('mouseleave', () => riseLeave());
/* 둘째 줄: 날짜 · 시각은 그 자리에서 고치고 (작은 판), 고치기는 자세히 종이. 줄의 끝냄으로 새지 않는다 */
document.addEventListener('click', e => {
  const x = e.target.closest && e.target.closest('.r .ex');
  if(!x) return;
  e.stopPropagation();
  const b = e.target.closest('.e'), i = x.closest('.r')._it;
  if(!b || !i) return;
  if(b.dataset.e === 'edit'){ riseClose(true); return startEdit(i); }
  if(ROP && ROP.kind === b.dataset.e) return ropClose();
  ropOpen(b, i);
}, true);
document.addEventListener('wheel', e => {
  const b = e.target.closest && e.target.closest('.r .ex .e[data-e="time"]'), i = b && b.closest('.r')._it;
  if(!b || !i || OFFLINE) return;
  e.preventDefault(); e.stopPropagation();
  const v = hhmm(((mins(i.time) + ((e.deltaY || e.deltaX) < 0 ? STEP : -STEP)) % 1440 + 1440) % 1440);
  i.time = v; b.textContent = v;
  clearTimeout(ropOpen._w);
  ropOpen._w = setTimeout(() => change(taskUrl(i), {due_time:v}), 500);
}, {passive:false, capture:true});

/* ══════════ 한 일의 값 ══════════
   2026-11: 머리 아래로 내려오던 읽기 띠를 걷었다 (판 머리를 덮고, 보이는 값을 되풀이하고, 눈을 위로 끌고 갔다).
   값은 이제 어디서나 떠오른 줄의 둘째 줄(위의 riseOpen)에서 말한다 */
/* 한 일의 값: [이름표, 값, 값의 모양, 고치는 손잡이] - 이름표는 자세히(전체)와 같은 낱말.
   rise: 떠오른 줄의 둘째 줄 - 줄이 이미 말하는 늦음 · 끝냄은 빼고, 할 일의 날짜는 오늘이어도 (그 자리에서 옮기게) 둔다 */
function roKV(i, rise){
  const kv = [];
  const ed = !!(i.id && (i.kind || 'deadline') === 'deadline' && !i.done && !i.start);
  if(rise && ed && i.date) kv.push(['날짜', i.date === STATE.today ? '오늘' : shortE(i.date), i.date === STATE.today ? '' : 'm', 'date']);
  else if(i.date && i.date !== STATE.today && !i.start) kv.push(['날짜', shortE(i.date), 'm']);
  if(i.start) kv.push(['기간', shortE(i.start) + ' – ' + shortE(i.date), 'm']);
  if(i.time) kv.push(['시각', i.time, 'm', 'time']);
  if(i.rule_text) kv.push(['반복', i.rule_text, '']);
  if(durOf(i)) kv.push(['걸림', '약 ' + durWord(durOf(i)), '']);
  if(i.time && !i.done){
    if(i.muted) kv.push(['알림', '끔', '']);
    else { const lead = i.notify_min != null ? i.notify_min : defLead(); kv.push(['알림', hhmm(Math.max(0, mins(i.time) - lead)), 'm']); }
  }
  if(!rise && isLate(i)) kv.push(['', '늦음', 'late']);
  if(!rise && i.done) kv.push(['', '끝냄', '']);
  if(i.note) kv.push(['설명', i.note.split('\n')[0], 'note']);
  return {kv, ed};
}
const kvHTML = (kv, ed) => kv.map(([k, v, c, e]) => '<span>' + (k ? '<i>' + k + '</i>' : '') +
  (ed && e ? '<button type="button" class="e ' + c + '" data-e="' + e + '">' + esc(v) + '</button>' : '<span class="' + c + '">' + esc(v) + '</span>') + '</span>').join('');
/* 값의 작은 판을 닫는다 (메뉴 · 종이 · 끌기가 시작될 때) */
function roHide(){ ropClose(); }
/* 둘째 줄의 값을 누르면 그 아래 작은 판: 시각은 앞뒤 30분 · 1시간 (휠로 5분씩), 날짜는 오늘 · 내일 · 다음 영업일 · 한 주 뒤 */
let ROP = null;
function ropClose(){ if(!ROP) return; ROP = null; $('#rop').classList.remove('on'); }
function ropOpen(b, i){
  const kind = b.dataset.e;
  if(!i) return;
  let opts;
  if(kind === 'time'){
    const c = mins(i.time);
    opts = [-60, -30, 0, 30, 60].map(d => c + d).filter(m => m >= 0 && m < 1440).map(m => [hhmm(m), hhmm(m)]);
  } else {
    const ds = [STATE.today, tomorrowOf({date:STATE.today}), laterDate({date:STATE.today}), addDay(i.date, 7)];
    if(!ds.includes(i.date)) ds.splice(3, 0, i.date);
    opts = [...new Set(ds)].sort().map(d => [d, fmtDay(d)]);
  }
  const cur = kind === 'time' ? i.time : i.date;
  const el = $('#rop');
  el.innerHTML = opts.map(([v, l]) => '<button type="button" data-v="' + v + '"' + (v === cur ? ' class="on"' : '') + '>' + esc(l) + '</button>').join('');
  ROP = {i, kind};
  const r = b.getBoundingClientRect();
  el.classList.add('on');
  el.style.left = Math.max(8, Math.min(r.left - 12, innerWidth - el.offsetWidth - 8)) + 'px';
  /* 그 값 바로 밑에 (화면 아래 끝이면 위로) */
  el.style.top = (r.bottom + 6 + el.offsetHeight > innerHeight - 8 ? r.top - 6 - el.offsetHeight : r.bottom + 6) + 'px';
}
$('#rop').addEventListener('mousedown', e => e.preventDefault());
$('#rop').addEventListener('click', e => {
  const b = e.target.closest('[data-v]');
  if(!b || !ROP) return;
  const {i, kind} = ROP, v = b.dataset.v;
  roHide(); riseClose(true);
  if(kind === 'date') return moveTo(i, v);
  if(v === i.time) return;
  const was = i.time;
  change(taskUrl(i), {due_time:v}).then(() => undoToast(toWord(v), i.title, () => change(taskUrl(i), {due_time:was})));
});
document.addEventListener('mousedown', e => { if(ROP && !e.target.closest('#rop, .ex')){ roHide(); } });
document.addEventListener('keydown', e => { if(ROP && e.key === 'Escape'){ e.stopPropagation(); roHide(); } }, true);

/* ══════════ 끌어서 옮기기 ══════════
   할 일 · 메모는 끌어서 다른 날(다가올 날의 줄) · 오늘 · 메모로 옮긴다. 반복은 끌지 않는다 (한 회차가 아니라 규칙이다). */
let DRAG = null;
function dragDown(e, i, el){
  if(e.button !== 0 || OFFLINE || e.target.closest('.dot') || i.kind === 'routine' || i.ghost) return;
  DRAG = {i, el, x:e.clientX, y:e.clientY, moved:false};
}
document.addEventListener('pointermove', e => {
  const d = DRAG;
  if(!d) return;
  if(!d.moved){
    if(Math.hypot(e.clientX - d.x, e.clientY - d.y) < 6) return;
    d.moved = true; roHide(); riseClose(true);
    d.ghost = document.createElement('div'); d.ghost.className = 'dragg';
    d.ghost.innerHTML = '<i></i><span>' + esc(d.i.title.length > 26 ? d.i.title.slice(0, 26) + '…' : d.i.title) + '</span>';
    document.body.appendChild(d.ghost); d.el.classList.add('lift');
  }
  d.ghost.style.left = (e.clientX + 12) + 'px'; d.ghost.style.top = (e.clientY - 20) + 'px';
  const t = document.elementsFromPoint(e.clientX, e.clientY).find(x => x.dataset && x.dataset.drop != null);
  const drop = t ? t.dataset.drop : null;
  if(drop !== d.drop){
    $$('.drop-on').forEach(x => x.classList.remove('drop-on'));
    d.drop = drop;
    if(drop != null) $$('[data-drop="' + drop + '"]').forEach(x => x.classList.add('drop-on'));
  }
});
let DRAG_END = 0;
document.addEventListener('pointerup', () => {
  const d = DRAG;
  DRAG = null;
  if(!d || !d.moved) return;
  DRAG_END = Date.now();
  d.ghost.remove(); d.el.classList.remove('lift');
  $$('.drop-on').forEach(x => x.classList.remove('drop-on'));
  if(d.drop == null) return;
  const i = d.i, to = d.drop === 'memo' ? null : d.drop === '0' ? STATE.today : d.drop;
  if((to || null) === (i.kind === 'floating' ? null : i.date)) return;
  const back = i.kind === 'floating' ? {kind:'floating'} : {kind:'deadline', due_date:i.date, start_date:i.start || null};
  const patch = to == null ? {kind:'floating'} :
    {kind:'deadline', due_date:to, start_date:i.start && i.start < to ? i.start : null};
  FLASH.add(i.id);
  change(taskUrl(i), patch).then(() =>
    undoToast(to == null ? '메모로' : (to === STATE.today ? '오늘로' : fullE(to) + '로'), i.title, () => change(taskUrl(i), back)));
});
/* 방금 생기거나 옮긴 줄: 청록이 한 번 깔렸다 빠진다 */
const FLASH = new Set();
function flashRows(){
  if(!FLASH.size || calm()) { FLASH.clear(); return; }
  const ids = new Set(FLASH); FLASH.clear();
  $$('.r[data-id]').forEach(el => { if(ids.has(el.dataset.id)) replay(el, 'fl'); });
}

/* ══════════ 문장 칸 (머리) ══════════
   새 항목은 이 칸에 한 줄로 적는다: "보고서 금요일 3시" · "월말 결산 매달 마지막 영업일 !" · "출장 10/12~16".
   날짜 · 시각 · 반복으로 읽힌 말은 칠해지고 이름에서 빠진다. 오른쪽에 무엇이 만들어질지가 선다 (FRI 30 OCT 15:00).
   치는 동안 그 일이 들어갈 자리에 점선 줄이 미리 선다 (오늘 · 다가올 날 · 메모). Enter 로 넣고, Esc 로 닫는다.
     날짜 없음 → 메모 · 시각만 → 오늘 · 날짜 → 할 일 · 이어진 날 → 기간 업무 · 반복 → 루틴 · ! → 중요
   이름을 누르면 그 일이 같은 문장으로 이 칸에 올라와 고칠 수 있다 (반복은 규칙이 문장 하나로 되돌아오지 않아
   '자세히' 종이로 연다). 알림 · 설명 · 규칙의 세부는 '자세히' 에서. */
const FLD = {edit:null, ghost:null, read:null};
const SAY = $('#say');

function readSentence(raw){
  const out = {spans:[], imp:false, name:'', kind:'floating', date:null, end:null, time:'', rule:null, ruleText:''};
  let t = raw;
  const bang = /(^|\s)!(?=\s|$)/.exec(t);
  if(bang){ const a = bang.index + bang[1].length; out.imp = true; out.spans.push([a, a + 1]); t = t.slice(0, a) + ' ' + t.slice(a + 1); }
  const memo = /(^|\s)(메모|날짜\s*없음)$/.exec(t.trimEnd());
  if(memo){ const a = memo.index + memo[1].length; out.spans.push([a, a + memo[2].length]); t = t.slice(0, a) + ' '.repeat(memo[2].length) + t.slice(a + memo[2].length); }
  const opt = {today:STATE.today, isBiz:bizOn() ? isBiz : null};
  const rr = memo ? null : whenRule(t);
  let rest = t;
  if(rr){ rest = t.slice(0, rr.span[0]) + ' '.repeat(rr.span[1] - rr.span[0]) + t.slice(rr.span[1]); out.spans.push(rr.span); out.ruleText = t.slice(rr.span[0], rr.span[1]).trim(); }
  let p = memo ? null : whenParse(rest, opt);
  /* 비슷한 말로 짐작한 것(오타 고침)은 이름에서는 읽지 않는다 - 이름에 든 낱말을 날짜로 잘못 먹지 않게 */
  if(p && (p.notes || []).includes('비슷한 말로 읽음')) p = null;
  if(p){ out.spans = out.spans.concat(p.spans.map(s => [s[0], s[1]])); if(p.time) out.time = p.time; }
  if(rr){
    const base = (p && p.date) || STATE.today, d = dObj(base);
    let r = rr.rule;
    if(!r && rr.need === 'day') r = {period:'month', basis:'day', n:d.getDate()};
    if(r && r.period === 'week' && rr.need === 'wd') r = Object.assign({}, r, {weekdays:[(d.getDay() + 6) % 7]});
    if(r && r.period === 'month'){
      if(rr.every === 2){ const m0 = d.getMonth(); r = Object.assign({}, r, {months:[0, 2, 4, 6, 8, 10].map(i => (m0 + i) % 12 + 1).sort((a, b) => a - b)}); }
      if(rr.year) r = Object.assign({}, r, {months:[d.getMonth() + 1]});
    }
    if(r && r.period !== 'day') r = Object.assign({holiday_shift:'prev'}, r);
    if(r){ out.rule = r; out.kind = 'routine'; out.date = base; }
  }
  if(!out.rule){
    if(p && p.date){ out.kind = 'deadline'; if(p.start){ out.date = p.start; out.end = p.date; } else out.date = p.date; }
    else if(out.time){ out.kind = 'deadline'; out.date = STATE.today; }       /* 시각만 → 오늘 */
  }
  let n = raw;
  out.spans.slice().sort((a, b) => b[0] - a[0]).forEach(([a, b]) => { n = n.slice(0, a) + ' ' + n.slice(b); });
  out.name = n.replace(/\s+/g, ' ').trim();
  return out;
}
/* 저장할 값. 고치기에서는 알림 · 설명은 보내지 않는다 (그대로 둔다) */
function payloadOf(s, fresh){
  const p = {title:s.name, kind:s.kind, pinned:s.imp};
  if(s.kind === 'floating') Object.assign(p, {due_date:null, start_date:null, due_time:'', rule:null});
  else if(s.kind === 'deadline') Object.assign(p, {due_date:s.end || s.date, start_date:s.end ? s.date : null, due_time:s.time || '', rule:null});
  else {
    const r = Object.assign({}, s.rule);
    if(r.period === 'week') r.anchor = r.anchor || s.date || STATE.today;
    Object.assign(p, {rule:r, due_time:s.time || '', due_date:null, start_date:null});
  }
  if(fresh) Object.assign(p, {note:'', notify_min:null, muted:false, early_days:0});
  return p;
}
/* 항목 → 같은 문장 (고치기로 올릴 때) */
function sentenceOf(i){
  const p = [i.title];
  if(i.kind !== 'floating' && i.date){
    if(i.start) p.push(md(i.start) + '~' + md(i.date));
    else if(i.date !== STATE.today || !i.time) p.push(i.date === STATE.today ? '오늘' : md(i.date));
  }
  if(i.time) p.push(i.time);
  if(i.pinned) p.push('!');
  return p.join(' ');
}

/* 칸 오른쪽: 무엇이 만들어질지 */
function sumOf(s){
  if(!s || !s.name) return '';
  const a = s.kind === 'floating' ? 'NOTES' : s.kind === 'routine' ? 'ROUTINE' :
    s.end ? fullE(s.date) + ' – ' + fullE(s.end) : s.date === STATE.today ? 'TODAY' : fullE(s.date);
  return '<b>' + esc(a) + '</b>' + (s.time ? '<span>' + esc(s.time) + '</span>' : '') + (s.ruleText ? '<i>' + esc(s.ruleText) + '</i>' : '');
}
/* 문장 칸 아래 한 칸짜리 판. 쓸 것이 있을 때만 선다: 이름이 같은 일이 이미 있으면 그것 (Tab 으로 연다),
   없고 예전에 끝낸 같은 이름이 시각과 함께 있으면 그 시각 (Tab 으로 붙인다) */
function matchesOf(name){
  const ws = name.toLowerCase().split(/\s+/).filter(Boolean);
  if(!ws.length || name.length < 2) return [];
  const hit = t => { const s = t.toLowerCase(); return ws.every(w => s.includes(w)); };
  const out = [];
  (STATE.routines || []).forEach(r => { if(hit(r.title)) out.push(Object.assign({}, r, {_where:r.rule_text || 'ROUTINE'})); });
  (STATE.tasks || []).forEach(t => {
    if(t.done || t.kind === 'routine' || !hit(t.title)) return;
    const i = (t.kind || 'deadline') === 'deadline' ? asItem(t) : {id:t.id, title:t.title, note:t.note || '', kind:'floating', date:null, time:'', pinned:!!t.pinned, done:false, rule_text:''};
    i._where = i.kind === 'floating' ? 'NOTE' : (i.date === STATE.today ? 'TODAY' : shortE(i.date)) + (i.time ? '  ' + i.time : '');
    out.push(i);
  });
  return out.slice(0, 3);
}
function memoryOf(s){
  if(!s || !s.name || s.time || s.rule || s.kind === 'floating') return null;
  const n = s.name.trim().toLowerCase();
  const t = (STATE.tasks || []).filter(x => x.done && x.due_time && x.title.trim().toLowerCase() === n)
    .sort((a, b) => (b.due_date || '').localeCompare(a.due_date || ''))[0];
  return t ? {time:t.due_time} : null;
}
function paintPop(){
  const pop = $('#fpop'), t = SAY.value.trim(), s = FLD.read;
  FLD.match = null; FLD.mem = null;
  let h = '';
  if(STATE && t && !FLD.edit && (document.activeElement === SAY || CAPTURE)){
    const ms = matchesOf((s && s.name) || t);
    FLD.match = ms[0] || null;
    pop._ms = ms;
    /* 이름이 친 글자 바로 아래에 (칸의 글자 열), 어디에 있는지는 오른쪽 끝에 */
    h = ms.map((i, n) => '<button type="button" class="pm" data-m="' + n + '"><span class="pn2">' + esc(i.title) + '</span><span class="pw mono">' + esc(i._where) + '</span>' +
      '</button>').join('');
    if(!ms.length){
      FLD.mem = memoryOf(s);
      if(FLD.mem) h = '<div class="pm mem"><span class="pn2">' + FLD.mem.time + '</span><span class="pw">지난번</span></div>';
    }
  }
  pop.innerHTML = h;
  if(h){ const f = $('#field').getBoundingClientRect(); pop.style.left = f.left + 'px'; pop.style.width = f.width + 'px'; }
  pop.classList.toggle('on', !!h);
  capFit();
}
/* ↑↓: 커서가 든 말(시각 · 날)을 한 칸씩. 시각 5분 (Shift 1시간) · 날 하루 (Shift 한 주) */
function nudge(dir, big){
  const t = SAY.value, s = FLD.read;
  if(!s || s.kind === 'floating' || s.kind === 'routine') return false;
  const at = SAY.selectionStart, opt = {today:STATE.today, isBiz:bizOn() ? isBiz : null};
  const kinds = s.spans.map(([a, b]) => { const p = whenParse(t.slice(a, b), opt); return {a, b, k:p && p.time && !p.date ? 'time' : p && p.date ? 'date' : null}; }).filter(x => x.k);
  const sp = kinds.find(x => at >= x.a && at <= x.b) || kinds.find(x => x.k === 'time') || kinds.find(x => x.k === 'date');
  if(!sp) return false;
  let rep;
  if(sp.k === 'time' && s.time) rep = hhmm(((mins(s.time) + dir * (big ? 60 : 5)) % 1440 + 1440) % 1440);
  else if(sp.k === 'date' && s.date && !s.end) rep = md(addDay(s.date, dir * (big ? 7 : 1)));
  else return false;
  SAY.value = t.slice(0, sp.a) + rep + t.slice(sp.b);
  const c = sp.a + rep.length;
  SAY.setSelectionRange(c, c);
  paintField();
  return true;
}
function openFound(i){
  if(!i) return;
  fieldClose();
  if(i.kind === 'routine') return openEdit(i);
  startEdit(i);
}
$('#fpop').addEventListener('mousedown', e => e.preventDefault());     /* 칸의 초점을 뺏지 않는다 */
$('#fpop').addEventListener('click', e => {
  const m = e.target.closest('[data-m]');
  if(m) openFound($('#fpop')._ms[+m.dataset.m]);
});

function paintField(){
  const t = SAY.value, s = t.trim() && STATE ? readSentence(t) : null;
  FLD.read = s;
  let h = '', at = 0;
  if(s) s.spans.slice().sort((a, b) => a[0] - b[0]).forEach(([a, b]) => { if(a < at) return; h += esc(t.slice(at, a)) + '<mark>' + esc(t.slice(a, b)) + '</mark>'; at = b; });
  $('#fhl').innerHTML = h + esc(t.slice(at));
  $('#fhl').scrollLeft = SAY.scrollLeft;
  $('#fsum').innerHTML = sumOf(s);
  const open = !!t || !!FLD.edit || document.activeElement === SAY;
  $('#field').classList.toggle('open', open);
  document.body.classList.toggle('composing', open);
  $('#field').classList.toggle('edit', !!FLD.edit);
  $('#f-del').hidden = !FLD.edit;
  $('#f-more').hidden = !open;
  $('#plus').title = $('#plus').ariaLabel = open ? '닫기 · Esc' : '새 항목 · Ctrl N';
  /* 미리 서는 자리 */
  const g = s && s.name ? {id:'', ghost:true, title:s.name, kind:s.kind, date:s.kind === 'floating' ? null : (s.end || s.date), start:s.end ? s.date : null,
    time:s.time, pinned:s.imp} : null;
  if(g && g.kind === 'routine') g.date = null;           /* 반복은 엔진이 날을 센다 - 자리를 짐작해 세우지 않는다 */
  const was = JSON.stringify(FLD.ghost);
  FLD.ghost = g && (g.kind !== 'routine') ? g : null;
  if(JSON.stringify(FLD.ghost) !== was) drawToday();
  paintPop();
}
SAY.addEventListener('input', () => { if(view !== 'today' && SAY.value) setView('today'); paintField(); });
SAY.addEventListener('scroll', () => { $('#fhl').scrollLeft = SAY.scrollLeft; });
SAY.addEventListener('focus', paintField);
SAY.addEventListener('blur', () => setTimeout(paintField, 0));
SAY.addEventListener('keydown', e => {
  if(e.key === 'Enter' && !e.isComposing){ e.preventDefault(); fieldCommit(); }
  else if(e.key === 'Tab' && !e.shiftKey && (FLD.match || FLD.mem)){
    e.preventDefault();
    if(FLD.match) openFound(FLD.match);
    else { SAY.value = SAY.value.replace(/\s*$/, ' ') + FLD.mem.time; paintField(); }
  }
  else if((e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.isComposing){ if(nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey)) e.preventDefault(); }
  else if(e.key === 'Escape'){ e.preventDefault(); e.stopPropagation(); if(CAPTURE) return capDone(); if(SAY.value || FLD.edit) fieldClose(); else { SAY.blur(); setView('today'); } }
});
/* ══════════ 어디서든 문장 칸 (전역 단축키 · ui.py 의 작은 창) ══════════
   주소가 #capture 인 창은 문장 칸과 그 아래 판만 보인다. 넣거나(Enter) 닫으면(Esc · 다른 데를 누름)
   창을 숨기고 하던 창으로 돌아간다. 창의 높이는 판의 높이를 따라간다 (CAPTURE 는 맨 위에) */
const capApi = () => window.pywebview && window.pywebview.api;
function capFit(){
  if(!CAPTURE) return;
  const pop = $('#fpop'), h = 56 + (pop.classList.contains('on') ? pop.offsetHeight : 0);
  if(capFit._h === h) return;
  capFit._h = h;
  const a = capApi(); if(a && a.capture_fit) a.capture_fit(h).catch(() => {});
}
function capDone(){
  if(!CAPTURE) return;
  SAY.value = ''; FLD.edit = null; capFit._h = null; paintField();
  const a = capApi(); if(a && a.capture_done) a.capture_done().catch(() => {});
}
window.__lsCapture = () => { SAY.value = ''; FLD.edit = null; load().catch(() => {}); fieldOpen(); setTimeout(capFit, 0); };
if(CAPTURE) addEventListener('blur', () => setTimeout(() => { if(!document.hasFocus()) capDone(); }, 120));
function fieldOpen(text){
  if(view === 'all' || view === 'set') setView('today');
  if(text != null){ SAY.value = text; }
  SAY.focus({preventScroll:true});
  const n = SAY.value.length; try{ SAY.setSelectionRange(n, n); }catch(e){}
  paintField();
}
function fieldClose(){
  FLD.edit = null; SAY.value = ''; SAY.blur(); paintField(); drawToday();
}
/* 달력 · 다가올 날의 빈 날을 누르면 그 날짜가 칸에 들어간다 - 이름만 치면 된다 */
let HOV = null;
document.addEventListener('mouseover', e => {
  const t = e.target.closest && e.target.closest('[data-drop]');
  if(t) HOV = {d:t.dataset.drop, t:Date.now(), on:true};
  else if(HOV && HOV.on){ HOV.on = false; HOV.t = Date.now(); }
});
function addHere(now){
  const h = HOV && (HOV.on || Date.now() - HOV.t < 1500) ? HOV.d : null;
  if(h === 'memo') return openAdd('floating', {}, now);
  openAdd('deadline', h && h !== '0' ? {date:h} : {}, now);
}
/* 창 안의 새 항목은 자세히 종이 하나로 연다 - 문장만으로 넣기는 아직 날짜를 잘못 읽을 때가 있다 (2026-11).
   이름 칸에 문장을 쳐도 날짜 · 시각은 아래 값 줄에 보이는 채로 채워져, 넣기 전에 눈으로 확인하고 고친다.
   머리의 문장 칸은 어디서든 새 항목(전역 단축키의 작은 창)에만 남는다 */
function fieldDay(k){ if(CAPTURE) fieldOpen(md(k) + ' '); else openAdd('deadline', {date:k}); }
$('#plus').addEventListener('mousedown', e => e.preventDefault());
$('#plus').onclick = () => {
  if(!CAPTURE) return addHere();
  if(SAY.value || FLD.edit || document.activeElement === SAY) fieldClose(); else fieldOpen();
};
$('#field').addEventListener('mousedown', e => { if(CAPTURE && (e.target === $('#field') || e.target.closest('.fsum'))){ e.preventDefault(); fieldOpen(); } });
$('#f-del').onclick = () => { const i = FLD.edit; fieldClose(); if(i) removeSoon(i); };
/* 자세히: 지금 친 문장을 그대로 들고 종이로 간다 */
$('#f-more').addEventListener('mousedown', e => e.preventDefault());
$('#f-more').onclick = () => {
  const i = FLD.edit, t = SAY.value;
  fieldClose();
  if(i) openEdit(i);
  else { openAdd('deadline', {}); if(t){ const n = $('#a-title'); n.value = t; n.dispatchEvent(new Event('input')); } }
};

function fieldCommit(){
  if(OFFLINE) return;
  const s = FLD.read || (SAY.value.trim() ? readSentence(SAY.value) : null);
  if(!s || !s.name){ if(SAY.value.trim()) say('이름을 적어 주세요'); return; }
  const where = s.kind === 'floating' ? '메모' : s.kind === 'routine' ? '반복' : s.date === STATE.today && !s.end ? '오늘' : fullE(s.end || s.date);
  if(FLD.edit){
    const i = FLD.edit, back = {title:i.title, kind:i.kind, pinned:!!i.pinned, due_date:i.kind === 'floating' ? null : i.date,
      start_date:i.start || null, due_time:i.time || '', rule:null};
    FLASH.add(i.id);
    change(taskUrl(i), payloadOf(s, false)).then(() => {
      fieldClose();
      undoToast('고침 · ' + where, s.name, () => change(taskUrl(i), back));
    });
    return;
  }
  change('/api/task', payloadOf(s, true)).then(d => {
    if(d && d.id) FLASH.add(d.id);
    SAY.value = ''; paintField(); flashRows();
    if(CAPTURE) return capDone();
    undoToast('추가 · ' + where, s.name, () => d && d.id && sendDelete(d.id));
  });
}

/* 이름을 누르면 고치기. 문장으로 고칠 수 있는 것(할 일 · 메모)은 칸으로, 아니면 자세히 종이로.
   문장으로 되돌린 것을 다시 읽어 같은 값이 나오는지 먼저 본다 - 이름에 날짜 같은 말이 들어 있으면 문장이 달리 읽혀
   날짜가 바뀌어 버린다. 그럴 때는 종이로 연다. */
function startEdit(i){
  if(!i || i.ghost || i._inert || OFFLINE) return;
  if(i._alt && !i.id) return;
  roHide();
  if(i.kind === 'routine' || i.done || !CAPTURE) return openEdit(i);
  const t = sentenceOf(i), s = readSentence(t);
  const same = s.name === i.title && s.kind === (i.kind || 'deadline') && !!s.imp === !!i.pinned &&
    (s.time || '') === (i.time || '') && (s.kind === 'floating' || ((s.end || s.date) === i.date && (s.end ? s.date : null) === (i.start || null)));
  if(!same) return openEdit(i);
  FLD.edit = i;
  if(view !== 'today') setView('today');
  fieldOpen(t);
  drawToday();
}

/* 어디서든 글자를 치면 새 항목 종이로 (그 글자가 이름 칸에 들어간다). Ctrl+N 도 같다. Ctrl+Z 는 마지막 일을 되돌린다 */
document.addEventListener('keydown', e => {
  const tg = e.target, typing = tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA' || tg.isContentEditable);
  if($$('.modal.on').length || ctxShown()) return;
  if((e.ctrlKey || e.metaKey) && (e.key === 'n' || e.key === 'N')){ e.preventDefault(); if(CAPTURE) fieldOpen(); else addHere(true); return; }
  if(typing) return;
  if((e.ctrlKey || e.metaKey) && (e.key === 'z' || e.key === 'Z')){ if($('#undo').classList.contains('on') && !$('#undo-btn').hidden){ e.preventDefault(); $('#undo-btn').click(); } return; }
  if(e.ctrlKey || e.metaKey || e.altKey) return;
  if(view === 'cal' && /^Arrow(Left|Right)$/.test(e.key)){ shiftMonth(e.key === 'ArrowLeft' ? -1 : 1); return; }
  if(e.key === '?'){ e.preventDefault(); keysSheet(); return; }
  if(e.key.length === 1 || e.key === 'Process'){
    if(tg && tg.closest && tg.closest('.seg, button') && e.key === ' ') return;
    if(CAPTURE) fieldOpen(); else if(e.key !== ' ') addHere(true);
  }
});

/* ══════════ 화면 넘기기 (오늘 · 달력 · 전체 · 설정) ══════════ */
let view = 'today', PREV_V = 'today';
function setView(v){
  const was = view;
  if(v === 'set' && was !== 'set') PREV_V = was;
  view = v;
  ['today', 'cal', 'all', 'set'].forEach(k => { $('#v-' + k).hidden = k !== v; });
  placeTab();
  closeSheets();
  roHide();
  if(v === 'today'){ OFFT = 0; drawToday(); }
  if(v === 'cal') drawCal();
  if(v === 'all') drawAll();
  if(v === 'set'){ fillSettings(); refreshSync().catch(() => {}); }
  if(was !== v) replay($('#v-' + v), 'view-in');
}
$$('#titlebar [data-v]').forEach(b => { b.onclick = () => setView(b.dataset.v === 'set' && view === 'set' ? PREV_V : b.dataset.v); });
/* 설정은 연 곳으로 닫는다 (오른쪽 아래 닫기 · 설정 그림 다시 · Esc) */
const closeSet = () => setView(PREV_V || 'today');
$('#s-close').onclick = closeSet;
/* 고른 화면 아래의 막대: 낱말 폭 (설정이면 톱니 폭). 화면을 바꾸면 미끄러져 옮겨 간다 */
function placeTab(){
  $$('#titlebar [data-v]').forEach(b => b.classList.toggle('on', b.dataset.v === view));
  const on = $('#titlebar [data-v="' + view + '"]'), hb = $('#titlebar').getBoundingClientRect();
  const t = on && (on.querySelector('.tn, svg') || on);
  if(t){ const r = t.getBoundingClientRect(); $('#tabline').style.cssText = 'left:' + (r.left - hb.left) + 'px; width:' + r.width + 'px'; }
}
addEventListener('resize', () => { placeTab(); if(view === 'today') drawToday(); });

/* ══════════ 달력 (한 달) ══════════
   주말 두 칸은 좁게 (1 : 2 : 2 : 2 : 2 : 2 : 1) - 영업일에 쓰는 도구라 주중이 넓어야 이름이 읽힌다.
   칸: 날짜 · 공휴일 이름 · 그날의 일(점 + 이름) · 넘치면 +n. 오늘은 날짜를 청록 네모로.
   기간 업무는 칸 아래의 2px 선으로 걸친 날들을 잇는다 - 선의 높이(줄)는 그 달 안에서 기간마다 하나로 고정해
   주가 바뀌어도 같은 선이 이어진다. 이름은 시작한 날 칸에 일 한 줄로 한 번 (그 달 앞에서 시작했으면 1일 칸에).
   예전처럼 선마다 이름을 얹으면(16px 띠) 기본 창 높이에서 띠 셋이 칸을 다 차지해 마감이 하나도 보이지 않았다.
   매일 도는 반복은 싣지 않는다 - 날마다 같은 이름이 칸을 채워 마감이 안 보인다.
   빈 곳을 누르면 그 날짜가 문장 칸에 들어가고, 일을 누르면 고치기, +n 을 누르면 그날 전체. */
let calCur = null;
function shiftMonth(n){
  if(!calCur){ const d = dObj(STATE.today); calCur = {y:d.getFullYear(), m:d.getMonth()}; }
  const t = new Date(calCur.y, calCur.m + n, 1);
  calCur = {y:t.getFullYear(), m:t.getMonth()};
  drawCal();
  if(n && !calm()) $('#cal-grid').animate([{opacity:0, transform:'translateX(' + (n > 0 ? 16 : -16) + 'px)'}, {opacity:1, transform:'none'}], {duration:240, easing:EASE});
}
$('#cal-prev').onclick = () => shiftMonth(-1);
$('#cal-next').onclick = () => shiftMonth(1);
$('#cal-now').onclick = () => { calCur = null; drawCal(); };
let _calT = 0;
addEventListener('resize', () => { clearTimeout(_calT); _calT = setTimeout(() => { if(view === 'cal') drawCal(); }, 120); });

function drawCal(){
  if(!STATE || view !== 'cal') return;
  const t0 = dObj(STATE.today);
  const cur = calCur || {y:t0.getFullYear(), m:t0.getMonth()};
  $('#cal-ym').textContent = MONTH[cur.m] + ' ' + cur.y;
  $('#cal-now').hidden = !calCur || (cur.y === t0.getFullYear() && cur.m === t0.getMonth());
  const f1 = new Date(cur.y, cur.m, 1, 12), off0 = f1.getDay(), dim = new Date(cur.y, cur.m + 1, 0).getDate();
  const W = Math.ceil((off0 + dim) / 7);
  const from = iso(new Date(cur.y, cur.m, 1 - off0, 12)), to = iso(new Date(cur.y, cur.m, W * 7 - off0, 12));
  ensureRoutines(from, to);
  $('#cal-head').innerHTML = WDE.map((w, k) => '<span' + (k === 0 || k === 6 ? ' class="we"' : '') + '>' + w + '</span>').join('');
  const by = {};
  const put = (k, i) => (by[k] = by[k] || []).push(i);
  deadlines().filter(t => !isSpan(t)).forEach(t => put(t.due_date, asItem(t)));
  routineItems().filter(i => i.period !== 'day').forEach(i => put(i.date, i));
  if(FLD.ghost && FLD.ghost.date && !FLD.ghost.start) put(FLD.ghost.date, FLD.ghost);
  const first = iso(f1), last = iso(new Date(cur.y, cur.m, dim, 12));
  const spans = spanList().filter(s => s.start_date <= last && s.due_date >= first);
  const lane = spanLanes(spans);
  /* 기간은 주마다 날짜 줄 바로 아래 한 가닥 (이름 ─── 끝 눈금), 두 가닥까지. 셋째부터는 시작한 날(이 달 첫날)의 목록에 이름으로 */
  const LANES = 2, LH = 14;
  spans.filter(s => lane.get(s.id) >= LANES).forEach(s => put(s.start_date < first ? first : s.start_date, Object.assign(asItem(s), {_span:true})));
  const grid = $('#cal-grid');
  grid.style.gridTemplateRows = 'repeat(' + W + ', minmax(0, 1fr))';
  const cellH = (grid.clientHeight || 400) / W;
  const f = document.createDocumentFragment();
  const wk = w => { const a = iso(new Date(cur.y, cur.m, 1 - off0 + w * 7, 12)); return [a, addDay(a, 6)]; };
  const inWeek = w => { const [a, b] = wk(w); return spans.filter(s => lane.get(s.id) < LANES && s.start_date <= b && s.due_date >= a); };
  /* 주마다 가닥 몇 줄이 지나가는지 - 그 주의 칸은 모두 그만큼 자리를 비운다 (가닥이 칸을 가로질러 한 줄로 서게) */
  const deepOf = [...Array(W).keys()].map(w => inWeek(w).reduce((n, s) => Math.max(n, lane.get(s.id) + 1), 0));
  for(let c = 0; c < W * 7; c++){
    const dt = new Date(cur.y, cur.m, 1 - off0 + c, 12), k = iso(dt), inM = dt.getMonth() === cur.m;
    const hol = (STATE.holiday_names || {})[k], off = !isBiz(k), deep = deepOf[Math.floor(c / 7)];
    const its = inM ? (by[k] || []).slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (a.time || '99:99').localeCompare(b.time || '99:99')) : [];
    /* 칸에 들어가는 줄 수: 칸 높이 - 위 여백 8 - 날짜 줄 24 - 가닥 자리(14 × 줄 + 2), 한 줄 20 */
    const room = Math.max(0, Math.floor((cellH - 8 - 24 - (deep ? deep * LH + 2 : 0)) / 20));
    const cap = room;                         /* 넘치는 수(+n)는 날짜 줄 오른쪽에 - 일 한 줄을 잡아먹지 않게 */
    const el = document.createElement('div');
    el.className = 'cc' + (inM ? '' : ' out') + (off ? ' off' : '') + (k === STATE.today ? ' now' : '') + (k < STATE.today ? ' past' : '');
    el.style.gridArea = (Math.floor(c / 7) + 1) + ' / ' + (c % 7 + 1);
    el.dataset.drop = k;
    el.innerHTML = '<div class="ch"><span class="cn">' + dt.getDate() + '</span>' + (inM && hol ? '<span class="hn">' + esc(hol) + '</span>' : '') + '</div>' +
      (deep ? '<div class="cl" style="height:' + deep * LH + 'px"></div>' : '');
    its.slice(0, cap).forEach(i => {
      const e = document.createElement('div');
      e.className = 'ce' + (i.done ? ' done' : '') + (isLate(i) && !i._span ? ' late' : '') + (i.ghost ? ' ghost' : '') + (i.pinned && !i.done ? ' imp' : '') + (i._span ? ' sp' : '');
      e.innerHTML = '<i></i><span>' + esc(i.title) + '</span>';
      e._it = i;
      if(!i.ghost){
        e.onclick = ev => { ev.stopPropagation(); dayModal(k, dayItems(k), i); };
        e.oncontextmenu = ev => { ev.preventDefault(); ev.stopPropagation(); roHide(); ctxOpen(ev.clientX, ev.clientY, i); };
      }
      el.appendChild(e);
    });
    if(its.length > cap){
      const m = document.createElement('button');
      m.type = 'button'; m.className = 'cm'; m.textContent = '+' + (its.length - cap);
      m.title = '그날 전체';
      m.onclick = ev => { ev.stopPropagation(); dayModal(k, dayItems(k)); };
      el.querySelector('.ch').appendChild(m);
    }
    /* 날짜를 누르면 그날 전체 (그날을 한눈에 - 새 항목은 그 종이의 '이 날에 추가', 또는 칸 위에서 + · Ctrl N) */
    el.onclick = () => dayModal(k, dayItems(k));
    f.appendChild(el);
  }
  /* 가닥: 그 주에서 이 달 안에 보이는 구간만. 이름은 구간 첫날에 (진짜 시작한 날이면 진하게), 진짜 끝나는 날에 끝 눈금 */
  for(let w = 0; w < W; w++){
    const [a, b] = wk(w);
    inWeek(w).forEach(s => {
      const s0 = [s.start_date, a, first].sort()[2], s1 = [s.due_date, b, last].sort()[0];
      if(s0 > s1) return;
      const bar = document.createElement('div');
      bar.className = 'cbar' + (s.start_date === s0 ? ' st' : '') + (s.due_date === s1 ? ' en' : '') + (s.done ? ' done' : '');
      bar.style.gridArea = (w + 1) + ' / ' + (dayDiff(a, s0) + 1) + ' / ' + (w + 2) + ' / ' + (dayDiff(a, s1) + 2);
      bar.style.marginTop = (8 + 22 + 2 + 4 + lane.get(s.id) * LH) + 'px';   /* 칸 위 여백 8 + 날짜 줄 22 + 2 + 칸의 틈 4 */
      /* 좁은 일요일 칸에서 시작하는 가닥은 이름을 월요일 칸에서 쓴다 (일요일 칸은 선만) - 이름이 칸 경계에 걸치지 않게.
         지난주에서 이어진 하루짜리 조각은 이름 없이 선과 끝 눈금만 (좁은 칸에 '월간 ···' 은 읽히지 않는다) */
      const len = dayDiff(s0, s1) + 1, cont = s.start_date !== s0;
      if(dayDiff(a, s0) === 0 && len > 1){ bar.classList.add('lo'); bar.style.setProperty('--lo', (grid.clientWidth / 12) + 'px'); }
      bar.innerHTML = cont && len === 1 ? '' : '<span class="lt">' + esc(s.title) + '</span>';
      const it = asItem(s);
      bar._it = it;
      bar.onclick = ev => { ev.stopPropagation(); dayModal(s0, dayItems(s0), it); };
      bar.oncontextmenu = ev => { ev.preventDefault(); ev.stopPropagation(); roHide(); ctxOpen(ev.clientX, ev.clientY, it); };
      f.appendChild(bar);
    });
  }
  grid.replaceChildren(f);
}

/* 그날 전체: 달력의 날짜 · +n · 일, 다가올 날의 날 머리. at: 그 일을 떠오른 채로 (달력에서 일을 눌렀을 때 - 그 일의 값과 고치기가 곧바로) */
function dayModal(key, list, pick){
  DAY_KEY = key;
  /* 시각 있는 일 → 시각 없는 일 → 그날에 걸친 기간 (달력 칸의 순서와 같다) */
  const sp = spansOn(key), at = t => t.time || t.due_time;
  const all = list.filter(at).concat(list.filter(t => !at(t)), sp);
  $('#day-title').innerHTML = '<span class="mono">' + esc(fullE(key)) + '</span><i class="opt cnt">' + all.length + '</i>';
  const box = $('#day-list');
  box.innerHTML = '';
  all.forEach(t => {
    const i = t._rt ? t : (t.due_date ? asItem(t) : t);
    const el = rowEl(i, {lab:{a:'', b:i.start ? '' : (i.time || '')}});
    box.appendChild(el);
  });
  if(!box.children.length) box.innerHTML = '<div class="empty">없음</div>';
  $('#day-add').onclick = () => { closeM('#m-day'); fieldDay(key); };
  openM('#m-day');
  const r = pick && [...box.querySelectorAll('.r')].find(x => x.dataset.k === keyOf(pick));
  if(r){ riseOpen(r); RISE.pin = true; r.scrollIntoView({block:'nearest'}); }
}

/* ══════════ 전체 ══════════
   왼쪽: 모든 항목을 넷으로 - Routines · Tasks · Notes · Done. 오른쪽: 고른 하나의 값 전부와, 그것을 문장으로 적으면
   어떻게 되는지 (문장 칸에 이렇게 치면 같은 일이 만들어진다). 고치기는 자세히 종이로. */
let ALL_SEL = null;
function allGroups(){
  const T = STATE.tasks || [];
  const rts = (STATE.routines || []).slice().sort((a, b) => (a.time || '99:99').localeCompare(b.time || '99:99'));
  const asIt = t => (t.kind || 'deadline') === 'deadline' ? asItem(t) :
    {id:t.id, title:t.title, note:t.note || '', kind:'floating', date:null, time:'', pinned:!!t.pinned, done:!!t.done, rule_text:''};
  const tasks = T.filter(t => (t.kind || 'deadline') === 'deadline' && !t.done && t.due_date).map(asIt)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99:99').localeCompare(b.time || '99:99'));
  const notes = T.filter(t => t.kind === 'floating' && !t.done).map(asIt);
  const done = T.filter(t => t.kind !== 'routine' && t.done).map(asIt).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
  return [['Routines', rts], ['Tasks', tasks], ['Notes', notes], ['Done', done]];
}
function allLab(i){
  if(i.kind === 'routine') return {a:'', b:i.time || ''};
  if(!i.date) return {a:'', b:''};
  if(i.date === STATE.today) return i.time ? {a:'', b:i.time} : {a:'TODAY', b:''};
  return lblOf(i.date);
}
function drawAll(){
  if(!STATE || view !== 'all') return;
  const G = allGroups(), box = $('#all-list');
  const all = [].concat(...G.map(g => g[1]));
  if(!ALL_SEL || !all.some(i => i.id === ALL_SEL)) ALL_SEL = all.length ? all[0].id : null;
  const f = document.createDocumentFragment();
  G.forEach(([name, list], n) => {
    const h = document.createElement('div');
    h.className = 'gh' + (n ? ' gap' : '');
    h.innerHTML = '<span>' + name + '</span><span class="gc">' + list.length + '</span>';
    f.appendChild(h);
    list.forEach(i => {
      const el = rowEl(i, {lab:allLab(i), cls:i.id === ALL_SEL ? 'sel' : ''});
      el.addEventListener('click', e => {
        if(e.target.closest('.dot')) return;
        e.stopImmediatePropagation();
        ALL_SEL = i.id; drawAll();
      }, true);
      f.appendChild(el);
    });
  });
  const keep = box.scrollTop;
  box.replaceChildren(f);
  box.scrollTop = keep;
  drawInsp(all.find(i => i.id === ALL_SEL));
}
function drawInsp(i){
  const box = $('#insp');
  if(!i){ box.innerHTML = '<div class="gh"><span>Details</span></div><p class="empty">적어 둔 일이 없습니다</p>'; return; }
  const late = isLate(i);
  const m = t => '<span class="m">' + esc(t) + '</span>';      /* 값 안의 시각만 mono */
  const alert = !i.time ? (STATE.settings.brief_time ? '아침 브리핑 ' + m(STATE.settings.brief_time) : '없음')
    : i.muted ? '끔' : m(hhmm(Math.max(0, mins(i.time) - (i.notify_min != null ? i.notify_min : defLead())))) +
      (i.early_days ? ' · ' + esc(EARLY_W[i.early_days] || i.early_days + '일') + ' 전에도' : '');
  const rows = [
    ['이름', esc(i.title), 'n'],
    i.kind === 'routine' ? ['다음', i.next_date ? esc(fullE(i.next_date)) : '없음', i.next_date ? 'm' : 'dim'] :
      ['날짜', i.date ? esc(fullE(i.date)) : '없음', i.date ? 'm' : 'dim'],
    ['시각', i.time ? esc(i.time) : '없음', i.time ? 'm' : 'dim'],
    ['반복', i.rule_text ? esc(i.rule_text) : '안 함', i.rule_text ? '' : 'dim'],
    ['알림', alert, ''],
    ['중요도', i.pinned ? '중요' : '보통', i.pinned ? '' : 'dim'],
    ['상태', i.done ? '끝냄' : late ? '늦음' : '할 것', late ? 'late' : ''],
  ];
  if(i.start) rows.push(['기간', esc(shortE(i.start) + ' – ' + shortE(i.date)), 'm']);
  if(i.note) rows.push(['설명', esc(i.note), '']);
  box.innerHTML = '<div class="gh"><span>Details</span></div>' +
    rows.map(([k, v, c]) => '<div class="kv"><span class="kk">' + k + '</span><span class="vv ' + c + '">' + v + '</span></div>').join('') +
    '<div class="acts"><button class="btn" type="button" data-a="edit">고치기</button>' +
    (i.kind !== 'routine' ? '<button class="btn" type="button" data-a="done">' + (i.done ? '끝냄 취소' : '끝냄') + '</button>' : '') +
    '<button class="lnk bad" type="button" data-a="del">삭제</button></div>';
  box.querySelector('.acts').onclick = e => {
    const b = e.target.closest('[data-a]'); if(!b) return;
    if(b.dataset.a === 'edit') openEdit(i);
    else if(b.dataset.a === 'done') setDone(i, !i.done);
    else if(b.dataset.a === 'del') removeSoon(i);
  };
}

/* ══════════ 설정 ══════════
   바꾸는 즉시 저장한다 (저장 단추가 없다). 바뀐 한 가지만 보낸다 - 다른 기기에서 바뀐 값을 이 창의 옛 값으로 덮지 않게.
   값은 모두 칸 묶음(seg)에서 고른다. 지금 값이 묶음에 없으면(예전에 손으로 적은 15분) 그 값도 한 칸으로 세운다. */
const ON_MAC = document.documentElement.dataset.os === 'mac';
if(ON_MAC){
  $('#s-shortcut').hidden = true;
  $('#s-where').textContent = '~/Library/Application Support/LazyScheduler';
}
/* 값 고르기: 미리 정한 값 몇 개 + 끝에 '직접' (custom). 직접을 누르면 그 자리가 입력 칸이 된다 (Enter 로 정한다).
   지금 값이 미리 정한 값에 없으면(예전에 손으로 적은 15분) 그 값도 한 칸으로 세운다 */
function segFill(id, opts, cur, onPick, custom){
  const box = $(id);
  if(!opts.some(o => o[0] === cur)) opts = opts.concat([[cur, custom ? custom.label(cur) : String(cur)]]);
  box.innerHTML = opts.map(([v, l]) => '<button type="button" class="' + (v === cur ? 'on' : '') + (/^\d/.test(l) ? ' mono' : '') +
    '" data-v="' + esc(JSON.stringify(v)) + '">' + esc(l) + '</button>').join('') +
    (custom ? '<button type="button" class="cu" data-cu>직접</button>' : '');
  box.onclick = e => {
    const b = e.target.closest('button'); if(!b || b.classList.contains('on')) return;
    if(b.dataset.cu != null){
      b.outerHTML = '<input class="segin" placeholder="' + custom.ph + '" aria-label="직접 넣기">';
      const inp = box.querySelector('.segin');
      inp.focus();
      inp.onkeydown = ev => {
        if(ev.key === 'Escape'){ ev.stopPropagation(); fillSettings(); return; }
        if(ev.key !== 'Enter') return;
        const v = custom.read(inp.value);
        if(v == null){ say(custom.bad); return; }
        onPick(v);
      };
      inp.onblur = () => setTimeout(fillSettings, 120);
      return;
    }
    $$(id + ' button').forEach(x => x.classList.toggle('on', x === b));
    onPick(JSON.parse(b.dataset.v));
  };
}
const ONOFF = [[true, '켬'], [false, '끔']];
const HOTKEYS = [['ctrl+alt+space', 'Ctrl Alt Space'], ['', '끔']];
const hotLabel = k => k ? k.split('+').map(x => x === 'space' ? 'Space' : x.length > 1 ? x[0].toUpperCase() + x.slice(1) : x.toUpperCase()).join(' ') : '끔';
function fillSettings(){
  if(!STATE) return;
  const st = STATE.settings, at = id => v => saveSetting(v, id);
  const lead = st.notify_min != null ? st.notify_min : 30;
  segFill('#s-lead', [[0, '정각'], [10, '10분'], [30, '30분'], [60, '1시간']], lead, v => at('#s-lead')({notify_min:v}),
    {label:leadLabel, ph:'분', bad:'0 ~ 1440 사이의 분으로 적어 주세요', read:t => { const n = parseInt(String(t).replace(/[^0-9]/g, ''), 10);
      const m = /시간/.test(t) ? n * 60 : n; return m >= 0 && m <= 1440 ? m : null; }});
  segFill('#s-brief', [['08:00', '08:00'], ['08:30', '08:30'], ['09:00', '09:00']], st.brief_time || '08:30', v => at('#s-brief')({brief_time:v}),
    {label:v => v, ph:'7:45', bad:'시각을 알아볼 수 없습니다 (예: 745 · 7:45)', read:t => parseTime(t) || null});
  segFill('#s-hold', [[true, '미룸'], [false, '그대로']], st.hold_when_busy !== false, v => at('#s-hold')({hold_when_busy:v}));
  segFill('#s-biz', ONOFF, bizOn(), v => at('#s-biz')({business_only:v}));
  /* 영업일 셈이 아는 공휴일이 몇 년까지인지 (받은 표 · desktop/holidays.py). 다음 해를 모르면 빨강 */
  const hol = STATE.holiday_state || {}, gd = hol.got && hol.got.split('-');
  $('#s-biz-d').textContent = hol.until ? '공휴일 ' + hol.until + '년까지' + (gd ? ' · ' + (+gd[1]) + '월 ' + (+gd[2]) + '일 받음' : '') : '';
  $('#s-biz-d').classList.toggle('bad', !!hol.until && hol.until <= +STATE.today.slice(0, 4));
  segFill('#s-end', [['17:00', '17:00'], ['18:00', '18:00'], ['19:00', '19:00']], st.day_end || '18:00', v => at('#s-end')({day_end:v}),
    {label:v => v, ph:'1830', bad:'시각을 알아볼 수 없습니다', read:t => parseTime(t) || null});
  const hk = st.hotkey != null ? st.hotkey : 'ctrl+alt+space', hs = STATE.hotkey || {};
  segFill('#s-hot', HOTKEYS.slice(), hk, v => at('#s-hot')({hotkey:v}));
  if(!HOTKEYS.some(h => h[0] === hk)) $('#s-hot button.on').textContent = hotLabel(hk);
  /* 이 줄은 문제가 있을 때만 말한다 */
  $('#s-hot-d').textContent = hs.unsupported ? '이 Mac 에서는 아직 없음' : hk && hs.ok === false ? '다른 프로그램이 쓰는 키' : '';
  $('#s-hot-d').classList.toggle('bad', hs.ok === false && !!hk);
  segFill('#s-theme', [['auto', '자동'], ['light', '낮'], ['dark', '밤']], st.theme || 'auto', v => { themeTo(() => { THEME = v; }); at('#s-theme')({theme:v}); });
  segFill('#s-auto', ONOFF, !!st.autostart, v => at('#s-auto')({autostart:v}));
  segFill('#s-upd', ONOFF, st.auto_update !== false, v => at('#s-upd')({auto_update:v}));
  $('#s-ver').textContent = 'v' + (STATE.version || '');
  paintUpdate();
}
/* 바꾸면 그 줄 이름 옆에 '저장됨' 이 잠깐 선다 (저장 단추가 없으니 저장됐다는 대답이 있어야 한다) */
function saveSetting(patch, id){
  return change('/api/settings', patch).then(() => {
    const row = id && $(id) && $(id).closest('.srow');
    if(!row) return;
    let m = row.querySelector('.saved');
    if(!m){ m = document.createElement('i'); m.className = 'saved'; m.textContent = '저장됨'; row.querySelector('.sl b').appendChild(m); }
    m.classList.remove('on'); void m.offsetWidth; m.classList.add('on');
    clearTimeout(m._t); m._t = setTimeout(() => m.classList.remove('on'), 1200);
  }).catch(e => { say(e.message); fillSettings(); });
}

/* ══════════ 자동 업데이트 ══════════
   서비스(updater.py)가 조용한 때 새 버전으로 바꿔 끼우고, 바꾼 뒤 처음 여는 창에 한 번
   "무엇이 바뀌었는지" 를 보여 준다. 닫으면(확인 · 바깥 · Esc) 서비스에 봤다고 알려 다시 뜨지 않는다. */
let UPD_OPEN = false;
function updNotice(u){
  if(!u || UPD_OPEN || SHOT_MIN != null) return;
  UPD_OPEN = true;
  $('#up-ver').textContent = (u.from ? u.from + ' → ' : '') + u.to;
  const lines = String(u.notes || '').split(/\r?\n/)
    .map(l => l.replace(/^\s*(?:[-*·•]|\d+\.)\s*/, '').replace(/[#*`]/g, '').trim())
    .filter(Boolean).slice(0, 6);
  $('#up-notes').innerHTML = lines.map(l => '<li>' + esc(l) + '</li>').join('');
  $('#up-notes').hidden = !lines.length;
  openM('#m-update');
}
function updSeen(){
  if(!UPD_OPEN) return;
  api('/api/update/seen', {}).catch(() => {});
}
$('#up-ok').onclick = () => closeM('#m-update');

/* 서비스에게 사람이 창을 쓰는지 알린다 - 보이는지와 실제 입력. 입력은 1분에 한 번만. */
let _uiT = 0;
const uiTell = b => api('/api/ui', Object.assign({visible: !document.hidden}, b)).catch(() => {});
document.addEventListener('visibilitychange', () => uiTell({}));
['mousedown', 'keydown', 'wheel'].forEach(t => document.addEventListener(t, () => {
  if(Date.now() - _uiT < 60000) return;
  _uiT = Date.now();
  uiTell({input: true});
}, {passive: true}));
uiTell({input: !document.hidden});

/* 설정 바닥의 버전 한 줄: 지금 버전 · 자동 업데이트가 어디까지 왔는지 · [업데이트 확인] (받아 둔 것이 있으면 [지금 업데이트]) */
let _updT = 0;
function paintUpdate(u){
  const show = u => {
    const busy = u.state === 'checking' || u.state === 'downloading';
    const tail = u.state === 'ready' ? u.latest + ' 받아 둠'
               : u.state === 'downloading' ? u.latest + ' 받는 중'
               : u.state === 'checking' ? '확인 중'
               : u.state === 'available' ? u.latest + ' 있음 (소스로 도는 중)'
               : u.state === 'error' ? (u.error === 'offline' ? '인터넷 연결 없음' : '확인하지 못함')
               : u.checked && u.latest && u.latest === u.version ? '최신' : '';
    $('#s-ver').textContent = 'v' + u.version;
    $('#s-vst').textContent = tail;
    const b = $('#s-upd-btn');
    b.textContent = u.state === 'ready' ? '지금 업데이트' : '업데이트 확인';
    b.dataset.act = u.state === 'ready' ? 'apply' : 'check';
    b.disabled = busy;
    clearTimeout(_updT);
    if(busy && view === 'set') _updT = setTimeout(() => paintUpdate(), 1500);
  };
  if(u) return show(u);
  api('/api/update').then(show).catch(() => {});
}
$('#s-upd-btn').onclick = e => {
  const b = e.currentTarget;
  if(b.dataset.act === 'apply'){
    b.disabled = true;
    $('#s-vst').textContent = '새 버전으로 바꾸는 중 · 곧 다시 열립니다';
    api('/api/update/apply', {}).catch(err => { say(err.message); paintUpdate(); });
    return;
  }
  api('/api/update/check', {}).then(paintUpdate).catch(err => say(err.message));
};

/* ══════════ 동기화 ══════════
   로그인은 브라우저에서 사람이 마쳐야 끝난다. 시작만 부탁하고, 설정을 보는 동안 1.5초마다 진행을 묻는다. */
let syncPoll = null;
function paintSync(s){
  const msg = $('#sync-msg'), btn = $('#sync-btn'), now = $('#sync-now'), del = $('#sync-del');
  btn.disabled = false;
  now.hidden = del.hidden = !(s.configured && s.signed_in);
  now.disabled = del.disabled = !!s.syncing;
  if(!s.configured){ msg.textContent = '동기화 설정이 없는 빌드입니다'; btn.hidden = true; return; }
  btn.hidden = false;
  if(s.state === 'waiting'){
    msg.textContent = '브라우저에서 Google 로그인을 마쳐 주세요…';
    btn.textContent = '기다리는 중'; btn.disabled = true;
  }else if(s.signed_in){
    const when = s.syncing ? '맞추는 중…' : s.sync_error ? s.sync_error : s.last_sync ? s.last_sync + ' 에 맞춤' : '곧 맞춥니다';
    msg.textContent = s.email + ' · ' + when + (s.pending ? ' · 보낼 변경 ' + s.pending : '');
    btn.textContent = '로그아웃';
  }else{
    msg.textContent = s.state === 'error' ? s.error : '';
    btn.textContent = '로그인';
  }
}
function refreshSync(){
  clearTimeout(syncPoll);
  return api('/api/sync').then(s => {
    paintSync(s);
    if((s.state === 'waiting' || s.syncing) && view === 'set') syncPoll = setTimeout(refreshSync, 1500);
    return s;
  });
}
$('#sync-btn').onclick = () => api('/api/sync').then(s => {
  if(s.signed_in){
    confirmBox('로그아웃할까요?', '이 PC 의 일정은 그대로 남습니다. 다시 로그인하면 이어서 맞춥니다.',
      () => api('/api/sync/signout', {}).then(after => { closeM('#m-confirm'); paintSync(after); say('로그아웃했습니다'); }), '로그아웃');
  }else api('/api/sync/signin', {}).then(() => refreshSync());
});
/* 계정 지우기. 되돌릴 수 없으므로 무엇이 지워지고 무엇이 남는지 먼저 적는다. 이 PC 의 일정은 기본으로 남긴다 */
$('#sync-del').onclick = () => confirmBox(
  '계정과 클라우드 데이터를 지울까요?',
  '클라우드에 올라간 일정이 모두 지워지고 로그인이 끊깁니다. 되돌릴 수 없습니다.',
  () => {
    const local = !!($('#cf-local') && $('#cf-local').checked);
    $('#cf-ok').disabled = true; $('#cf-ok').textContent = '지우는 중…';
    api('/api/sync/delete-account', {local: local})
      .then(after => { closeM('#m-confirm'); paintSync(after); say('계정을 지웠습니다' + (after.wiped ? ' · 이 PC 의 일정 ' + after.wiped + '건도' : '')); load(); })
      .catch(e => { closeM('#m-confirm'); say(e.message); })
      .then(() => { $('#cf-ok').disabled = false; $('#cf-ok').textContent = '삭제'; });
  }, '삭제',
  '<label class="chk"><input type="checkbox" id="cf-local"> 이 PC 의 일정도 함께 지우기 <i class="opt">기본은 남겨 둡니다</i></label>' +
  '<label class="chk"><input type="checkbox" id="cf-ack"> 되돌릴 수 없다는 것을 확인했습니다</label>', true);
$('#sync-now').onclick = () => api('/api/sync/now', {}).then(() => {
  $('#sync-msg').textContent = '맞추는 중…';
  setTimeout(() => refreshSync().then(() => load()), 3500);
});
$('#s-shortcut').onclick = () => api('/api/shortcut', {})
  .then(r => say(r.ok ? '바탕화면에 바로가기를 만들었습니다' : '바로가기를 만들지 못했습니다'));
$('#s-test').onclick = () => api('/api/test-toast', {}).then(() => say('알림을 띄웠습니다 (오른쪽 아래)'));
$('#s-quit').onclick = () => confirmBox('완전히 종료할까요?',
  '알림도 함께 멈춥니다. 바탕화면 아이콘으로 다시 시작할 수 있습니다.',
  () => { api('/api/quit', {}); setTimeout(() => window.pywebview ? window.pywebview.api.close() : window.close(), 400); },
  '종료');

/* ══════════ 새로 읽기 ══════════
   45초마다 다시 읽는다. 창이 숨어 있는 동안에는 묻지 않는다 - 다시 보이는 순간 곧바로 한 번 읽는다.
   창은 Win32 로 숨기고 보이므로 visibilitychange 가 오지 않을 수 있다. 그래서 창 프로세스가 보일 때
   __lsShown 을 불러 주고(ui.py), × 를 누를 때 HIDDEN 을 세운다. */
const POLL_MS = 45000;
let HIDDEN = false;
function setHidden(on){ HIDDEN = on; document.body.classList.toggle('away', on); }
const onScreen = () => !HIDDEN && !document.hidden;
function wake(){
  setHidden(false);
  if(Date.now() - lastLoad > 3000) load();
}
window.__lsShown = wake;
document.addEventListener('visibilitychange', () => { if(!document.hidden) wake(); });
addEventListener('focus', () => { if(HIDDEN || Date.now() - lastLoad > POLL_MS) wake(); });
/* 첫 읽기는 sky.js 까지 모두 읽힌 뒤에 */
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => load());
else load();
setInterval(() => { if(onScreen()) load(); }, POLL_MS);

/* ══════════ 화면 갈무리 ══════════
   tools/shots.py 가 창을 하나씩 열어 두고 찍는다. 주소에 #shot=이름 을 붙이면 그 화면이 열린 채로 멈춘다.
   시각은 한낮(11시)으로 못 박는다. 평소에는 이 고리가 아무 일도 하지 않는다. */
function shotHook(){
  const m = /^#shot=([a-z-]+)$/.exec(location.hash || '');
  if(!m) return;
  SHOT_MIN = 11 * 60;
  if(m[1] === 'night') SHOT_MIN = 21 * 60;
  /* 빛은 낮으로 못 박는다 (밤 화면만 밤) - 이 PC 가 밤 모드여도 같은 그림이 나오게 */
  if(STATE) STATE.settings.theme = m[1] === 'night' ? 'dark' : 'light';
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{transition:none !important; animation:none !important}';
  document.head.appendChild(st);
  const HHMM = hhmm(SHOT_MIN);
  if(RAW) RAW.now = HHMM;
  $('#clock')._v = HHMM; $('#clock').textContent = HHMM;
  repaint();
  const first = () => (STATE.todays || []).find(i => !i.done && i.time) || (STATE.todays || [])[0] || (STATE.overdue || [])[0];
  const firstRow = () => $('#drum .r.lens') || $('#drum .r');
  const go = {
    home:       () => {},
    night:      () => relight(),
    cal:        () => setView('cal'),
    all:        () => setView('all'),
    settings:   () => setView('set'),
    type:       () => { openAdd('deadline', {}); const n = $('#a-title'); n.value = '분기 운용보고서 초안 다음주 화요일 3시'; n.dispatchEvent(new Event('input')); },
    hover:      () => { const el = $('#up .r[data-id]'); if(el) riseOpen(el); },
    add:        () => { openAdd('deadline', {date:addDay(STATE.today, 2)}); $('#a-title').value = '분기 운용보고서 초안'; },
    'add-rt':   () => { openAdd('routine', {}); $('#a-title').value = '월말 결산'; },
    'add-say':  () => { openAdd('deadline', {}); $('#a-title').value = '분기 운용보고서 초안';
                        const f = $('#m-add .win'); f.focus(); f.value = '매달 넷째 목 오전 10시'; f.dispatchEvent(new Event('input')); },
    'add-memo': () => openAdd('floating', {}),
    morning:    () => { SHOT_NODOOR = false; triStart('am', amPool()); },
    evening:    () => { SHOT_NODOOR = false; SHOT_MIN = 18 * 60 + 40; drawToday(); },
    edit:       () => { const i = first(); if(i) openEdit(i); },
    day:        () => { setView('cal'); dayModal(STATE.today, dayItems(STATE.today)); },
    time:       () => { openAdd('deadline', {date:addDay(STATE.today, 1)}); $('#a-title').value = '견적서 회신';
                        setTimeout(() => $('#m-add .tin').focus(), 150); },
    ctx:        () => {
      const i = first(), el = firstRow();
      if(!i || !el) return;
      OFFLINE = false;
      const r = el.getBoundingClientRect();
      ctxOpen(r.left + 300, r.bottom + 2, i);
    },
    undo:       () => { undoToast('끝냄', (first() || {title:'국내 일임 매매'}).title, () => {}); clearTimeout(undoToast._t); },
  };
  const f = go[m[1]];
  if(f) setTimeout(f, 80);
}
