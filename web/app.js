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
   오전 · 오후를 따로 찾는 일이 없게, 24시간을 한 판에 펼쳐 놓는다.

     시    0 1 2 … 11
           12 13 … 23        ← 한 번 누르면 곧바로 정각 (09:00)
     분    00 05 … 55        ← 이어서 누르면 분까지 (09:30) · 닫힌다

   같은 열에 시와 분이 세로로 맞물려 있어 눈이 한 번만 움직인다. 12시간 표기를
   쓰지 않으므로 "3" 이 두 군데 있을 일도, 오전/오후를 고를 일도 없다.
   정각이면 한 번, 아니면 두 번. 키보드가 빠르면 칸에 그냥 쳐도 된다:
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
  const v = TP.input && TP.input.value;
  return v && /^\d\d:\d\d$/.test(v) ? [+v.slice(0, 2), +v.slice(3)] : null;
}
/* 한밤과 늦은 밤은 흐리게 둔다 - 흔히 쓰는 시간대가 먼저 눈에 들게 */
const dimHour = h => h < 6 || h >= 22;

function tpDraw(){
  const box = $('#tp'), el = TP.input;
  if(!el) return;
  const cur = tpCur();
  const curH = cur ? cur[0] : null, curM = cur ? cur[1] : null;
  const nowH = new Date().getHours();
  const none = el.hasAttribute('data-req') ? '' : '<button type="button" data-tp="none">없음</button>';
  const hour = h => {
    const cls = [h === curH ? 'on' : '', h === nowH ? 'now' : '', dimHour(h) ? 'dim' : ''].filter(Boolean).join(' ');
    return '<button type="button" data-h="' + h + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + h + '</button>';
  };
  const minute = k => {
    const m = k * 5;
    return '<button type="button" data-m="' + m + '"' + (cur && m === curM ? ' class="on"' : '') + '>' + pad2(m) + '</button>';
  };
  const typed = el.value.trim();
  box.innerHTML =
    '<div class="tp-h"><span class="tp-t">시각</span><span class="tp-v' + (typed ? '' : ' ph') + '">' +
      esc(typed || '시각 없음') + '</span><span class="sp"></span>' + none + '</div>' +
    '<div class="tp-f">숫자로 쳐도 됩니다 · 930 · 21 · 930p</div>' +
    '<div class="tp-l">시</div>' +
    '<div class="tp-g">' + [...Array(24)].map((_, h) => hour(h)).join('') + '</div>' +
    '<div class="tp-l">분</div>' +
    '<div class="tp-g m">' + [...Array(12)].map((_, k) => minute(k)).join('') + '</div>';
}
/* 판은 시각 칸을 덮고 뜬다 (도안 4f). 판 위의 값 칸(.tp-v)이 시각 칸과 같은 자리에
   오게 놓아, 칸이 판으로 부풀어 오른 것처럼 읽힌다. 아래가 모자라면 위로 올리되,
   하늘이 펼쳐져 있으면 그 아래에서 멈춘다 - 점선 구슬을 가리면 하늘을 펼친 까닭이 없다. */
function tpPlace(){
  const box = $('#tp'), r = TP.input.getBoundingClientRect();
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
  tpDraw();
  $('#tp').classList.add('on');
  tpPlace();
  peekOpen(el);
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
function peekOpen(el){
  if(!el.closest('#m-add, #m-edit')) return;
  document.body.classList.add('peek');
  peekSet(el.value);
  [120, 260, 400, 540].forEach(t => setTimeout(() => { if(tpShown()) tpPlace(); }, t));
}
function peekSet(v){
  if(!document.body.classList.contains('peek')) return;
  const t = parseTime(v);
  PEEK = t ? mins(t) : null;
  if(STATE && SKY_ALL) drawSky(SKY_ALL);
}
function peekClose(){
  if(!document.body.classList.contains('peek')) return;
  document.body.classList.remove('peek');
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
  }else el.value = v;
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
/* 시를 누르면 정각으로 정해 두고 열어 둔다 (대부분 거기서 끝난다).
   분까지 누르면 닫는다 - 더 고를 것이 없기 때문이다. */
function tpPick(h, m, close){
  const el = TP.input;
  if(!el) return;
  el.value = hhmm(h * 60 + m);
  tfCommit(el);
  if(close) tpClose(); else tpDraw();
}
$('#tp').addEventListener('click', e => {
  const b = e.target.closest('button');
  if(!b) return;
  if(b.dataset.tp === 'none') return tfSet('');
  const cur = tpCur();
  if(b.dataset.h != null) return tpPick(+b.dataset.h, cur ? cur[1] : 0, false);
  if(b.dataset.m != null) return tpPick(cur ? cur[0] : new Date().getHours(), +b.dataset.m, true);
});
document.addEventListener('focusin', e => { if(e.target.matches && e.target.matches('input[data-tf]')) tpOpen(e.target); });
document.addEventListener('click', e => { if(e.target.matches && e.target.matches('input[data-tf]')) tpOpen(e.target); });
document.addEventListener('mousedown', e => {
  if(tpShown() && !e.target.closest('#tp') && e.target !== TP.input) tpClose();
});
document.addEventListener('keydown', e => {
  const el = e.target;
  if(!(el.matches && el.matches('input[data-tf]'))) return;
  if(e.key === 'Enter'){ e.preventDefault(); tfCommit(el); tpClose(); }
  else if(e.key === 'Tab') tpClose();
}, true);
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
  esc(v || '') + '" title="' + (title || '예: 930 · 21 · 930p') + '">';
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
   (내일로 · 건너뛰기 · 삭제) 이 뜬다. 어느 것이든 5초 안에 되돌릴 수 있다. */
function rowActs(i, where){
  const a = [];
  if(!i.done){
    if(i.kind === 'routine'){
      if(i.date) a.push('<button type="button" data-a="skip" title="' + esc(fmtDay(i.date)) + ' 회차만 건너뜁니다">건너뛰기</button>');
    }else if(i.kind !== 'floating' && i.date){
      a.push('<button type="button" data-a="later">' + (i.date > STATE.today ? '하루 뒤로' : '내일로') + '</button>');
    }
  }
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
                 (opt.next ? ' next' : '') + (pop ? ' pop' : '') +
                 (ARRIVE.has(i.id) && !calm() ? ' arrive' : '');
  if(i.id) el.dataset.id = i.id;
  if(i.n) el.dataset.n = i.n;
  const bits = [];
  if(i.muted) bits.push('<span class="tag">알림 끔</span>');
  if(opt.next) bits.push('<span class="st">다음</span>');
  if(opt.showOverdue && i.date && i.date < STATE.today && !i.done)
    bits.push('<span class="st late">'+esc(fmtDay(i.date))+'</span>');
  const when = opt.showDate && i.date ? fmtDay(i.date) + (i.time ? ' ' + i.time : '') : (i.time || '');
  if(when) bits.push('<span class="tm">'+esc(when)+'</span>');
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

function fill(node, list, emptyMsg, opt, maker){
  node.innerHTML = '';
  if(!list.length){
    /* '<' 로 시작하면 이미 완성된 마크업이다 (아래 emptyToday 같은 안내 화면) */
    node.innerHTML = emptyMsg.charAt(0) === '<'
      ? emptyMsg : '<div class="empty">'+emptyMsg+'</div>';
    return;
  }
  list.forEach(i => node.appendChild((maker||itemEl)(i, opt)));
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
  const when = n && n.date ? fmtDay(n.date) + (n.time ? ' ' + n.time : '') : '';
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
  node.innerHTML = '';
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
      const r = document.createElement('div'); r.className = 'nowrule'; r.textContent = STATE.now;
      node.appendChild(r); ruled = true;
    }
    if(b !== band){ band = b; head('band', BAND_NAME[b]); }
    node.appendChild(itemEl(i, {showOverdue:true, where:'today', next:i === nxt}));
  });
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
  if(el.textContent !== v) el.textContent = $('#clock-m').textContent = v;   /* 같은 글자를 다시 넣어도 큰 시계를 새로 그린다 */
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
   완료 · 건너뛰기 · 내일로 · 삭제는 묻지 않고 곧바로 한다. 아래 가운데에 5초 동안
   "되돌리기" 가 뜬다. 확인 창으로 한 번 더 묻는 것보다 빠르고, 잘못 눌렀을 때도
   손해가 없다. 삭제만은 실제로 지우는 것을 5초 미룬다 (되돌리면 아무 일도 없었던 것). */
const UNDO_MS = 5000;
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
  const from = i.date, to = laterDate(i);
  return change(taskUrl(i), {due_date: to}).then(() => {
    undoToast(fmtDay(to) + '로', i.title, () => change(taskUrl(i), {due_date: from}));
  });
}

/* 삭제: 화면에서는 곧바로 빼고, 서버에는 5초 뒤에 보낸다 */
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
      if(i.date || i.next_date) r.push(['skip', '이번 회차 건너뛰기']);
    }else if(i.kind !== 'floating' && i.date){
      r.push(['later', i.date > STATE.today ? '하루 뒤로' : '내일로']);
    }
  }
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
  /* 달력을 보고 있을 때만 좌우로 달 넘기기 (입력 중에는 방해하지 않는다) */
  if(view === 'cal' && !$$('.modal.on').length && /^Arrow(Left|Right)$/.test(e.key)){
    shiftMonth(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  /* 메모는 여러 줄이 될 수 있다 - 그 칸에서 Enter 는 줄바꿈이고, 저장은 Ctrl+Enter */
  const multi = e.target.tagName === 'TEXTAREA' && !e.ctrlKey && !e.metaKey;
  if(e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !multi && !e.defaultPrevented){
    if($('#m-add').classList.contains('on')) $('#a-save').click();
    else if($('#m-edit').classList.contains('on')) $('#e-save').click();
  }
};

/* ══════════ 루틴: 예시 날짜 × 단위 ══════════
   규칙 하나를 정할 때 사람이 고르는 것은 셋뿐이다.

     ① 이 일을 하는 날 하나        달력
     ② 단위와 간격                 일 · 주 · 월 · 년, 그리고 몇 단위마다 (격주 · 격월 · 분기 · 반기)
     ③ 그 날을 어떻게 읽을지        말일 · 마지막 영업일 · 마지막 수요일 · 말일 3일 전 …

   ③ 은 엔진(recur.suggest)이 만든다. 화면에 뜨는 것은 모두 "고른 그 날에 도는" 규칙이라,
   무엇을 골라도 그 날이 빠지지 않는다. basis · N번째 같은 말은 화면에 나오지 않는다.

   간격이 "실행하는 달" 까지 정한다: 9월을 짚고 3달마다면 3·6·9·12월, 10월이면 1·4·7·10월.
   그래서 "분기 말 / 분기 초" 를 따로 고를 일이 없다.

   저장 형식(period · basis · n · k · months · holiday_shift)은 그대로다. */
const UNITS = [['day','일'], ['week','주'], ['month','월'], ['year','년']];
const EVERY = {
  week:  [[1,'매주'], [2,'격주']],
  month: [[1,'매달'], [2,'격월'], [3,'분기'], [6,'반기']],
};
/* 예전에 저장한 간격(2달마다 등)이 목록에 없으면 그 줄만 하나 더 붙여 둔다 -
   고치려고 연 규칙이 소리 없이 다른 주기로 바뀌면 안 된다 */
function everyOpts(unit, cur){
  const o = (EVERY[unit] || []).slice();
  if(o.length && !o.some(x => x[0] === cur)) o.push([cur, cur + (unit === 'week' ? '주' : '달') + '마다']);
  return o.sort((x, y) => x[0] - y[0]);
}
const SHIFTS = [['prev','앞 영업일로'], ['next','다음 영업일로'], ['none','그대로']];
const sel = (f, opts, cur) => '<select data-f="'+f+'">'+opts.map(([v,l]) =>
  '<option value="'+v+'"'+(String(cur)===String(v)?' selected':'')+'>'+l+'</option>').join('')+'</select>';
const seg = (key, opts, cur, off) => '<div class="seg'+(off ? ' off' : '')+'">'+opts.map(([v,l]) =>
  '<button type="button" data-s="'+key+'" data-v="'+v+'"'+(String(cur)===String(v)?' class="on"':'')+'>'+l+'</button>').join('')+'</div>';
const line = (label, body, note) => '<div class="sl"><span class="lb">'+label+(note ? '<i>'+note+'</i>' : '')+'</span><div>'+body+'</div></div>';

/* 저장된 규칙 → 단위와 간격 (고치기로 열었을 때 어디서 시작할지) */
function unitOf(rule){
  if(!rule) return {unit:'month', every:1};
  if(rule.period === 'day') return {unit:'day', every:1};
  if(rule.period === 'week') return {unit:'week', every: rule.interval || 1};
  if(rule.period === 'quarter') return {unit:'month', every:3};     /* 예전 분기 규칙: 가장 가까운 자리 */
  const m = rule.months;
  if(!m || m.length >= 12) return {unit:'month', every:1};
  if(m.length === 1) return {unit:'year', every:1};
  return {unit:'month', every: 12 % m.length === 0 ? 12 / m.length : 1};
}
/* 영업일로 세는 규칙은 주말 · 공휴일에 걸릴 일이 없다 */
const countsBizDays = r => !!r && (r.basis === 'business_day' || r.basis === 'before_end_bd' ||
  (r.period === 'day' && r.business_only));

/* ══════════ 폼 (추가 / 수정 공용) ══════════
   창의 크기와 뼈대는 종류(할 일 · 루틴 · 메모)와 상관없이 같다. 탭을 바꿔도
   겹치는 것은 제자리에 있다:

     이름 · 메모              맨 위
     작은 달력                왼쪽 칸 (할 일: 마감 날짜 / 루틴: 예시 날짜)
     종류마다 다른 것         오른쪽 칸 (할 일: 고른 날 / 루틴: 문장)
     시각 · 알림              아래 띠 (메모는 비워 두되 자리는 남긴다)
     단추                     맨 아래

   예전에는 종류마다 창 높이 · 너비가 달라서, 탭을 누를 때마다 이름 칸과
   단추가 위아래로 뛰었다. */

/* 알림은 몇 분 전에: 자주 쓰는 넷. 저장된 값이 이와 다르면 그 값도 하나 더 보여 준다 */
/* "전" 은 알약마다 붙이지 않고 줄 끝에 한 번만 적는다 - 넷 모두에 붙이면 한 줄에
   들어가지 않아 알약이 두 줄로 넘쳤다. */
const LEADS = [[10,'10분'], [30,'30분'], [60,'1시간'], [180,'3시간']];
const leadLabel = m => !m ? '정각' : m % 60 === 0 ? (m / 60) + '시간' : m + '분';

function Form(box){
  const F = f => box.querySelector('[data-f="'+f+'"]');
  const self = {kind:'deadline', box:box, lead:null, date:null, R:null};

  /* 작은 달력. 할 일은 마감 날짜를, 루틴은 "날짜 하나로 시작" 의 예시 날짜를 고른다 */
  function miniCal(el, MC, onPick, marks){
    const draw = () => {
      const first = new Date(MC.y, MC.m, 1);
      const cur = new Date(first);
      cur.setDate(1 - first.getDay());
      let h = '<div class="mc-top"><button type="button" data-mc="-1" aria-label="이전 달">'+
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>'+
        '<b>'+MC.y+'년 '+(MC.m+1)+'월</b>'+
        '<button type="button" data-mc="1" aria-label="다음 달">'+
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button></div>'+
        '<div class="mc">' + WD_SUN.map((w, x) =>
          '<i'+(x === 0 ? ' class="sun"' : x === 6 ? ' class="sat"' : '')+'>'+w+'</i>').join('');
      /* 늘 여섯 줄: 달마다 달력 높이가 달라지면 아래 것이 또 움직인다 */
      for(let k = 0; k < 42; k++){
        const key = iso(cur);
        const w = cur.getDay();
        const cls = [cur.getMonth() !== MC.m ? 'out' : '',
                     (w === 0 || w === 6 || HOL.has(key)) ? 'we' : '',
                     HOL.has(key) ? 'hol' : w === 0 ? 'sun' : w === 6 ? 'sat' : '',
                     key === STATE.today ? 'now' : '', key === MC.pick ? 'on' : '',
                     marks && marks.has(key) ? 'has' : ''].filter(Boolean).join(' ');
        h += '<span data-d="'+key+'"'+(cls ? ' class="'+cls+'"' : '')+'>'+cur.getDate()+'</span>';
        cur.setDate(cur.getDate() + 1);
      }
      el.innerHTML = h + '</div>';
    };
    el.onclick = e => {
      const nav = e.target.closest('[data-mc]');
      if(nav){
        const t = new Date(MC.y, MC.m + +nav.dataset.mc, 1);
        MC.y = t.getFullYear(); MC.m = t.getMonth();
        return draw();
      }
      const d = e.target.closest('[data-d]');
      if(!d) return;
      MC.pick = d.dataset.d;
      const dd = dObj(MC.pick);
      MC.y = dd.getFullYear(); MC.m = dd.getMonth();
      draw();
      onPick(MC.pick);
    };
    draw();
    return draw;
  }
  const calAt = s => { const d = dObj(s); return {y: d.getFullYear(), m: d.getMonth(), pick: null}; };

  /* 아래 띠: 시각 · 알림. 메모에서는 숨기지만 자리는 그대로 둔다 */
  const whenStrip = (t, lead, muted, hidden, hint) => {
    const def = STATE.settings.notify_min != null ? STATE.settings.notify_min : 30;
    const cur = lead != null ? lead : def;
    const opts = LEADS.slice();
    if(!opts.some(o => o[0] === cur)) opts.push([cur, leadLabel(cur)]);
    opts.sort((a, b) => a[0] - b[0]);
    self.lead = lead;                    /* 손대지 않으면 저장된 값(비어 있으면 "기본")을 그대로 */
    return '<div class="f-when'+(hidden ? ' off' : '')+'"><span class="step">시각 · 알림</span><div class="when-row">'+
      tfHtml('time', t)+
      '<label class="sw"><input type="checkbox" data-f="alarm"'+(muted ? '' : ' checked')+'> 알림</label>'+
      '<div data-f="leads">'+seg('lead', opts, cur, muted)+
        '<span class="lead-tail'+(muted ? ' off' : '')+'">전</span></div></div>'+
      (hint ? '<p class="when-hint">시각 칸을 누르면 하늘이 다시 펼쳐지고 고른 시각이 점선 구슬로 놓입니다.</p>' : '')+
      '</div>';
  };
  const bindWhen = () => {
    F('alarm').onchange = () => {
      const off = !F('alarm').checked;
      F('leads').firstChild.classList.toggle('off', off);
      F('leads').querySelector('.lead-tail').classList.toggle('off', off);
    };
    F('leads').onclick = e => {
      const b = e.target.closest('[data-s="lead"]');
      if(!b) return;
      self.lead = +b.dataset.v;
      F('leads').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    };
  };

  /* ---------- 할 일: 날짜는 달력으로만 ---------- */
  function renderDeadline(i){
    self.date = i.date || shift(1);          /* 기본은 다음 날 (영업일만 쓰면 다음 영업일) */
    const MC = calAt(self.date);
    MC.pick = self.date;
    box.innerHTML =
      '<div class="f-grid"><div class="f-left"><span class="step">마감 날짜</span><div data-f="mc"></div></div>'+
      '<div class="f-right"><div class="due" data-f="due"></div></div></div>'+
      whenStrip(i.time, i.notify_min, i.muted, false, box.id === 'a-body');
    let redraw;
    const drawDue = () => {
      const v = self.date, d = dObj(v);
      const days = Math.round((d - dObj(STATE.today)) / 864e5);
      const rel = days === 0 ? '오늘' : days === 1 ? '내일' : days === 2 ? '모레' : days > 0 ? days + '일 뒤' : (-days) + '일 지남';
      let h = '<b class="due-d">'+(d.getMonth()+1)+'월 '+d.getDate()+'일 '+WD[(d.getDay()+6)%7]+'요일</b>'+
              '<span class="due-r">'+rel+'</span>';
      if(bizOn() && !isBiz(v)){
        const alt = rollBiz(v, -1);
        h += '<div class="warn-line">이 날은 영업일이 아닙니다'+
             '<button type="button" data-f="fix">'+fmtDay(alt)+'로</button></div>';
      }
      /* 그날 이미 있는 일: 날짜를 고를 때 얼마나 붐비는 날인지 보인다 */
      const others = deadlines().filter(t => t.due_date === v && !t.done && t.id !== i.id)
        .sort((a, b) => (a.due_time || '99:99').localeCompare(b.due_time || '99:99'));
      h += '<span class="step">같은 날 마감 <i class="opt">'+(others.length ? others.length + '건' : '')+'</i></span>'+
        (others.length ? others.slice(0, 6).map(t => '<div class="due-o"><b>'+esc(t.title)+'</b>'+
            (t.due_time ? '<span>'+esc(t.due_time)+'</span>' : '')+'</div>').join('') + (others.length > 6 ? '<div class="due-m">외 '+(others.length - 6)+'건</div>' : '')
          : '<p class="hint">없음</p>');
      F('due').innerHTML = h;
      const fix = F('fix');
      if(fix) fix.onclick = () => {
        self.date = rollBiz(v, -1);
        Object.assign(MC, calAt(self.date), {pick: self.date});
        redraw(); drawDue();
      };
    };
    const marks = new Set(deadlines().filter(t => !t.done && t.id !== i.id).map(t => t.due_date));
    redraw = miniCal(F('mc'), MC, key => { self.date = key; drawDue(); }, marks);
    drawDue();
    bindWhen();
  }

  /* ---------- 루틴 ---------- */
  function renderRoutine(i){
    const saved = i.rule_n || null;
    const u = unitOf(saved);
    const U = {date: i.next_date || i.date || STATE.today, unit:u.unit, every:u.every,
               items:null, text: saved ? (i.rule_text || '') : '', wds:[]};
    /* 저장된 주 규칙은 여러 요일일 수 있다. 달력을 건드리기 전까지만 그대로 둔다 */
    const savedWds = saved && saved.period === 'week' && (saved.weekdays || []).length
      ? saved.weekdays.slice() : null;
    const wdOf = key => (dObj(key).getDay() + 6) % 7;      /* 규칙은 월요일이 0 */
    U.wds = savedWds || [wdOf(U.date)];
    self.R = saved;                      /* 손대기 전에는 저장된 규칙 그대로 둔다 */
    const MC = calAt(U.date);
    MC.pick = U.date;

    box.innerHTML =
      '<div class="f-grid">'+
        '<div class="f-left"><span class="step">기준 날짜</span><div data-f="mc"></div></div>'+
        '<div class="f-right"><div data-f="pick"></div></div>'+
      '</div>'+ whenStrip(i.time, i.notify_min, i.muted);

    const shift = () => (self.R && self.R.holiday_shift) || (isBiz(U.date) ? 'prev' : 'none');

    /* 고른 규칙의 날짜를 다시 물어 그 줄에 적는다 (휴일 처리를 바꿨을 때) */
    const refreshDates = () => {
      const el = box.querySelector('[data-f="dates"]') || box.querySelector('.pk-row.on span');
      if(!el || !self.R) return;
      api('/api/preview', {rule: self.R})
        .then(d => { el.textContent = d.error ? d.error : d.dates.slice(0, 3).join(' · '); })
        .catch(e => { el.textContent = e.message; });
    };

    const drawPick = () => {
      let h = line('단위', seg('unit', UNITS, U.unit));
      if(EVERY[U.unit]) h += line('간격', seg('every', everyOpts(U.unit, U.every), U.every));
      if(U.unit === 'week'){
        h += line('요일', '<div class="wd">'+WD.map((w, x) =>
          '<span data-w="'+x+'"'+(U.wds.includes(x) ? ' class="on"' : '')+'>'+w+'</span>').join('')+'</div>');
        h += '<p class="dates"><b data-f="rule-t">'+esc(self.R ? describeWeek() : '')+'</b>'+
             '<span data-f="dates">—</span></p>';
      }else{
        h += line('규칙 제안', '<div class="pk-list" data-f="rows"></div>');
      }
      /* 매일 도는 일은 걸릴 날이 없다. 영업일로 세는 규칙도 마찬가지 */
      if(U.unit !== 'day' && !countsBizDays(self.R))
        h += '<div class="quiet">주말 · 공휴일에 걸리면 '+sel('shift', SHIFTS, shift())+'</div>';
      F('pick').innerHTML = h;
      /* 매일 하는 일에는 기준 날짜가 뜻이 없다 - 달력을 쉬게 둔다 */
      box.querySelector('.f-left').classList.toggle('idle', U.unit === 'day');
      if(U.unit === 'week') weekRule(false);
      else drawRows();
    };

    /* 주: 요일은 여럿일 수 있어 화면에서 바로 만든다 (제안은 한 줄뿐이라 줄 필요가 없다) */
    function describeWeek(){
      const head = U.every === 2 ? '격주' : '매주';
      return U.wds.length ? head+' '+U.wds.slice().sort((a,b)=>a-b).map(x => WD[x]).join('·')+'요일' : '요일을 고르세요';
    }
    function weekRule(reset){
      if(!U.wds.length){ self.R = null; }
      else self.R = {period:'week', weekdays:U.wds.slice().sort((a,b)=>a-b), interval:U.every,
                     anchor:U.date, holiday_shift: reset ? (U.wds.every(x => x < 5) ? 'prev' : 'none') : shift()};
      const t = box.querySelector('[data-f="rule-t"]');
      if(t) t.textContent = describeWeek();
      const d = box.querySelector('[data-f="dates"]');
      if(d) d.textContent = U.wds.length ? '' : '';
      if(self.R) refreshDates();
      else if(d) d.textContent = '요일을 하나 이상 고르세요';
    }

    const drawRows = () => {
      const el = F('rows');
      if(!el) return;
      if(!U.items){ el.innerHTML = '<p class="hint">찾는 중…</p>'; return; }
      const list = U.items.slice();
      /* 저장된 규칙이 제안에 없으면(예전 분기 규칙 등) 맨 위에 그대로 남긴다 */
      if(U.text && !list.some(it => it.text === U.text))
        list.unshift({text:U.text, dates:[], keep:true});
      el.innerHTML = list.map((it, k) => '<button type="button" class="pk-row'+(it.text === U.text ? ' on' : '')+
        '" data-k="'+k+'"><b>'+esc(it.text)+'</b>'+
        (U.unit === 'day' ? '' : '<span>'+esc((it.dates || []).join(' · '))+'</span>')+'</button>').join('');
      el.onclick = e => {
        const b = e.target.closest('[data-k]');
        if(!b) return;
        const it = list[+b.dataset.k];
        if(it.keep) return;              /* 예전 규칙 줄: 그대로 두는 것이 선택이다 */
        self.R = Object.assign({}, it.rule, {holiday_shift: it.rule.holiday_shift});
        U.text = it.text;
        drawPick();
      };
    };

    /* 단위 · 간격 · 날짜가 바뀔 때마다 그 조합에 맞는 규칙들을 엔진에 묻는다 */
    let seq = 0;
    const load = () => {
      if(U.unit === 'week'){ weekRule(true); return; }
      U.items = null;
      drawRows();
      const my = ++seq;
      api('/api/suggest?date='+U.date+'&unit='+U.unit+'&every='+U.every)
        .then(r => {
          if(my !== seq) return;
          U.items = r.items || [];
          /* 고른 것이 없거나 새 조합이면 가장 흔한 것을 미리 골라 둔다 */
          const hit = U.items.find(it => it.text === U.text);
          if(!hit && U.items.length && !(U.text && self.R && sameKind(self.R))){
            U.text = U.items[0].text;
            self.R = U.items[0].rule;
          }else if(hit) self.R = hit.rule;
          drawPick();
        })
        .catch(err => { if(my === seq && F('rows')) F('rows').innerHTML = '<p class="hint">'+esc(err.message)+'</p>'; });
    };
    /* 저장된 규칙이 지금 단위와 같은 갈래인가 (고치기로 열었을 때 함부로 바꾸지 않으려고) */
    const sameKind = r => {
      const k = unitOf(r);
      return k.unit === U.unit && k.every === U.every;
    };

    miniCal(F('mc'), MC, key => {
      U.date = key;
      U.moved = true;
      U.wds = [wdOf(key)];            /* 요일 칩은 늘 고른 날짜를 따라간다 */
      U.text = '';
      load();
    });

    F('pick').onclick = e => {
      const b = e.target.closest('[data-s]');
      if(b){
        const k = b.dataset.s, v = b.dataset.v;
        if(k === 'unit'){
          /* 달력에서 목요일을 짚고 단위를 "주" 로 바꾸면 목요일이 켜져 있어야 한다 */
          if(v === 'week' && U.unit !== 'week') U.wds = (!U.moved && savedWds) || [wdOf(U.date)];
          U.unit = v; U.every = 1; U.text = '';
        }
        else if(k === 'every'){ U.every = +v; U.text = ''; }
        drawPick();
        load();
        return;
      }
      const w = e.target.closest('[data-w]');
      if(w){
        const x = +w.dataset.w;
        U.wds = U.wds.includes(x) ? U.wds.filter(y => y !== x) : U.wds.concat(x);
        drawPick();
      }
    };
    F('pick').onchange = e => {
      if(e.target.dataset.f !== 'shift' || !self.R) return;
      self.R = Object.assign({}, self.R, {holiday_shift: e.target.value});
      refreshDates();
    };

    drawPick();
    load();
    bindWhen();
  }

  /* ---------- 메모: 뼈대는 같고 속만 비운다 ---------- */
  function renderFloating(){
    box.innerHTML =
      '<div class="f-grid memo"><p class="hint">마감도 시각도 없습니다 — '+
      '홈 오른쪽 아래 ‘메모’ 에 놓입니다.</p></div>'+
      whenStrip('', null, false, true);
  }

  /* 규칙에 빠진 것이 있으면 그 문장, 없으면 '' */
  self.problem = function(){
    if(self.kind !== 'routine') return '';
    if(!self.R) return '규칙을 하나 고르세요';
    return '';
  };

  self.render = function(kind, i){
    self.kind = kind;
    self.R = null;
    box.dataset.kind = kind;
    const win = box.closest('.modal');
    if(win) win.dataset.kind = kind;
    i = i || {};
    if(kind === 'floating') renderFloating();
    else if(kind === 'deadline') renderDeadline(i);
    else renderRoutine(i);
  };

  self.read = function(){
    const p = {kind:self.kind};
    if(self.kind === 'floating')
      return Object.assign(p, {due_date:null, due_time:'', rule:null, notify_min:null, muted:false});
    p.due_time = parseTime(F('time').value) || '';
    p.notify_min = self.lead;
    p.muted = !F('alarm').checked;
    if(self.kind === 'deadline'){ p.due_date = self.date || STATE.today; p.rule = null; }
    else { p.rule = self.R; p.due_date = null; }
    return p;
  };

  self.valid = function(){
    if(self.kind !== 'floating' && parseTime(F('time').value) === null){
      say('시각을 알아볼 수 없습니다 (예: 930 · 21 · 930p)');
      F('time').focus();
      return false;
    }
    const bad = self.kind === 'routine' ? self.problem() : '';
    if(bad){ say(bad); return false; }
    return true;
  };
  return self;
}

/* ══════════ 새 항목 ══════════ */
/* 부르는 이름은 어디서나 셋: 할 일 · 루틴 · 메모 */
const KIND_NAME = {deadline:'할 일', routine:'루틴', floating:'메모'};
const addForm = Form($('#a-body'));
let addKind = 'deadline';
function setAddKind(kind, seed){
  addKind = kind;
  $$('#add-tabs button').forEach(x => x.classList.toggle('on', x.dataset.k === kind));
  $('#a-head').textContent = '새 ' + KIND_NAME[kind];
  addForm.render(kind, seed || {});
}
$('#add-tabs').onclick = e => {
  const b = e.target.closest('button'); if(!b) return;
  setAddKind(b.dataset.k, {});
};
function openAdd(kind, seed){
  $('#a-title').value = ''; $('#a-note').value = '';
  setAddKind(kind || 'deadline', seed);
  openM('#m-add');
  setTimeout(() => $('#a-title').focus(), 90);
}
$('#btn-add').onclick = () => openAdd('deadline', {});
/* 빈 상태 안내의 버튼. 목록은 그릴 때마다 새로 만들어지므로 칸에 위임해 둔다. */
$('#today').addEventListener('click', e => {
  const b = e.target.closest && e.target.closest('[data-new]');
  if(b) openAdd(b.dataset.new, {});
});
$('#a-save').onclick = () => {
  const title = $('#a-title').value.trim();
  if(!title){ say('이름을 입력하세요'); return $('#a-title').focus(); }
  if(!addForm.valid()) return;
  change('/api/task', Object.assign({title, note:$('#a-note').value.trim()}, addForm.read()))
    .then(() => { closeM('#m-add'); say('추가됨 · '+title); });
};

/* ══════════ 수정 ══════════ */
const editForm = Form($('#e-body'));
let EDIT = null;
function openEdit(i){
  EDIT = i;
  $('#e-title').value = i.title;
  $('#e-note').value = i.note || '';
  editForm.render(i.kind, i);
  $('#e-skip').hidden = i.kind !== 'routine' || !(i.date || i.next_date);
  $('#e-later').hidden = i.kind !== 'deadline' || !i.date || !!i.done;
  if(!$('#e-later').hidden) $('#e-later').textContent = i.date > STATE.today ? '하루 뒤로' : '내일로';
  $('#m-edit').querySelector('h3').innerHTML = esc(KIND_NAME[i.kind] || '항목') + ' 고치기';
  openM('#m-edit');
}
$('#e-save').onclick = () => {
  const title = $('#e-title').value.trim();
  if(!title){ say('이름을 입력하세요'); return $('#e-title').focus(); }
  if(!editForm.valid()) return;
  change('/api/task/'+encodeURIComponent(EDIT.id), Object.assign({title, note:$('#e-note').value.trim()}, editForm.read()))
    .then(() => { closeM('#m-edit'); say('저장됨'); });
};
/* 건너뛰기 · 내일로 · 삭제는 묻지 않는다. 창을 닫고 5초 동안 되돌릴 수 있다 */
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
function calRoom(weeks){
  const g = $('#cal-grid'), h = g ? g.clientHeight : 0;
  if(!h || !weeks) return 4;
  const cell = (h - (weeks-1) - 2) / weeks;     /* 1px 실선 · 위아래 테두리 */
  return Math.max(1, Math.min(5, Math.floor((cell - 26) / 16)));   /* 날짜 줄 · 여백 26 · 한 줄 16 */
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
  const out = deadlines().filter(t => cellDate(t.due_date) === key);
  if(routinesOn())
    routineItems().forEach(i => { if(cellDate(i.date) === key) out.push(asRoutine(i)); });
  return out.sort(byWhen);
}

function ensureRoutines(y, m){
  if(!routinesOn()) return;
  const key = y + '-' + m + '@' + STATE.rev;
  if(RT.key === key || RT.busy === key) return;
  /* 주말 마감을 옆 달 칸으로 옮기는 경우까지 덮게 앞뒤로 한 주씩 더 */
  const from = iso(new Date(y, m, 1 - 7)), to = iso(new Date(y, m + 1, 7));
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

/* 달력의 항목을 수정 창에 넘길 형태로 맞춘다 (STATE.tasks 는 저장 형식) */
function asItem(t){
  return {id:t.id, title:t.title, note:t.note || '', kind:'deadline', rule:null,
          date:t.due_date || null, time:t.due_time || '',
          notify_min:t.notify_min != null ? t.notify_min : null,
          muted:!!t.muted, rule_text:'', done:!!t.done};
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
  el.className = 'chip ' + cls + (wk ? ' wk' : '');
  el.innerHTML = '<span class="n2">' + esc(t.title) + '</span>';
  el.title = '';
  el._hov = {
    title: t.title,
    when: fmtDay(t.due_date) + (t.due_time ? ' ' + t.due_time : ' 시각 없음') +
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
                    '<div' + (r.done ? ' class="dn"' : '') + '><span class="hr-t">' + esc(r.t || '종일') + '</span>' +
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
  const el = e.target.closest ? e.target.closest('.chip, .rtline') : null;
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
  if(!list.length){
    box.innerHTML = '<div class="empty">이 날짜에 마감이 없습니다</div>';
  }
  list.forEach(t => {
    const el = document.createElement('div');
    el.className = 'mg-row day-row' + (t.done ? ' off' : '');
    const d = dObj(t.due_date);
    const when = (isWeekend(t.due_date)
        ? d.getDate() + '일(' + WD[(d.getDay() + 6) % 7] + ') ' : '') +
      (t.due_time || (isWeekend(t.due_date) ? '' : '시각 없음'));
    el.innerHTML = '<span class="dot" role="checkbox" aria-checked="' + (t.done ? 'true' : 'false') + '" title="' + (t.done ? '완료 취소' : '완료') + '"></span>' +
                   '<span class="n">' + esc(t.title) + '</span>' +
                   (t.note ? '<span class="note">' + esc(t.note) + '</span>' : '') +
                   '<span class="w">' + esc(when.trim()) + '</span>';
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
  if(!calCur){ const d = dObj(STATE.today); calCur = {y:d.getFullYear(), m:d.getMonth()}; }
  const y = calCur.y, m = calCur.m;
  $('#cal-ym').textContent = y + '년 ' + (m + 1) + '월';

  ensureRoutines(y, m);

  const byDate = {};
  deadlines().forEach(t => {
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

  for(let wk = 0; wk < weeks; wk++){
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

      if(!out){
        const list = byDate[key] || [];
        const dls = list.filter(t => !t._rt);
        const rts = list.filter(t => t._rt);
        /* 루틴 줄과 '+N건 더' 가 쓸 자리를 먼저 떼어 둔다 */
        const budget = Math.max(1, room - (rts.length ? 1 : 0));
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
          rl.className = 'rtline';
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
        cell.onclick = () => list.length ? dayModal(key, list)
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
  if(v === 'cal') drawCal();
  if(was !== v) replay(v === 'cal' ? $('#v-cal') : $('#v-home'), 'view-in');
}
$('#btn-view').onclick = () => setView(view === 'cal' ? 'home' : 'cal');
$('#cal-prev').onclick = () => shiftMonth(-1);
$('#cal-next').onclick = () => shiftMonth(1);
$('#cal-now').onclick = () => {
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
               : (t.due_date ? fmtDay(t.due_date) : '날짜 없음') + (t.due_time ? ' ' + t.due_time : '');
    const el = document.createElement('div');
    /* 지난 것은 시각이 벽돌빛이다 - 홈 · 달력과 같은 말 */
    const late = kind === 'deadline' && !t.done && t.due_date && t.due_date < STATE.today;
    el.className = 'mg-row' + (t.done ? ' off' : '') + (late ? ' late' : '');
    el.innerHTML = '<span class="k">'+KN[kind]+'</span><span class="n">'+esc(t.title)+
                   '</span><span class="w">'+esc(when)+'</span>';
    el.onclick = () => openEdit(rt || {
      id:t.id, title:t.title, note:t.note||'', kind:kind, rule:t.rule||null,
      date:t.due_date||null, time:t.due_time||'',
      notify_min:t.notify_min!=null?t.notify_min:null, muted:!!t.muted, rule_text:'', done:!!t.done
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
function fillSettings(){
  const st = STATE.settings;
  $('#s-lead').value = st.notify_min != null ? st.notify_min : 30;
  $('#s-brief').value = st.brief_time || '08:30';
  $('#s-brief').dataset.last = $('#s-brief').value;
  $('#s-biz').checked = bizOn();
  $('#s-auto').checked = !!st.autostart;
  $('#s-hold').checked = st.hold_when_busy !== false;
  $('#s-walk').checked = st.guy_walk !== false;
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
 ['#s-upd', 'auto_update']]
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
  if(STATE && e.target.value !== STATE.settings.brief_time) saveSetting({brief_time: e.target.value});
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
  $('#clock').textContent = $('#clock-m').textContent = HHMM;
  repaint();
  const first = () => (STATE.todays || [])[0] || (STATE.overdue || [])[0];
  const go = {
    home:       () => {},
    night:      () => {},                  /* 같은 홈, 빛만 한밤 */
    cal:        () => setView('cal'),
    add:        () => openAdd('deadline', {}),
    'add-rt':   () => openAdd('routine', {}),
    'add-memo': () => openAdd('floating', {}),
    edit:       () => { const i = first(); if(i) openEdit(i); },
    manage:     () => { openM('#m-manage'); drawManage(); },
    settings:   () => $('#btn-settings').onclick(),
    day:        () => dayModal(STATE.today, dayItems(STATE.today)),
    time:       () => { openAdd('deadline', {});
                        setTimeout(() => { const f = $('#m-add [data-tf]'); if(f) tpOpen(f); }, 150); },
    ctx:        () => {
      const i = first(), el = $('#today .item');
      if(!i || !el) return;
      OFFLINE = false;                       /* 연결이 끊긴 채로는 열리지 않는다 */
      const r = el.getBoundingClientRect();
      ctxOpen(r.left + 300, r.bottom + 2, i, 'today');
    },
    undo:       () => { undoToast('완료', (first() || {title:'국내 일임 매매'}).title, () => {});
                        clearTimeout(undoToast._t); },   /* 가상 시간이 5초를 지나쳐 버린다 */
  };
  const f = go[m[1]];
  if(f) setTimeout(f, 80);
}
