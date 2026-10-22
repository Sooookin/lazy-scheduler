const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
/* 서비스는 비밀값이 없는 요청을 거절한다 (다른 웹 페이지가 일정을 건드리지 못하게).
   값은 서비스가 index.html 을 내줄 때 meta 태그에 심어 준다. */
/* 화면 갈무리(tools/shots.py) 중에만 값이 들어간다. 파일 끝에서 let 으로 선언하면
   tickClock 이 먼저 읽어 TDZ 로 스크립트가 통째로 죽는다 - var 로 맨 위에 둔다. */
var SHOT_MIN = null;

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
const WD_SUN = ['일','월','화','수','목','금','토'];
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
  const top = document.body.classList.contains('peek') ? $('#sky').getBoundingClientRect().bottom + 8 : 8;
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
  /* 하늘이 펴지며 종이가 내려가는 거리만큼 아래에, 처음부터 마지막 자리에 놓는다.
     예전에는 종이를 0.14초마다 네 번 따라가서 판이 뚝뚝 끊겨 내려왔다 */
  const dy = peekOpen(el);
  $('#tp').classList.add('on');
  tpPlace(dy);
}
function tpClose(){
  $('#tp').classList.remove('on');
  TP.input = null;
  peekClose();
}

/* 새 항목 · 수정에서 시각 칸을 누르면 접혀 있던 하늘이 다시 펼쳐지고, 고른 시각이
   궤도 위에 점선 구슬로 먼저 놓인다 - 저장하면 실선이 된다. 무엇을 고르는지가
   하루 가운데 어디쯤인지로 보인다. 종이가 88px 내려가므로 시각 고르기 판도
   그 움직임이 끝날 때까지 칸을 따라간다. */
let PEEK = null;                    /* 점선 구슬의 시각 (분) · 없으면 null */
/* 종이의 윗변을 하늘 아랫변에 맞춰 옮긴다. 윗변(top)은 한 번에 바꾸고, 눈에는 transform 으로
   미끄러져 보이게 한다 (하늘의 skyFlip 과 같은 방법). top 을 움직이던 때는 0.5초 동안 매 프레임
   종이 안을 통째로 다시 배치하고 다시 칠했다. 옮긴 거리(px)를 돌려준다. */
function sheetFlip(change){
  const s = document.querySelector('.modal.sheet.on');
  if(!s){ change(); return 0; }
  const a = s.getBoundingClientRect().top;
  change();
  const d = s.getBoundingClientRect().top - a;
  if(!d) return 0;
  s.style.transition = 'none';
  s.style.transform = 'translateY(' + (-d) + 'px)';
  s.offsetHeight;                             /* 시작 자리를 먼저 그리게 한다 */
  s.style.transition = '';
  s.style.transform = '';
  return d;
}
function peekOpen(el){
  /* 하늘을 끄면 펼쳐 보일 궤도가 없다 - 종이만 괜히 내려앉는다 */
  if(!el.closest('#m-add, #m-edit') || document.body.classList.contains('no-sky')) return 0;
  const d = sheetFlip(() => document.body.classList.add('peek'));
  peekSet(el.value);
  return d;
}
function peekSet(v){
  if(!document.body.classList.contains('peek')) return;
  const t = parseTime(v);
  PEEK = t ? mins(t) : null;
  if(STATE && SKY_ALL) drawSky(SKY_ALL);
}
function peekClose(){
  if(!document.body.classList.contains('peek')) return;
  sheetFlip(() => document.body.classList.remove('peek'));
  PEEK = null;
  if(STATE && SKY_ALL) drawSky(SKY_ALL);
}
document.addEventListener('tf-change', e => { if(e.target === TP.input) peekSet(e.target.value); });
document.addEventListener('input', e => {
  if(e.target !== TP.input) return;
  tpDraw();
  peekSet(e.target.value);
});
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

const say = m => { $('#status').textContent = m; clearTimeout(say._t); say._t = setTimeout(()=>$('#status').textContent='', 2800); };
/* 처리하지 않은 요청 실패는 아래 상태줄에 보여준다 (조용히 삼키지 않는다).
   .then 으로 이어 둔 "창 닫기 · 저장됨" 은 실행되지 않으므로 입력한 내용도 그대로 남는다. */
addEventListener('unhandledrejection', e => {
  e.preventDefault();
  say((e.reason && e.reason.message) || '요청을 처리하지 못했습니다');
});

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
   크기를 바꾼다. 화면은 창 크기에 비례해서 커진다 (ui.apply_zoom). */
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
  if(ev.button !== 0 || ev.target.closest('button')) return;
  const a = window.pywebview && window.pywebview.api;
  if(a && a.begin_move){ ev.preventDefault(); a.begin_move(); }
});
$('#titlebar').addEventListener('dblclick', ev => {
  if(!ev.target.closest('button')) $('#w-max').click();
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
/* 시각은 12시간으로 보인다: "13:00" → 01:00 PM (AM · PM 은 오른쪽에 작게). 저장 · 입력 · 비교는
   24시간 그대로다 - 보여 줄 때만 이 둘을 거친다. tmHTML 은 화면 글자, tmText 는 글자만 (손끝 카드 · 하늘 이름표). */
function ap12(t){
  const m = /^(\d{1,2}):(\d{2})$/.exec(t || '');
  if(!m) return null;
  const h = +m[1];
  return {hm: String(h % 12 || 12).padStart(2, '0') + ':' + m[2], ap: h < 12 ? 'AM' : 'PM'};
}
const tmText = t => { const a = ap12(t); return a ? a.hm + ' ' + a.ap : (t || ''); };
const tmHTML = t => { const a = ap12(t); return a ? esc(a.hm) + '<small class="ap">' + a.ap + '</small>' : esc(t || ''); };

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

/* ══════════ 항목 행 ══════════
   완료는 동그라미로만 한다. 줄을 누르면 열린다 (고치기 · 자세히).
   예전에는 줄 전체가 "다 했다" 였고 수정은 연필에 맡겼는데, 열어 보려던 손이
   완료를 눌렀고 연필은 찾기 어려웠다. 마우스를 올리면 자주 하는 동작
   (내일로 · 건너뛰기 · 삭제) 이 뜬다. 어느 것이든 3초 안에 되돌릴 수 있다. */
function rowActs(i, where){
  const a = [];
  if(!i.done){
    if(i.kind === 'routine'){
      if(i.date){
        a.push('<button type="button" data-a="later" title="이 회차만 ' + esc(fmtDay(laterDate(i))) + '로 옮깁니다">' +
               (i.date > STATE.today ? '하루 뒤로' : '내일로') + '</button>');
        a.push('<button type="button" data-a="skip" title="' + esc(fmtDay(i.date)) + ' 회차만 건너뜁니다">건너뛰기</button>');
      }
    }else if(i.kind !== 'floating' && i.date){
      a.push('<button type="button" data-a="later">' + (i.date > STATE.today ? '하루 뒤로' : '내일로') + '</button>');
    }
  }
  if(!i.done && i.id) a.push('<button type="button" data-a="imp">' + (i.pinned ? '보통으로' : '중요') + '</button>');
  /* 오늘 목록의 루틴 회차에서 "삭제" 는 루틴 전체를 지운다 - 거기서는 건너뛰기만 둔다 */
  if(!(i.kind === 'routine' && where !== 'routines'))
    a.push('<button type="button" class="del" data-a="del">삭제</button>');
  return a.length ? '<div class="ra">' + a.join('') + '</div>' : '';
}

/* 줄 하나에 누르기 · 키보드를 잇는다 (목록 줄 · 루틴 줄 공용) */
function wireRow(el, i, where){
  el.tabIndex = 0;
  el.oncontextmenu = e => { e.preventDefault(); ctxOpen(e.clientX, e.clientY, i, where); };
  el.onclick = e => {
    if(e.target.closest('.dot')) return setDone(i, !i.done);
    const b = e.target.closest('[data-a]');
    if(b) return rowAct(b.dataset.a, i);
    openEdit(i);
  };
  el.onkeydown = e => {
    if(e.key !== 'Enter' && e.key !== ' ') return;
    if(e.target === el){ e.preventDefault(); openEdit(i); }
    else if(e.target.classList.contains('dot')){ e.preventDefault(); setDone(i, !i.done); }
  };
  return el;
}

/* 줄 하나. 규칙 라벨은 뺐다 - 날마다 같은 글이 되풀이될 뿐이고, 누르면 다 나온다.
   동그라미 안에는 번호가 들어간다: 같은 번호가 하늘의 구슬에도 있어서
   "저 위의 저것이 이 줄" 이 설명 없이 이어진다. 끝낸 것은 체크로 바뀐다. */
function itemEl(i, opt){
  opt = opt || {};
  const el = document.createElement('div');
  const late = i.date && !i.done &&
    (i.date < STATE.today || (i.date === STATE.today && i.time && i.time < STATE.now));
  const pop = i.done && POP && POP.id === i.id && Date.now() - POP.t < 1500 && !calm();
  if(pop) POP.used = true;
  el.className = 'item k-' + (i.kind || 'deadline') + (i.done ? ' done' : '') + (late ? ' late' : '') +
                 (opt.next ? ' next' : '') + (pop ? ' pop' : '') + (i.pinned && !i.done ? ' imp' : '') +
                 (ARRIVE.has(i.id) && !calm() ? ' arrive' : '');
  if(i.id) el.dataset.id = i.id;
  if(i.n) el.dataset.n = i.n;
  const bits = [];
  if(i.muted) bits.push('<span class="tag">알림 끔</span>');
  if(opt.next) bits.push('<span class="st">다음</span>');
  if(opt.showOverdue && i.date && i.date < STATE.today && !i.done)
    bits.push('<span class="st late">'+esc(fmtDay(i.date))+'</span>');
  const when = (opt.showDate && i.date ? esc(fmtDay(i.date)) + (i.time ? ' ' : '') : '') + (i.time ? tmHTML(i.time) : '');
  /* 기간 업무: 시작일을 앞에 적어 "언제부터 하던 일" 인지 보이게 (마감은 끝나는 날) */
  if(i.start) bits.push('<span class="tm">'+esc(md(i.start))+' ~</span>');
  if(when) bits.push('<span class="tm">'+when+'</span>');
  el.innerHTML = '<div class="dot" role="checkbox" tabindex="0" aria-checked="'+(i.done ? 'true' : 'false')+'" title="'+
      (i.done ? '완료 취소' : '완료') + '">'+(i.done ? '\u2713' : (i.n || '')) + '</div>'+
    '<div class="t">'+esc(i.title)+'</div>'+
    (bits.length ? '<div class="meta">'+bits.join('')+'</div>' : '')+
    rowActs(i, opt.where);
  el.title = i.title + (i.kind === 'routine' && i.rule_text ? '  ·  ' + i.rule_text : '') +
             (i.note ? String.fromCharCode(10) + i.note : '') +
             String.fromCharCode(10) + '눌러서 열기 · 동그라미는 완료 · 오른쪽 단추로 더';
  if(i.n){
    el.addEventListener('mouseenter', () => skyHover(i.n));
    el.addEventListener('mouseleave', () => skyHover(null));
  }
  return wireRow(el, i, opt.where);
}

/* 새로 지은 줄(fresh)을 목록에 옮긴다 - 글자 하나까지 같은 줄은 그대로 둔다. 통째로 갈아 끼우면
   하나를 끝냈을 뿐인데 세 칸의 모든 줄을 다시 칠했다. 같은 줄은 같은 항목이다 (data-id 가 들어 있다).
   줄 수가 달라지면 (추가 · 삭제) 통째로 바꾼다. */
function patch(node, fresh){
  const a = [...node.children], b = [...fresh.children];
  if(a.length !== b.length){ node.replaceChildren(...b); return; }
  a.forEach((x, k) => { if(x.outerHTML !== b[k].outerHTML) node.replaceChild(b[k], x); });
}
function fill(node, list, emptyMsg, opt, maker){
  const f = document.createElement('div');
  if(!list.length){
    /* '<' 로 시작하면 이미 완성된 마크업이다 (아래 emptyToday 같은 안내 화면) */
    f.innerHTML = emptyMsg.charAt(0) === '<'
      ? emptyMsg : '<div class="empty">'+emptyMsg+'</div>';
  } else list.forEach(i => f.appendChild((maker||itemEl)(i, opt)));
  patch(node, f);
}

/* 오늘 칸이 비는 경우는 두 가지고, 사용자가 할 일도 서로 다르다.
   ① 아직 아무것도 등록하지 않았다  → 반복 업무부터 넣도록 권한다
   ② 등록은 했는데 오늘은 없다      → 다음 마감이 언제인지 알려준다
   둘 다 "없습니다" 한 줄로 끝내면 다음에 뭘 해야 할지 알 수 없다. */
function emptyToday(o){
  const none = !(o.upcoming || []).length && !(o.floating || []).length
            && !(o.routines || []).length;
  if(none)
    return '<div class="empty-rich"><div class="ill">' + ICON.plusBig + '</div>'
      + '<div class="eh">아직 등록한 일정이 없습니다</div>'
      + '<div class="ep">루틴을 먼저 넣어 두면 오늘 칸이 저절로 채워집니다</div>'
      + '<div class="ec"><button data-new="routine">' + ICON.plus + '루틴 추가</button>'
      + '<button class="ghost" data-new="deadline">마감 하나 넣어보기</button></div></div>';
  const n = (o.upcoming || [])[0];
  /* 날짜 표기는 목록과 같은 함수를 쓴다 ("내일" · "9/17 (목)") */
  const when = n && n.date ? fmtDay(n.date) + (n.time ? ' ' + tmText(n.time) : '') : '';
  return '<div class="empty-rich"><div class="ill">' + ICON.check + '</div>'
    + '<div class="eh">오늘 할 일이 없습니다</div>'
    + '<div class="ep">' + (n
        ? '다음 마감 <b>' + esc(when) + ' · ' + esc(n.title) + '</b>'
        : '다가오는 7일에도 마감 없음') + '</div>'
    + '<div class="ec"><button data-new="deadline">' + ICON.plus + '새 항목</button></div></div>';
}

/* 서버가 준 그대로의 overview. 지우기를 미뤄 둔 항목(GONE)을 걸러 낸 것이 STATE 다.
   되돌리기를 누르면 RAW 로 다시 그리기만 하면 된다. */
let RAW = null;
function hideGone(o){
  if(!GONE.size) return o;
  const keep = x => !GONE.has(x.id);
  const gone = (o.overdue || []).concat(o.todays || []).filter(x => !keep(x));
  const open = gone.filter(x => !x.done).length;
  return Object.assign({}, o, {
    overdue: (o.overdue || []).filter(keep), todays: (o.todays || []).filter(keep),
    upcoming: (o.upcoming || []).filter(keep), floating: (o.floating || []).filter(keep),
    routines: (o.routines || []).filter(keep), tasks: (o.tasks || []).filter(keep),
    stats: Object.assign({}, o.stats, {
      left: o.stats.left - open, done: o.stats.done - (gone.length - open), total: o.stats.total - gone.length}),
  });
}
const repaint = () => { if(RAW) render(RAW); };
/* 방금 끝낸 것(POP) - 다시 그린 줄에서 동그라미가 톡 찬다.
   방금 새로 생긴 것(ARRIVE) - 새로 그린 목록에 처음 나타난 id. 한꺼번에 여럿이
   나타나면(날이 바뀜 · 처음 읽음) 움직이지 않는다 - 전부 움직이면 아무것도 안 보인다. */
let POP = null, ARRIVE = new Set(), SEEN = null;

/* 오늘 목록: 지난 일이 있으면 "지난 일 · 오늘" 두 묶음으로 나눠 이름을 단다 */
/* 오늘 목록. 시간대로 묶어 두고 '지금' 선만 하루 동안 내려온다 -
   줄 자체를 시간에 비례해 놓으면 08:30 과 08:40 이 몇 px 차이로 겹친다.
   지난 날짜의 일은 시간대와 상관없이 맨 위에 따로 모은다. */
const BAND_NAME = ['오전', '오후', '저녁', '아무 때나'];
const bandOf = t => t == null ? 3 : (mins(t) < 720 ? 0 : mins(t) < 1080 ? 1 : 2);

function fillToday(node, all, empty){
  if(!all.length){ return fill(node, all, empty, {showOverdue:true, where:'today'}); }
  const out = node;
  node = document.createElement('div');
  const head = (cls, txt) => {
    const g = document.createElement('div'); g.className = cls; g.textContent = txt; node.appendChild(g);
  };
  const nxt = nextItem(all);
  const old = all.filter(i => i.date && i.date < STATE.today && !i.done);
  if(old.length){
    head('grp', '지난 일');
    old.forEach(i => node.appendChild(itemEl(i, {showOverdue:true, where:'today', next:i === nxt})));
  }
  const rest = all.filter(i => old.indexOf(i) < 0);
  let band = -1, ruled = false;
  rest.forEach(i => {
    const b = bandOf(i.time);
    /* 지금 선을 시간대 머리보다 먼저 놓는다 - 안 그러면 다음 칸 안으로 밀려 들어간다 */
    if(!ruled && i.time && !i.done && mins(i.time) > mins(STATE.now)){
      const r = document.createElement('div'); r.className = 'nowrule'; r.innerHTML = '<span>' + tmHTML(STATE.now) + '</span>';
      node.appendChild(r); ruled = true;
    }
    if(b !== band){ band = b; head('band', BAND_NAME[b]); }
    node.appendChild(itemEl(i, {showOverdue:true, where:'today', next:i === nxt}));
  });
  patch(out, node);
}

/* 다음에 할 것 하나. 아직 안 끝났고 지금보다 뒤인 것 중 가장 이른 것 */
function nextItem(all){
  return all.filter(i => !i.done && i.time && mins(i.time) >= mins(STATE.now))
            .sort((a, b) => mins(a.time) - mins(b.time))[0] || null;
}

function render(o){
  RAW = o;
  o = hideGone(o);
  STATE = o;
  HOL = new Set(o.holidays || []);
  THEME = (o.settings && o.settings.theme) || 'auto';
  document.body.classList.toggle('guy-still', !!o.settings && o.settings.guy_walk === false);
  document.body.classList.toggle('no-sky', !!o.settings && o.settings.show_sky === false);
  /* 일정 파일이 손상돼 백업에서 되살렸다면, 조용히 넘어가지 않고 한 번 알린다 */
  /* alert 는 창을 막고 알림 처리까지 멈춰 세운다. 띠로 남겨 두고 직접 닫게 한다. */
  if(o.notice && o.notice !== render._notice){
    render._notice = o.notice;
    strip(o.notice, { action: '확인', onClick: () => strip('') });
  }
  const d = dObj(o.today);
  $('#dow').textContent = $('#dow-m').textContent = (d.getMonth()+1)+'월 '+d.getDate()+'일 '+WD[(d.getDay()+6)%7]+'요일';
  /* 지난 일 + 오늘. 시간순으로 세우고 번호를 매긴다 - 이 번호가 목록과
     하늘의 구슬을 잇는 유일한 끈이다. 끝낸 것도 번호를 지키므로 하루 동안 안 흔들린다. */
  const all = o.overdue.concat(o.todays).sort((a,b) =>
    (a.date||'').localeCompare(b.date||'') || (a.time||'99:99').localeCompare(b.time||'99:99'));
  all.forEach((i, k) => { i.n = k + 1; });
  const ids = new Set(all.concat(o.upcoming, o.floating).map(x => x.id));
  ARRIVE = SEEN ? new Set([...ids].filter(x => !SEEN.has(x))) : new Set();
  if(ARRIVE.size > 2) ARRIVE.clear();
  SEEN = ids;
  fillToday($('#today'), all, emptyToday(o));
  const undone = all.filter(i => !i.done).length;
  const doneN = all.length - undone;
  $('#c-today').textContent = all.length;
  $('#today-note').textContent = all.length ? (undone ? (doneN ? '완료 ' + doneN : '') : '전부 완료') : '';

  fill($('#upcoming'), o.upcoming, '앞으로 7일, 마감 없음', {showDate:true, where:'upcoming'});
  fill($('#floating'), o.floating, '＋ 새 항목 → 메모', {where:'floating'});
  $('#c-up').textContent = o.upcoming.length;
  $('#c-float').textContent = o.floating.length;
  if(POP && POP.used) POP = null;
  ARRIVE = new Set();
  SKY_ALL = all;
  nightFor(all.length > 0 && !undone);
  drawSky(all);
  if($('#m-manage').classList.contains('on')) drawManage();
  if(view === 'cal') drawCal();
  /* 하루 목록이 열려 있으면 방금 바뀐 것(완료 · 삭제 · 되돌리기)을 거기에도 */
  if(DAY_KEY && $('#m-day').classList.contains('on')) dayModal(DAY_KEY, dayItems(DAY_KEY));
}

/* 시계 */
function tickClock(){
  if(SHOT_MIN != null){ return; }                  /* 갈무리 중에는 시계를 묶어 둔다 */
  const n = new Date(), v = String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
  const el = $('#clock');
  if(el._v !== v){ el._v = v; el.innerHTML = $('#clock-m').innerHTML = tmHTML(v); }   /* 같은 글자를 다시 넣어도 큰 시계를 새로 그린다 */
}
tickClock();
setInterval(tickClock, 10000);

let lastLoad = 0;                   /* 마지막으로 새로 읽은 때 (ms) */
/* 받은 개요를 그린다. 지난번과 글자 하나까지 같으면 그리지 않는다 - 45초마다 새로
   읽을 때 대개는 아무것도 바뀌지 않았는데, 예전에는 목록 셋과 하늘 전체(해 위치
   수백 번 계산)와 보고 있던 달력까지 매번 통째로 다시 지었다. 비교하는 값은
   render 가 번호(i.n)를 붙이기 전의 모습이다. */
let lastSeen = '';
function take(o){
  lastLoad = Date.now();
  const seen = JSON.stringify(o);
  if(seen === lastSeen && RAW) return;
  lastSeen = seen;
  render(o);
  updNotice(o.update);
  if(!load._first){                 /* 주소에 #cal 이 있으면 달력으로 시작 */
    load._first = true;
    if(location.hash === '#cal') setView('cal');
    shotHook();
  }
}
const load = () => api('/api/overview').then(take);
/* 바꾸는 요청. 서버가 바뀐 뒤의 개요를 같이 실어 보내므로(?ov=1) 곧이어 또 묻지 않는다.
   예전에는 누를 때마다 "바꿔 줘" 와 "다시 보여 줘" 두 번을 왕복한 뒤에야 화면이 바뀌었다. */
const change = (u, b) => api(u + '?ov=1', b).then(d => {
  if(d && d.overview) take(d.overview); else load();
  return d;
});

/* ══════════ 되돌리기 ══════════
   완료 · 건너뛰기 · 내일로 · 삭제는 묻지 않고 곧바로 한다. 아래 가운데에 3초 동안
   "되돌리기" 가 뜬다. 확인 창으로 한 번 더 묻는 것보다 빠르고, 잘못 눌렀을 때도
   손해가 없다. 삭제만은 실제로 지우는 것을 3초 미룬다 (되돌리면 아무 일도 없었던 것). */
const UNDO_MS = 3000;
/* verb 는 한 일(완료 · 삭제 · 내일로 …), title 은 그 항목. 되돌리기 옆에 남은 초를
   센다 - 언제까지 되돌릴 수 있는지가 보여야 서두를지 말지를 안다. */
function undoToast(verb, title, undo){
  const el = $('#undo');
  const stop = () => { clearTimeout(undoToast._t); clearInterval(undoToast._c); };
  const hide = () => { el.classList.remove('on'); stop(); };
  $('#undo-verb').textContent = verb;
  $('#undo-msg').textContent = title;
  $('#undo-btn').onclick = () => { hide(); undo(); };
  stop();
  const end = Date.now() + UNDO_MS, sec = $('#undo-sec');
  const tick = () => { sec.textContent = Math.max(1, Math.ceil((end - Date.now()) / 1000)); };
  tick();
  undoToast._c = setInterval(tick, 250);
  el.classList.add('on');
  undoToast._t = setTimeout(hide, UNDO_MS);
}
/* 마우스를 올려 두면 사라지지 않는다 (읽는 중에 없어지지 않게). 그동안은 초도 세지 않는다 */
$('#undo').addEventListener('mouseenter', () => {
  clearTimeout(undoToast._t); clearInterval(undoToast._c); $('#undo-sec').textContent = '';
});
$('#undo').addEventListener('mouseleave', () => {
  undoToast._t = setTimeout(() => $('#undo').classList.remove('on'), 2000);
});

const taskUrl = i => '/api/task/' + encodeURIComponent(i.id);

/* 완료 / 완료 취소. 뒤집기가 아니라 "누른 사람이 본 상태의 반대" 를 보낸다 - 알림 카드에서
   이미 완료했는데 화면이 늦게 갱신됐어도 결과가 누른 사람의 뜻대로 나온다. */
function setDone(i, done, after){
  /* after(달력 회차 고치기)는 새 개요를 그리기 전에 - 그래야 다시 그린 달력에 곧바로 보인다 */
  if(done) POP = {id: i.id, t: Date.now()};
  if(done && window.PB) PB.done();
  const send = v => api(taskUrl(i) + '/done?ov=1', {date: i.date, done: v}).then(d => {
    if(after) after();
    if(d && d.overview) take(d.overview); else load();
  });
  return send(done).then(() => {
    if(done) undoToast('완료', i.title, () => send(false));
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
function later(i){
  if(i.kind === 'routine') return laterOnce(i);
  const from = i.date, to = laterDate(i);
  return change(taskUrl(i), {due_date: to}).then(() => {
    undoToast(fmtDay(to) + '로', i.title, () => change(taskUrl(i), {due_date: from}));
  });
}

/* 루틴의 한 회차를 미룬다. 루틴에는 "이 회차만 다른 날" 이라는 자리가 없으므로, 그 회차를
   건너뛰고 미룬 날에 같은 이름 · 시각의 할 일을 하나 만든다. 되돌리면 둘 다 거둔다. */
function laterOnce(i){
  const day = i.date, to = laterDate(i);
  let made = null;
  return change(taskUrl(i) + '/skip', {date: day})
    .then(() => change('/api/task', {title: i.title, kind: 'deadline', due_date: to, due_time: i.time || '', note: i.note || ''}))
    .then(d => {
      made = d && d.id;
      undoToast(fmtDay(to) + '로', i.title, () =>
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
  const rows = calm() ? [] : $$('.item').filter(el => el.dataset.id === i.id);
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
  const r = [['edit', '열기']];
  if(!(i.kind === 'routine' && where === 'routines'))
    r.push(['done', i.done ? '완료 취소' : '완료']);
  if(!i.done){
    if(i.kind === 'routine'){
      if(i.date) r.push(['later', '이번 회차 ' + (i.date > STATE.today ? '하루 뒤로' : '내일로')]);
      if(i.date || i.next_date) r.push(['skip', '이번 회차 건너뛰기']);
    }else if(i.kind !== 'floating' && i.date){
      r.push(['later', i.date > STATE.today ? '하루 뒤로' : '내일로']);
    }
  }
  if(i.id) r.push(['imp', i.pinned ? '중요 표시 끄기' : '중요로 표시' + (i.kind === 'routine' ? ' (모든 회차)' : '')]);
  /* 오늘 목록의 루틴 회차에서 지우면 그 날짜가 아니라 루틴 자체가 없어진다.
     막지 않되 글자로 밝혀 둔다 - 매번 루틴 칸까지 찾아가게 할 일은 아니다 */
  r.push(['del', i.kind === 'routine' && where !== 'routines' ? '루틴 전체 삭제' : '삭제', 'danger']);
  return r;
}
function ctxOpen(x, y, i, where){
  const el = $('#ctx');
  if(OFFLINE) return;
  const rows = ctxRows(i, where);
  el.innerHTML = rows.map(([a, label, cls]) =>
    (cls === 'danger' ? '<div class="ctx-sep"></div>' : '') +
    '<button type="button" role="menuitem" data-a="' + a + '"' +
    (cls ? ' class="' + cls + '"' : '') + '>' + esc(label) + '</button>').join('');
  el.onclick = e => {
    const b = e.target.closest('[data-a]');
    if(!b) return;
    ctxClose();
    rowAct(b.dataset.a, i);
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
document.addEventListener('mousedown', e => { if(ctxShown() && !e.target.closest('#ctx')) ctxClose(); });
document.addEventListener('scroll', ctxClose, true);
addEventListener('resize', ctxClose);
addEventListener('blur', ctxClose);

/* ══════════ 모달 ══════════ */
/* 종이로 여는 것(.sheet)은 하늘을 접고 그 아래를 통째로 차지한다 - 가림막이 없다.
   떠 있는 종이(하루 목록 · 확인)만 뒤를 옅게 가린다. */
function openM(id){
  const el = $(id), sheet = el.classList.contains('sheet');
  $('#veil').classList.toggle('on', !sheet);
  el.classList.add('on');
  fold();
}
function closeM(id){
  if(id === '#m-update') updSeen();
  $(id).classList.remove('on');
  if(!$$('.modal.on').length) $('#veil').classList.remove('on');
  fold();
  themeBack();
}
function closeAll(){
  if($('#m-update').classList.contains('on')) updSeen();
  $('#veil').classList.remove('on');
  $$('.modal').forEach(m => m.classList.remove('on'));
  fold();
  themeBack();
}
/* 하늘을 접을 때. 종이가 하나라도 열려 있거나 달력을 보고 있으면 접는다 -
   그 둘 다 아래가 넓어야 하는 화면이고, 접힌 하늘이 "오늘은 아직 여기" 를
   계속 말해 준다. */
function fold(){
  const sheet = $$('.modal.sheet.on').length > 0, on = view === 'cal' || sheet;
  document.body.classList.toggle('folded', on);
  document.body.classList.toggle('sheet', sheet);
  if(!on) peekClose();
}
/* 하늘이 접히고 펴질 때 (종이 · 달력 · 시각 고르기). 하늘의 높이는 한 번에 바뀌고, 땅은 옛 자리에서
   새 자리로 미끄러진다 - 한 번 칠한 채 옮기기만 한다 (skyFlip). ResizeObserver 는 배치 뒤 ·
   그리기 전에 부르므로 옛 자리가 한 프레임도 비지 않는다. 시각을 고르는 동안 종이의 윗변이
   하늘을 따라 내려가는 것은 그대로 top 으로 움직인다 - 종이는 아래 끝이 붙어 있어 옮기면 빈다. */
(function skyFlip(){
  const sky = $('#sky');
  let last = sky.offsetHeight;
  new ResizeObserver(() => {
    const h = sky.offsetHeight, dy = last - h;
    last = h;
    if(!dy || calm()) return;
    const cs = getComputedStyle(document.documentElement);
    $('.ground').animate([{transform: 'translateY(' + dy + 'px)'}, {transform: 'none'}],
      {duration: parseFloat(cs.getPropertyValue('--t-move')) || 480, easing: cs.getPropertyValue('--ease-move').trim() || EASE});
  }).observe(sky);
})();
$('#veil').onclick = closeAll;
$$('[data-close]').forEach(b => b.onclick = e => closeM('#'+e.target.closest('.modal').id));
document.onkeydown = e => {
  if(e.key === 'Escape'){
    if(ctxShown()){ ctxClose(); return; }
    if(tpShown()){ tpClose(); return; }
    if($$('.modal.on').length){ closeAll(); return; }
    /* 열린 것이 없으면 달력에서 오늘로 - Esc 는 "한 겹 나가기" 하나로 읽힌다 */
    if(view === 'cal') setView('home');
    return;
  }
  /* 달력을 보고 있을 때만 좌우로 넘기기 - 월은 한 달, 7일은 하루 (입력 중에는 방해하지 않는다) */
  if(view === 'cal' && !$$('.modal.on').length && /^Arrow(Left|Right)$/.test(e.key)){
    (e.key === 'ArrowLeft' ? $('#cal-prev') : $('#cal-next')).click();
    return;
  }
  /* 메모는 여러 줄이 될 수 있다 - 그 칸에서 Enter 는 줄바꿈이고, 저장은 Ctrl+Enter */
  const multi = e.target.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey;
  if(e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !multi && !e.defaultPrevented){
    if($('#m-add').classList.contains('on')) $('#a-save').click();
    else if($('#m-edit').classList.contains('on')) $('#e-save').click();
  }
};

/* ══════════ 새 항목 · 고치기 ══════════
   정할 것은 셋이다: 무엇 (이름) · 언제 (날짜 · 시각 · 반복) · 알림. 창도 그 순서다.

     왼쪽   고른 값만 줄지어 보여 준다       날짜 · 시각 · 반복 · 알림 · 설명
     오른쪽 지금 누른 줄의 도구 하나 (판)    날짜 → 달력 · 시각 → 시계판 · 반복 → 빈도와 규칙 · 알림 → 알림 고르기

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
      '<input class="cp-name" id="' + pre + '-title" autocomplete="off" placeholder="무엇을 할까요?" aria-label="이름">' +
      '<div class="cp-move" hidden></div>' +
      '<div class="cp-props">' +
        '<div class="cp-p when" data-p="date"><span class="pl">날짜</span>' +
          '<div class="wbox"><div class="hl" aria-hidden="true"></div>' +
          '<input class="win" autocomplete="off" aria-label="날짜 (쳐도 됩니다)" placeholder="없음 · 쳐도 됩니다"></div><span class="tr" data-t="date"></span></div>' +
        '<div class="cp-say" aria-live="polite"></div>' +
        '<div class="cp-p" data-p="time"><span class="pl">시각</span>' +
          '<input class="tin" autocomplete="off" aria-label="시각" title="예: 930 · 21 · 930p · ↑↓ 5분"><span class="tr" data-t="time"></span></div>' +
        '<button type="button" class="cp-p" data-p="rule"><span class="pl">반복</span><span class="pv" data-v="rule"></span><span class="tr" data-t="rule"></span></button>' +
        '<button type="button" class="cp-p" data-p="alert"><span class="pl">알림</span><span class="pv" data-v="alert"></span><span class="tr"></span></button>' +
        '<button type="button" class="cp-p cp-imp" data-p="imp" aria-pressed="false"><span class="pl">중요</span><span class="pv" data-v="imp"></span><span class="tr"><i class="sw"></i></span></button>' +
        '<div class="cp-note"></div>' +
      '</div>' +
    '</div>' +
    '<div class="cp-pane"><div class="cp-ph"></div><div class="pb"><div class="px"></div><div class="cp-cal"></div>' +
      '<div class="dialw" hidden></div><p class="cp-ctx" hidden></p></div></div>';
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
  }

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
    if(p.rule) b.push('반복 · 처음 날은 엔진이 셉니다');
    else if(p.end) b.push(mdw(p.date) + ' – ' + mdw(p.end));
    else if(p.date) b.push(mdw(p.date) + ' · ' + relW(p.date));
    if(p.time) b.push(tmText(p.time));
    return b.join(' · ') || '날짜를 먼저 정해야 시각을 둘 수 있습니다';
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
    } else if(S.mode === 'range') t = '끝 날을 누르세요';
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
    tin.placeholder = lock ? '날짜를 정하면' : '없음';
    tin.disabled = lock;
    Q('[data-t=time]').innerHTML = S.time ? '<span class="clr" role="button" data-clr="time" aria-label="시각 지우기">' + XI + '</span>' : '';
    const fq = S.freq && FREQ.find(f => f[0] === S.freq[0] && f[1] === S.freq[1]);
    const rv = S.rule ? (S.ruleText || '…') : fq ? fq[2] + ' · 날을 고르세요' : '';
    const pv = (k, v, ph) => { const el = Q('[data-v=' + k + ']'); el.textContent = v || ph; el.classList.toggle('ph', !v); };
    pv('rule', rv, '안 함');
    Q('[data-t=rule]').innerHTML = S.freq ? '<span class="clr" role="button" data-clr="rule" aria-label="반복 끄기">' + XI + '</span>' : '';
    pv('alert', alertText(), lock ? '날짜를 정하면' : '');
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
        w.innerHTML = '<textarea class="cp-memo" id="' + pre + '-note" rows="2" placeholder="설명 · 링크 · 참고할 것" aria-label="설명"></textarea>';
        w.querySelector('textarea').value = I.note || '';
      }
    } else if(!w.querySelector('button')) w.innerHTML = '<button type="button" class="cp-p" data-p="note"><span class="pl">설명</span><span class="pv ph">덧붙이기</span><span class="tr"></span></button>';
  }
  function drawSay(){
    const el = Q('.cp-say');
    if(typing != null && typing.trim()){
      el.innerHTML = !parsed ? '<span class="miss">알아듣지 못했습니다 · 예: 모레 · 금 3시 · 다음주 월~금 · 매달 마지막 영업일</span>' :
        '<span class="k">' + esc(sayParsed(parsed)) + '</span><span class="miss">Enter 로 확정</span>';
      return;
    }
    if(bizOn() && S.mode === 'one' && !isBiz(S.date)){
      /* 쉬는 날을 골랐으면 앞뒤 영업일을 내민다. 그대로 둬도 된다 */
      const a = rollBiz(S.date, -1), b = rollBiz(S.date, 1);
      el.innerHTML = '<span class="warn">' + mdw(S.date).replace(/ \(.\)$/, '') + '은 ' + esc(offName(S.date)) + '</span>' +
        (a >= STATE.today ? '<button type="button" class="tl" data-go="' + a + '">' + dOnlyW(a) + '로</button>' : '') +
        '<button type="button" class="tl" data-go="' + b + '">' + dOnlyW(b) + '로</button>';
      return;
    }
    el.innerHTML = '';
  }

  /* ---------- 그리기: 판 ---------- */
  function drawPane(){
    const P = S.pane, grp = P === 'time' ? 'dial' : P === 'alert' ? 'alert' : P === 'rule' ? 'rule' : 'cal';
    /* 반복 판에는 달력이 없다 - 처음 돌 날은 날짜 줄의 달력에서 고른다 (거기에 앞으로 돌 날도 찍힌다).
       날이 아직 없을 때만 여기서도 달력을 띄워 하나 누르게 한다 (빈도와 날은 어느 쪽을 먼저 골라도 된다).
       그래서 어느 판이든 기본 창 높이(960×592) 안에 든다 */
    const showCal = grp === 'cal' || (grp === 'rule' && !S.date && !(S.freq && S.freq[0] === 'day'));
    if(lastGroup && lastGroup !== grp){ pane.classList.remove('swap'); void pane.offsetWidth; pane.classList.add('swap'); }
    /* 반복 판은 머리줄이 없다 - 고른 줄(반복)이 곧 제목이고, 끄는 것은 그 줄의 × 다. 그만큼 달력이 창 안에 든다 */
    lastGroup = grp;
    pane.dataset.p = P;
    let head = '', x = '';
    if(P === 'date'){
      if(S.mode === 'rule') head = '<span class="t">처음 돌 날</span><span class="sp"></span><span class="n">밑줄 = 앞으로 돌 날</span>';
      else head = '<span class="t">날짜</span><span class="sp"></span><div class="seg" role="group" aria-label="하루 또는 여러 날">' +
        '<button type="button" data-span="0"' + (!S.span ? ' class="on"' : '') + '>하루</button>' +
        '<button type="button" data-span="1"' + (S.span ? ' class="on"' : '') + '>여러 날</button></div>';
    } else if(P === 'rule'){
      x = '<div class="freq" role="group" aria-label="얼마나 자주">' + FREQ.map(([u, e, l]) => '<button type="button" data-fu="' + u + '" data-fe="' + e + '"' +
        (S.freq && S.freq[0] === u && S.freq[1] === e ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div>';
      if(S.freq){
        const [u, e] = S.freq;
        if(u === 'day') x += '<div class="cp-opt">' + [[false, '날마다'], [true, '영업일만']].map(([v, l]) =>
          '<button type="button" data-biz="' + v + '"' + (S.rule && !!S.rule.business_only === v ? ' class="on"' : '') + '>' + l + '</button>').join('') + '</div>';
        else if(!S.date) x += '<p class="hint">이 일을 하는 날을 하나 누르세요. 그 날에 도는 규칙을 골라 드립니다.</p>';
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
      } else x += '<p class="hint">' + (S.date ? '얼마나 자주 하는지 고르면 ' + mdw(S.date) + ' 에 도는 규칙을 골라 드립니다.' :
        '얼마나 자주 하는지 고르고, 이 일을 하는 날을 하나 누르세요.') + '</p>';
    } else if(P === 'time'){
      const t = S.time;
      head = '<span class="big' + (t ? '' : ' none') + '">' + (t ? tmHTML(t) : '시각 없음') + '</span><span class="sp"></span>' +
        '<div class="seg" role="group" aria-label="오전 오후"><button type="button" data-ap="0"' + (t && mins(t) < 720 ? ' class="on"' : '') + '>오전</button>' +
        '<button type="button" data-ap="1"' + (t && mins(t) >= 720 ? ' class="on"' : '') + '>오후</button></div>';
    } else if(P === 'alert'){
      const daily = S.rule && S.rule.period === 'day';
      const cur = S.lead != null ? S.lead : defLead();
      const opts = LEADS.slice();
      if(!opts.some(o => o[0] === cur)) opts.push([cur, leadLabel(cur)]), opts.sort((a, b) => a[0] - b[0]);
      head = '<span class="t">알림</span>';
      x = '<div class="alr"><span>' + (S.time ? '마감 ' + tmText(S.time) + ' 의 몇 분 전' : '마감 알림') + '</span><div class="cp-opt">' +
        '<button type="button" data-mute="1"' + (S.muted ? ' class="on"' : '') + '>끔</button>' +
        (S.time ? opts.map(([v, l]) => '<button type="button" data-l="' + v + '"' + (!S.muted && cur === v ? ' class="on"' : '') + '>' + l + '</button>').join('')
                : '<button type="button" data-mute="0"' + (!S.muted ? ' class="on"' : '') + '>아침 브리핑에서</button>') + '</div></div>';
      if(!daily) x += '<div class="alr"><span>며칠 앞서 한 번 더</span><div class="cp-opt">' + EARLY.map(([v, l]) =>
        '<button type="button" data-y="' + v + '"' + (S.early === v ? ' class="on"' : '') + (S.muted ? ' disabled' : '') + '>' + l + '</button>').join('') + '</div></div>';
      x += '<p class="hint">' + esc(alertSay()) + '</p>';
    }
    Q('.cp-ph').innerHTML = head;
    Q('.cp-ph').hidden = !head;
    const px = Q('.px');
    px.innerHTML = x; px.hidden = !x;
    cal.hidden = !showCal;
    Q('.dialw').hidden = grp !== 'dial';
    if(showCal) drawCal();
    if(grp === 'dial') drawDial();
    /* 그날 이미 있는 마감: 고른 날이 붐비는 날인지. 있을 때만 */
    const ctx = Q('.cp-ctx');
    const others = grp === 'cal' && S.mode === 'one' ? deadlines().filter(t => t.due_date === S.date && !t.done && t.id !== I.id) : [];
    ctx.hidden = !others.length;
    if(others.length) ctx.innerHTML = '같은 날 마감 <b>' + others.length + '건</b> · ' + others.slice(0, 3).map(t => esc(t.title)).join(' · ') + (others.length > 3 ? ' 외' : '');
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
  function drawCal(){
    const first = new Date(MC.y, MC.m, 1, 12), from = addDay(iso(first), -first.getDay());
    let rg = null;
    if(drag) rg = drag.a < drag.b ? [drag.a, drag.b] : [drag.b, drag.a];
    else if(S.mode === 'range' && S.end) rg = [S.date, S.end];
    else if(S.mode === 'range' && S.pending && hover) rg = hover < S.date ? [hover, S.date] : [S.date, hover];
    let h = '<div class="mtop"><b>' + MC.y + '년 ' + (MC.m + 1) + '월</b>' +
      '<button type="button" data-mc="-1" aria-label="이전 달"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg></button>' +
      '<button type="button" data-mc="1" aria-label="다음 달"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg></button></div>' +
      '<div class="grid">' + WD_SUN.map((w, i) => '<i' + (i === 0 ? ' class="sun"' : '') + '>' + w + '</i>').join('');
    for(let i = 0, k = from; i < 42; i++, k = addDay(k, 1)){
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
  function receipt(){
    const tm = S.time ? ' ' + tmText(S.time) : '';
    let w;
    if(S.mode === 'none') w = '날짜 없이 <b>메모</b>로 둡니다';
    else if(S.mode === 'rule'){
      if(!S.rule) w = '반복할 날을 고르세요';
      else {
        const o = [...S.occ].sort().slice(0, 3);
        w = '<b>' + esc(S.ruleText || '반복') + '</b>' + tm + (o.length ? ' · 다음 ' + o.map(md).join(', ') : '');
      }
    }
    else if(S.mode === 'range' && S.end) w = '<b>' + mdw(S.date) + '</b>부터 <b>' + mdw(S.end) + tm + '</b>까지';
    else w = '<b>' + mdw(S.date) + tm + '</b>까지 · ' + relW(S.date) + (S.mode === 'range' ? ' · 끝 날을 누르면 기간' : '');
    const a = alertText();
    return w + (a && has() ? ' · 알림 ' + a : '') + (S.imp ? ' · <b>중요</b>' : '');
  }
  function draw(){
    if(!S) return;
    win.querySelector('.f-kind').textContent = I.id ? kindWord() + ' 고치기' : '새 ' + kindWord();
    const sv = win.querySelector('.f-save');
    sv.textContent = I.id ? '저장' : kindWord() + ' 추가';
    drawProps(); drawSay(); drawPane();
    win.querySelector('.rcpt').innerHTML = receipt();
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
  when.addEventListener('focus', () => { setPane('date'); setTimeout(() => { if(typing == null) when.select(); }, 0); });
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
  tin.addEventListener('focus', () => { setPane('time'); setTimeout(() => tin.select(), 0); });
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

  /* ---------- 이름 (날짜처럼 보이는 말은 옮길지 한 번만 묻는다 - 누를 때만 옮긴다) ---------- */
  name.addEventListener('input', () => {
    const t = name.value;
    const p = t.trim().length >= 3 ? whenParse(t, {today:STATE.today, isBiz:bizOn() ? isBiz : null}) : null;
    moveP = p && p.rest && p.date && !(p.notes || []).includes('비슷한 말로 읽음') ? p : null;
    const mv = Q('.cp-move');
    mv.hidden = !moveP;
    if(moveP) mv.innerHTML = '<span>' + moveP.spans.map(([a, b]) => '<mark>' + esc(t.slice(a, b)) + '</mark>').join(' ') +
      ' 을(를) 날짜로 옮길까요?</span><button type="button" class="tl" data-mv>옮기기</button>';
  });

  /* ---------- 누르기 ---------- */
  body.addEventListener('click', e => {
    const clr = e.target.closest('[data-clr]');
    if(clr){
      const c = clr.dataset.clr;
      if(c === 'date') clearWhen(); else if(c === 'time') S.time = ''; else if(c === 'rule') setFreq(null);
      draw(); return;
    }
    const b = e.target.closest('button');
    if(!b) return;
    const ds = b.dataset;
    if(ds.mv != null && moveP){
      if(moveP.start) setRange(moveP.start, moveP.date); else { setOne(moveP.date); S.span = false; }
      if(moveP.time) S.time = moveP.time;
      showMonth(S.date); name.value = moveP.rest; moveP = null; Q('.cp-move').hidden = true; draw(); name.focus(); return;
    }
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
    else if(ds.go) setOne(ds.go);
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
    const t = e.target.closest('[data-p=time]');
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
  cal.addEventListener('wheel', e => {
    if(!e.deltaY) return;
    e.preventDefault();
    const t = new Date(MC.y, MC.m + (e.deltaY > 0 ? 1 : -1), 1); MC.y = t.getFullYear(); MC.m = t.getMonth(); drawCal();
  }, {passive:false});

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
    w.innerHTML = '<svg viewBox="0 0 220 220" aria-label="시계판: 바깥은 시, 안쪽은 분">' + f + '<circle cx="110" cy="110" r="3.5" class="d-pin"/></svg>' +
      '<p class="hint">바깥은 시 · 안쪽은 분 · 누른 채 돌리거나 휠</p>';
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

  /* ---------- 열기 · 읽기 ---------- */
  /* item: 고칠 항목 (asItem 모양) 또는 새 항목의 씨앗 {date, kind} */
  self.render = function(item){
    I = item || {};
    S = blank(); typing = null; parsed = null; hover = null; drag = null; apLock = false; moveP = null;
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
  self.title = () => name.value.trim();
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
function openAdd(kind, seed){
  addForm.render(Object.assign({kind: kind === 'routine' ? 'routine' : null}, seed || {}));
  openM('#m-add');
  setTimeout(() => addForm.focusName(), 90);
}
$('#btn-add').onclick = () => openAdd('deadline', {});
/* 빈 상태 안내의 버튼. 목록은 그릴 때마다 새로 만들어지므로 칸에 위임해 둔다. */
$('#today').addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-new]');
  if(b) openAdd(b.dataset.new, {});
});
$('#a-save').onclick = () => {
  addForm.commit();
  const title = addForm.title();
  if(!title){ say('이름을 입력하세요'); return addForm.focusName(); }
  if(!addForm.valid()) return;
  change('/api/task', Object.assign({title, note:addForm.note()}, addForm.read()))
    .then(() => { closeM('#m-add'); say('추가됨 · ' + title); });
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
    .then(() => { closeM('#m-edit'); say('저장됨'); });
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

/* ══════════ 달력 ══════════
   영업일만 쓰는 도구이므로 월~금 5칸만 만든다. 칸이 40% 넓어져서
   한 칸에 일정 여러 개를 넣어도 제목이 읽힌다.
   표시 대상은 "마감이 있는 일" 뿐이다. 반복 업무는 넣지 않는다 -
   매달 되풀이되는 항목이 칸을 다 차지해서 정작 마감이 안 보이게 된다. */
/* 한 칸에 몇 줄이 들어가는지는 창 높이에 달렸다. 넷으로 못 박아 두면 창이
   낮을 때 마지막 줄이 반만 잘려 보인다 - 읽을 수도 누를 수도 없는 줄이다. */
function calRoom(weeks, below){
  const g = $('#cal-grid'), h = g ? g.clientHeight : 0;
  if(!h || !weeks) return 4;
  const cell = (h - (weeks-1) - 2) / weeks;     /* 1px 실선 · 위아래 테두리 */
  /* 날짜 줄 · 여백 26 · 한 줄 16. below 는 칸 아랫단에 깔린 기간 띠의 높이 */
  return Math.max(1, Math.min(5, Math.floor((cell - 26 - (below || 0)) / 16)));
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
const routinesOn = () => !!STATE && STATE.settings.show_routines !== false;
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
let calCur = null;                  /* 보고 있는 달 {y, m} - m 은 0~11 */
let view = 'home';

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
const SPAN_N = 5;                     /* tokens.SPAN 의 수 (--span1 ~ --span5) */

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
  return s.done ? '완료' : n === 0 ? '오늘 마감' : n > 0 ? 'D-' + n : (-n) + '일 지남';
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
  if(weekendOn() || !isWeekend(d)) return d;
  const m = d.slice(0, 7);
  const back = dObj(d), fwd = dObj(d);
  while(isWeekend(iso(back))) back.setDate(back.getDate() - 1);
  if(iso(back).slice(0, 7) === m) return iso(back);
  while(isWeekend(iso(fwd))) fwd.setDate(fwd.getDate() + 1);
  return iso(fwd);
}

function chipEl(t){
  const el = document.createElement('div');
  const cls = t.done ? 'done' : t.due_date < STATE.today ? 'p'
            : t.due_date === STATE.today ? 't' : 'f';
  const wk = isWeekend(t.due_date) && !weekendOn();   /* 앞 영업일 칸에 얹힌 것 */
  el.className = 'chip ' + cls + (wk ? ' wk' : '') + (t.pinned && !t.done ? ' imp' : '');
  el.innerHTML = '<span class="n2">' + esc(t.title) + '</span>';
  el.title = '';
  el._hov = {
    title: t.title,
    when: fmtDay(t.due_date) + (t.due_time ? ' ' + tmText(t.due_time) : ' 시각 없음') +
          (t.done ? ' · 완료' : ''),
    note: (wk ? '주말 마감이라 앞 영업일 칸에 놓았습니다' : '') +
          (wk && t.note ? String.fromCharCode(10) : '') + (t.note || ''),
  };
  /* 누르는 것은 칸에 맡긴다 (그날 요약이 열린다). 칩을 바로 수정으로 이으면
     달력에서 날짜를 훑어보려던 손이 자꾸 수정 창을 연다 - 목록 줄에서 고친
     것과 같은 문제다. 수정은 요약 안의 연필에만 맡긴다. */
  return el;
}

/* 달력 줄의 손끝 카드. 줄은 다시 그려지므로 머리말에 한 번만 매달고
   위임해 받는다. 카드 자체는 마우스를 받지 않아(pointer-events:none)
   카드 위로 지나가다 줄에서 벗어나는 일이 없다. */
let HOV_T = 0, HOV_EL = null;

function hovShow(el){
  const d = el._hov;
  if(!d) return;
  const box = $('#hov');
  box.innerHTML = '<b>' + esc(d.title) + '</b>' +
                  (d.when ? '<i>' + esc(d.when) + '</i>' : '') +
                  (d.note ? '<i>' + esc(d.note) + '</i>' : '') +
                  (d.rows ? '<div class="hov-rows">' + d.rows.map(r =>
                    '<div' + (r.done ? ' class="dn"' : '') + '><span class="hr-t">' + (r.t ? tmHTML(r.t) : '종일') + '</span>' +
                    '<span class="hr-x">' + esc(r.x) + '</span><span class="hr-s">' + (r.done ? '완료' : '') + '</span></div>').join('') +
                    '</div>' : '');
  box.classList.toggle('wide', !!d.rows);
  box.classList.add('on');
  const r = el.getBoundingClientRect(), b = box.getBoundingClientRect();
  /* 줄 바로 아래가 기본이되, 창 밖으로 나가면 위로 넘긴다 */
  let x = r.left, y = r.bottom + 6;
  if(x + b.width > innerWidth - 8) x = innerWidth - 8 - b.width;
  if(y + b.height > innerHeight - 8) y = r.top - 6 - b.height;
  box.style.left = Math.max(8, x) + 'px';
  box.style.top = Math.max(8, y) + 'px';
}

function hovHide(){
  clearTimeout(HOV_T);
  HOV_EL = null;
  const box = $('#hov');
  if(box) box.classList.remove('on');
}

document.addEventListener('mouseover', e => {
  const el = e.target.closest ? e.target.closest('.chip, .rtline, .sband, .rail, .sp-row') : null;
  if(el === HOV_EL) return;             /* 제 안의 글자로 옮겨간 것뿐 */
  hovHide();
  if(!el) return;
  HOV_EL = el;
  HOV_T = setTimeout(() => hovShow(el), 90);
});
document.addEventListener('scroll', hovHide, true);
window.addEventListener('blur', hovHide);

function dayModal(key, list){
  DAY_KEY = key;
  /* 주말 마감을 앞 영업일 칸에 얹었으므로, 목록에서는 실제 날짜를 밝혀 준다 */
  const wknd = weekendOn() ? 0 : list.filter(t => isWeekend(t.due_date)).length;
  const dd = dObj(key), rel = fmtDay(key);
  $('#day-title').innerHTML =
    (dd.getMonth()+1) + '월 ' + dd.getDate() + '일 ' + WD[(dd.getDay()+6)%7] + '요일' +
    '<i class="rel">' + rel + '</i>' +
    '<i class="opt cnt">' + list.length + '건' +
    (wknd ? ' · 주말 마감 ' + wknd + '건 포함' : '') + '</i>';
  const box = $('#day-list');
  box.innerHTML = '';
  const sp = spansOn(key);
  if(!list.length && !sp.length){
    box.innerHTML = '<div class="empty">이 날짜에 마감이 없습니다</div>';
  }
  sp.forEach(s => {
    const el = document.createElement('div');
    el.className = 'mg-row day-row day-sp' + (s.done ? ' off' : '');
    el.style.setProperty('--c', spanColor(s));
    el.innerHTML = '<i class="sp-sw"></i><span class="n">' + esc(s.title) + '</span>' +
                   '<span class="w">' + spanRange(s) + ' · ' + spanLeft(s, key) + '</span>';
    el.title = '기간 업무 - 눌러서 열기';
    el.onclick = () => { closeM('#m-day'); openEdit(asItem(s)); };
    box.appendChild(el);
  });
  list.forEach(t => {
    const el = document.createElement('div');
    el.className = 'mg-row day-row' + (t.done ? ' off' : '');
    const d = dObj(t.due_date);
    const when = (isWeekend(t.due_date)
        ? d.getDate() + '일(' + WD[(d.getDay() + 6) % 7] + ') ' : '') +
      (t.due_time ? tmHTML(t.due_time) : isWeekend(t.due_date) ? '' : '시각 없음');
    el.innerHTML = '<span class="dot" role="checkbox" aria-checked="' + (t.done ? 'true' : 'false') + '" title="' + (t.done ? '완료 취소' : '완료') + '"></span>' +
                   '<span class="n">' + esc(t.title) + '</span>' +
                   (t.note ? '<span class="note">' + esc(t.note) + '</span>' : '') +
                   '<span class="w">' + when.trim() + '</span>';
    el.title = '눌러서 열기';
    /* 목록 줄과 같다: 동그라미는 완료, 줄은 열기 */
    el.onclick = e => {
      if(!e.target.closest('.dot')){ closeM('#m-day'); openEdit(t._rt ? t : asItem(t)); return; }
      const item = t._rt ? t : asItem(t);
      setDone(item, !t.done, () => {
        /* 새 회차 목록이 오기 전에도 누른 결과가 곧바로 보이게 */
        if(t._rt) RT.items.forEach(o => { if(o.id === t.id && o.date === t.date) o.done = !t.done; });
      });
    };
    box.appendChild(el);
  });
  $('#day-add').onclick = () => { closeM('#m-day'); openAdd('deadline', {date:key}); };
  openM('#m-day');
}

function drawCal(){
  if(!STATE) return;
  const week = calWeek();
  $$('#cal-mode button').forEach(b => b.classList.toggle('on', (b.dataset.m === 'week') === week));
  $('#v-cal').classList.toggle('is-week', week);
  $('#cal-week').hidden = !week;
  $('#cal-head').hidden = $('#cal-grid').hidden = week;
  $('#cal-now').textContent = week ? '오늘' : '이번 달';
  $('#cal-prev').title = week ? '하루 앞' : '이전 달';
  $('#cal-next').title = week ? '하루 뒤' : '다음 달';
  $('#cal-rt').classList.toggle('off', !routinesOn());
  if(week) return drawWeek();
  if(!calCur){ const d = dObj(STATE.today); calCur = {y:d.getFullYear(), m:d.getMonth()}; }
  const y = calCur.y, m = calCur.m;
  $('#cal-ym').textContent = y + '년 ' + (m + 1) + '월';

  /* 주말 마감을 옆 달 칸으로 옮기는 경우까지 덮게 앞뒤로 한 주씩 더 */
  ensureRoutines(iso(new Date(y, m, 1 - 7)), iso(new Date(y, m + 1, 7)));

  const byDate = {};
  deadlines().forEach(t => {
    if(isSpan(t)) return;                          /* 기간은 칸 안의 줄이 아니라 띠로 */
    const k = cellDate(t.due_date);
    (byDate[k] = byDate[k] || []).push(t);
  });
  if(routinesOn()){
    const pm = y + '-' + String(m + 1).padStart(2, '0');
    routineItems().forEach(i => {
      if(i.date.slice(0, 7) !== pm) return;          /* 보고 있는 달만 */
      const k = cellDate(i.date);
      (byDate[k] = byDate[k] || []).push(asRoutine(i));
    });
  }
  Object.keys(byDate).forEach(k => byDate[k].sort(byWhen));


  /* 보여 줄 요일 (Date.getDay() 값). 주말을 끄면 월~금만 남는다 */
  const days = weekendOn() ? [0, 1, 2, 3, 4, 5, 6] : [1, 2, 3, 4, 5];
  const cols = days.length;
  $('#cal-we').classList.toggle('off', !weekendOn());
  $('#cal-rt').classList.toggle('off', !routinesOn());
  const head = $('#cal-head');
  head.style.setProperty('--cols', cols);
  head.innerHTML = days.map(w => '<span' + (w === 0 ? ' class="sun"' : w === 6 ? ' class="sat"' : '') +
    '>' + WD_SUN[w] + '</span>').join('');

  /* 그 달의 첫 주 일요일부터, 마지막 날이 포함된 주까지 */
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const cur = new Date(first);
  cur.setDate(first.getDate() - first.getDay());
  const hasDay = sun => {                     /* 그 주에 이 달에 속한 칸이 있나 */
    for(const w of days){
      const d = new Date(sun); d.setDate(sun.getDate() + w);
      if(d.getMonth() === m) return true;
    }
    return false;
  };
  while(!hasDay(cur)) cur.setDate(cur.getDate() + 7);
  const grid = $('#cal-grid');
  grid.style.setProperty('--cols', cols);
  /* 늘 여섯 줄 (참고 도안). 달마다 줄 수가 다르면 칸 높이가 달마다 바뀐다 */
  const weeks = 6;
  const room = calRoom(weeks);
  grid.innerHTML = '';
  const HN = STATE.holiday_names || {};

  /* 기간의 띠: 보이는 여섯 주에서 줄을 한 번 나눠 두면 주가 바뀌어도 같은 줄로 이어진다.
     셋까지만 그린다 (넘는 것은 그 날 목록에 있다). 이름은 적지 않고 손끝 카드로 */
  /* 이 달에 걸친 기간만 고르되, 옆 달 칸까지 끊지 않고 잇는다 - 9/28 ~ 10/3 은 9월에서도
     10월에서도 한 줄로 이어 보인다. 옆 달에만 있는 기간은 그 달에서 본다 */
  const m0 = iso(first), m1 = iso(last);
  const vis = spanList().filter(s => s.due_date >= m0 && s.start_date <= m1);
  const lanes = spanLanes(vis);
  const BAND_MAX = 3;

  for(let wk = 0; wk < weeks; wk++){
    /* 이 주에 그릴 띠 줄 수 - 한 주의 칸들은 같은 높이만큼 비워 두어야 띠가 가로로 곧게 잇는다 */
    const w0 = new Date(cur); w0.setDate(cur.getDate() + days[0]);
    const w1 = new Date(cur); w1.setDate(cur.getDate() + days[days.length - 1]);
    const wkSpans = vis.filter(s => s.due_date >= iso(w0) && s.start_date <= iso(w1) && lanes.get(s.id) < BAND_MAX);
    const bands = wkSpans.length ? Math.max(...wkSpans.map(s => lanes.get(s.id))) + 1 : 0;
    /* 띠는 칸 아랫단에 깐다 - 날짜 아래에 두면 모든 줄이 한 칸씩 밀려 그 날의 일이 잘린다.
       띠가 있는 주만 그 높이만큼 줄 수를 덜어 낸다 */
    const roomW = bands ? calRoom(weeks, bands * 5 + 2) : room;
    for(const w of days){
      const d = new Date(cur); d.setDate(cur.getDate() + w);
      const key = iso(d);
      const out = d.getMonth() !== m;
      const hol = HOL.has(key);
      const we = isWeekend(key);
      const cell = document.createElement('div');
      cell.className = 'day' + (out ? ' out' : '') +
                       (!out && (hol || we) ? ' we' : '') +
                       (!out && hol ? ' hol' : '') +
                       (w === 0 ? ' sun' : w === 6 ? ' sat' : '') +
                       (key === STATE.today ? ' now' : '');
      const num = key === STATE.today ? '<b>' + d.getDate() + '</b>' : d.getDate();
      /* 날짜는 칸 왼쪽의 좋은 홈이다. 일정도 공휴일 이름도 모두 그 오른쪽 칸에
         차례로 쌓는다 - 줄이 몇이든 왼쪽 끝은 하나다. */
      cell.innerHTML = '<div class="n">' + num + '</div>' +
        (hol && !out ? '<span class="hn">' + esc(HN[key] || '공휴일') + '</span>' : '');

      if(bands){
        const bb = document.createElement('div');
        bb.className = 'bands';
        bb.style.setProperty('--bands', bands);
        wkSpans.forEach(s => {
          if(s.start_date > key || s.due_date < key) return;
          const st = s.start_date === key || w === days[0], en = s.due_date === key || w === days[days.length - 1];
          const el = document.createElement('i');
          el.className = 'sband' + (s.start_date === key ? ' st' : '') + (s.due_date === key ? ' en' : '') +
                         (s.done ? ' dn' : '');
          el.style.setProperty('--c', spanColor(s));
          el.style.setProperty('--lane', lanes.get(s.id));
          el._hov = spanHov(s);
          el.onclick = e => { e.stopPropagation(); openEdit(asItem(s)); };
          bb.appendChild(el);
        });
        cell.appendChild(bb);
      }

      if(!out){
        const list = byDate[key] || [];
        const dls = list.filter(t => !t._rt);
        const rts = list.filter(t => t._rt);
        /* 루틴 줄과 '+N건 더' 가 쓸 자리를 먼저 떼어 둔다. 띠가 두 줄을 넘으면 한 줄 더 */
        const budget = Math.max(1, roomW - (rts.length ? 1 : 0));
        const show = dls.length > budget ? budget - 1 : budget;
        dls.slice(0, Math.max(0, show)).forEach(t => cell.appendChild(chipEl(t)));
        if(dls.length > show){
          const more = document.createElement('div');
          more.className = 'more';
          more.textContent = '+' + (dls.length - Math.max(0, show)) + '건 더';
          more.onclick = e => { e.stopPropagation(); dayModal(key, list); };
          cell.appendChild(more);
        }
        /* 반복은 한 줄로 접는다. 제목을 모두 적으면 같은 글이 날마다 되풀이되고,
           그 달에 하나뿐인 진짜 마감이 그 속에 묻힌다. 몇 건인지만 알려 준다. */
        if(rts.length){
          const rl = document.createElement('div');
          rl.className = 'rtline' + (rts.some(t => t.pinned && !t.done) ? ' imp' : '');
          const left = rts.filter(t => !t.done).length;
          rl.innerHTML = '루틴 <b>' + rts.length + '</b>' +
            (left && left !== rts.length ? '<span class="lf">' + left + ' 남음</span>' : '');
          rl.title = '';
          rl._hov = {title: '루틴 ' + rts.length + '건', when: fmtDay(key),
                     rows: rts.map(t => ({t: t.due_time || '', x: t.title, done: !!t.done}))};
          rl.onclick = e => { e.stopPropagation(); dayModal(key, list); };
          cell.appendChild(rl);
        }
        /* 뭔가 있는 날은 그날 목록을, 빈 날은 추가 창을 연다 */
        cell.onclick = () => list.length || spansOn(key).length ? dayModal(key, list)
                                         : openAdd('deadline', {date:key});
        const kind = hol ? (HN[key] || '공휴일') + ' · 영업일 아님'
                         : we ? '주말 · 영업일 아님' : '';
        cell.title = (kind ? kind + String.fromCharCode(10) : '') +
                     (list.length ? '마감 ' + list.length + '건 - 눌러서 전체 보기'
                                  : '눌러서 이 날짜에 마감 추가');
      }
      grid.appendChild(cell);
    }
    cur.setDate(cur.getDate() + 7);
  }
}

function shiftMonth(n){
  if(!calCur){ const d = dObj(STATE.today); calCur = {y:d.getFullYear(), m:d.getMonth()}; }
  const t = new Date(calCur.y, calCur.m + n, 1);
  calCur = {y:t.getFullYear(), m:t.getMonth()};
  drawCal();
  slideCal(n);
}
/* 다음 달은 오른쪽에서, 지난달은 왼쪽에서 들어온다. 격자가 통째로 한 번에 바뀌면
   몇 번 눌렀는지 · 어느 쪽으로 갔는지가 손에 남지 않는다. */
function slideCal(n){
  if(!n || calm()) return;
  const d = n > 0 ? 1 : -1, o = {duration: 300, easing: EASE};
  $('#cal-grid').animate([{opacity: 0, transform: 'translateX(' + (d * 24) + 'px)'},
                          {opacity: 1, transform: 'none'}], o);
  $('#cal-ym').animate([{opacity: 0, transform: 'translateX(' + (d * 8) + 'px)'},
                        {opacity: 1, transform: 'none'}], o);
}

/* 오늘 ↔ 달력. 인덱스 탭을 버렸으므로 머리줄의 둥근 단추가 넘긴다.
   단추 하나가 두 방향을 다 맡는다 - 지금 보고 있지 않은 쪽의 이름이 붙는다. */
function setView(v){
  const was = view;
  view = v;
  document.body.classList.toggle('v-cal', v === 'cal');
  $('#v-home').hidden = v !== 'home';
  $('#v-cal').hidden = v !== 'cal';
  $('#btn-view-l').textContent = v === 'cal' ? '오늘' : '달력';
  $('#btn-view').title = v === 'cal' ? '오늘' : '달력';
  fold();
  if(v === 'cal' && was !== 'cal') wkSel = null;   /* 다시 들어오면 7일은 오늘부터 */
  if(v === 'cal') drawCal();
  if(was !== v) replay(v === 'cal' ? $('#v-cal') : $('#v-home'), 'view-in');
}
$('#btn-view').onclick = () => setView(view === 'cal' ? 'home' : 'cal');
$('#cal-prev').onclick = () => calWeek() ? pickWeek(wkStep(wkSel || STATE.today, -1)) : shiftMonth(-1);
$('#cal-next').onclick = () => calWeek() ? pickWeek(wkStep(wkSel || STATE.today, 1)) : shiftMonth(1);
$('#cal-now').onclick = () => {
  if(calWeek()) return pickWeek(STATE.today);
  const t = dObj(STATE.today), was = calCur;
  calCur = null; drawCal();
  if(was) slideCal((t.getFullYear() - was.y) * 12 + t.getMonth() - was.m);
};
/* 달력을 보는 동안에는 하늘이 접혀 머리줄의 단추가 가려진다 -
   나가는 길은 여기 하나뿐이므로 반드시 있어야 한다 */
$('#cal-close').onclick = () => setView('home');
$('#cal-rt').onclick = () => {
  const on = !routinesOn();
  STATE.settings.show_routines = on;          /* 그리기는 바로, 저장은 뒤에 */
  drawCal();
  api('/api/settings', {show_routines: on});
};
$('#cal-we').onclick = () => {
  const on = !weekendOn();
  STATE.settings.show_weekend = on;          /* 그리기는 바로, 저장은 뒤에 */
  drawCal();
  api('/api/settings', {show_weekend: on});
};

/* ══════════ 7일 보기 ══════════
   고른 날부터 7일. 날을 누르면 그 날이 맨 위로 오고 7일이 그 날부터 다시 선다 (굴러가듯).
   ‹ › · 좌우 화살표는 하루씩. 오른쪽 판은 고른 날 하나를 전부 보여 준다.
   왼쪽 줄에는 시각 있는 일은 시각을, 없는 일은 점을 먼저 둔다 (도안 11a). */
let wkSel = null;                     /* 고른 날 = 7일의 첫날 (iso) */
const calWeek = () => !!(STATE && STATE.settings && STATE.settings.cal_week);
const addDay = (k, n) => { const d = dObj(k); d.setDate(d.getDate() + n); return iso(d); };

/* 주말을 끄면 한 주 보기는 영업일(월~금) 다섯 줄이다. 고른 날 · 넘기기도 주말을 건너뛴다 */
const wkDay = k => { if(!weekendOn()) while(isWeekend(k)) k = addDay(k, 1); return k; };
function wkStep(k, n){
  k = addDay(k, n);
  if(!weekendOn()) while(isWeekend(k)) k = addDay(k, n);
  return k;
}
function wkDays(){
  const out = [];
  for(let k = wkDay(wkSel); out.length < (weekendOn() ? 7 : 5); k = addDay(k, 1))
    if(weekendOn() || !isWeekend(k)) out.push(k);
  return out;
}

/* 한 주 보기의 한 줄에 놓을 것 (기간 업무는 세로선이라 뺀다). 주말 마감은 제 날에 그대로 -
   주말을 껐으면 앞 영업일 줄에 얹는다 (월 보기와 같다) */
function weekItems(key){
  const keys = [key];
  if(!weekendOn()) for(let k = addDay(key, 1); isWeekend(k); k = addDay(k, 1)) keys.push(k);
  const out = deadlines().filter(t => !isSpan(t) && keys.includes(t.due_date));
  if(routinesOn())
    routineItems().forEach(i => { if(i.date === key) out.push(asRoutine(i)); });
  return out.sort(byWhen);
}

/* 줄 하나: 앞 칸(시각 · 점 · ✓) + 이름 */
function wkItem(t, big){
  const el = document.createElement('div');
  const past = !t.done && !t._rt && t.due_date < STATE.today;
  el.className = 'wi' + (t._rt ? ' rt' : '') + (t.done ? ' dn' : '') + (past ? ' p' : '') + (big ? ' big' : '') + (t.pinned && !t.done ? ' imp' : '');
  const mark = t.done ? '<span class="wm ok">✓</span>'
             : t.due_time ? '<span class="wm tm">' + tmHTML(t.due_time) + '</span>'
             : '<span class="wm dt"></span>';
  el.innerHTML = mark + '<span class="wn">' + esc(t.title) + '</span>';
  return el;
}

function drawWeek(){
  wkSel = wkDay(wkSel || STATE.today);
  const days = wkDays();
  $('#cal-we').classList.toggle('off', !weekendOn());
  ensureRoutines(addDay(wkSel, -7), addDay(wkSel, 14));
  $('#cal-ym').textContent = md(days[0]) + ' – ' + md(days[days.length - 1]);
  const HN = STATE.holiday_names || {};
  const rows = $('#wk-rows');
  rows.innerHTML = '';
  days.forEach(key => {
    const d = dObj(key), w = d.getDay(), hol = HOL.has(key);
    const all = weekItems(key);
    const dls = all.filter(t => !t._rt), rts = all.filter(t => t._rt);
    const row = document.createElement('div');
    row.className = 'wr' + (key === wkSel ? ' sel' : '') + (key === STATE.today ? ' now' : '') +
                    (w === 0 || hol ? ' sun' : w === 6 ? ' sat' : '');
    row.dataset.d = key;
    row.innerHTML = '<div class="wh"><b class="wd-n">' + d.getDate() + '</b><span class="wd-w">' + WD_SUN[w] + '</span>' +
      (hol ? '<span class="wd-h">' + esc(HN[key] || '공휴일') + '</span>' : '') +
      (all.length ? '' : '<span class="wd-e">비어 있음</span>') +
      '<span class="wd-c">' + (all.length || '') + '</span><span class="wd-go">›</span></div>' +
      '<div class="wl"></div>';
    const list = row.querySelector('.wl');
    dls.forEach(t => list.appendChild(wkItem(t)));
    /* 루틴은 여기서는 한 줄로 접는다 - 오른쪽 판에서 모두 보인다 */
    if(rts.length){
      const rl = wkItem({title:'루틴 ' + rts.length, _rt:true, done:rts.every(t => t.done)});
      rl._hov = {title:'루틴 ' + rts.length + '건', when:fmtDay(key),
                 rows:rts.map(t => ({t:t.due_time || '', x:t.title, done:!!t.done}))};
      rl.classList.add('rtline');
      list.appendChild(rl);
    }
    row.onclick = () => pickWeek(key);
    rows.appendChild(row);
  });
  drawRails(days);
  drawPane(wkSel);
}

/* 기간의 세로선: 걸친 줄의 위에서 아래까지. 이 7일 안에서 시작하면 머리에 고리를 단다 */
function drawRails(days){
  const box = $('#wk-rails'), first = days[0], last = days[days.length - 1];
  box.innerHTML = '';
  const vis = spanList().filter(s => s.due_date >= first && s.start_date <= last);
  const lanes = spanLanes(vis);
  const pos = {};
  $$('#wk-rows .wr').forEach(r => pos[r.dataset.d] = {top:r.offsetTop, bot:r.offsetTop + r.offsetHeight});
  vis.forEach(s => {
    const a = s.start_date < first ? first : s.start_date, b = s.due_date > last ? last : s.due_date;
    if(!pos[a] || !pos[b]) return;
    const st = s.start_date >= first, en = s.due_date <= last;
    const top = pos[a].top + (st ? 6 : 0), bot = pos[b].bot - (en ? 6 : 0);
    const el = document.createElement('i');
    el.className = 'rail' + (st ? ' st' : '') + (en ? ' en' : '') + (s.done ? ' dn' : '');
    el.style.cssText = 'left:' + (lanes.get(s.id) * 9) + 'px;top:' + top + 'px;height:' + Math.max(6, bot - top) + 'px;--c:' + spanColor(s);
    el._hov = spanHov(s);
    el.onclick = e => { e.stopPropagation(); openEdit(asItem(s)); };
    box.appendChild(el);
  });
  box.style.width = Math.max(1, lanes.size ? Math.max(...lanes.values()) + 1 : 0) * 9 + 'px';
}

/* 오른쪽 판: 고른 날의 전부 + 그 날 걸쳐 있는 기간 업무 */
function drawPane(key){
  const pane = $('#wk-pane'), d = dObj(key), w = d.getDay(), HN = STATE.holiday_names || {};
  /* 판은 하루 전부라 시각 차례로 섞는다 (시각 없는 일은 뒤, 같은 시각이면 할 일이 먼저) */
  const all = weekItems(key).sort((a, b) => (a.due_time || '99:99').localeCompare(b.due_time || '99:99') ||
                                            (a._rt ? 1 : 0) - (b._rt ? 1 : 0));
  const sp = spansOn(key);
  const gap = dayDiff(STATE.today, key);
  const tag = gap === 0 ? '오늘' : gap > 0 ? gap + '일 뒤' : (-gap) + '일 전';
  pane.innerHTML =
    '<div class="wp-h"><b>' + d.getDate() + '</b><span>' + WD_SUN[w] + '요일</span>' +
    '<span class="wp-tag' + (gap === 0 ? ' now' : '') + '">' + tag + '</span>' +
    (HOL.has(key) ? '<span class="wp-hol">' + esc(HN[key] || '공휴일') + '</span>' : '') +
    '<span class="wp-c">' + (all.length ? all.length + '건' : '') + '</span></div>' +
    '<div class="wp-list"></div>' +
    '<button type="button" class="link wp-add">+ 이 날에 추가</button>' +
    '<div class="wp-sp"><div class="wp-sh"><span>진행 중인 기간 업무</span><span>' + (sp.length || '없음') + '</span></div></div>';
  const list = pane.querySelector('.wp-list');
  if(!all.length) list.innerHTML = '<div class="wp-empty">이 날엔 정해진 일이 없습니다</div>';
  all.forEach(t => {
    const el = wkItem(t, true);
    el.title = '눌러서 열기';
    el.onclick = () => openEdit(t._rt ? t : asItem(t));
    list.appendChild(el);
  });
  pane.querySelector('.wp-add').onclick = () => openAdd('deadline', {date:key});
  const box = pane.querySelector('.wp-sp');
  sp.forEach(s => {
    const len = Math.max(1, dayDiff(s.start_date, s.due_date));
    const pr = Math.min(1, Math.max(0, dayDiff(s.start_date, key) / len));
    const left = dayDiff(key, s.due_date);
    const el = document.createElement('div');
    el.className = 'sp-row' + (s.done ? ' dn' : '');
    el.style.setProperty('--c', spanColor(s));
    el.innerHTML = '<div class="sp-l"><i class="sp-sw"></i><span class="sp-n">' + esc(s.title) + '</span>' +
      '<span class="sp-r">' + spanRange(s) + '</span>' +
      '<span class="sp-d' + (!s.done && left <= 1 ? ' soon' : '') + '">' + (s.done ? '완료' : left === 0 ? '오늘 마감' : 'D-' + left) + '</span></div>' +
      '<div class="sp-bar"><i style="width:' + Math.round(pr * 100) + '%"></i></div>';
    el._hov = spanHov(s);
    el.onclick = () => openEdit(asItem(s));
    box.appendChild(el);
  });
}

/* 날을 고른다: 그 날이 첫 줄이 된다. 몇 칸 굴렀는지 손에 남게 위아래로 미끄러진다 */
function pickWeek(key){
  if(!key || key === wkSel) return;
  const n = dayDiff(wkSel, key);
  wkSel = key;
  drawWeek();
  if(calm()) return;
  const o = {duration:280, easing:EASE};
  $('#wk-rows').animate([{opacity:.4, transform:'translateY(' + (n > 0 ? 18 : -18) + 'px)'}, {opacity:1, transform:'none'}], o);
  $('#wk-rails').animate([{opacity:0}, {opacity:1}], o);
  $('#wk-pane').animate([{opacity:0, transform:'translateY(6px)'}, {opacity:1, transform:'none'}], o);
}

/* 왼쪽 7일 위에서 휠: 한 눈금에 하루씩 굴린다 (끊어서). 터치패드는 작은 값이 잇달아
   오므라 모아서 한 눈금만큼 차면 하루 넘기고, 넘긴 뒤 잠깐은 남은 관성을 버린다 */
let _wkAcc = 0, _wkLock = 0;
$('#wk-list').addEventListener('wheel', e => {
  if(!calWeek() || e.ctrlKey) return;
  e.preventDefault();
  const now = performance.now();
  if(now < _wkLock){ _wkAcc = 0; return; }
  _wkAcc += e.deltaMode === 1 ? e.deltaY * 40 : e.deltaY;
  if(Math.abs(_wkAcc) < 50) return;
  const n = _wkAcc > 0 ? 1 : -1;
  _wkAcc = 0;
  _wkLock = now + (e.deltaMode === 0 && Math.abs(e.deltaY) < 50 ? 220 : 60);
  pickWeek(wkStep(wkSel || STATE.today, n));
}, {passive:false});

/* 월 ↔ 7일. 고른 모양은 이 기기에만 남긴다 (설정 cal_week) */
function setCalMode(week){
  STATE.settings.cal_week = week;
  if(week) wkSel = STATE.today;
  drawCal();
  api('/api/settings', {cal_week: week});
}
/* 창 높이가 바뀌면 칸에 들어갈 줄 수(월) · 세로선 자리(7일)가 달라진다 */
let _calT = 0;
addEventListener('resize', () => { clearTimeout(_calT); _calT = setTimeout(() => { if(view === 'cal') drawCal(); }, 120); });
$('#cal-mode').onclick = e => {
  const b = e.target.closest('[data-m]');
  if(b) setCalMode(b.dataset.m === 'week');
};

/* ══════════ 전체 관리 ══════════ */
let mgKind = 'all';
$('#mg-tabs').onclick = e => {
  const b = e.target.closest('button'); if(!b) return;
  $$('#mg-tabs button').forEach(x => x.classList.toggle('on', x === b));
  mgKind = b.dataset.k; drawManage();
};
$('#btn-manage').onclick = () => { openM('#m-manage'); drawManage(); };

function drawManage(){
  const KN = {deadline:'할 일', routine:'루틴', floating:'메모'};
  let rows = STATE.tasks.slice();
  if(mgKind === 'done') rows = rows.filter(t => t.done);
  else if(mgKind !== 'all') rows = rows.filter(t => (t.kind||'deadline') === mgKind && !t.done);
  else rows = rows.filter(t => !t.done);

  const box = $('#mg-list');
  box.innerHTML = '';
  $('#mg-count').textContent = rows.length + '건';
  if(!rows.length){ box.innerHTML = '<div class="empty">해당 항목이 없습니다</div>'; return; }
  const byId = {};
  STATE.routines.forEach(r => byId[r.id] = r);
  rows.forEach(t => {
    const kind = t.kind || 'deadline';
    const rt = byId[t.id];
    const when = kind === 'routine' ? (rt ? rt.rule_text : '루틴')
               : kind === 'floating' ? '기한 없음'
               : (t.due_date ? fmtDay(t.due_date) : '날짜 없음') + (t.due_time ? ' ' + tmText(t.due_time) : '');
    const el = document.createElement('div');
    /* 지난 것은 시각이 벽돌빛이다 - 홈 · 달력과 같은 말 */
    const late = kind === 'deadline' && !t.done && t.due_date && t.due_date < STATE.today;
    el.className = 'mg-row' + (t.done ? ' off' : '') + (late ? ' late' : '');
    el.innerHTML = '<span class="k">'+KN[kind]+'</span><span class="n">'+esc(t.title)+
                   '</span><span class="w">'+esc(when)+'</span>';
    el.onclick = () => openEdit(rt || {
      id:t.id, title:t.title, note:t.note||'', kind:kind, rule:t.rule||null,
      date:t.due_date||null, start:isSpan(t) ? t.start_date : null, time:t.due_time||'',
      notify_min:t.notify_min!=null?t.notify_min:null, early_days:t.early_days||0, muted:!!t.muted, rule_text:'', done:!!t.done
    });
    box.appendChild(el);
  });
}

/* ══════════ 자동 업데이트 ══════════
   서비스(updater.py)가 조용한 때 새 버전으로 바꿔 끼우고, 바꾼 뒤 처음 여는 창에 한 번
   "무엇이 바뀌었는지" 를 보여 준다. 닫으면(확인 · 바깥 · Esc) 서비스에 봤다고 알려 다시 뜨지 않는다.
   숨긴 채 미리 만든 창에서 먼저 열려도 괜찮다 - 사람이 창을 열 때 그대로 떠 있다. */
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

/* 서비스에게 사람이 창을 쓰는지 알린다 - 보이는지(창을 닫아 숨기거나 최소화하면 바뀐다)와 실제 입력.
   목록을 스스로 다시 읽는 요청은 사람이 쓰는 것이 아니므로 따로 알려야 한다. 입력은 1분에 한 번만. */
let _uiT = 0;
const uiTell = b => api('/api/ui', Object.assign({visible: !document.hidden}, b)).catch(() => {});
document.addEventListener('visibilitychange', () => uiTell({}));
['mousedown', 'keydown', 'wheel'].forEach(t => document.addEventListener(t, () => {
  if(Date.now() - _uiT < 60000) return;
  _uiT = Date.now();
  uiTell({input: true});
}, {passive: true}));
uiTell({input: !document.hidden});

/* 설정의 버전 한 줄: 지금 버전과 자동 업데이트가 어디까지 왔는지.
   [업데이트 확인] 은 바로 한 번 확인하고(받을 것이 있으면 받는다), 받아 둔 것이 있으면
   [지금 업데이트] 로 바뀌어 조용한 때를 기다리지 않고 바꾼다 - 앱이 잠깐 꺼졌다 다시 열린다. */
let _updT = 0;
function paintUpdate(u){
  const show = u => {
    const busy = u.state === 'checking' || u.state === 'downloading';
    const tail = u.state === 'ready' ? u.latest + ' 받아 둠'
               : u.state === 'downloading' ? u.latest + ' 받는 중'
               : u.state === 'checking' ? '확인 중'
               : u.state === 'available' ? u.latest + ' 있음 (소스로 도는 중이라 받지 않습니다)'
               : u.state === 'error' ? (u.error === 'offline' ? '인터넷에 연결되지 않았습니다' : '확인하지 못했습니다 · 잠시 뒤 다시 눌러 주세요')
               : u.checked && u.latest && u.latest === u.version ? '최신입니다' : '';
    $('#s-ver').textContent = '버전 ' + u.version + (tail ? ' · ' + tail : '');
    const b = $('#s-upd-btn');
    b.textContent = u.state === 'ready' ? '지금 업데이트' : '업데이트 확인';
    b.dataset.act = u.state === 'ready' ? 'apply' : 'check';
    b.disabled = busy;
    clearTimeout(_updT);
    if(busy && $('#m-settings').classList.contains('on')) _updT = setTimeout(() => paintUpdate(), 1500);
  };
  if(u) return show(u);
  api('/api/update').then(show).catch(() => {});
}
$('#s-upd-btn').onclick = e => {
  const b = e.currentTarget;
  if(b.dataset.act === 'apply'){
    b.disabled = true;
    $('#s-ver').textContent = '새 버전으로 바꾸는 중 · 곧 다시 열립니다';
    api('/api/update/apply', {}).catch(err => { say(err.message); paintUpdate(); });
    return;
  }
  api('/api/update/check', {}).then(paintUpdate).catch(err => say(err.message));
};

/* ══════════ 설정 ══════════ */
/* 설정 창의 값은 창을 열 때 한 번만 채운다. 예전에는 45초마다 새로 읽을 때마다
   채워서, 고치던 값이 저장을 누르기 전에 조용히 예전 값으로 되돌아갔다. */
/* macOS 에서 도는 창이면 (서비스가 index.html 의 data-os 에 적어 준다) 그 운영체제의 말로 */
const ON_MAC = document.documentElement.dataset.os === 'mac';
if(ON_MAC){
  const auto = $('#s-auto');
  if(auto) auto.parentNode.lastChild.textContent = ' 로그인할 때 자동 실행';
  const sc = $('#s-shortcut');
  if(sc) sc.hidden = true;                 /* 바로가기 대신 응용 프로그램 폴더 · Dock 에 둔다 */
  const where = $('#s-where');
  if(where) where.textContent = '~/Library/Application Support/LazyScheduler/data.json';
  const hold = $('#s-hold');
  if(hold) hold.parentNode.title = '전체 화면 앱 · 잠금 화면일 때 미룹니다.\n집중 모드(방해 금지)는 macOS 가 알려주지 않아 잡지 못합니다.';
}

function fillSettings(){
  const st = STATE.settings;
  $('#s-lead').value = st.notify_min != null ? st.notify_min : 30;
  $('#s-brief').value = tmText(st.brief_time || '08:30');
  $('#s-brief').dataset.last = $('#s-brief').value;
  $('#s-biz').checked = bizOn();
  $('#s-auto').checked = !!st.autostart;
  $('#s-hold').checked = st.hold_when_busy !== false;
  $('#s-walk').checked = st.guy_walk !== false;
  $('#s-sky').checked = st.show_sky !== false;
  $('#s-walk').disabled = st.show_sky === false;
  $('#s-upd').checked = st.auto_update !== false;
  $('#s-ver').textContent = '버전 ' + (STATE.version || '');
  paintUpdate();
  paintTheme(st.theme || 'auto');
}

/* 설정은 바꾸는 즉시 저장한다 (저장 단추가 없다). 바뀐 한 가지만 보낸다 - 창을
   연 뒤 다른 기기에서 바뀐 값을 이 창의 옛 값으로 덮어쓰지 않게. 서버가 거절하면
   (예: 알림 분이 범위 밖) 알리고 저장된 값으로 되돌린다. */
let _savedT = 0;
function saveSetting(patch){
  const tag = $('#s-saved');
  return change('/api/settings', patch).then(() => {
    tag.textContent = '저장됨';
    tag.classList.add('ok');
    clearTimeout(_savedT);
    _savedT = setTimeout(() => { tag.textContent = ''; tag.classList.remove('ok'); }, 1600);
  }).catch(e => { say(e.message); if(STATE) fillSettings(); });
}
[['#s-biz', 'business_only'], ['#s-auto', 'autostart'], ['#s-hold', 'hold_when_busy'], ['#s-walk', 'guy_walk'],
 ['#s-upd', 'auto_update'], ['#s-sky', 'show_sky']]
  .forEach(([id, key]) => { $(id).addEventListener('change', e => saveSetting({[key]: e.target.checked})); });
$('#s-lead').addEventListener('change', e => {
  const v = +e.target.value;
  if(!Number.isInteger(v) || v < 0 || v > 1440){
    say('기본 알림은 0~1440분 사이로 적어 주세요');
    e.target.value = STATE.settings.notify_min != null ? STATE.settings.notify_min : 30;
    return;
  }
  saveSetting({notify_min: v});
});
$('#s-brief').addEventListener('tf-change', e => {
  const v = parseTime(e.target.value);
  if(STATE && v && v !== STATE.settings.brief_time) saveSetting({brief_time: v});
});

/* 화면 밝기. 고르는 순간 창에 비치고 곧바로 저장된다 - 색을 고르는 일은 눈으로
   보고 정하는 것이다. */
function paintTheme(v){
  $$('#s-theme button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
}
function themeBack(){
  if(!STATE || $('#m-settings').classList.contains('on')) return;
  const want = (STATE.settings && STATE.settings.theme) || 'auto';
  if(THEME === want) return;
  themeTo(() => { THEME = want; });
}
$$('#s-theme button').forEach(b => { b.onclick = () => {
  paintTheme(b.dataset.v);
  themeTo(() => { THEME = b.dataset.v; });
  saveSetting({theme: b.dataset.v});
}; });
$('#btn-settings').onclick = () => {
  if(STATE) fillSettings();
  openM('#m-settings');
  refreshSync();
};

/* ══════════ 동기화 (설정 창) ══════════
   로그인은 브라우저에서 사람이 마쳐야 끝난다. 시작만 부탁하고, 설정 창이 열려
   있는 동안 1.5초마다 진행을 묻는다. 창을 닫으면 묻지 않는다 (로그인은 계속된다). */
let syncPoll = null;
function paintSync(s){
  const msg = $('#sync-msg'), btn = $('#sync-btn'), now = $('#sync-now'), del = $('#sync-del');
  btn.disabled = false;
  now.hidden = del.hidden = !(s.configured && s.signed_in);
  now.disabled = del.disabled = !!s.syncing;
  if(!s.configured){
    msg.textContent = '동기화 설정이 없는 빌드입니다.';
    btn.hidden = true;
    return;
  }
  btn.hidden = false;
  if(s.state === 'waiting'){
    msg.textContent = '브라우저에서 Google 로그인을 마쳐 주세요…';
    btn.textContent = '기다리는 중';
    btn.disabled = true;
  }else if(s.signed_in){
    const when = s.syncing ? '맞추는 중…'
               : s.sync_error ? s.sync_error
               : s.last_sync ? s.last_sync + ' 에 맞춤' : '곧 맞춥니다';
    msg.textContent = s.email + ' · ' + when + (s.pending ? ' · 보낼 변경 ' + s.pending + '건' : '');
    btn.textContent = '로그아웃';
  }else{
    msg.textContent = s.state === 'error' ? s.error : '로그인하면 이 PC 와 휴대폰의 일정이 같아집니다.';
    btn.textContent = 'Google 계정으로 로그인';
  }
}
function refreshSync(){
  clearTimeout(syncPoll);
  return api('/api/sync').then(s => {
    paintSync(s);
    if((s.state === 'waiting' || s.syncing) && $('#m-settings').classList.contains('on'))
      syncPoll = setTimeout(refreshSync, 1500);
    return s;
  });
}
$('#sync-btn').onclick = () => api('/api/sync').then(s => {
  if(s.signed_in){
    confirmBox('로그아웃할까요?',
      '이 PC 의 일정은 그대로 남습니다. 다시 로그인하면 이어서 맞춥니다.',
      () => api('/api/sync/signout', {}).then(after => {
        closeM('#m-confirm'); paintSync(after); say('로그아웃했습니다');
      }), '로그아웃');
  }else{
    api('/api/sync/signin', {}).then(() => refreshSync());
  }
});
/* 계정 지우기. 되돌릴 수 없으므로 무엇이 지워지고 무엇이 남는지 먼저 적어 준다.
   이 PC 의 일정은 기본으로 남긴다 - 계정을 정리하려는 것과 이 PC 를 비우려는 것은 다른 일이다. */
$('#sync-del').onclick = () => confirmBox(
  '계정과 클라우드 데이터를 지울까요?',
  '클라우드에 올라간 일정이 모두 지워지고 로그인이 끊깁니다. 되돌릴 수 없습니다.',
  () => {
    const local = !!($('#cf-local') && $('#cf-local').checked);
    $('#cf-ok').disabled = true;
    $('#cf-ok').textContent = '지우는 중…';
    api('/api/sync/delete-account', {local: local})
      .then(after => {
        closeM('#m-confirm');
        paintSync(after);
        say('계정을 지웠습니다' + (after.wiped ? ' · 이 PC 의 일정 ' + after.wiped + '건도' : ''));
        load();
      })
      .catch(e => { closeM('#m-confirm'); say(e.message); })
      .then(() => { $('#cf-ok').disabled = false; $('#cf-ok').textContent = '삭제'; });
  }, '삭제',
  '<label class="chk"><input type="checkbox" id="cf-local"> 이 PC 의 일정도 함께 지우기 ' +
  '<i class="opt">기본은 남겨 둡니다</i></label>' +
  '<label class="chk"><input type="checkbox" id="cf-ack"> 되돌릴 수 없다는 것을 확인했습니다</label>', true);

/* 지금 맞추기: 뒤에서 2초 뒤에 시작하므로, 조금 기다렸다가 결과를 묻고 목록도 다시 읽는다 */
$('#sync-now').onclick = () => api('/api/sync/now', {}).then(() => {
  $('#sync-msg').textContent = '맞추는 중…';
  setTimeout(() => refreshSync().then(() => load()), 3500);
});
$('#s-shortcut').onclick = () => api('/api/shortcut', {})
  .then(r => say(r.ok ? '바탕화면에 바로가기를 만들었습니다' : '바로가기를 만들지 못했습니다'));
$('#s-test').onclick = () => api('/api/test-toast', {}).then(() => say('알림을 띄웠습니다 (우측 하단)'));
$('#s-quit').onclick = () => confirmBox('완전히 종료할까요?',
  '알림도 함께 멈춥니다. 바탕화면 아이콘으로 다시 시작할 수 있습니다.',
  () => { api('/api/quit', {}); setTimeout(() => window.pywebview ? window.pywebview.api.close() : window.close(), 400); },
  '종료');

/* 첫 그림이 오기 전에는 뾈대를 세워 둔다. 빈 화면보다 낫고,
   줄 높이가 같아서 내용이 들어올 때 화면이 튀지 않는다. */
['#today', '#upcoming', '#floating'].forEach(sel => {
  const el = $(sel);
  if(el && !el.children.length)
    el.innerHTML = [58, 42, 50, 36].map(w =>
      '<div class="sk-row"><span class="sk c"></span><span class="sk l" style="width:' + w + '%"></span>' +
      '<span class="sk r"></span></div>').join('');
});
/* ══════════ 새로 읽기 ══════════
   45초마다 다시 읽는다. 창이 숨어 있는 동안에는 묻지 않는다 - × 로 숨겨 둔 창이
   하루 종일 서비스를 두드릴 까닭이 없다. 다시 보이는 순간 곧바로 한 번 읽는다.
   창은 Win32 로 숨기고 보이므로 visibilitychange 가 오지 않을 수 있다. 그래서
   창 프로세스가 보일 때 __lsShown 을 불러 주고(ui.py), × 를 누를 때 HIDDEN 을 세운다. */
const POLL_MS = 45000;
let HIDDEN = false;
function setHidden(on){
  HIDDEN = on;
  document.body.classList.toggle('away', on);
  if(on && window.PB) PB.rest();
}
const onScreen = () => !HIDDEN && !document.hidden;
function wake(){
  setHidden(false);
  if(Date.now() - lastLoad > 3000) load();
}
window.__lsShown = wake;
document.addEventListener('visibilitychange', () => {
  document.body.classList.toggle('bg', document.hidden);     /* 최소화 등 - 움직임을 쉰다 */
  if(!document.hidden) wake();
});
addEventListener('focus', () => { if(HIDDEN || Date.now() - lastLoad > POLL_MS) wake(); });
/* 첫 읽기는 하늘(sky.js) · 돌멩이(pebble.js)까지 모두 읽힌 뒤에 */
if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => load());
else load();
setInterval(() => { if(onScreen()) load(); }, POLL_MS);

/* ══════════ 화면 갈무리 ══════════
   tools/shots.py 가 창을 하나씩 열어 두고 찍는다. 주소에 #shot=이름 을 붙이면
   그 화면이 열린 채로 멈춘다. 빛은 한낮(11시)으로 못 박는다 - 밤에 찍으면
   밤 색을 기준으로 디자인하게 된다. 평소에는 이 고리가 아무 일도 하지 않는다. */
function shotHook(){
  const m = /^#shot=([a-z-]+)$/.exec(location.hash || '');
  if(!m) return;
  /* 시각까지 한낮으로 못 박는다 - 새벽에 찍으면 해가 뜨지 않아 궤도가 비어 버리고,
     지난 것 · 다음 것 구분도 실제와 다르게 나온다. */
  SHOT_MIN = m[1] === 'night' ? 0 : 11 * 60;
  /* 움직임을 아예 끈다. 헤드리스 갈무리는 가상 시간으로 돌지만 CSS 전환은
     그 시계를 따라가지 않아, 창이 반쯤 열린 채로 찍힌 적이 있다(하루 목록). */
  const st = document.createElement('style');
  st.textContent = '*,*::before,*::after{transition:none !important; animation:none !important}';
  document.head.appendChild(st);
  const HHMM = SHOT_MIN === 0 ? '00:00' : '11:00';
  if(RAW){ RAW.now = HHMM; }
  $('#clock')._v = HHMM; $('#clock').innerHTML = $('#clock-m').innerHTML = tmHTML(HHMM);
  repaint();
  const first = () => (STATE.todays || [])[0] || (STATE.overdue || [])[0];
  const go = {
    home:       () => {},
    night:      () => {},                  /* 같은 홈, 빛만 한밤 */
    cal:        () => setView('cal'),
    add:        () => { openAdd('deadline', {date:addDay(STATE.today, 2)}); $('#a-title').value = '분기 운용보고서 초안'; },
    'add-rt':   () => { openAdd('routine', {}); $('#a-title').value = '월말 결산'; },
    'add-say':  () => { openAdd('deadline', {}); $('#a-title').value = '분기 운용보고서 초안';
                        const f = $('#m-add .win'); f.focus(); f.value = '매달 넷째 목 오전 10시'; f.dispatchEvent(new Event('input')); },
    'add-memo': () => openAdd('floating', {}),
    edit:       () => { const i = first(); if(i) openEdit(i); },
    manage:     () => { openM('#m-manage'); drawManage(); },
    settings:   () => $('#btn-settings').onclick(),
    day:        () => dayModal(STATE.today, dayItems(STATE.today)),
    time:       () => { openAdd('deadline', {date:addDay(STATE.today, 1)}); $('#a-title').value = '견적서 회신';
                        setTimeout(() => $('#m-add .tin').focus(), 150); },
    ctx:        () => {
      const i = first(), el = $('#today .item');
      if(!i || !el) return;
      OFFLINE = false;                       /* 연결이 끊긴 채로는 열리지 않는다 */
      const r = el.getBoundingClientRect();
      ctxOpen(r.left + 300, r.bottom + 2, i, 'today');
    },
    undo:       () => { undoToast('완료', (first() || {title:'국내 일임 매매'}).title, () => {});
                        clearTimeout(undoToast._t); },   /* 가상 시간이 3초를 지나쳐 버린다 */
  };
  const f = go[m[1]];
  if(f) setTimeout(f, 80);
}
