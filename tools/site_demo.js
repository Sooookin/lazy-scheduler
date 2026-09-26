/* docs/demo/demo.js - 홈페이지의 화면 미리 보기에서 서비스 대신 답한다 (tools/site_demo.py 가 만든다)

   app.js 보다 먼저 읽힌다. 보기 전용이다 (홈페이지가 창 위의 누르기를 막는다).
     1. 읽기 요청(개요 · 달력 회차)에 구워 둔 답을 준다. 바꾸는 요청은 모두 거절한다.
     2. 구워 둔 날짜를 여는 날에 맞춰 옮긴다 (본보기 일정이 언제나 오늘 것이 되게).
     3. 바깥(홈페이지)이 시각과 화면(홈 · 달력)을 정한다. 인자 없는 new Date() 와 개요의
        now 가 그 시각을 따른다. Date.now() 는 그대로 둔다 (움직임은 실제 흐름을 따라야 한다). */
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
  const OCC = move(DATA.occ);

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
  const reply = (body, status) => Promise.resolve(new Response(JSON.stringify(body),
    {status: status || 200, headers: {'Content-Type': 'application/json'}}));
  const realFetch = window.fetch.bind(window);
  window.fetch = (u, opt) => {
    const url = new URL(u, location.href);
    const at = url.pathname.indexOf('/api/');
    if(at < 0) return realFetch(u, opt);
    const p = url.pathname.slice(at), q = url.searchParams;
    if(p === '/api/overview') return reply(Object.assign({}, OV, {now: nowStr(), rev: 'demo'}));
    if(p === '/api/occurrences'){
      const from = q.get('from'), to = q.get('to'), rt = q.get('kind') === 'routine';
      return reply({rev: 'demo', items: OCC.filter(o => o.date >= from && o.date <= to && (!rt || RT.has(o.id)))});
    }
    return reply({error: '미리 보기입니다'}, 403);
  };

  /* ── 바깥(홈페이지)과 ── 시각 · 화면을 받고, 안 보일 때는 쉰다 */
  let raf = 0, want;
  function setMin(m){
    want = m;
    if(raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      MIN = want;
      tickClock();
      load();
    });
  }
  addEventListener('message', e => {
    if(e.origin !== location.origin) return;
    const d = e.data || {};
    if('lsMin' in d) setMin(d.lsMin == null ? null : Math.max(0, Math.min(1439, Math.round(d.lsMin))));
    if(d.lsView === 'home' || d.lsView === 'cal') setView(d.lsView);
    if('lsAway' in d){ if(d.lsAway) setHidden(true); else wake(); }
  });
})();
