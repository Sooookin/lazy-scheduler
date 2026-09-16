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

/* 시각은 모두 5분 단위. 키보드로 직접 입력할 수 있고(09:30, 0930),
   5분 배수가 아닌 값이 들어오면 가장 가까운 5분으로 맞춘다. */
const STEP = 5;
const pad2 = n => String(n).padStart(2, '0');
const hhmm = m => pad2(Math.floor(m/60)) + ':' + pad2(m%60);
function snapTime(el){
  if(!el.value || !/^\d\d:\d\d/.test(el.value)) return;
  el.value = hhmm(Math.min(1435, Math.max(0, Math.round(mins(el.value)/STEP)*STEP)));
}
/* 폼은 그때그때 새로 그리므로 개별 바인딩 대신 문서 한 곳에서 위임 처리한다. */
document.addEventListener('change', e => {
  const el = e.target;
  if(!el.matches) return;
  if(el.matches('input[type="time"]')) snapTime(el);
  else if(el.matches('input.min5') && el.value !== '')
    el.value = Math.max(0, Math.round(+el.value/STEP)*STEP);
}, true);
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
  $('#w-close').onclick = () => has() ? window.pywebview.api.close() : window.close();
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

/* ══════════ 항목 행 ══════════ */
function itemEl(i, opt){
  opt = opt || {};
  const el = document.createElement('div');
  el.className = 'item k-' + (i.kind || 'deadline') + (i.done ? ' done' : '');
  const bits = [];
  if(i.kind === 'routine') bits.push('<span class="rt-ico" title="'+esc(i.rule_text)+'">'+ICON.repeat+'</span>');
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
  /* 한 줄: 체크 · 제목(늘어남) · 상태 · 시각. 줄을 누르면 수정 창이 열린다 */
  el.innerHTML = '<div class="dot" role="checkbox" aria-checked="'+(i.done ? 'true' : 'false')+'" title="완료"></div>'+
    '<div class="t">'+esc(i.title)+'</div>'+
    (bits.length ? '<div class="meta">'+bits.join('')+'</div>' : '');
  el.title = i.title + (i.note ? String.fromCharCode(10) + i.note : '');
  el.querySelector('.dot').onclick = e => {
    e.stopPropagation();
    /* 뒤집기가 아니라 "화면에 보이는 상태의 반대" 로 정한다. 알림 카드에서 이미
       완료했는데 화면이 늦게 갱신됐어도 결과가 누른 사람의 뜻대로 나온다. */
    api('/api/task/'+encodeURIComponent(i.id)+'/done', {date:i.date, done:!i.done}).then(load);
  };
  el.onclick = () => openEdit(i);
  return el;
}

/* 반복 업무 행: 완료 체크 없이 "다음 예정일"만 */
function routineEl(i){
  const el = document.createElement('div');
  const isToday = i.next_date === STATE.today;
  el.className = 'item rt k-routine';
  let when;
  if(!i.next_date) when = '<span class="tm">예정 없음</span>';
  else if(isToday) when = (i.done ? '<span class="st ok">완료</span>' : '<span class="st late">오늘</span>') +
                          (i.time ? '<span class="tm">'+esc(i.time)+'</span>' : '');
  else when = '<span class="tm">'+esc(fmtDay(i.next_date))+'</span>';
  el.innerHTML = '<div class="t">'+esc(i.title)+'</div>'+
    '<span class="rule-t" title="'+esc(i.rule_text)+'">'+esc(i.rule_text)+'</span>'+
    '<div class="meta">'+(i.muted ? '<span class="tag">알림 끔</span>' : '')+when+'</div>';
  el.title = i.title + ' · ' + i.rule_text + (isToday && i.done ? ' (오늘 완료)' : '');
  el.onclick = () => openEdit(i);
  return el;
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
      + '<div class="ep">매일 · 매주 반복되는 업무를 먼저 넣어 두면,<br>'
      + '아침마다 오늘 할 일이 저절로 채워집니다.</div>'
      + '<div class="ec"><button data-new="routine">' + ICON.plus + '반복 업무 추가</button>'
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

function render(o){
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
  $('#fulldate').textContent = o.is_business_day ? '영업일' : '영업일 아님';
  $('#tb-sub').textContent = o.stats.left ? o.stats.left+'건 남음' : '';
  $('#left').textContent = o.stats.left;
  const pct = o.stats.total ? o.stats.done / o.stats.total : (o.stats.left ? 0 : 1);
  $('#ringfg').style.strokeDashoffset = 188.5 * (1 - pct);
  $('#ringfg').style.stroke = o.stats.left ? 'var(--mid)' : 'var(--mint)';

  /* 지금 + 오늘 통합: 시간순, 완료는 아래로 */
  const rank = i => (i.done ? 1 : 0);
  const all = o.overdue.concat(o.todays).sort((a,b) =>
    rank(a)-rank(b) || (a.date||'').localeCompare(b.date||'') ||
    (a.time||'99:99').localeCompare(b.time||'99:99'));
  fill($('#today'), all, emptyToday(o), {showOverdue:true});
  const undone = all.filter(i => !i.done).length;
  $('#c-today').textContent = all.length;
  $('#c-today').classList.toggle('hot', undone > 0);
  $('#today-note').textContent = all.length ? (undone ? undone+'건 남음' : '전부 완료') : '';

  fill($('#upcoming'), o.upcoming, '앞으로 7일, 마감 없음', {showDate:true});
  fill($('#floating'), o.floating, '＋ 새 항목 → 기한 없는 메모');
  fill($('#routines'), o.routines, '＋ 새 항목 → 반복되는 일', null, routineEl);
  $('#c-up').textContent = o.upcoming.length;
  $('#c-up').classList.toggle('hot', o.upcoming.length > 0);
  $('#c-rt').textContent = o.routines.length;
  $('#c-float').textContent = o.floating.length;
  $('#s-lead').value = o.settings.notify_min != null ? o.settings.notify_min : 30;
  $('#s-brief').value = o.settings.brief_time || '08:30';
  $('#s-biz').checked = bizOn();
  $('#s-auto').checked = !!o.settings.autostart;
  $('#s-hold').checked = o.settings.hold_when_busy !== false;
  if($('#m-manage').classList.contains('on')) drawManage();
  if(view === 'cal') drawCal();
  queueFit();
}

/* ══════════ 오른쪽 칸 높이 맞추기 ══════════
   flex 비율(1 / .6 / auto)로 나누면 항목 3개일 때 공백이 남고 4개일 때 넘쳐
   스크롤이 생겼다. 한 줄 높이를 실제로 재서, 칸 높이를 그 정수배로만 준다.
   자리가 모자라면 줄이 가장 많은 칸부터 한 줄씩 줄인다 (그 칸만 스크롤). */
const COL_GAP = 14;          /* .col 의 gap 과 같아야 한다 */
const MIN_ROWS = 4;          /* 다가오는 마감·메모는 네 줄 자리를 잡아 둔다 */

/* 배치는 세 구간이다. 가운데(2단)에서만 높이를 계산한다.
   넓은 화면은 CSS 그리드가, 좁은 창은 스크롤이 알아서 한다. */
const WIDE = () => matchMedia('(min-width:1500px)').matches;
const NARROW = () => matchMedia('(max-width:900px)').matches;

function fitCards(){
  const col = $('#col-right');
  if(!col || $('#v-home').hidden) return;
  const cards = [...col.querySelectorAll('.card')];
  /* 이 두 구간에서는 높이를 정하지 않는다. 예전에 넣어 둔 인라인 높이가
     남아 있으면 그리드 배치가 어긋나므로 반드시 지우고 나간다. */
  if(WIDE() || NARROW()){
    cards.forEach(c => {
      c.style.height = '';
      const l = c.querySelector('.list');
      if(l) l.style.height = '';
    });
    return;
  }
  /* 반복 업무 칸이 펼쳐지면 칼럼 전체를 덮으므로(position:absolute) 건드리지 않는다 */
  if(!cards.length || cards.some(c => c.classList.contains('open'))) return;

  const info = cards.map(c => {
    const list = c.querySelector('.list');
    c.style.height = 'auto';
    if(list) list.style.height = 'auto';
    const open = list && getComputedStyle(list).display !== 'none';
    const cs = open ? getComputedStyle(list) : null;
    const first = open ? list.firstElementChild : null;
    return {
      c: c, list: list, open: open,
      pad: open ? parseFloat(cs.paddingTop) + parseFloat(cs.paddingBottom) : 0,
      gap: open ? (parseFloat(cs.rowGap) || 0) : 0,
      rows: open ? list.children.length : 0,
      rowH: first ? first.offsetHeight : 0,
      /* 목록을 뺀 나머지(제목줄 + 칸 여백) */
      chrome: c.offsetHeight - (open ? list.offsetHeight : 0),
    };
  });

  /* 목록 높이를 "정확히 n줄" 로 정하고 칸은 그만큼만 키운다.
     칸 높이만 맞추면 목록 여백 때문에 줄이 반쯤 잘려 보인다. */
  const listH = (o, n) => n ? n * o.rowH + (n - 1) * o.gap + o.pad : 0;
  const cardH = (o, n) => o.chrome + listH(o, n);

  const avail = col.clientHeight - COL_GAP * (cards.length - 1);

  /* 칸 높이는 "보여줄 줄 수" 와 "잡아 둘 줄 수(min)" 중 큰 쪽으로 정한다.
     항목이 두 개뿐이어도 네 줄 자리를 남겨 두면, 항목이 늘 때 배치가 흔들리지
     않고 칼럼 아래에 큰 빈 공간이 남지도 않는다. */
  let show = [], min = MIN_ROWS;
  const slot = k => info[k].open ? Math.max(show[k], min) : 0;
  const total = () => info.reduce((sum, o, k) => sum + cardH(o, slot(k)), 0);

  for(;;){
    show = info.map(o => o.rows);
    /* 자리가 모자라면 아래쪽 칸(우선순위가 낮은 쪽)부터 줄인다.
       중요도가 오늘 > 다가오는 마감 > 메모 > 반복 업무 순이므로,
       마감을 남기고 메모를 먼저 접는 게 맞다. */
    for(let guard = 0; guard < 400 && total() > avail; guard++){
      let k = -1;
      for(let j = show.length - 1; j >= 0; j--)
        if(info[j].open && show[j] > min){ k = j; break; }
      if(k < 0) break;
      show[k]--;
    }
    if(total() <= avail || min <= 1) break;
    min--;                        /* 창이 정말 좁으면 잡아 두는 줄 수를 줄인다 */
  }

  info.forEach((o, k) => {
    if(o.open) o.list.style.height = listH(o, slot(k)) + 'px';
    o.c.style.height = cardH(o, slot(k)) + 'px';
  });
}
/* render() 직후에는 아직 배치가 끝나지 않아 칼럼 높이를 잘못 잰다.
   (첫 화면에서 92px 작게 나와 줄 수가 모자라게 잡혔다)
   그리기 한 박자 뒤에, 그리고 글꼴이 준비된 뒤에 다시 맞춘다. */
function queueFit(){
  cancelAnimationFrame(queueFit._r);
  queueFit._r = requestAnimationFrame(() => requestAnimationFrame(fitCards));
}
addEventListener('resize', () => { clearTimeout(fitCards._t); fitCards._t = setTimeout(fitCards, 120); });
addEventListener('load', queueFit);
if(document.fonts && document.fonts.ready) document.fonts.ready.then(queueFit);

/* 시계 */
function tickClock(){
  const n = new Date();
  $('#clock').textContent = String(n.getHours()).padStart(2,'0')+':'+String(n.getMinutes()).padStart(2,'0');
}
tickClock();
setInterval(tickClock, 10000);

/* 반복 업무 카드 접기 (기본 접힘) */
const rtCard = $('#card-rt');
if(localStorage.getItem('rt-open') === '1') rtCard.classList.add('open');
function toggleRt(){
  /* 3단 배치에서는 반복 업무가 이미 자기 칼럼에 펼쳐져 있다. 접을 것이 없다. */
  if(WIDE()) return;
  rtCard.classList.toggle('open');
  localStorage.setItem('rt-open', rtCard.classList.contains('open') ? '1' : '0');
  // 화살표 방향은 CSS 가 회전으로 처리한다 (여기서 글리프까지 바꾸면 두 번 뒤집힌다)
  if(rtCard.classList.contains('open')) rtCard.style.height = '';   /* inset:0 이 먹도록 */
  else queueFit();
}
$('#rt-head').onclick = toggleRt;

const load = () => api('/api/overview').then(o => {
  render(o);
  if(!load._first){                 /* 주소에 #cal 이 있으면 달력으로 시작 */
    load._first = true;
    if(location.hash === '#cal') setView('cal');
  }
});

/* ══════════ 모달 ══════════ */
function openM(id){ $('#veil').classList.add('on'); $(id).classList.add('on'); }
function closeM(id){ $(id).classList.remove('on'); if(!$$('.modal.on').length) $('#veil').classList.remove('on'); }
function closeAll(){ $('#veil').classList.remove('on'); $$('.modal').forEach(m => m.classList.remove('on')); }
$('#veil').onclick = closeAll;
$$('[data-close]').forEach(b => b.onclick = e => closeM('#'+e.target.closest('.modal').id));
document.onkeydown = e => {
  if(e.key === 'Escape'){
    if(!$$('.modal.on').length && rtCard.classList.contains('open')) return toggleRt();
    closeAll();
  }
  /* 달력을 보고 있을 때만 좌우로 달 넘기기 (입력 중에는 방해하지 않는다) */
  if(view === 'cal' && !$$('.modal.on').length && /^Arrow(Left|Right)$/.test(e.key)){
    shiftMonth(e.key === 'ArrowLeft' ? -1 : 1);
    return;
  }
  if(e.key === 'Enter' && e.target.tagName !== 'BUTTON'){
    if($('#m-add').classList.contains('on')) $('#a-save').click();
    else if($('#m-edit').classList.contains('on')) $('#e-save').click();
  }
};

/* ══════════ 반복 규칙: 주기 × 기준 ══════════ */
const PERIODS = [['day','매 영업일'],['week','매주'],['month','매월'],['quarter','분기']];

/* 기준을 "읽는 그대로" 한 줄 선택지로 펼침 */
const BASES = [
  ['bd_n',    'N번째 영업일',      '분기 N번째 영업일'],
  ['bd_last', '마지막 영업일',     '분기 마지막 영업일'],
  ['bebd_k',  '말일 K영업일 전',   '분기말 K영업일 전'],
  ['wd_n',    'N번째 O요일',       '분기 N번째 O요일'],
  ['wd_last', '마지막 O요일',      '분기 마지막 O요일'],
  ['day_n',   'N일',               '분기 N일째'],
  ['day_last','말일',              '분기 마지막 날'],
  ['be_k',    '말일 K일 전',       '분기말 K일 전'],
];
const MONTHSETS = [
  ['all',  '매월',        null],
  ['q1',   '3·6·9·12월',  [3,6,9,12]],
  ['q2',   '1·4·7·10월',  [1,4,7,10]],
  ['half', '6·12월',      [6,12]],
];
const sel = (f, opts, cur) => '<select data-f="'+f+'">'+opts.map(([v,l]) =>
  '<option value="'+v+'"'+(String(cur)===String(v)?' selected':'')+'>'+l+'</option>').join('')+'</select>';
const numSel = (f, from, to, cur, suffix) => '<select data-f="'+f+'">'+
  [...Array(to-from+1)].map((_,x)=>{const v=from+x;
    return '<option value="'+v+'"'+(String(cur)===String(v)?' selected':'')+'>'+v+(suffix||'')+'</option>';}).join('')+'</select>';

function basisKey(r){
  const b = r.basis || 'day', last = +r.n === -1;
  if(b === 'business_day') return last ? 'bd_last' : 'bd_n';
  if(b === 'weekday')      return last ? 'wd_last' : 'wd_n';
  if(b === 'before_end')   return 'be_k';
  if(b === 'before_end_bd')return 'bebd_k';
  return last ? 'day_last' : 'day_n';
}
function monthsKey(r){
  const m = r.months;
  if(!m || m.length === 12) return 'all';
  const hit = MONTHSETS.find(([,,set]) => set && set.length===m.length && set.every(x=>m.includes(x)));
  return hit ? hit[0] : 'custom';
}

/* ══════════ 폼 (추가 / 수정 공용) ══════════ */
function Form(box){
  const F = f => box.querySelector('[data-f="'+f+'"]');
  const self = {kind:'routine', box:box};

  const timeBlock = (t, lead, muted, step) =>
    '<span class="step">'+(step ? '<i class="n">'+step+'</i>' : '')+'언제 알릴까</span>'+
    '<div class="row"><div><label>마감 시각 <i class="opt">(비워도 됨)</i></label>'+
      '<input type="time" step="300" data-f="time" title="직접 입력할 수 있습니다 (5분 단위)" value="'+(t||'')+'"></div>'+
    '<div><label>알림 (분 전)</label><input type="number" class="min5" data-f="lead" min="0" step="5" placeholder="기본값 사용" value="'+(lead!=null?lead:'')+'"></div></div>'+
    '<label class="chk"><input type="checkbox" data-f="muted"'+(muted?' checked':'')+'> 이 항목은 알림 띄우지 않기</label>';

  /* ---------- 마감 ---------- */
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
  }

  /* ---------- 반복 ---------- */
  function renderRoutine(i){
    const r = i.rule_n || {period:'month', basis:'business_day', n:1};
    self.anchor = (i.rule_n && i.rule_n.anchor) || null;   /* 격주의 기준 주는 수정해도 유지 */
    box.innerHTML =
      '<span class="step"><i class="n">1 ·</i>얼마나 자주</span>'+ sel('period', PERIODS, r.period)+
      '<div data-f="detail"></div>'+
      timeBlock(i.time, i.notify_min, i.muted, '3 ·')+
      '<p class="preview" data-f="prev"><b>다음 실행 날짜</b>—</p>';

    const drawDetail = keep => {
      const p = F('period').value, q = (p === 'quarter');
      const rr = keep ? r : {};
      let h = '';
      if(p === 'day'){
        h = '<label class="chk"><input type="checkbox" data-f="biz"'+
            (rr.business_only !== false ? ' checked' : '')+'> 주말·공휴일 제외</label>';
      } else if(p === 'week'){
        h = '<span class="step"><i class="n">2 ·</i>어느 요일 · 주기</span>'+
            '<div class="row"><div class="g15"><div class="wd" data-f="wd">'+
            WD.map((w,x)=> (bizOn() && x>4 && !(rr.weekdays||[]).includes(x)) ? '' :
              '<span data-w="'+x+'"'+((rr.weekdays||[]).includes(x)?' class="on"':'')+'>'+w+'</span>').join('')+
            '</div></div><div>'+sel('iv', [[1,'매주'],[2,'격주'],[3,'3주마다'],[4,'4주마다']], rr.interval||1)+
            '</div></div>';
      } else {
        h = '<span class="step"><i class="n">2 ·</i>어느 날'+(q ? '' : ' · 실행하는 달')+'</span>'+
            '<div class="row"><div class="g15">'+
              sel('basis', BASES.map(([v,ml,ql])=>[v, q?ql:ml]), basisKey(rr))+
            '</div><div data-f="arg"></div>'+
            (q ? '' : '<div class="g11">'+sel('mset', MONTHSETS.map(([v,l])=>[v,l]), monthsKey(rr))+'</div>')+
            '</div>';
      }
      F('detail').innerHTML = h;
      if(p === 'month' || p === 'quarter') drawArg(keep);
      bind();
    };

    const drawArg = keep => {
      const rr = keep ? r : {};
      const k = F('basis').value, q = F('period').value === 'quarter';
      let h = '';
      if(k === 'bd_n')   h = numSel('n', 1, 20, keep&&rr.n>0?rr.n:1, '번째');
      if(k === 'day_n')  h = q ? numSel('n', 1, 92, keep&&rr.n>0?rr.n:1, '일째')
                              : numSel('n', 1, 31, keep&&rr.n>0?rr.n:1, '일');
      if(k === 'be_k' || k === 'bebd_k')
        h = '<div class="unit"><input type="number" data-f="k" min="0" max="'+(q?60:27)+'" value="'+
            (keep&&rr.k!=null?rr.k:3)+'"><span>'+(k==='be_k'?'일':'영업일')+' 전</span></div>';
      if(k === 'wd_n' || k === 'wd_last'){
        h = '<div class="row2">' + (k==='wd_n'
              ? sel('n', [[1,'첫째'],[2,'둘째'],[3,'셋째'],[4,'넷째']], keep&&rr.n>0?rr.n:1) : '')+
            sel('wdsel', WD.map((w,x)=>[x, w+'요일']).filter(([x])=>!(bizOn()&&x>4&&x!=rr.weekday)),
                keep&&rr.weekday!=null?rr.weekday:0)+'</div>';
      }
      F('arg').innerHTML = h;
    };

    const bind = () => {
      box.querySelectorAll('.wd span').forEach(s => s.onclick = () => { s.classList.toggle('on'); preview(); });
      if(F('basis')) F('basis').onchange = () => { drawArg(false); bind(); preview(); };
      box.querySelectorAll('[data-f="detail"] input, [data-f="detail"] select')
         .forEach(el => { if(el.dataset.f !== 'basis') el.onchange = preview; });
      preview();
    };

    /* 미리보기 요청은 늦게 도착할 수 있다. 주기를 빠르게 바꾸면 이전 요청의 답이
       나중 것을 덮어써서 "매주" 를 골랐는데 "매월" 날짜가 보였다. 마지막 요청만 반영한다. */
    let prevSeq = 0;
    const preview = () => {
      const seq = ++prevSeq;
      const rule = self.readRule();
      if(rule.period === 'week' && !rule.weekdays.length){
        F('prev').innerHTML = '<b>다음 실행 날짜</b>요일을 하나 이상 선택하세요'; return;
      }
      const show = html => { if(seq === prevSeq && F('prev')) F('prev').innerHTML = html; };
      api('/api/preview', {rule})
        .then(d => show(d.error
          ? '<b>다음 실행 날짜</b>'+esc(d.error)
          : '<b>'+esc(d.text)+'</b>'+esc(d.dates.join('   ·   '))))
        .catch(e => show('<b>다음 실행 날짜</b>'+esc(e.message)));
    };

    F('period').onchange = () => drawDetail(false);
    drawDetail(true);
  }

  self.render = function(kind, i){
    self.kind = kind;
    /* 종류마다 필요한 높이가 다르다. 자리를 잡아 두는 것은 반복뿐이다
       (주기를 바꿀 때마다 창이 흔들리지 않게). 종류를 바꾸는 것은 누른 사람이
       뜻한 일이므로 창 높이가 따라 변해도 놀라지 않는다. */
    box.dataset.kind = kind;
    i = i || {};
    if(kind === 'floating'){
      box.innerHTML = '<p class="hint">기한 없이 목록에만 남습니다. 나중에 이 창에서 종류를 바꿔 마감을 붙일 수 있습니다.</p>';
    } else if(kind === 'deadline'){
      renderDeadline(i);
    } else {
      renderRoutine(i);
    }
  };

  self.readRule = function(){
    const p = F('period').value, r = {period:p, holiday_shift:'prev'};
    if(p === 'day'){ r.business_only = F('biz').checked; return r; }
    if(p === 'week'){
      r.weekdays = [...box.querySelectorAll('.wd span.on')].map(s=>+s.dataset.w);
      r.interval = +F('iv').value;
      if(self.anchor) r.anchor = self.anchor;
      return r;
    }
    const k = F('basis').value;
    r.basis = {bd_n:'business_day', bd_last:'business_day', wd_n:'weekday', wd_last:'weekday',
               be_k:'before_end', bebd_k:'before_end_bd', day_n:'day', day_last:'day'}[k];
    if(k === 'bd_last' || k === 'wd_last' || k === 'day_last') r.n = -1;
    else if(F('n')) r.n = +F('n').value;
    if(k === 'wd_n' || k === 'wd_last') r.weekday = +F('wdsel').value;
    if(k === 'be_k' || k === 'bebd_k') r.k = +F('k').value;
    if(p === 'month'){
      const ms = (MONTHSETS.find(m => m[0] === F('mset').value) || [])[2];
      if(ms) r.months = ms;
    }
    return r;
  };

  self.read = function(){
    const p = {kind:self.kind};
    if(self.kind === 'floating')
      return Object.assign(p, {due_date:null, due_time:'', rule:null, notify_min:null, muted:false});
    p.due_time = F('time').value || '';
    p.notify_min = F('lead').value === '' ? null : +F('lead').value;
    p.muted = F('muted').checked;
    if(self.kind === 'deadline'){ p.due_date = F('date').value || STATE.today; p.rule = null; }
    else { p.rule = self.readRule(); p.due_date = null; }
    return p;
  };

  self.valid = function(){
    if(self.kind === 'routine'){
      const r = self.readRule();
      if(r.period === 'week' && !r.weekdays.length){ say('요일을 하나 이상 선택하세요'); return false; }
    }
    return true;
  };
  return self;
}

/* ══════════ 새 항목 ══════════ */
const addForm = Form($('#a-body'));
let addKind = 'routine';
$('#add-tabs').onclick = e => {
  const b = e.target.closest('button'); if(!b) return;
  $$('#add-tabs button').forEach(x => x.classList.toggle('on', x === b));
  addKind = b.dataset.k;
  addForm.render(addKind, {});
};
function openAdd(kind, seed){
  $('#a-title').value = ''; $('#a-note').value = '';
  addKind = kind || 'routine';
  $$('#add-tabs button').forEach(x => x.classList.toggle('on', x.dataset.k === addKind));
  addForm.render(addKind, seed || {});
  openM('#m-add');
  setTimeout(() => $('#a-title').focus(), 90);
}
$('#btn-add').onclick = () => openAdd('routine', {});
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
  $('#e-skip').hidden = i.kind !== 'routine';
  $('#m-edit').querySelector('h3').innerHTML = '항목 수정 <i class="opt">'+
    ({deadline:'마감', routine:'반복', floating:'메모'}[i.kind] || '')+'</i>';
  openM('#m-edit');
}
$('#e-save').onclick = () => {
  const title = $('#e-title').value.trim();
  if(!title){ say('이름을 입력하세요'); return $('#e-title').focus(); }
  if(!editForm.valid()) return;
  api('/api/task/'+EDIT.id, Object.assign({title, note:$('#e-note').value.trim()}, editForm.read()))
    .then(() => { closeM('#m-edit'); say('저장됨'); load(); });
};
$('#e-skip').onclick = () => {
  const day = EDIT.next_date || EDIT.date || STATE.today;
  api('/api/task/'+EDIT.id+'/skip', {date:day})
    .then(() => { closeM('#m-edit'); say(fmtDay(day)+' 회차 건너뜀'); load(); });
};
$('#e-del').onclick = () => confirmBox('삭제할까요?',
  '「'+EDIT.title+'」'+(EDIT.kind==='routine' ? ' 반복 일정 전체가 사라집니다. 이번 회차만 빼려면 건너뛰기를 쓰세요.' : ' 항목을 삭제합니다.'),
  () => api('/api/task/'+EDIT.id+'/delete', {}).then(() => { closeAll(); say('삭제됨'); load(); }));

function confirmBox(title, msg, onOk){
  $('#cf-title').textContent = title;
  $('#cf-msg').textContent = msg;
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
   보고 있는 달을 덮을 만큼만 물어본다. */
let RT = {key:null, items:[], busy:null};
const routinesOn = () => !!STATE && STATE.settings.show_routines !== false;

function ensureRoutines(y, m){
  if(!routinesOn()) return;
  const key = y + '-' + m;
  if(RT.key === key || RT.busy === key) return;
  const DAY = 864e5, t0 = dObj(STATE.today);
  const back = Math.max(0, Math.ceil((t0 - new Date(y, m, 1)) / DAY) + 7);
  const ahead = Math.max(0, Math.ceil((new Date(y, m + 1, 0) - t0) / DAY) + 7);
  RT.busy = key;
  api('/api/all?back=' + back + '&ahead=' + ahead).then(d => {
    RT = {key:key, items:(d.items || []).filter(i => i.kind === 'routine' && i.date), busy:null};
    drawCal();
  }).catch(() => { RT.busy = null; });
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
  el.className = 'chip ' + cls + (wk ? ' wk' : '') + (t._rt ? ' rt' : '');
  const d = dObj(t.due_date);
  const head = wk ? d.getDate() + '일(' + WD[(d.getDay() + 6) % 7] + ')' : t.due_time;
  el.innerHTML = (head ? '<span class="h">' + esc(head) + '</span>' : '') +
                 '<span class="n2">' + esc(t.title) + '</span>';
  el.title = fmtDay(t.due_date) + (t.due_time ? ' ' + t.due_time : '') + '  ' + t.title +
             (wk ? String.fromCharCode(10) + '주말 마감이라 앞 영업일 칸에 표시했습니다' : '') +
             (t.note ? String.fromCharCode(10) + t.note : '') +
             (t.done ? String.fromCharCode(10) + '(완료)' : '');
  el.onclick = e => { e.stopPropagation(); openEdit(t._rt ? t : asItem(t)); };
  return el;
}

function dayModal(key, list){
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
    el.innerHTML = '<span class="dot" title="완료"></span>' +
                   '<span class="n">' + esc(t.title) + '</span>' +
                   (t.note ? '<span class="note">' + esc(t.note) + '</span>' : '') +
                   '<span class="w">' + esc(when.trim()) + '</span>';
    el.querySelector('.dot').onclick = e => {
      e.stopPropagation();
      api('/api/task/' + encodeURIComponent(t.id) + '/done', {date: t.due_date, done: !t.done})
        .then(() => api('/api/overview')).then(o => {
          render(o);
          const fresh = deadlines().filter(x => cellDate(x.due_date) === key);
          dayModal(key, fresh.sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) ||
            a.due_date.localeCompare(b.due_date) ||
            (a.due_time || '99:99').localeCompare(b.due_time || '99:99')));
        });
    };
    el.onclick = () => { closeM('#m-day'); openEdit(asItem(t)); };
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
    RT.items.forEach(i => {
      if(i.date.slice(0, 7) !== pm) return;          /* 보고 있는 달만 */
      const k = cellDate(i.date);
      (byDate[k] = byDate[k] || []).push(
        Object.assign({}, i, {due_date:i.date, due_time:i.time, _rt:true}));
    });
  }
  /* 끝난 것은 아래로, 반복은 마감 뒤로. 칸에 세 개까지만 보이므로 순서가
     곧 "무엇을 남길까" 가 된다 - 그 달의 마감이 되풀이되는 일에 밀리면 안 된다. */
  Object.keys(byDate).forEach(k => byDate[k].sort((a, b) =>
    (a.done ? 1 : 0) - (b.done ? 1 : 0) ||
    (a._rt ? 1 : 0) - (b._rt ? 1 : 0) ||
    a.due_date.localeCompare(b.due_date) ||
    (a.due_time || '99:99').localeCompare(b.due_time || '99:99')));

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
        const chips = document.createElement('div');
        chips.className = 'chips';
        list.slice(0, CAL_MAX).forEach(t => chips.appendChild(chipEl(t)));
        cell.appendChild(chips);
        if(list.length > CAL_MAX){
          const more = document.createElement('div');
          more.className = 'more';
          more.textContent = '+' + (list.length - CAL_MAX) + '건 더';
          more.onclick = e => { e.stopPropagation(); dayModal(key, list); };
          cell.appendChild(more);
        }
        /* 마감이 있는 날은 그날 목록을, 빈 날은 추가 창을 연다 */
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
  $$('#views button').forEach(b => b.classList.toggle('on', b.dataset.v === v));
  $('#v-home').hidden = v !== 'home';
  $('#v-cal').hidden = v !== 'cal';
  if(v === 'cal') drawCal();
  else queueFit();
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
  const KN = {deadline:'마감', routine:'반복', floating:'메모'};
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
    const when = kind === 'routine' ? (rt ? rt.rule_text : '반복')
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
$('#btn-settings').onclick = () => openM('#m-settings');
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
  () => { api('/api/quit', {}); setTimeout(() => window.pywebview ? window.pywebview.api.close() : window.close(), 400); });

/* 첫 그림이 오기 전에는 뾈대를 세워 둔다. 빈 화면보다 낫고,
   줄 높이가 같아서 내용이 들어올 때 화면이 튀지 않는다. */
['#today', '#upcoming', '#floating'].forEach(sel => {
  const el = $(sel);
  if(el && !el.children.length)
    el.innerHTML = [58, 42, 50, 36].map(w =>
      '<div class="sk-row"><span class="sk c"></span><span class="sk l" style="width:' + w + '%"></span>' +
      '<span class="sk r"></span></div>').join('');
});
load();
setInterval(load, 45000);
