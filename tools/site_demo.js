/* docs/demo/demo.js - 홈페이지 체험판에서 서비스 대신 답한다 (tools/site_demo.py 가 만든다)

   app.js 보다 먼저 읽힌다. 하는 일은 셋이다.
     1. /api/* 요청을 가로채 구워 둔 답을 준다. 완료 · 건너뛰기 · 삭제 · 설정은 이 자리에서만
        바꾸고, 새로 만들기 · 고치기는 "체험판에서는 저장하지 않습니다" 로 거절한다.
     2. 구워 둔 날짜를 여는 날에 맞춰 옮긴다 (본보기 일정이 언제나 오늘 것이 되게).
     3. 시각을 바깥(홈페이지의 막대)이 정할 수 있게 한다 - 인자 없는 new Date() 와
        개요의 now 가 그 시각을 따른다. Date.now() 는 그대로 둔다 (움직임 · 돌멩이의
        쉰 시간 셈은 실제 흐름을 따라야 한다). */
(() => {
  const DATA = /*DATA*/null;
  const RealDate = Date;
  const pad = n => String(n).padStart(2, '0');
  const iso = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());

  /* 날짜 옮기기: 구운 날(base) → 오늘. 요일이 어긋나는 반복 회차가 생길 수 있지만 본보기다.
     공휴일은 옮기면 엉뚱한 날이 빨개지므로 뺀다. */
  const t = new RealDate(), today = new RealDate(t.getFullYear(), t.getMonth(), t.getDate());
  const SHIFT = Math.round((today - new RealDate(DATA.base + 'T00:00:00')) / 864e5);
  const move = o => JSON.parse(JSON.stringify(o).replace(/\d{4}-\d{2}-\d{2}/g, s => {
    const d = new RealDate(s + 'T00:00:00');
    d.setDate(d.getDate() + SHIFT);
    return iso(d);
  }));
  const OV = move(DATA.overview);
  OV.holidays = []; OV.holiday_names = {};
  OV.is_business_day = today.getDay() % 6 !== 0;
  const RT = new Set(OV.tasks.filter(x => x.kind === 'routine').map(x => x.id));
  const OCC = {all: move(DATA.occ)};
  OCC.routine = OCC.all.filter(o => RT.has(o.id));
  let VER = 0;

  /* ── 시각 ── null 이면 실제 시각 */
  let MIN = null;
  class DemoDate extends RealDate {
    constructor(...a){
      if(a.length || MIN == null){ super(...a); return; }
      const n = new RealDate();
      n.setHours(Math.floor(MIN / 60), MIN % 60, 0, 0);
      super(n.getTime());
    }
    static now(){ return RealDate.now(); }
  }
  window.Date = DemoDate;
  const nowStr = () => { const d = new DemoDate(); return pad(d.getHours()) + ':' + pad(d.getMinutes()); };

  /* ── 답 ── */
  const ov = () => Object.assign({}, OV, {now: nowStr(), rev: 'demo-' + VER});
  const reply = (body, status) => Promise.resolve(new Response(JSON.stringify(body),
    {status: status || 200, headers: {'Content-Type': 'application/json'}}));
  const NO = '체험판에서는 저장하지 않습니다. 앱을 내려받아 써 보세요.';
  const LISTS = ['overdue', 'todays', 'upcoming', 'routines', 'floating'];
  const each = f => LISTS.forEach(k => OV[k] = OV[k].filter(i => f(i) !== false));
  const stats = () => {
    const all = OV.todays;
    const done = all.filter(i => i.done).length;
    OV.stats = {left: all.length - done, done, total: all.length};
    VER++;
  };
  const SKIPPED = new Map();            /* 'id|날짜' → 뺀 항목들 (되돌리기용) */

  function task(id, act, b){
    const same = i => i.id === id && (!b.date || !i.date || i.date === b.date);
    if(act === 'done'){
      each(i => { if(same(i)) i.done = !!b.done; });
      OV.tasks.forEach(x => { if(x.id === id && x.kind === 'deadline') x.done = !!b.done; });
      [OCC.all, OCC.routine].forEach(l => l.forEach(o => { if(o.id === id && o.date === b.date) o.done = !!b.done; }));
    } else if(act === 'delete'){
      each(i => i.id !== id);
      OV.tasks = OV.tasks.filter(x => x.id !== id);
      OCC.all = OCC.all.filter(o => o.id !== id);
      OCC.routine = OCC.routine.filter(o => o.id !== id);
    } else if(act === 'skip'){
      const out = [];
      LISTS.forEach(k => OV[k] = OV[k].filter(i => { if(same(i)){ out.push([k, i]); return false; } return true; }));
      SKIPPED.set(id + '|' + b.date, out);
    } else if(act === 'unskip'){
      (SKIPPED.get(id + '|' + b.date) || []).forEach(([k, i]) => OV[k].push(i));
      SKIPPED.delete(id + '|' + b.date);
      OV.todays.sort((a, c) => (a.time || '99') < (c.time || '99') ? -1 : 1);
    } else return reply({error: NO}, 403);
    stats();
    return reply({ok: true, overview: ov()});
  }

  const realFetch = window.fetch.bind(window);
  window.fetch = (u, opt) => {
    const url = new URL(u, location.href);
    if(!url.pathname.startsWith('/api/') && !url.pathname.includes('/api/')) return realFetch(u, opt);
    const p = url.pathname.slice(url.pathname.indexOf('/api/'));
    const q = url.searchParams;
    const b = opt && opt.body ? JSON.parse(opt.body) : {};
    if(p === '/api/overview') return reply(ov());
    if(p === '/api/sync') return reply(DATA.sync);
    if(p === '/api/occurrences'){
      const from = q.get('from'), to = q.get('to');
      const items = (q.get('kind') === 'routine' ? OCC.routine : OCC.all)
        .filter(o => o.date >= from && o.date <= to);
      return reply({rev: 'demo-' + VER, items});
    }
    if(p === '/api/settings' && opt && opt.method === 'POST'){
      Object.assign(OV.settings, b); VER++;
      return reply({ok: true, overview: ov()});
    }
    if(p === '/api/hidden' || p === '/api/open') return reply({ok: true});
    const m = /^\/api\/task\/([^/]+)\/([a-z]+)$/.exec(p);
    if(m) return task(decodeURIComponent(m[1]), m[2], b);
    return reply({error: NO}, 403);
  };

  /* ── 바깥(홈페이지)과 ── 시각을 받고, 안 보일 때는 쉰다 */
  let raf = 0, want;
  function setMin(m){
    want = m;
    if(raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      MIN = want;
      if(typeof tickClock === 'function') tickClock();
      if(typeof load === 'function') load();
    });
  }
  addEventListener('message', e => {
    const d = e.data || {};
    if('lsMin' in d) setMin(d.lsMin == null ? null : Math.max(0, Math.min(1439, Math.round(d.lsMin))));
    if('lsAway' in d && typeof setHidden === 'function'){
      if(d.lsAway) setHidden(true); else wake();
    }
  });
})();
