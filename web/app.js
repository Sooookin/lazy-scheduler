const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
/* 서비스는 비밀값이 없는 요청을 거절한다 (다른 웹 페이지가 일정을 건드리지 못하게).
   값은 서비스가 index.html 을 내줄 때 meta 태그에 심어 준다. */
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
  repeat: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 2l4 4-4 4"/><path d="M3 11V9a3 3 0 013-3h15"/><path d="M7 22l-4-4 4-4"/><path d="M21 13v2a3 3 0 01-3 3H3"/></svg>',
  max: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1.5" y="1.5" width="7" height="7" rx="1"/></svg>',
  restore: '<svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.1"><rect x="1.5" y="3" width="5.5" height="5.5" rx="1"/><path d="M3.5 3v-.5a1 1 0 011-1h3a1 1 0 011 1v3a1 1 0 01-1 1H7"/></svg>',
  check: '<svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path pathLength="1" d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  plusBig: '<svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path pathLength="1" d="M12 5v14"/><path pathLength="1" d="M5 12h14"/></svg>',
  plus: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
};

/* ══════════ 시각 칸 ══════════
   시각은 모두 5분 단위. 미리 정한 시각(09:00 · 12:00 …)은 두지 않는다 -
   칸을 누르면 시 격자가 뜨고, 시를 누르면 분 격자, 분을 누르면 닫힌다.
   어떤 시각이든 정확히 두 번이다. 키보드가 빠르면 칸에 그냥 쳐도 된다:
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
const TP = {input:null, stage:'h', hour:null};
const tpShown = () => $('#tp').classList.contains('on');
const HOUR_ROWS = [['새벽', 0], ['오전', 6], ['오후', 12], ['저녁', 18]];
const h12 = h => h % 12 === 0 ? 12 : h % 12;
const ampm = h => (h < 12 ? '오전 ' : '오후 ') + h12(h) + '시';

function tpDraw(){
  const box = $('#tp'), el = TP.input;
  if(!el) return;
  const cur = el.value && /^\d\d:\d\d$/.test(el.value) ? el.value : '';
  const curH = cur ? +cur.slice(0, 2) : null, curM = cur ? +cur.slice(3) : null;
  const nowH = new Date().getHours();
  const none = el.hasAttribute('data-req') ? '' : '<button type="button" data-tp="none">시각 없음</button>';
  if(TP.stage === 'h'){
    box.innerHTML = '<div class="tp-h"><b>시</b><span>› 분</span><span class="sp"></span>' + none + '</div>' +
      '<div class="tp-g">' + HOUR_ROWS.map(([lb, from]) => '<i>' + lb + '</i>' +
        [0,1,2,3,4,5].map(k => {
          const h = from + k;
          const cls = [h === curH ? 'on' : '', h === nowH ? 'now' : '', from === 0 ? 'dim' : ''].join(' ').trim();
          return '<button type="button" data-h="' + h + '"' + (cls ? ' class="' + cls + '"' : '') + '>' + h12(h) + '</button>';
        }).join('')).join('') + '</div>' +
      '<div class="tp-f">예: 930 · 21 · 930p</div>';
  }else{
    const h = TP.hour;
    box.innerHTML = '<div class="tp-h"><b>' + ampm(h) + '</b><span>› 분</span><span class="sp"></span>' +
      '<button type="button" data-tp="back">‹ 시 다시</button></div>' +
      '<div class="tp-g m">' + [...Array(12)].map((_, k) => {
        const m = k * 5;
        return '<button type="button" data-m="' + m + '"' + (h === curH && m === curM ? ' class="on"' : '') + '>' + pad2(m) + '</button>';
      }).join('') + '</div>' +
      '<div class="tp-f">5분 단위 · 딱 맞는 분은 칸에 숫자로</div>';
  }
}
function tpPlace(){
  const box = $('#tp'), r = TP.input.getBoundingClientRect();
  const w = box.offsetWidth || 300, h = box.offsetHeight || 220;
  let x = Math.min(Math.max(8, r.left), innerWidth - w - 8);
  let y = r.bottom + 6;
  if(y + h > innerHeight - 8) y = Math.max(8, r.top - h - 6);
  box.style.left = x + 'px';
  box.style.top = y + 'px';
}
function tpOpen(el){
  if(TP.input === el && tpShown()) return;
  TP.input = el;
  TP.stage = 'h';
  el.dataset.last = el.value;
  tpDraw();
  $('#tp').classList.add('on');
  tpPlace();
}
function tpClose(){
  $('#tp').classList.remove('on');
  TP.input = null;
}
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
$('#tp').addEventListener('click', e => {
  const b = e.target.closest('button');
  if(!b) return;
  if(b.dataset.tp === 'none') return tfSet('');
  if(b.dataset.tp === 'back'){ TP.stage = 'h'; tpDraw(); return; }
  if(b.dataset.h != null){ TP.hour = +b.dataset.h; TP.stage = 'm'; tpDraw(); return; }
  if(b.dataset.m != null) tfSet(hhmm(TP.hour * 60 + +b.dataset.m));
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
    HIDDEN = true;                      /* 숨어 있는 동안 새로 읽기를 멈춘다 (아래 "새로 읽기") */
    flushGone();                        /* 되돌리기를 기다리던 삭제는 지금 보낸다 */
    has() ? window.pywebview.api.close() : window.close();
  };
  syncMax();
}
wireWindow();
window.addEventListener('pywebviewready', wireWindow);
window.addEventListener('resize', syncMax);

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
function wireRow(el, i){
  el.tabIndex = 0;
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

function itemEl(i, opt){
  opt = opt || {};
  const el = document.createElement('div');
  el.className = 'item k-' + (i.kind || 'deadline') + (i.done ? ' done' : '');
  const bits = [];
  if(i.muted) bits.push('<span class="tag">알림 끔</span>');
  /* 상태는 알약 하나로: 지난 날짜 · 지난 시각은 짙게, 90분 안이면 민트 */
  const overdue = opt.showOverdue && i.date && i.date < STATE.today && !i.done;
  if(overdue) bits.push('<span class="st late">'+esc(fmtDay(i.date))+'</span>');
  else if(i.date === STATE.today && i.time && !i.done){
    if(i.time < STATE.now) bits.push('<span class="st late">지남</span>');
    else if(mins(i.time) - mins(STATE.now) <= 90) bits.push('<span class="st soon">임박</span>');
  }
  const when = opt.showDate && i.date ? fmtDay(i.date) + (i.time ? ' ' + i.time : '') : (i.time || '');
  if(when) bits.push('<span class="tm">'+esc(when)+'</span>');
  const sub = i.kind === 'routine' && i.rule_text ? '<small>루틴 · ' + esc(i.rule_text) + '</small>' : '';
  el.innerHTML = '<div class="dot" role="checkbox" tabindex="0" aria-checked="'+(i.done ? 'true' : 'false')+'" title="'+
      (i.done ? '완료 취소' : '완료') + '"></div>'+
    '<div class="t">'+esc(i.title)+sub+'</div>'+
    (bits.length ? '<div class="meta">'+bits.join('')+'</div>' : '')+
    rowActs(i, opt.where);
  el.title = i.title + (i.note ? String.fromCharCode(10) + i.note : '') +
             String.fromCharCode(10) + '눌러서 열기 · 동그라미는 완료';
  return wireRow(el, i);
}

/* 루틴 줄: 완료 체크 없이 "다음 실행일" 만. 규칙은 제목 아래 작은 글씨로 */
function routineEl(i){
  const el = document.createElement('div');
  const isToday = i.next_date === STATE.today;
  el.className = 'item rt k-routine';
  let when;
  if(!i.next_date) when = '<span class="tm">예정 없음</span>';
  else if(isToday) when = i.done ? '<span class="st ok">완료</span>' : '<span class="st late">오늘</span>';
  else when = '<span class="tm">'+esc(fmtDay(i.next_date))+'</span>';
  el.innerHTML = '<div class="t">'+esc(i.title)+
      '<small>'+esc(i.rule_text)+(i.time ? ' · '+esc(i.time) : '')+'</small></div>'+
    '<div class="meta">'+(i.muted ? '<span class="tag">알림 끔</span>' : '')+when+'</div>'+
    rowActs(Object.assign({}, i, {done: isToday && i.done}), 'routines');
  el.title = i.title + ' · ' + i.rule_text + (isToday && i.done ? ' (오늘 완료)' : '') +
             String.fromCharCode(10) + '눌러서 열기';
  return wireRow(el, i);
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

/* 오늘 목록: 지난 일이 있으면 "지난 일 · 오늘" 두 묶음으로 나눠 이름을 단다 */
function fillToday(node, all, empty){
  const late = all.filter(i => i.date && i.date < STATE.today && !i.done);
  if(!late.length) return fill(node, all, empty, {showOverdue:true, where:'today'});
  node.innerHTML = '';
  const grp = t => { const g = document.createElement('div'); g.className = 'grp'; g.textContent = t; node.appendChild(g); };
  grp('지난 일');
  late.forEach(i => node.appendChild(itemEl(i, {showOverdue:true, where:'today'})));
  const rest = all.filter(i => late.indexOf(i) < 0);
  if(rest.length){
    grp('오늘');
    rest.forEach(i => node.appendChild(itemEl(i, {showOverdue:true, where:'today'})));
  }
}

function render(o){
  RAW = o;
  o = hideGone(o);
  STATE = o;
  HOL = new Set(o.holidays || []);
  /* 일정 파일이 손상돼 백업에서 되살렸다면, 조용히 넘어가지 않고 한 번 알린다 */
  /* alert 는 창을 막고 알림 처리까지 멈춰 세운다. 띠로 남겨 두고 직접 닫게 한다. */
  if(o.notice && o.notice !== render._notice){
    render._notice = o.notice;
    strip(o.notice, { action: '확인', onClick: () => strip('') });
  }
  const d = dObj(o.today);
  $('#dow').textContent = (d.getMonth()+1)+'월 '+d.getDate()+'일 '+WD[(d.getDay()+6)%7]+'요일';
  $('#tb-sub').textContent = o.stats.left ? o.stats.left+'건 남음' : '';
  $('#left').textContent = o.stats.left;
  const pct = o.stats.total ? o.stats.done / o.stats.total : (o.stats.left ? 0 : 1);
  $('#ringfg').style.strokeDashoffset = 188.5 * (1 - pct);
  $('#ringfg').style.stroke = o.stats.left ? 'var(--mid)' : 'var(--mint)';
  if($('#pop-left').classList.contains('on')) drawPop();

  /* 지금 + 오늘 통합: 시간순, 완료는 아래로 */
  const rank = i => (i.done ? 1 : 0);
  const all = o.overdue.concat(o.todays).sort((a,b) =>
    rank(a)-rank(b) || (a.date||'').localeCompare(b.date||'') ||
    (a.time||'99:99').localeCompare(b.time||'99:99'));
  fillToday($('#today'), all, emptyToday(o));
  const undone = all.filter(i => !i.done).length;
  const doneN = all.length - undone;
  $('#c-today').textContent = all.length;
  $('#c-today').classList.toggle('hot', undone > 0);
  $('#today-note').textContent = all.length ? (undone ? (doneN ? '완료 ' + doneN : '') : '전부 완료') : '';

  fill($('#upcoming'), o.upcoming, '앞으로 7일, 마감 없음', {showDate:true, where:'upcoming'});
  fill($('#floating'), o.floating, '＋ 새 항목 → 메모', {where:'floating'});
  fill($('#routines'), o.routines, '＋ 새 항목 → 루틴', null, routineEl);
  $('#c-up').textContent = o.upcoming.length;
  $('#c-up').classList.toggle('hot', o.upcoming.length > 0);
  $('#c-rt').textContent = o.routines.length;
  $('#c-float').textContent = o.floating.length;
  if($('#m-manage').classList.contains('on')) drawManage();
  if(view === 'cal') drawCal();
  /* 하루 목록이 열려 있으면 방금 바뀐 것(완료 · 삭제 · 되돌리기)을 거기에도 */
  if(DAY_KEY && $('#m-day').classList.contains('on')) dayModal(DAY_KEY, dayItems(DAY_KEY));
}

/* ══════════ 배치 ══════════
   기본(900–1500px)은 두 칼럼: 오늘 | 다가오는 마감 · 메모 · 루틴.
   넓은 화면은 루틴이 셋째 칼럼으로 옮겨 간다. 칼럼은 저마다 스크롤한다 -
   예전처럼 칸 높이를 한 줄 단위로 재서 나누지 않는다. */
const WIDE = matchMedia('(min-width:1500px)');
function placeRoutines(){
  const sec = $('#sec-rt');
  const to = WIDE.matches ? $('#col-rt') : $('#col-right');
  if(sec.parentNode !== to) to.appendChild(sec);
}
placeRoutines();
WIDE.addEventListener('change', placeRoutines);

/* 시계 */
function tickClock(){
  const n = new Date();
  $('#clock').textContent = String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
}
tickClock();
setInterval(tickClock, 10000);

let lastLoad = 0;                   /* 마지막으로 새로 읽은 때 (ms) */
const load = () => api('/api/overview').then(o => {
  lastLoad = Date.now();
  render(o);
  if(!load._first){                 /* 주소에 #cal 이 있으면 달력으로 시작 */
    load._first = true;
    if(location.hash === '#cal') setView('cal');
  }
});

/* ══════════ 남은 일 미리보기 ══════════ */
/* 고리는 "5" 라고만 한다. 그 다섯이 무엇인지 보려면 아래 목록을 훑어야 했고,
   달력을 보고 있으면 그마저 없다. 눌러서 바로 펼친다.
   모달이 아니라 붙는 종이인 이유: 확인하고 곧장 하던 일로 돌아가는 동작이라
   화면을 가리고 닫는 절차를 거치게 할 일이 아니다. */
const POP_MAX = 6;                    /* 그 아래는 "외 N건" 으로 접는다 */

function drawPop(){
  const el = $('#pop-left'), o = STATE;
  if(!o) return;
  const left = (o.overdue || []).concat(o.todays || []).filter(i => !i.done)
    .sort((a, b) => (a.date || '').localeCompare(b.date || '') ||
                    (a.time || '99:99').localeCompare(b.time || '99:99'));
  const late = left.filter(i => i.date && i.date < o.today).length;

  if(!left.length){
    el.innerHTML = '<div class="pop-h"><b>다 끝났습니다</b></div>' +
      '<div class="pop-none">오늘 남은 일이 없습니다.</div>';
    return;
  }
  const rows = left.slice(0, POP_MAX).map(i => {
    const over = i.date && i.date < o.today;
    const when = over ? fmtDay(i.date) : (i.time || '');
    return '<div class="pop-r k-' + (i.kind || 'deadline') + (over ? ' late' : '') + '">' +
      '<i></i><div class="n" title="' + esc(i.title) + '">' + esc(i.title) + '</div>' +
      (when ? '<div class="w">' + esc(when) + '</div>' : '') + '</div>';
  }).join('');
  const more = left.length - POP_MAX;
  el.innerHTML =
    '<div class="pop-h"><b>' + left.length + '건 남음</b>' +
    (late ? '<span>지난 것 ' + late + '건</span>' : '') + '</div>' +
    rows +
    '<div class="pop-f">' +
    (more > 0 ? '외 ' + more + '건 · ' : '') +
    '완료 ' + o.stats.done + ' · 전체 ' + o.stats.total + '</div>';
}

function popOpen(on){
  const el = $('#pop-left'), btn = $('#ring-btn');
  if(on) drawPop();
  el.classList.toggle('on', on);
  btn.setAttribute('aria-expanded', on ? 'true' : 'false');
}
const popShown = () => $('#pop-left').classList.contains('on');

$('#ring-btn').onclick = e => { e.stopPropagation(); popOpen(!popShown()); };
/* 바깥을 누르면 닫는다. 미리보기 안을 누른 것은 빼고 (제목이 길면 끌어 읽는다) */
document.addEventListener('mousedown', e => {
  if(popShown() && !e.target.closest('#pop-left, #ring-btn')) popOpen(false);
});

/* ══════════ 되돌리기 ══════════
   완료 · 건너뛰기 · 내일로 · 삭제는 묻지 않고 곧바로 한다. 아래 가운데에 5초 동안
   "되돌리기" 가 뜬다. 확인 창으로 한 번 더 묻는 것보다 빠르고, 잘못 눌렀을 때도
   손해가 없다. 삭제만은 실제로 지우는 것을 5초 미룬다 (되돌리면 아무 일도 없었던 것). */
const UNDO_MS = 5000;
function undoToast(msg, undo){
  const el = $('#undo');
  const hide = () => { el.classList.remove('on'); clearTimeout(undoToast._t); };
  $('#undo-msg').textContent = msg;
  $('#undo-btn').onclick = () => { hide(); undo(); };
  clearTimeout(undoToast._t);
  el.classList.add('on');
  undoToast._t = setTimeout(hide, UNDO_MS);
}
/* 마우스를 올려 두면 사라지지 않는다 (읽는 중에 없어지지 않게) */
$('#undo').addEventListener('mouseenter', () => clearTimeout(undoToast._t));
$('#undo').addEventListener('mouseleave', () => {
  undoToast._t = setTimeout(() => $('#undo').classList.remove('on'), 2000);
});

const taskUrl = i => '/api/task/' + encodeURIComponent(i.id);
const quote = i => '「' + i.title + '」';

/* 완료 / 완료 취소. 뒤집기가 아니라 "누른 사람이 본 상태의 반대" 를 보낸다 - 알림 카드에서
   이미 완료했는데 화면이 늦게 갱신됐어도 결과가 누른 사람의 뜻대로 나온다. */
function setDone(i, done, after){
  return api(taskUrl(i) + '/done', {date: i.date, done: done}).then(() => {
    if(after) after();
    load();
    if(done) undoToast(quote(i) + ' 완료', () =>
      api(taskUrl(i) + '/done', {date: i.date, done: false}).then(() => { if(after) after(); load(); }));
  });
}

/* 루틴의 그 회차만 건너뛴다 */
function skipOnce(i){
  const day = i.date || i.next_date || STATE.today;
  return api(taskUrl(i) + '/skip', {date: day}).then(() => {
    load();
    undoToast(fmtDay(day) + ' ' + quote(i) + ' 건너뜀', () =>
      api(taskUrl(i) + '/unskip', {date: day}).then(load));
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
  return api(taskUrl(i), {due_date: to}).then(() => {
    load();
    undoToast(quote(i) + ' → ' + fmtDay(to), () => api(taskUrl(i), {due_date: from}).then(load));
  });
}

/* 삭제: 화면에서는 곧바로 빼고, 서버에는 5초 뒤에 보낸다 */
const GONE = new Map();               /* id → {t: 타이머} */
function sendDelete(id){
  return api('/api/task/' + encodeURIComponent(id) + '/delete', {});
}
function removeSoon(i){
  if(GONE.has(i.id)) return;
  const go = () => {
    GONE.delete(i.id);
    sendDelete(i.id).catch(e => say(e.message)).then(load);
  };
  GONE.set(i.id, {t: setTimeout(go, UNDO_MS)});
  repaint();
  undoToast(quote(i) + ' 삭제', () => {
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
}

/* ══════════ 모달 ══════════ */
function openM(id){ popOpen(false); $('#veil').classList.add('on'); $(id).classList.add('on'); }
function closeM(id){ $(id).classList.remove('on'); if(!$$('.modal.on').length) $('#veil').classList.remove('on'); }
function closeAll(){ $('#veil').classList.remove('on'); $$('.modal').forEach(m => m.classList.remove('on')); }
$('#veil').onclick = closeAll;
$$('[data-close]').forEach(b => b.onclick = e => closeM('#'+e.target.closest('.modal').id));
document.onkeydown = e => {
  if(e.key === 'Escape'){
    if(tpShown()){ tpClose(); return; }
    if(popShown()){ popOpen(false); $('#ring-btn').focus(); return; }
    closeAll();
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
     ② 단위와 간격                 일 · 주 · 월 · 년, 그리고 몇 단위마다 (격주 · 분기 · 반기)
     ③ 그 날을 어떻게 읽을지        말일 · 마지막 영업일 · 마지막 수요일 · 말일 3일 전 …

   ③ 은 엔진(recur.suggest)이 만든다. 화면에 뜨는 것은 모두 "고른 그 날에 도는" 규칙이라,
   무엇을 골라도 그 날이 빠지지 않는다. basis · N번째 같은 말은 화면에 나오지 않는다.

   간격이 "실행하는 달" 까지 정한다: 9월을 짚고 3달마다면 3·6·9·12월, 10월이면 1·4·7·10월.
   그래서 "분기 말 / 분기 초" 를 따로 고를 일이 없다.

   저장 형식(period · basis · n · k · months · holiday_shift)은 그대로다. */
const UNITS = [['day','일'], ['week','주'], ['month','월'], ['year','년']];
const EVERY = {
  week:  [[1,'매주'], [2,'격주']],
  month: [[1,'매달'], [3,'분기'], [6,'반기']],
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
const LEADS = [[10,'10분 전'], [30,'30분 전'], [60,'1시간 전'], [180,'3시간 전']];
const leadLabel = m => !m ? '정각' : m % 60 === 0 ? (m / 60) + '시간 전' : m + '분 전';

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
  const whenStrip = (t, lead, muted, hidden) => {
    const def = STATE.settings.notify_min != null ? STATE.settings.notify_min : 30;
    const cur = lead != null ? lead : def;
    const opts = LEADS.slice();
    if(!opts.some(o => o[0] === cur)) opts.push([cur, leadLabel(cur)]);
    opts.sort((a, b) => a[0] - b[0]);
    self.lead = lead;                    /* 손대지 않으면 저장된 값(비어 있으면 "기본")을 그대로 */
    return '<div class="f-when'+(hidden ? ' off' : '')+'"><span class="step">시각 · 알림</span><div class="when-row">'+
      tfHtml('time', t)+
      '<label class="sw"><input type="checkbox" data-f="alarm"'+(muted ? '' : ' checked')+'> 알림</label>'+
      '<div data-f="leads">'+seg('lead', opts, cur, muted)+'</div></div></div>';
  };
  const bindWhen = () => {
    F('alarm').onchange = () => F('leads').firstChild.classList.toggle('off', !F('alarm').checked);
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
      whenStrip(i.time, i.notify_min, i.muted);
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
        (others.length ? others.slice(0, 6).map(t => '<div class="due-o"><span>'+esc(t.due_time || '—')+'</span>'+
            '<b>'+esc(t.title)+'</b></div>').join('') + (others.length > 6 ? '<div class="due-m">외 '+(others.length - 6)+'건</div>' : '')
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
      '<div class="f-grid memo"></div>'+
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
  api('/api/task', Object.assign({title, note:$('#a-note').value.trim()}, addForm.read()))
    .then(() => { closeM('#m-add'); say('추가됨 · '+title); load(); });
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
  api('/api/task/'+encodeURIComponent(EDIT.id), Object.assign({title, note:$('#e-note').value.trim()}, editForm.read()))
    .then(() => { closeM('#m-edit'); say('저장됨'); load(); });
};
/* 건너뛰기 · 내일로 · 삭제는 묻지 않는다. 창을 닫고 5초 동안 되돌릴 수 있다 */
$('#e-skip').onclick = () => { closeAll(); skipOnce(EDIT); };
$('#e-later').onclick = () => { closeAll(); later(EDIT); };
$('#e-del').onclick = () => { closeAll(); removeSoon(EDIT); };

/* 확인 단추의 글자는 하는 일을 그대로 말한다. 예전에는 늘 "삭제" 라서
   "완전히 종료할까요?" 에도 삭제 단추가 떴다. */
function confirmBox(title, msg, onOk, okLabel, extra){
  $('#cf-title').textContent = title;
  $('#cf-msg').textContent = msg;
  $('#cf-extra').innerHTML = extra || '';       /* 여기 들어가는 것은 우리가 적은 것뿐이다 */
  $('#cf-ok').textContent = okLabel || '삭제';
  $('#cf-ok').onclick = onOk;
  openM('#m-confirm');
}

/* ══════════ 달력 ══════════
   영업일만 쓰는 도구이므로 월~금 5칸만 만든다. 칸이 40% 넓어져서
   한 칸에 일정 여러 개를 넣어도 제목이 읽힌다.
   표시 대상은 "마감이 있는 일" 뿐이다. 반복 업무는 넣지 않는다 -
   매달 되풀이되는 항목이 칸을 다 차지해서 정작 마감이 안 보이게 된다. */
const CAL_MAX = 3;                  /* 한 칸에 보여줄 최대 개수, 나머지는 +N */

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
  const d = dObj(t.due_date);
  const head = wk ? d.getDate() + '일(' + WD[(d.getDay() + 6) % 7] + ')' : t.due_time;
  el.innerHTML = (head ? '<span class="h">' + esc(head) + '</span>' : '') +
                 '<span class="n2">' + esc(t.title) + '</span>';
  el.title = fmtDay(t.due_date) + (t.due_time ? ' ' + t.due_time : '') + '  ' + t.title +
             (wk ? String.fromCharCode(10) + '주말 마감이라 앞 영업일 칸에 표시했습니다' : '') +
             (t.note ? String.fromCharCode(10) + t.note : '') +
             (t.done ? String.fromCharCode(10) + '(완료)' : '');
  /* 누르는 것은 칸에 맡긴다 (그날 요약이 열린다). 칩을 바로 수정으로 이으면
     달력에서 날짜를 훑어보려던 손이 자꾸 수정 창을 연다 - 목록 줄에서 고친
     것과 같은 문제다. 수정은 요약 안의 연필에만 맡긴다. */
  return el;
}

function dayModal(key, list){
  DAY_KEY = key;
  /* 주말 마감을 앞 영업일 칸에 얹었으므로, 목록에서는 실제 날짜를 밝혀 준다 */
  const wknd = weekendOn() ? 0 : list.filter(t => isWeekend(t.due_date)).length;
  $('#day-title').innerHTML = fmtDay(key) + ' <i class="opt">' + list.length + '건' +
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

  const pre = y + '-' + String(m + 1).padStart(2, '0');
  const mine = deadlines().filter(t => t.due_date.slice(0, 7) === pre);
  const cnt = mine.length, left = mine.filter(t => !t.done).length;
  $('#cal-note').textContent = cnt ? cnt + '건 · ' + left + '건 남음' : '마감 없음';

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
  grid.innerHTML = '';
  const HN = STATE.holiday_names || {};

  while(cur <= last && hasDay(cur)){
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
      cell.innerHTML = '<div class="n">' + num +
        (hol && !out ? '<span class="hn">' + esc(HN[key] || '공휴일') + '</span>' : '') +
        '</div>';
      if(!out){
        const list = byDate[key] || [];
        const dls = list.filter(t => !t._rt);
        const rts = list.filter(t => t._rt);
        const chips = document.createElement('div');
        chips.className = 'chips';
        dls.slice(0, CAL_MAX).forEach(t => chips.appendChild(chipEl(t)));
        cell.appendChild(chips);
        if(dls.length > CAL_MAX){
          const more = document.createElement('div');
          more.className = 'more';
          more.textContent = '+' + (dls.length - CAL_MAX) + '건 더';
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
          rl.title = rts.map(t => (t.due_time ? t.due_time + ' ' : '') + t.title).join(String.fromCharCode(10));
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
}

function setView(v){
  view = v;
  $$('#views .dtab').forEach(b => {
    b.classList.toggle('on', b.dataset.v === v);
    b.setAttribute('aria-selected', b.dataset.v === v ? 'true' : 'false');
  });
  $('#v-home').hidden = v !== 'home';
  $('#v-cal').hidden = v !== 'cal';
  if(v === 'cal') drawCal();
}
$('#views').onclick = e => {
  const b = e.target.closest('button');
  if(b) setView(b.dataset.v);
};
$('#cal-prev').onclick = () => shiftMonth(-1);
$('#cal-next').onclick = () => shiftMonth(1);
$('#cal-now').onclick = () => { calCur = null; drawCal(); };
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
    el.className = 'mg-row' + (t.done ? ' off' : '');
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
}
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
  '<i class="opt">기본은 남겨 둡니다</i></label>');

/* 지금 맞추기: 뒤에서 2초 뒤에 시작하므로, 조금 기다렸다가 결과를 묻고 목록도 다시 읽는다 */
$('#sync-now').onclick = () => api('/api/sync/now', {}).then(() => {
  $('#sync-msg').textContent = '맞추는 중…';
  setTimeout(() => refreshSync().then(() => load()), 3500);
});
$('#s-save').onclick = () => api('/api/settings', {
    notify_min:+$('#s-lead').value, brief_time:$('#s-brief').value,
    business_only:$('#s-biz').checked, autostart:$('#s-auto').checked,
    hold_when_busy:$('#s-hold').checked
  }).then(() => { closeM('#m-settings'); say('설정 저장됨'); load(); });
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
const onScreen = () => !HIDDEN && !document.hidden;
function wake(){
  HIDDEN = false;
  if(Date.now() - lastLoad > 3000) load();
}
window.__lsShown = wake;
document.addEventListener('visibilitychange', () => { if(!document.hidden) wake(); });
addEventListener('focus', () => { if(HIDDEN || Date.now() - lastLoad > POLL_MS) wake(); });
load();
setInterval(() => { if(onScreen()) load(); }, POLL_MS);
