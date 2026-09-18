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
      '<div class="tp-f">민트 테두리 = 지금 시각 · 숫자로 쳐도 됩니다 (930 · 21 · 930p)</div>';
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
  esc(v || '') + '" title="' + (title || '누르면 시 → 분. 숫자로 쳐도 됩니다 (930 · 21 · 930p)') + '">';
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
function nextWd(w){ const d = dObj(STATE.today); let k = (w+1 - d.getDay() + 7) % 7; d.setDate(d.getDate() + (k||7)); return rollBiz(iso(d), 1); }
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
      + '<div class="ep">매일 · 매주 하는 루틴을 먼저 넣어 두면,<br>'
      + '아침마다 오늘 할 일이 저절로 채워집니다.</div>'
      + '<div class="ec"><button data-new="routine">' + ICON.plus + '루틴 추가</button>'
      + '<button class="ghost" data-new="deadline">마감 하나 넣어보기</button></div></div>';
  const n = (o.upcoming || [])[0];
  /* 날짜 표기는 목록과 같은 함수를 쓴다 ("내일" · "9/17 (목)") */
  const when = n && n.date ? fmtDay(n.date) + (n.time ? ' ' + n.time : '') : '';
  return '<div class="empty-rich"><div class="ill">' + ICON.check + '</div>'
    + '<div class="eh">오늘 할 일이 없습니다</div>'
    + '<div class="ep">' + (n
        ? '다음 마감은 <b>' + esc(when) + ' · ' + esc(n.title) + '</b> 입니다.'
        : '다가오는 7일에도 마감이 없습니다.') + '</div>'
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
  if(e.key === 'Enter' && e.target.tagName !== 'BUTTON' && !e.defaultPrevented){
    if($('#m-add').classList.contains('on')) $('#a-save').click();
    else if($('#m-edit').classList.contains('on')) $('#e-save').click();
  }
};

/* ══════════ 루틴 규칙: 문장으로 ══════════
   "매월 · 날짜로 · 말일 · 달력 날 · 앞 영업일로 · 매월" 처럼 문장 조각을 고른다.
   달력 날이 기본이고, 영업일은 주기가 아니라 "세는 방법" 이다 - 같은 문장에서
   달력 날 / 영업일만 바꾸면 "매월 3일" 이 "매월 3번째 영업일" 이 된다.
   저장 형식(period · basis · n · k · months · holiday_shift)은 예전 그대로라
   PC · 휴대폰 · 이미 저장된 루틴이 모두 그대로 동작한다. 매년은 "한 달만 도는 매월" 이다. */
const MONTHSETS = [
  ['all',    '매월',                 null],
  ['q1',     '분기 말',  [3,6,9,12]],
  ['q2',     '분기 초',  [1,4,7,10]],
  ['half',   '반기',     [6,12]],
  ['custom', '직접',     null],
];
const SHIFTS = [['prev','앞 영업일로'], ['next','뒤로'], ['none','그대로']];
const sel = (f, opts, cur) => '<select data-f="'+f+'">'+opts.map(([v,l]) =>
  '<option value="'+v+'"'+(String(cur)===String(v)?' selected':'')+'>'+l+'</option>').join('')+'</select>';
const seg = (key, opts, cur, off) => '<div class="seg'+(off ? ' off' : '')+'">'+opts.map(([v,l]) =>
  '<button type="button" data-s="'+key+'" data-v="'+v+'"'+(String(cur)===String(v)?' class="on"':'')+'>'+l+'</button>').join('')+'</div>';
const line = (label, body, note) => '<div class="sl"><span class="lb">'+label+(note ? '<i>'+note+'</i>' : '')+'</span><div>'+body+'</div></div>';

/* 저장된 규칙 → 고르는 상태 */
function ruleToS(r){
  r = r || {};
  const S = {freq:'month', frame:'date', biz:false, n:1, k:0, wn:1, weekday:0, weekdays:[], interval:1,
             anchor:r.anchor || null, shift:r.holiday_shift || 'prev', mset:'all', months:[], ymonth:1};
  const p = r.period;
  if(p === 'day'){ S.freq = 'day'; S.biz = r.business_only !== false; return S; }
  if(p === 'week'){ S.freq = 'week'; S.weekdays = (r.weekdays || []).slice(); S.interval = r.interval || 1; return S; }
  if(p !== 'month' && p !== 'quarter') return S;
  S.freq = p;
  const b = r.basis || 'day';
  if(b === 'weekday'){ S.frame = 'weekday'; S.wn = r.n || 1; S.weekday = r.weekday || 0; }
  else if(b === 'before_end' || b === 'before_end_bd'){ S.frame = 'end'; S.biz = b === 'before_end_bd'; S.k = r.k || 0; }
  else { S.frame = 'date'; S.biz = b === 'business_day'; S.n = r.n || 1; }
  const m = r.months;
  if(p === 'month' && m && m.length === 1){ S.freq = 'year'; S.ymonth = m[0]; }
  else if(p === 'month' && m && m.length && m.length < 12){
    const hit = MONTHSETS.find(x => x[2] && x[2].length === m.length && x[2].every(v => m.includes(v)));
    S.mset = hit ? hit[0] : 'custom';
    S.months = m.slice();
  }
  return S;
}
/* 고르는 상태 → 저장할 규칙 */
function sToRule(S){
  const r = {period: S.freq === 'year' ? 'month' : S.freq, holiday_shift: S.shift};
  if(S.freq === 'day'){ r.business_only = S.biz; return r; }
  if(S.freq === 'week'){
    r.weekdays = S.weekdays.slice().sort((a, b) => a - b);
    r.interval = S.interval;
    if(S.anchor) r.anchor = S.anchor;
    return r;
  }
  if(S.frame === 'weekday'){ r.basis = 'weekday'; r.n = S.wn; r.weekday = S.weekday; }
  else if(S.frame === 'end'){ r.basis = S.biz ? 'before_end_bd' : 'before_end'; r.k = S.k; }
  else { r.basis = S.biz ? 'business_day' : 'day'; r.n = S.n; }
  if(S.freq === 'year') r.months = [S.ymonth];
  else if(S.freq === 'month' && S.mset !== 'all'){
    const set = S.mset === 'custom' ? S.months.slice().sort((a, b) => a - b)
                                    : MONTHSETS.find(x => x[0] === S.mset)[2];
    if(set.length && set.length < 12) r.months = set;
  }
  return r;
}
/* "몇 번째" 의 끝 (분기는 예전 규칙을 고칠 때만 나온다) */
const nTop = S => S.freq === 'quarter' ? (S.biz ? 66 : 92) : (S.biz ? 23 : 31);

/* ══════════ 폼 (추가 / 수정 공용) ══════════ */
function Form(box){
  const F = f => box.querySelector('[data-f="'+f+'"]');
  const self = {kind:'deadline', box:box, lead:null};

  /* 알림: 켜고 끄는 스위치 + 얼마 전에. "끄기" 체크보다 "받기" 스위치가 읽기 쉽다 */
  const timeBlock = (t, lead, muted) => {
    const def = STATE.settings.notify_min != null ? STATE.settings.notify_min : 30;
    const opts = [[null, '기본 (' + (def ? def + '분' : '정각') + ')'], [0, '정각'], [10, '10분'],
                  [30, '30분'], [60, '1시간'], [1440, '하루']];
    if(lead != null && !opts.some(o => o[0] === lead)) opts.push([lead, lead + '분']);
    self.lead = lead != null ? lead : null;
    return '<span class="step">언제 · 알림</span>'+
      line('시각', '<div class="row2">' + tfHtml('time', t) + '</div>', '비워도 됨')+
      line('알림', '<div class="alarm"><label class="sw"><input type="checkbox" data-f="alarm"'+(muted ? '' : ' checked')+
        '> 알림 받기</label><div data-f="leads">'+
        seg('lead', opts.map(([v, l]) => [v == null ? '' : v, l]), lead == null ? '' : lead, muted)+'</div></div>',
        '얼마나 먼저');
  };
  const bindTime = () => {
    F('alarm').onchange = () => F('leads').firstChild.classList.toggle('off', !F('alarm').checked);
    F('leads').onclick = e => {
      const b = e.target.closest('[data-s="lead"]');
      if(!b) return;
      self.lead = b.dataset.v === '' ? null : +b.dataset.v;
      F('leads').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    };
  };

  /* ---------- 할 일 ---------- */
  function renderDeadline(i){
    box.innerHTML =
      '<span class="step">언제까지</span>'+
      '<label>마감 날짜</label><input type="date" data-f="date" value="'+(i.date||rollBiz(STATE.today,1))+'">'+
      '<div class="quick">'+[['오늘',0],['내일',1],['모레',2],['+7일',7],['+30일',30]]
          .map(([l,n])=>'<button type="button" data-add="'+n+'">'+l+'</button>').join('')+
        '<button type="button" data-wd="0">다음 월요일</button><button type="button" data-wd="4">다음 금요일</button></div>'+
      '<div data-f="warn"></div>'+ timeBlock(i.time, i.notify_min, i.muted);
    const chk = () => {
      const v = F('date').value, w = F('warn');
      if(!v || !bizOn() || isBiz(v)){ w.innerHTML = ''; return; }
      const alt = rollBiz(v, -1);
      w.innerHTML = '<div class="warn-line">이 날은 영업일이 아닙니다 ('+fmtDay(v)+')'+
        '<button type="button" data-f="fix">'+fmtDay(alt)+'로</button></div>';
      w.querySelector('[data-f="fix"]').onclick = () => { F('date').value = alt; chk(); };
    };
    box.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { F('date').value = shift(+b.dataset.add); chk(); });
    box.querySelectorAll('[data-wd]').forEach(b => b.onclick = () => { F('date').value = nextWd(+b.dataset.wd); chk(); });
    F('date').onchange = chk;
    chk();
    bindTime();
  }

  /* ---------- 루틴 ---------- */
  function renderRoutine(i){
    const today = dObj(STATE.today);
    const S = self.S = i.rule_n ? ruleToS(i.rule_n)
      : Object.assign(ruleToS(null), {n: Math.min(today.getDate(), 31)});   /* 새 루틴: "매월 (오늘 날짜)일" */
    const legacyQ = S.freq === 'quarter';
    const start = dObj(i.next_date || i.date || STATE.today);
    const MC = {y: start.getFullYear(), m: start.getMonth(), pick: null, rule: null};
    box.innerHTML =
      '<div class="rt-grid">'+
        '<div class="rt-pick"><span class="step">날짜 하나로 시작 <i class="opt">그 일을 하는 날</i></span>'+
          '<div data-f="mc"></div><div class="sugg" data-f="sugg"></div></div>'+
        '<div class="rt-sent"><span class="step">문장으로 확인 · 고치기</span><div data-f="sent"></div>'+
          '<p class="preview" data-f="prev"><b>다음 실행 날짜</b>—</p>'+
          timeBlock(i.time, i.notify_min, i.muted)+'</div>'+
      '</div>';

    /* 작은 달력: 날짜를 누르면 그 날을 포함하는 규칙을 서버(recur.suggest)에 묻는다 */
    const drawMc = () => {
      const first = new Date(MC.y, MC.m, 1);
      const cur = new Date(first);
      cur.setDate(1 - ((first.getDay() + 6) % 7));
      let h = '<div class="mc-top"><button type="button" data-mc="-1" aria-label="이전 달">'+
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M15 18l-6-6 6-6"/></svg></button>'+
        '<b>'+MC.y+'년 '+(MC.m+1)+'월</b>'+
        '<button type="button" data-mc="1" aria-label="다음 달">'+
        '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M9 6l6 6-6 6"/></svg></button></div>'+
        '<div class="mc">' + WD.map(w => '<i>'+w+'</i>').join('');
      for(let k = 0; k < 42; k++){
        const key = iso(cur);
        const w = cur.getDay();
        const cls = [cur.getMonth() !== MC.m ? 'out' : '', (w === 0 || w === 6 || HOL.has(key)) ? 'we' : '',
                     key === STATE.today ? 'now' : '', key === MC.pick ? 'on' : ''].join(' ').trim();
        h += '<span data-d="'+key+'"'+(cls ? ' class="'+cls+'"' : '')+'>'+cur.getDate()+'</span>';
        cur.setDate(cur.getDate() + 1);
        if(k === 34 && cur.getMonth() !== MC.m) break;           /* 다섯 줄이면 충분한 달 */
      }
      F('mc').innerHTML = h + '</div>';
    };
    const drawSugg = items => {
      const box2 = F('sugg');
      if(!MC.pick){
        box2.innerHTML = '<p class="hint">날짜를 누르면 그 날에 맞는 규칙이 나옵니다.<br>“매월 말일쯤 하는 그 일” 이라면 이번 달 말일을 누르세요.</p>';
        return;
      }
      if(!items){ box2.innerHTML = '<p class="hint">찾는 중…</p>'; return; }
      box2.innerHTML = items.map((it, k) => '<button type="button" data-k="'+k+'"'+
        (MC.rule === it.text ? ' class="on"' : '')+'>'+esc(it.text)+'</button>').join('');
      box2.onclick = e => {
        const b = e.target.closest('[data-k]');
        if(!b) return;
        const it = items[+b.dataset.k];
        Object.assign(S, ruleToS(it.rule));
        MC.rule = it.text;
        box2.querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
        drawSent();
      };
    };
    let suggSeq = 0;
    F('mc').onclick = e => {
      const nav = e.target.closest('[data-mc]');
      if(nav){
        const t = new Date(MC.y, MC.m + +nav.dataset.mc, 1);
        MC.y = t.getFullYear(); MC.m = t.getMonth();
        return drawMc();
      }
      const d = e.target.closest('[data-d]');
      if(!d) return;
      MC.pick = d.dataset.d; MC.rule = null;
      const dd = dObj(MC.pick);
      if(dd.getMonth() !== MC.m){ MC.y = dd.getFullYear(); MC.m = dd.getMonth(); }
      drawMc();
      drawSugg(null);
      const seq = ++suggSeq;
      api('/api/suggest?date=' + MC.pick)
        .then(r => { if(seq === suggSeq) drawSugg(r.items || []); })
        .catch(err => { if(seq === suggSeq) F('sugg').innerHTML = '<p class="hint">'+esc(err.message)+'</p>'; });
    };

    /* 문장 */
    const drawSent = () => {
      const freqs = [['day','매일'],['week','매주'],['month','매월'],['year','매년']];
      if(legacyQ) freqs.push(['quarter','매 분기']);
      let h = line('얼마나 자주', seg('freq', freqs, S.freq));
      if(S.freq === 'day'){
        h += line('세는 방법', seg('biz', [[0,'달력 날 (날마다)'],[1,'영업일만']], S.biz ? 1 : 0),
                  S.biz ? '주말 · 공휴일 빼고' : '');
      }else if(S.freq === 'week'){
        h += line('요일', '<div class="wd">'+WD.map((w, x) =>
               (bizOn() && x > 4 && !S.weekdays.includes(x)) ? '' :
               '<span data-w="'+x+'"'+(S.weekdays.includes(x) ? ' class="on"' : '')+'>'+w+'</span>').join('')+'</div>');
        h += line('간격', '<div class="row2">'+sel('interval', [[1,'매주'],[2,'격주'],[3,'3주마다'],[4,'4주마다']], S.interval)+'</div>');
        h += line('주말 · 공휴일에<br>걸리면', seg('shift', SHIFTS, S.shift));
      }else{
        if(S.freq === 'year')
          h += line('달', '<div class="row2">'+sel('ymonth', [...Array(12)].map((_, k) => [k+1, (k+1)+'월']), S.ymonth)+'</div>');
        h += line('틀', seg('frame', [['date','날짜로'],['weekday','요일로'],['end','말일부터']], S.frame));
        let when = '';
        const q = S.freq === 'quarter';
        if(S.frame === 'date'){
          const top = nTop(S);
          const opts = [...Array(top)].map((_, k) => [k+1, (k+1) + (S.biz ? '번째 영업일' : (q ? '일째' : '일'))]);
          opts.push([-1, S.biz ? '마지막 영업일' : (q ? '분기 마지막 날' : '말일')]);
          when = sel('n', opts, S.n);
        }else if(S.frame === 'weekday'){
          when = sel('wn', [[1,'첫째'],[2,'둘째'],[3,'셋째'],[4,'넷째'],[-1,'마지막']], S.wn)+
                 sel('weekday', WD.map((w, x) => [x, w+'요일']), S.weekday);
        }else{
          when = '<span class="u">'+(q ? '분기말' : '말일')+'</span><input type="number" data-f="k" min="0" max="'+(q ? 60 : 27)+
                 '" value="'+S.k+'"><span class="u">'+(S.biz ? '영업일 전' : '일 전')+'</span>';
        }
        h += line('언제', '<div class="row2">'+when+'</div>', S.frame === 'end' ? '0 이면 말일 당일' : '');
        if(S.frame !== 'weekday')
          h += line('세는 방법', seg('biz', [[0,'달력 날'],[1,'영업일']], S.biz ? 1 : 0));
        const bizCount = S.frame !== 'weekday' && S.biz;
        h += line('주말 · 공휴일에<br>걸리면', seg('shift', SHIFTS, S.shift, bizCount), bizCount ? '영업일로 세면 걸리지 않음' : '');
        if(S.freq === 'month'){
          const ms = (MONTHSETS.find(x => x[0] === S.mset) || [])[2];
          h += line('실행하는 달', seg('mset', MONTHSETS.map(([v, l]) => [v, l]), S.mset)+
            (S.mset === 'custom' ? '<div class="mpick">'+[...Array(12)].map((_, k) =>
              '<span data-m="'+(k+1)+'"'+(S.months.includes(k+1) ? ' class="on"' : '')+'>'+(k+1)+'월</span>').join('')+'</div>' : ''),
            ms ? ms.join('·') + '월' : '');
        }
      }
      F('sent').innerHTML = h;
      preview();
    };

    /* 조각을 고를 때마다 상태를 고치고 다시 그린다 */
    F('sent').onclick = e => {
      const b = e.target.closest('[data-s]');
      if(b){
        const k = b.dataset.s, v = b.dataset.v;
        if(k === 'freq'){
          S.freq = v;
          const base = MC.pick ? dObj(MC.pick) : today;
          if(v === 'week' && !S.weekdays.length) S.weekdays = [(base.getDay() + 6) % 7];
          if(v === 'year') S.ymonth = base.getMonth() + 1;
        }else if(k === 'biz'){
          S.biz = v === '1';
          if(S.n > nTop(S)) S.n = -1;
        }else if(k === 'mset'){
          S.mset = v;
          if(v === 'custom' && !S.months.length) S.months = [(MC.pick ? dObj(MC.pick) : today).getMonth() + 1];
        }else S[k] = v;
        MC.rule = null;
        F('sugg').querySelectorAll('button.on').forEach(x => x.classList.remove('on'));
        return drawSent();
      }
      const w = e.target.closest('[data-w]');
      if(w){
        const x = +w.dataset.w;
        S.weekdays = S.weekdays.includes(x) ? S.weekdays.filter(y => y !== x) : S.weekdays.concat(x);
        return drawSent();
      }
      const m = e.target.closest('[data-m]');
      if(m){
        const x = +m.dataset.m;
        S.months = S.months.includes(x) ? S.months.filter(y => y !== x) : S.months.concat(x);
        return drawSent();
      }
    };
    F('sent').onchange = e => {
      const f = e.target.dataset.f;
      if(!f) return;
      let v = +e.target.value;
      if(f === 'k') v = Math.max(0, Math.min(S.freq === 'quarter' ? 60 : 27, Math.round(v) || 0));
      S[f] = v;
      drawSent();
    };

    /* 미리보기 요청은 늦게 도착할 수 있다. 조각을 빠르게 바꾸면 이전 요청의 답이
       나중 것을 덮어써서 "매주" 를 골랐는데 "매월" 날짜가 보였다. 마지막 요청만 반영한다. */
    let prevSeq = 0;
    const preview = () => {
      const seq = ++prevSeq;
      const bad = self.problem();
      if(bad){ F('prev').innerHTML = '<b>다음 실행 날짜</b>' + esc(bad); return; }
      const show = html => { if(seq === prevSeq && F('prev')) F('prev').innerHTML = html; };
      api('/api/preview', {rule: sToRule(S)})
        .then(d => show(d.error
          ? '<b>다음 실행 날짜</b>'+esc(d.error)
          : '<b>'+esc(d.text)+'</b>'+esc(d.dates.join('   ·   '))))
        .catch(e => show('<b>다음 실행 날짜</b>'+esc(e.message)));
    };

    drawMc();
    drawSugg();
    drawSent();
    bindTime();
  }

  /* 규칙에 빠진 것이 있으면 그 문장, 없으면 '' */
  self.problem = function(){
    const S = self.S;
    if(!S) return '';
    if(S.freq === 'week' && !S.weekdays.length) return '요일을 하나 이상 고르세요';
    if(S.freq === 'month' && S.mset === 'custom' && !S.months.length) return '실행하는 달을 하나 이상 고르세요';
    return '';
  };

  self.render = function(kind, i){
    self.kind = kind;
    self.S = null;
    box.dataset.kind = kind;
    /* 루틴은 두 칸(날짜로 시작 · 문장)이라 창을 넓힌다 */
    const modal = box.closest('.modal');
    if(modal) modal.classList.toggle('rt', kind === 'routine');
    i = i || {};
    if(kind === 'floating'){
      box.innerHTML = '<p class="hint">기한 없이 목록에만 남습니다. 나중에 이 창에서 종류를 바꿔 마감을 붙일 수 있습니다.</p>';
    } else if(kind === 'deadline'){
      renderDeadline(i);
    } else {
      renderRoutine(i);
    }
  };

  self.read = function(){
    const p = {kind:self.kind};
    if(self.kind === 'floating')
      return Object.assign(p, {due_date:null, due_time:'', rule:null, notify_min:null, muted:false});
    p.due_time = parseTime(F('time').value) || '';
    p.notify_min = self.lead;
    p.muted = !F('alarm').checked;
    if(self.kind === 'deadline'){ p.due_date = F('date').value || STATE.today; p.rule = null; }
    else { p.rule = sToRule(self.S); p.due_date = null; }
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
function confirmBox(title, msg, onOk, okLabel){
  $('#cf-title').textContent = title;
  $('#cf-msg').textContent = msg;
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

  const cols = weekendOn() ? 7 : 5;
  $('#cal-we').classList.toggle('off', !weekendOn());
  $('#cal-rt').classList.toggle('off', !routinesOn());
  const head = $('#cal-head');
  head.style.setProperty('--cols', cols);
  head.innerHTML = WD.slice(0, cols)
    .map((w, k) => '<span' + (k >= 5 ? ' class="we"' : '') + '>' + w + '</span>').join('');

  /* 그 달의 첫 주 월요일부터, 마지막 날이 포함된 주까지 */
  const first = new Date(y, m, 1), last = new Date(y, m + 1, 0);
  const cur = new Date(first);
  cur.setDate(first.getDate() - ((first.getDay() + 6) % 7));
  const hasDay = mon => {                     /* 그 주에 이 달에 속한 칸이 있나 */
    for(let k = 0; k < cols; k++){
      const d = new Date(mon); d.setDate(mon.getDate() + k);
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
    for(let k = 0; k < cols; k++){
      const d = new Date(cur); d.setDate(cur.getDate() + k);
      const key = iso(d);
      const out = d.getMonth() !== m;
      const hol = HOL.has(key);
      const we = isWeekend(key);
      const cell = document.createElement('div');
      cell.className = 'day' + (out ? ' out' : '') +
                       (!out && hol ? ' hol' : (!out && we ? ' we' : '')) +
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
  const msg = $('#sync-msg'), btn = $('#sync-btn'), now = $('#sync-now');
  btn.disabled = false;
  now.hidden = !(s.configured && s.signed_in);
  now.disabled = !!s.syncing;
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
