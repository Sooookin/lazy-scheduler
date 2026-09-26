/* ══════════════════════════════════════════════════════════════════
   돌멩이 - 하늘의 게으름뱅이가 무엇을 언제 하는지
   참고 도안: design/references/LS 돌멩이 행동.dc.html

   원칙은 하나 - 돌은 게으르다. 평소엔 거의 안 움직이고 눈만 굴린다. 움직여야 할 땐
   짧은 거리는 총총 뛰어가고(scoot) 먼 거리는 굴러간다. 미끄러지지 않는다 - 돌은
   미끄러지지 않으니까. 굴러가는 건 진짜 급할 때 · 진짜 기쁠 때 · 잠자리로 갈 때뿐.
   모든 동작은 실제 상태(시각 · 완료 · 커서 · 비활성)에서만 나온다.

   살아 있음  시계가 아니라 주사위 - 5~13초 사이 무작위로, 가중 추첨한 행동 하나.
              같은 행동은 연달아 하지 않는다. 눈은 2.5~6초마다 40% 는 해, 60% 는 아무 데나.
   자리       잠자리 셋(일몰 자리 · 왼쪽 구석 · 가운데) 가운데 어제 잔 곳은 피한다.
              켤 때마다 평상시 자리도 ±60px 다르다.
   이동       예비 동작 220ms (가는 반대쪽으로 7° 기울고 가는 쪽을 본다) → 110px 미만은
              340ms 짜리 작은 점프 2~4번, 그 이상은 실제 둘레(r 17)로 도는 굴림 → 도착하면
              0.5초 흔들리며 자리 잡음. 움직이기 전에는 80% 의 확률로 한숨.

   순간 → 행동 (위에 있는 것이 먼저)
     밤 (해가 졌거나 · 오늘 일을 다 마침)   잠자리로 가서 파자마 모자 쓰고 잔다. 커서를 보지 않는다.
                                            막 다 마친 순간이면 팔짝 → 기쁜 눈으로 굴러가서 눕는다.
     새 항목 시각을 고르는 중                점선 구슬 아래로 가서 ? 하나 이고 올려다본다. 따라간다.
     다음 업무 10분 전                      한숨 → 굴러가 → 헐떡이며 올려다본다 (게으른 애가 굴렀다 = 진짜).
     업무가 지남                            구슬에서 살짝 떨어져 점 눈으로 반대쪽을 보며 ♪. 한 번만.
     입력 5분 없음 / 15분 없음              기지개나 하품 한 번 / 그 자리(또는 두세 걸음 옆)에서 낮잠.
     평상시                                눈이 커서를 따라온다. 너무 가까우면 실눈 뜨고 물러선다.
   반응: 누르면 움찔(!) → 2초 삐침(점 눈) · 자는데 누르면 한쪽 눈만 뜬다 · 낮잠 중 입력이
         오면 화들짝 · 완료하면 팔짝(6초 안에 또 완료하면 너무 신나서 한 바퀴 뒤집힘).

   지킬 것 - 과업을 막지 않는다(이동은 비차단, 한 번짜리 동작은 짧다). 지난 업무를 놀리지
   않는다(눈치 한 번, 반복 없음). 설정에서 끌 수 있다('돌멩이 움직임'). 움직임 줄이기를
   켜면 잠 · 팔짝 · 굴림이 모두 즉시 상태 교체가 된다.

   가볍게 - 끝없이 도는 CSS 애니메이션은 쓰지 않는다 (창 전체를 초당 60번 다시 합성해
   CPU 를 늘 붙잡는다). 숨 쉬기는 1초에 3~6번만 옮기고, z 는 입력 뒤 3분 동안만 돌며,
   나머지는 한 번 돌고 끝난다.
   창이 숨어 있으면 주사위도 숨도 멈춘다.
   ══════════════════════════════════════════════════════════════════ */
window.PB = (() => {
  const guy = $('#guy');
  if(!guy) return null;
  const E = {
    lean: guy.querySelector('.pb-lean'), sq: guy.querySelector('.pb-sq'), roll: guy.querySelector('.pb-roll'),
    eyes: guy.querySelector('.gy-e'), prop: guy.querySelector('.pb-prop'), fx: guy.querySelector('.pb-fx'),
  };
  const art = () => $('#sky-art');

  /* ── 주사위. 갈무리(tools/shots.py) 중에는 늘 가운데 값 - 같은 그림이 나와야 한다 ── */
  const frozen = () => SHOT_MIN != null;
  const rnd = (a, b) => frozen() ? (a + b) / 2 : a + Math.random() * (b - a);
  const chance = p => !frozen() && Math.random() < p;
  const off = () => document.body.classList.contains('guy-still');
  const nowMin = () => SHOT_MIN != null ? SHOT_MIN : (d => d.getHours() * 60 + d.getMinutes())(new Date());

  /* ── 상태. 자리 x 는 도안의 자(900 폭) 단위다 - 창 폭이 바뀌어도 같은 자리에 있다 ── */
  const S = {
    x: 470 + rnd(-60, 60), rot: 0, lean: 0, gaze: null, mode: 'idle', move: null, moveDir: 0,
    lookUp: false, cursor: null, ptr: null, anim: null, sulk: false, peek: false, away: null, dir: 0,
    drag: false, lift: 0, swing: 0,               /* 손에 들림 · 땅에서 뜬 높이(px) · 흔들림(°) */
  };
  let G = null;                                   /* 무대: {k, onArc, set, dir} (drawSky) */
  let lastAct = null, lastInput = Date.now(), yawned = false, lastDone = 0;
  let nextSeen = null, wasAll = null, justAll = false, busyEnd = null;
  const HZ_Y = SKY_HZ;                            /* 땅에 닿는 자리 (하늘 그림 좌표) */
  const clampX = x => Math.max(170, Math.min(740, x));
  const beadX = m => G ? G.onArc(m).x / G.k : 470;
  const asleep = () => S.mode === 'sleep' || S.mode === 'nap';
  /* 밤이어도 곁에서 일하는 동안은 깨어 있다: 추가 · 수정 창, 시각 고르기, 되돌리기 띠가
     떠 있는 동안, 그리고 그것이 닫힌 뒤 6초. 고깔은 쓴 채로 평소처럼 움직인다. */
  const WORK_LINGER = 6000;
  let lastWork = 0, wasWork = false;
  const workingNow = () => !!document.querySelector('.modal.on, #undo.on') || (typeof PEEK !== 'undefined' && PEEK != null);
  const busy = () => !!(S.move || S.anim || S.drag);
  let homing = false;                             /* '돌멩이 움직임' 을 끈 순간 가운데로 가는 중 */

  /* 어제 잔 곳 · 이미 못 본 척한 지난 업무는 창을 다시 열어도 기억한다 (이 PC 에서만) */
  const mem = (k, v) => {
    try{
      if(v === undefined) return JSON.parse(localStorage.getItem('ls-pebble-' + k) || 'null');
      localStorage.setItem('ls-pebble-' + k, JSON.stringify(v));
    }catch(e){ return null; }
  };

  /* ── 한 번짜리 동작 (참고 도안의 키프레임 그대로) ── */
  const KF = {
    hop:     [['translateY(0) scale(1,1)', 0], ['translateY(2px) scale(1.15,.8)', .18], ['translateY(-26px) scale(.9,1.14)', .45],
              ['translateY(0) scale(1.1,.86)', .7], ['translateY(-6px) scale(.98,1.04)', .85], ['translateY(0) scale(1,1)', 1]],
    squash:  [['scale(1,1)', 0], ['scale(1.28,.68)', .3], ['scale(.92,1.1)', .6], ['scale(1,1)', 1]],
    stretch: [['scale(1,1)', 0], ['scale(.9,1.32)', .35], ['scale(.9,1.28)', .6], ['scale(1,1)', 1]],
    yawn:    [['scale(1,1)', 0], ['scale(1.1,1.12)', .4], ['scale(1.1,1.12)', .7], ['scale(1,1)', 1]],
    wobble:  [['rotate(0deg)', 0], ['rotate(-9deg)', .25], ['rotate(6deg)', .55], ['rotate(-3deg)', .8], ['rotate(0deg)', 1]],
    sigh:    [['scale(1,1)', 0], ['scale(1,1.06)', .3], ['scale(1.06,.86)', .55], ['scale(1.06,.86)', .8], ['scale(1,1)', 1]],
    pant:    [['scale(1,1)', 0], ['scale(1.06,.94)', .5], ['scale(1,1)', 1]],
    topple:  [['rotate(0deg) translateY(0)', 0], ['rotate(-180deg) translateY(-12px)', .3], ['rotate(-180deg) translateY(-2px)', .55],
              ['rotate(-196deg) translateY(-2px)', .7], ['rotate(-360deg) translateY(0)', 1]],
    fidget:  [['scale(1,1) rotate(0deg)', 0], ['scale(1.05,.95) rotate(-3deg)', .3], ['scale(.97,1.03) rotate(3deg)', .65], ['scale(1,1) rotate(0deg)', 1]],
    rollbob: [['translateY(0) scale(1,1)', 0], ['translateY(-2.5px) scale(.97,1.03)', .5], ['translateY(0) scale(1,1)', 1]],
    scoot:   [['translateY(0) scale(1,1)', 0], ['translateY(1px) scale(1.12,.86)', .2], ['translateY(-9px) scale(.94,1.08)', .55],
              ['translateY(0) scale(1.06,.94)', .85], ['translateY(0) scale(1,1)', 1]],
  };
  const EASE_OF = {hop: 'cubic-bezier(.3,.7,.3,1)', squash: 'ease-out', wobble: 'ease-out', topple: 'cubic-bezier(.4,.2,.3,1)',
                   scoot: 'cubic-bezier(.35,.6,.4,1)'};
  const frames = n => KF[n].map(([t, o]) => ({transform: t, offset: o}));
  const TIMERS = new Set();
  const later = (f, ms) => { const t = setTimeout(() => { TIMERS.delete(t); f(); }, ms); TIMERS.add(t); return t; };

  /* 동작 하나를 한 번 튼다. 끝나면 after, 그리고 미뤄 둔 판단(think)을 다시 한다 */
  function play(name, ms, after, times){
    S.anim = name;
    paint();
    if(!calm()){
      E.sq.style.transformOrigin = name === 'topple' ? '50% 60%' : '50% 100%';
      E.sq.animate(frames(name), {duration: ms / (times || 1), iterations: times || 1, easing: EASE_OF[name] || 'ease-in-out'});
    }
    later(() => {
      if(S.anim === name) S.anim = null;
      E.sq.style.transformOrigin = '50% 100%';
      paint();
      if(after) after();
      settle();
    }, calm() ? 0 : ms);
  }

  /* ── 이동: 예비 동작 → 총총 또는 굴림 → 자리 잡음. 막지 않는다(비차단) ── */
  const at = (x, lift) => 'translate(' + (x * G.k - 20).toFixed(1) + 'px,' + (-(lift || 0)).toFixed(1) + 'px)';
  function place(){
    if(!G || S.move === 'scoot' || S.move === 'roll' || S.move === 'fall') return;
    guy.style.transform = at(S.x, S.lift);
    shade(S.lift);
  }
  /* 발밑 그림자는 땅에 남는다 - 높이 들수록 작고 옅어진다 */
  function shade(lift){
    guy.style.setProperty('--lift', lift.toFixed(1) + 'px');
    guy.style.setProperty('--ls', Math.max(.35, 1 - lift / 160).toFixed(3));
  }
  function moveTo(x, kind, after){
    const dx = x - S.x, dist = Math.abs(dx);
    if(!G || dist < 4 || (off() && !homing)){ if(after) after(); settle(); return; }
    if(kind === 'auto') kind = dist < 110 ? 'scoot' : 'roll';
    const sgn = dx > 0 ? 1 : -1;
    if(calm()){ S.x = x; place(); paint(); if(after) after(); settle(); return; }
    /* 예비 동작: 가려는 반대쪽으로 7° 기울어 몸을 일으키고, 가는 쪽을 본다 */
    S.move = 'prep'; S.moveDir = sgn; S.lean = -sgn * 7;
    paint();
    later(() => travel(x, kind, sgn, dist, after), 220);
  }
  function travel(x, kind, sgn, dist, after){
    const k = G.k, x0 = S.x * k - 20, x1 = x * k - 20;
    S.x = x; S.lean = 0;
    dust(x0 + 20, -sgn);
    const done = () => {
      guy.style.transform = 'translateX(' + x1.toFixed(1) + 'px)';
      S.move = null;
      paint();
    };
    if(kind === 'roll'){
      /* 굴림 = 회전 + 들썩. 회전각은 실제 둘레(r 17)로 - 눈도 같이 돈다. 가속 → 감속 */
      /* 바퀴 수는 정수로 맞춘다 - 둘레대로 1.37 바퀴를 돌면 눈이 비스듬히 누운 채로 멈췄다.
         거리와 한 바퀴 안쪽의 차이는 눈에 띄지 않고, 도착하면 늘 똑바로 선다. */
      const raw = (x1 - x0) / (2 * Math.PI * 17);
      const dur = Math.min(1600, 420 + dist * 1.7), turns = Math.sign(raw) * Math.max(1, Math.round(Math.abs(raw)));
      const per = Math.max(120, dur / Math.max(1, Math.abs(turns)));
      const r0 = S.rot; S.rot = r0 + turns * 360;
      S.move = 'roll'; paint();
      guy.animate([{transform: 'translateX(' + x0.toFixed(1) + 'px)'}, {transform: 'translateX(' + x1.toFixed(1) + 'px)'}],
                  {duration: dur, easing: 'cubic-bezier(.4,0,.25,1)', fill: 'forwards'}).finished.then(a => { done(); a.cancel(); }, () => {});
      E.roll.animate([{transform: 'rotate(' + r0 + 'deg)'}, {transform: 'rotate(' + S.rot + 'deg)'}],
                     {duration: dur, easing: 'cubic-bezier(.25,.6,.3,1)'});
      S.rot = 0;                                   /* 정수 바퀴 - 끝나면 똑바로 */
      E.sq.animate(frames('rollbob'), {duration: per, iterations: dur / per, easing: 'ease-in-out'});
      later(() => play('wobble', 500, after), dur + 20);
    } else {
      /* 총총 = 2~4 번 뛰기. 눌렸다 튀어오르며 한 칸씩 - 공중에 있을 때만 앞으로 간다 */
      const hops = Math.max(2, Math.min(4, Math.round(dist / 32))), per = 340;
      const kf = [];
      for(let i = 0; i < hops; i++){
        const a = x0 + (x1 - x0) * i / hops, b = x0 + (x1 - x0) * (i + 1) / hops;
        kf.push({transform: 'translateX(' + a.toFixed(1) + 'px)', offset: i / hops},
                {transform: 'translateX(' + a.toFixed(1) + 'px)', offset: (i + .2) / hops},
                {transform: 'translateX(' + b.toFixed(1) + 'px)', offset: (i + .85) / hops});
      }
      kf.push({transform: 'translateX(' + x1.toFixed(1) + 'px)', offset: 1});
      S.move = 'scoot'; paint();
      guy.animate(kf, {duration: hops * per, fill: 'forwards'}).finished.then(a => { done(); a.cancel(); }, () => {});
      E.sq.animate(frames('scoot'), {duration: per, iterations: hops, easing: EASE_OF.scoot});
      later(() => { if(after) after(); settle(); }, hops * per + 20);
    }
  }
  /* 게으르니까 - 움직이기 전에 대개(80%) 한 번 푹 꺼진다. 가끔은 한숨 없이 바로 간다 */
  function go(x, kind, after){
    if((off() && !homing) || !G || Math.abs(x - S.x) < 4){ if(after) after(); settle(); return; }
    if(chance(.8)) play('sigh', 700, () => moveTo(x, kind, after));
    else moveTo(x, kind, after);
  }
  function dust(px, dir){
    const a = art();
    if(!a || calm()) return;
    const d = document.createElement('i');
    d.className = 'pb-dust';
    d.style.left = (px - 8).toFixed(0) + 'px';
    d.style.top = (HZ_Y - 8) + 'px';
    d.style.setProperty('--dx', (dir * 14) + 'px');
    d.addEventListener('animationend', () => d.remove());
    a.appendChild(d);
  }

  /* ── 자리. 잠자리는 어제와 60px 넘게 떨어진 곳 · 낮잠은 그 자리 또는 두세 걸음 옆 ── */
  function spot(kind){
    const c = kind === 'sleep'
      ? [beadX(G ? G.set : 1100) + rnd(10, 50), 190 + rnd(0, 50), 430 + rnd(0, 90)]
      : [S.x, clampX(S.x + (chance(.5) ? -1 : 1) * rnd(30, 60))];
    const last = kind === 'sleep' ? mem('bed') : null;
    const ok = c.filter(x => last == null || Math.abs(x - last) > 60);
    const x = clampX(frozen() ? c[0] : (ok.length ? ok : c)[Math.floor(Math.random() * (ok.length || c.length))]);
    if(kind === 'sleep') mem('bed', x);
    return x;
  }

  /* ── 겉모습: 상태 → 눈 모양 · 소품 · 보는 쪽 · 기울기 ── */
  let shownProp = null;
  function look(){
    let gx = S.dir, gy = -.6;                              /* 평소에는 해를 본다 */
    if(S.gaze){ gx = S.gaze.x; gy = S.gaze.y; }
    if(S.move){ gx = S.moveDir || gx; gy = -.2; }          /* 가는 쪽을 본다 */
    if(S.lookUp){ gx = 0; gy = -1; }
    let near = false;
    /* 눈은 창 어디에 있는 커서든 따라간다 (ptr). 하늘 안에 있을 때(cursor)만 가까우면 실눈을 뜨고,
       다른 행동(딴짓 멈춤 · 몸 기울기)도 하늘 안의 커서에만 반응한다 - 목록을 쓰는 동안 돌이 매번
       멈춰 서면 하늘이 죽는다. */
    const pt = S.cursor || (!S.move && !S.lookUp ? S.ptr : null);   /* 가는 중 · 올려다보는 중에는 하던 쪽을 본다 */
    if(pt && !asleep() && G){
      const dx = pt.x - S.x * G.k, dy = pt.y - (HZ_Y - 16), L = Math.hypot(dx, dy) || 1;
      gx = dx / L; gy = dy / L; near = !!S.cursor && L < 46;
    }
    if(S.sulk){ gx = -S.dir || .8; gy = .2; }              /* 등을 돌렸다 */
    if(S.drag){ gx = -S.swing / 30; gy = .8; near = false; }   /* 들렸다 - 발밑(땅)을 내려다본다 */
    if(S.away != null){ gx = S.away > S.x ? -1 : 1; gy = -.3; }
    return {gx, gy, near};
  }
  function paint(){
    const {gx, gy, near} = look(), sl = asleep(), a = S.anim;
    let shape = 'round', prop = null;
    if(S.drag) shape = S.mode === 'sleep' ? 'peek' : 'wide';
    else if(a === 'hop' || a === 'topple') shape = a === 'topple' ? 'wide' : 'happy';
    else if(a === 'squash'){ shape = 'wide'; prop = 'bang'; }
    else if(S.sulk) shape = 'dot';
    else if(a === 'sigh' || a === 'yawn'){ shape = 'closed'; prop = 'puff'; }
    else if(a === 'stretch') shape = 'happy';
    else if(a === 'pant'){ shape = 'wide'; prop = 'sweat'; }
    else if(S.away != null) shape = 'dot';
    else if(sl){ shape = S.peek ? 'peek' : 'closed'; prop = S.mode === 'nap' ? 'leaf' : 'cap'; }
    if(!sl && S.night && !prop && !S.drag) prop = 'cap';   /* 밤에 깨어 있으면 고깔은 쓴 채로 */
    else if(S.mode === 'all') shape = 'happy';
    else if(near) shape = 'squint';
    else if(S.lookUp){ shape = 'roundBig'; prop = S.mode === 'ghost' ? 'q' : null; }
    if(E.eyes.dataset.s !== shape) E.eyes.dataset.s = shape;
    guy.style.setProperty('--lx', gx.toFixed(2));
    guy.style.setProperty('--ly', gy.toFixed(2));
    const tilt = S.drag ? S.swing : (S.move === 'scoot' ? S.moveDir * 6 : near && !sl ? (gx > 0 ? -6 : 6) : S.sulk ? (S.dir > 0 ? 6 : -6) : 0) + S.lean;
    E.lean.style.transform = 'rotate(' + tilt.toFixed(1) + 'deg)' + (sl && !S.drag ? ' rotate(-8deg) translateY(2px)' : '');
    if(prop !== shownProp){ shownProp = prop; E.prop.innerHTML = PROP[prop] ? PROP[prop]() : ''; }
    zzz(sl && !S.peek && !S.drag);
  }
  const side = (l, r) => (S.dir > 0 ? l : r) + 'px';
  const PROP = {
    cap:   () => '<span class="pb-cap" style="transform:rotate(' + (S.dir > 0 ? -14 : 14) + 'deg)"><b></b><u></u><i></i></span>',
    leaf:  () => '<svg class="pb-leaf" width="16" height="10" viewBox="0 0 16 10"><path d="M1 9 Q4 0 15 1 Q12 9 1 9Z" fill="var(--pb-leaf)"/>' +
                 '<path d="M1 9 Q8 5 15 1" fill="none" stroke="var(--pb-vein)" stroke-width=".8"/></svg>',
    sweat: () => '<span class="pb-sweat" style="left:' + side(-4, 36) + '"></span>',
    puff:  () => '<span class="pb-puff" style="left:' + side(-8, 38) + '"></span>',
    bang:  () => '<span class="pb-bang">!</span>',
    q:     () => '<span class="pb-q">?</span>',
  };
  /* 잠의 z 세 개 - 떠올랐다 사라지기를 되풀이한다.
     예전에는 숨 쉬기와 같은 느린 박자(1초에 6번)로 옮겼더니 눈에 띄게 뚝뚝 끊겼다. 이제는
     Web Animations(transform · opacity 만)라 합성기가 화면 주사율대로 매끄럽게 돌린다.
     다만 끝없이 돌리지는 않는다 - 마지막 입력 뒤 3분 동안만 돌고, 그 뒤로는 z 가 한 바퀴를
     마저 떠오르고 멈춘다(깊이 잠든 셈). 창이 숨으면 rest() 가 끝내고, 입력이 오면 다시 돈다.
     바퀴의 자리는 시계에서 읽으므로 다시 켜도 z 가 튀지 않는다. */
  const Z_P = 2800, Z_FOR = 180000;
  const Z_KF = [{opacity: 0, transform: 'translate(0,0) scale(.6)'},
                {opacity: 1, transform: 'translate(3.5px,-6.5px) scale(.73)', offset: .25},
                {opacity: 0, transform: 'translate(14px,-26px) scale(1.1)'}];
  let Z = null, zEnd = 0;
  function zzz(on){
    if(on && !Z){
      Z = [0, 1, 2].map(i => {
        const z = document.createElement('span');
        z.className = 'pb-z'; z.textContent = 'z';
        z.style.left = (30 + i * 4) + 'px'; z.style.top = (2 - i * 6) + 'px';
        z.style.fontSize = (9 + i * 1.5) + 'px';
        E.fx.appendChild(z);
        return z;
      });
      zEnd = 0;
    } else if(!on && Z){ Z.forEach(z => z.remove()); Z = null; }
    if(Z) zRun();
  }
  function zRun(force){
    if(!Z || calm() || frozen() || !onScreen()) return;
    const left = Z_FOR - (Date.now() - lastInput);
    if(left <= 0) return;
    const on = Z[0]._a && Z[0]._a.playState === 'running';
    if(on && !force) return;
    if(on && Date.now() < zEnd - 60000) return;         /* 아직 넉넉하면 그대로 (마우스를 움직일 때마다 다시 걸지 않는다) */
    const n = Math.ceil(left / Z_P) + 1, t = performance.now();
    Z.forEach((z, i) => {
      if(z._a) z._a.cancel();
      z._a = z.animate(Z_KF, {duration: Z_P, iterations: n, delay: -((t + i * 900) % Z_P), easing: 'linear'});
    });
    zEnd = Date.now() + n * Z_P;
  }
  function sparks(){
    if(calm()) return;
    [[-14, -22], [16, -24], [-20, -6], [22, -8], [0, -30]].forEach((p, i) => {
      const s = document.createElement('span');
      s.className = 'pb-spark';
      s.style.setProperty('--sx', p[0] + 'px'); s.style.setProperty('--sy', p[1] + 'px');
      s.style.animationDelay = (i * .04) + 's';
      s.addEventListener('animationend', () => s.remove());
      E.fx.appendChild(s);
    });
  }
  function note(){
    if(calm()) return;
    const n = document.createElement('span');
    n.className = 'pb-note'; n.textContent = '♪';
    n.addEventListener('animationend', () => n.remove());
    E.fx.appendChild(n);
  }

  /* ── 느린 박자: 숨 쉬기(깨어 5초 · 잠 3.2초에 한 번) ──
     숨은 5초에 1.3px 남짓 부푸는 것이라 1초에 3번이면 눈에는 매끄럽다. 잠의 숨은 더
     깊어서 밤에만 6번으로 올린다 (재 보니 6번으로 늘 돌면 그것만으로 CPU 2~3% 였다).
     한 번짜리 동작(Web Animations)은 이 값 위에 덮여 돌므로 서로 부딪치지 않는다. */
  const TICK = () => 1000 / (Z ? 6 : 3);
  (function tick(){
    if(onScreen() && !calm() && !frozen() && !S.drag){
      const t = performance.now() / 1000, sl = asleep();
      const P = sl ? 3.2 : 5, A = sl ? [.06, .07] : [.04, .04];
      const u = (1 - Math.cos(2 * Math.PI * t / P)) / 2;
      E.sq.style.transform = 'scale(' + (1 + A[0] * u).toFixed(3) + ',' + (1 - A[1] * u).toFixed(3) + ')';
    } else if(Z && frozen()) Z.forEach((z, i) => { z.style.opacity = i === 1 ? '1' : '.6'; });
    setTimeout(tick, TICK());
  })();

  /* 깜빡임 - 3~6초에 한 번, 가끔은 두 번 연달아. 뜬 눈(동그라미)일 때만 */
  (function blink(){
    const s = E.eyes.dataset.s;
    if(onScreen() && !calm() && (s === 'round' || s === 'roundBig')){
      replay(E.eyes, 'blink');
      if(chance(.18)) later(() => replay(E.eyes, 'blink'), 360);
    }
    setTimeout(blink, rnd(3000, 6000));
  })();

  /* ── 살아 있음: 4~9초마다 행동 하나 (같은 것은 연달아 하지 않는다) ──
     처음에는 도안대로 5~13초였는데, 창 옆에 두고 보니 너무 가만히 있었다. 절반 가까이가
     자리를 옮기는 일이다 - 두세 걸음 총총, 가끔은 조금 멀리까지 총총(여전히 구르지는
     않는다: 구르는 건 급할 때 · 기쁠 때 · 잠자리로 갈 때뿐). */
  (function idle(){
    setTimeout(() => { idleAct(); idle(); }, rnd(4000, 9000));
  })();
  function idleAct(){
    if(!onScreen() || frozen() || off() || S.mode !== 'idle' || busy() || S.cursor || S.sulk) return;
    const acts = ['shift', 'shift', 'fidget', 'yawn', 'stretch', 'sigh', 'shuffle', 'shuffle', 'shuffle', 'wander', 'wander',
                  'lookaround'].filter(a => a !== lastAct);
    const a = acts[Math.floor(Math.random() * acts.length)];
    lastAct = a;
    if(a === 'shift'){                                     /* 무게 옮기기 - 살짝 기울었다가 */
      S.lean = (chance(.5) ? -1 : 1) * rnd(2, 4); paint();
      later(() => { S.lean = 0; paint(); }, rnd(2500, 5000));
    } else if(a === 'fidget') play('fidget', 380);
    else if(a === 'lookaround'){
      const g = {x: rnd(-1, 1), y: rnd(-.9, -.1)};
      S.gaze = g; paint();
      later(() => { S.gaze = {x: -g.x, y: rnd(-.9, -.1)}; paint(); }, 900);
      later(() => { S.gaze = null; paint(); }, 2000);
    } else if(a === 'shuffle'){                            /* 두세 걸음 옆으로 총총 */
      const x = clampX(S.x + (chance(.5) ? -1 : 1) * rnd(24, 70));
      if(chance(.5)) moveTo(x, 'scoot'); else go(x, 'scoot');
    } else if(a === 'wander'){                             /* 조금 멀리 - 갈 곳은 넓은 쪽으로 */
      const room = S.x - 170 > 740 - S.x ? -1 : 1, x = clampX(S.x + (chance(.25) ? -room : room) * rnd(70, 105));
      go(x, 'scoot');
    } else play(a, a === 'sigh' ? 700 : 1400);
  }
  /* 눈이 해만 보지 않는다 - 2.5~6초마다 40% 는 해, 60% 는 아무 데나 */
  (function gaze(){
    setTimeout(() => {
      if(onScreen() && !frozen() && !S.cursor && !S.lookUp && S.away == null && !asleep() && !S.anim){
        S.gaze = Math.random() < .4 ? null : {x: rnd(-1, 1), y: rnd(-1, .1)};
        paint();
      }
      gaze();
    }, rnd(2500, 6000));
  })();

  /* ── 신호 → 판단. 바쁘면(이동 · 동작 중) 끝난 뒤로 미룬다 ── */
  function signals(){
    const all = (typeof SKY_ALL !== 'undefined' && SKY_ALL) || [], now = nowMin();
    const allDone = all.length > 0 && all.every(i => i.done);
    const nx = all.length ? nextItem(all) : null;
    const today = STATE && STATE.today;
    const late = all.filter(i => !i.done && (i.date < today || (i.time && mins(i.time) < now)));
    const night = allDone || skyLight(now).night > .5;
    return {now, allDone, night, next: nx && nx.time ? {id: nx.id, m: mins(nx.time)} : null, late,
            ghost: typeof PEEK !== 'undefined' ? PEEK : null, idle: (Date.now() - lastInput) / 1000,
            work: workingNow() || Date.now() - lastWork < WORK_LINGER};
  }
  function settle(){ if(!busy()) think(); }
  function think(){
    /* 창이 숨어 있으면 새로 판단하지 않는다 - 보는 사람이 없다. 다시 보이면 새로 읽은
       개요(render → drawSky → stage)가 판단을 다시 부른다. */
    if(!G || !STATE || !onScreen()) return;
    const s = signals();
    if(wasAll === false && s.allDone) justAll = true;
    if(!s.allDone) justAll = false;
    wasAll = s.allDone;
    S.night = s.night;
    if(busy()) return;                               /* 끝나면 settle 이 다시 부른다 */
    if(frozen()){                                    /* 갈무리: 늘 같은 그림 - 낮엔 제자리, 밤엔 잠자리 */
      S.mode = s.night ? 'sleep' : 'idle';
      S.x = s.night ? spot('sleep') : 470;
      place(); paint(); return;
    }

    /* 밤 (해가 졌거나 · 오늘 일을 다 마침) - 잠자리로. 일하는 중이면 깨어 곁에 있는다 */
    if(s.night && s.work && (S.mode === 'sleep' || S.mode === 'bed' || S.mode === 'all')){
      S.mode = 'idle'; S.peek = false;
      return play('hop', 720);
    }
    if(s.night && !s.work){
      if(S.mode === 'sleep') return;
      S.lookUp = false; S.away = null; S.gaze = null;
      if(justAll){                                   /* 막 다 마쳤다 - 기쁜 눈으로 굴러가서 눕는다 */
        justAll = false;
        S.mode = 'all';
        return moveTo(spot('sleep'), 'roll', () => { S.mode = 'sleep'; paint(); });
      }
      S.mode = 'bed';
      return go(off() ? S.x : spot('sleep'), 'auto', () => { S.mode = 'sleep'; paint(); });
    }
    if(S.mode === 'sleep' || S.mode === 'bed' || S.mode === 'all'){   /* 아침 · 되돌리기 - 깨어 기지개 */
      S.mode = 'idle';
      return play('stretch', 1400);
    }
    if(off()){ S.lookUp = false; S.away = null; if(S.mode !== 'nap') S.mode = 'idle'; paint(); return; }

    /* 새 항목 시각을 고르는 중 - 점선 구슬 아래로, 시각이 바뀌면 따라간다 */
    if(s.ghost != null){
      const x = clampX(beadX(s.ghost));
      if(S.mode !== 'ghost'){ S.mode = 'ghost'; S.lookUp = false; S.away = null; return go(x, 'auto', () => { S.lookUp = true; paint(); }); }
      if(Math.abs(x - S.x) > 4){ S.lookUp = false; return moveTo(x, 'auto', () => { S.lookUp = true; paint(); }); }
      return;
    }
    if(S.mode === 'ghost'){ S.mode = 'idle'; S.lookUp = false; paint(); }

    /* 다음 업무 10분 전 - 한숨 → 굴러가 → 헐떡이며 올려다본다 */
    const soon = s.next && s.next.m - s.now <= 10 && s.next.m >= s.now;
    if(soon && nextSeen !== s.next.id + '@' + s.next.m){
      nextSeen = s.next.id + '@' + s.next.m;
      S.mode = 'next'; S.away = null;
      return go(clampX(beadX(s.next.m)), 'roll', () => { S.lookUp = true; paint(); play('pant', 1500, null, 3); });
    }
    if(S.mode === 'next' && !soon){ S.mode = 'idle'; S.lookUp = false; paint(); }
    if(S.mode === 'next') return;

    /* 업무가 지남 - 못 본 척, 지남 하나에 딱 한 번 */
    const seen = new Set(mem('late') || []);
    const fresh = s.late.filter(i => !seen.has(i.id + '@' + i.date));
    if(fresh.length && S.mode === 'idle'){
      mem('late', s.late.map(i => i.id + '@' + i.date).concat([...seen]).slice(-200));
      const t = fresh.find(i => i.time && i.date === STATE.today);
      const bx = t ? beadX(mins(t.time)) : S.x - 60;
      S.mode = 'over';
      return go(clampX(bx + 80), 'auto', () => {
        S.away = bx; paint(); note();
        later(() => { S.away = null; S.mode = 'idle'; paint(); settle(); }, 3200);
      });
    }

    /* 오래 입력이 없다 - 5분이면 기지개나 하품 한 번, 15분이면 낮잠 */
    if(S.mode === 'idle' && s.idle > 900){
      const x = spot('nap');
      S.mode = 'napping';
      /* 가는 동안 사람이 돌아왔으면 눕지 않는다 */
      const lie = () => { S.mode = (Date.now() - lastInput) / 1000 > 900 ? 'nap' : 'idle'; paint(); };
      return Math.abs(x - S.x) < 4 ? lie() : moveTo(x, 'scoot', lie);
    }
    if(S.mode === 'idle' && s.idle > 300 && !yawned){ yawned = true; return play(chance(.5) ? 'yawn' : 'stretch', 1400); }
    paint();
  }

  /* ── 사람 쪽 입력 ── */
  function input(){
    const was = (Date.now() - lastInput) / 1000;
    lastInput = Date.now();
    if(was > 300) yawned = false;
    if(Z) zRun(true);
    if(S.mode === 'nap'){                                  /* 화들짝 - 낮잠 깸, 곧 평상시 */
      S.mode = 'idle';
      play('squash', 420);
    }
  }
  let _mv = 0, _ev = null;
  document.addEventListener('mousemove', e => {
    _ev = e;
    if(_mv) return;
    _mv = requestAnimationFrame(() => {
      _mv = 0;
      const sky = $('.sky'), a = art();
      if(!sky || !a) return;
      const b = sky.getBoundingClientRect(), r = a.getBoundingClientRect();
      const inside = _ev.clientX >= b.left && _ev.clientX <= b.right && _ev.clientY >= b.top && _ev.clientY <= b.bottom;
      const p = {x: _ev.clientX - r.left, y: _ev.clientY - r.top};
      S.ptr = p;
      S.cursor = inside ? p : null;
      if(!asleep()) paint();
      input();
    });
  }, {passive: true});
  ['mousedown', 'keydown', 'wheel'].forEach(t => document.addEventListener(t, input, {passive: true}));
  /* 커서가 창 밖으로 나가면 더는 보지 않는다 */
  document.addEventListener('mouseout', e => { if(!e.relatedTarget && (S.cursor || S.ptr)){ S.cursor = S.ptr = null; paint(); } });

  /* 누르면: 깨어 있으면 움찔(!) → 2초 삐침 · 낮잠이면 화들짝 · 밤잠이면 한쪽 눈만 */
  function poke(){
    if(S.mode === 'sleep'){
      S.peek = true; paint();
      later(() => { S.peek = false; paint(); }, 1500);
    } else if(S.mode === 'nap'){ S.mode = 'idle'; play('squash', 420); }
    else if(!S.anim) play('squash', 420, () => sulk(2200));
  }
  function sulk(ms){
    S.sulk = true; paint();
    later(() => { S.sulk = false; paint(); settle(); }, ms);
  }

  /* ── 손으로 잡아 옮기기 ──
     누른 채 4px 넘게 끌면 들린다: 몸이 아래로 늘어지고 눈이 커지며, 끄는 빠르기만큼
     좌우로 흔들린다. 놓으면 중력대로 떨어져(높을수록 오래) 눌렸다 튀고 먼지가 인다.
     옆으로 세게 던지면 떨어진 뒤 그쪽으로 조금 굴러간다. 옮긴 자리가 새 자리다 -
     게으르니까 스스로 돌아가지 않는다. 밤잠 중이면 한쪽 눈만 뜬 채 들리고, 놓인
     곳에서 다시 잔다. 4px 안에서 떼면 그냥 누른 것(poke)이다. */
  let D = null;
  guy.addEventListener('pointerdown', e => {
    if(e.button !== 0 || !G) return;
    e.preventDefault(); e.stopPropagation();
    input();
    try{ guy.setPointerCapture(e.pointerId); }catch(err){}
    D = {id: e.pointerId, x0: e.clientX, y0: e.clientY, moved: false, lx: e.clientX, lt: performance.now(), vx: 0};
  });
  guy.addEventListener('pointermove', e => {
    if(!D || e.pointerId !== D.id) return;
    if(!D.moved){
      if(Math.hypot(e.clientX - D.x0, e.clientY - D.y0) < 4 || off()) return;
      D.moved = true;
      grab(e);
    }
    hold(e);
  });
  guy.addEventListener('pointerup', e => {
    if(!D || e.pointerId !== D.id) return;
    const d = D; D = null;
    if(d.moved) drop(d); else poke();
  });
  guy.addEventListener('pointercancel', () => { const d = D; D = null; if(d && d.moved) drop(d); });
  guy.addEventListener('click', e => e.stopPropagation());

  /* 하던 일을 모두 그만둔다 - 굴러가던 중이면 지금 보이는 그 자리에 멈춘다 */
  function halt(){
    TIMERS.forEach(clearTimeout); TIMERS.clear();
    const a = art().getBoundingClientRect(), r = guy.getBoundingClientRect();
    guy.getAnimations({subtree: true}).forEach(x => x.cancel());
    E.sq.style.transformOrigin = '50% 100%';
    E.roll.style.transform = '';
    S.x = (r.left - a.left + 20) / G.k;
    S.move = null; S.anim = null; S.sulk = false; S.away = null; S.lookUp = false; S.peek = false; S.gaze = null;
    S.lean = 0; S.rot = 0;
    if(S.mode !== 'sleep') S.mode = asleep() || S.mode === 'bed' || S.mode === 'all' ? 'sleep' : 'idle';
    if(S.mode === 'sleep' && !signals().night) S.mode = 'idle';
  }
  function grab(e){
    halt();
    const a = art().getBoundingClientRect();
    D.ox = e.clientX - (a.left + S.x * G.k);          /* 잡은 곳 - 몸 가운데에서 얼마나 옆인지 */
    D.oy = (a.top + HZ_Y) - e.clientY;                 /* 잡은 곳 - 땅에서 얼마나 위인지 */
    S.drag = true; S.swing = 0; S.lift = 0;
    document.body.classList.add('pb-drag');
    E.sq.style.transformOrigin = '50% 0';              /* 잡힌 곳(머리)에 매달려 늘어진다 */
    E.sq.style.transform = 'scale(.92,1.1)';
    E.roll.style.transform = '';
    paint();
  }
  let _swingT = 0;
  function hold(e){
    const a = art().getBoundingClientRect(), now = performance.now();
    const dt = Math.max(8, now - D.lt);
    D.vx = D.vx * .6 + ((e.clientX - D.lx) / dt) * .4;   /* px/ms, 부드럽게 */
    D.lx = e.clientX; D.lt = now;
    const maxX = (a.width - 20) / G.k;
    S.x = Math.max(20 / G.k, Math.min(maxX, (e.clientX - a.left - D.ox) / G.k));
    S.lift = Math.max(0, Math.min(150, (a.top + HZ_Y) - e.clientY - D.oy));
    S.swing = Math.max(-28, Math.min(28, -D.vx * 22));
    clearTimeout(_swingT);
    _swingT = setTimeout(() => { if(S.drag){ S.swing = 0; D && (D.vx = 0); paint(); } }, 120);
    place(); paint();
  }
  function drop(d){
    clearTimeout(_swingT);
    S.drag = false; S.swing = 0;
    document.body.classList.remove('pb-drag');
    E.sq.style.transformOrigin = '50% 100%';
    const L = S.lift, vx = d.vx || 0, night = S.mode === 'sleep';
    const land = () => {
      if(night){                                       /* 놓인 곳이 오늘의 잠자리 */
        mem('bed', S.x);
        S.peek = true; paint();
        return later(() => { S.peek = false; paint(); }, 1200);
      }
      const k = G.k, maxX = (art().getBoundingClientRect().width - 20) / k;
      if(Math.abs(vx) > .5){                           /* 던졌다 - 그쪽으로 조금 굴러간다 */
        const sgn = vx > 0 ? 1 : -1, dist = Math.min(180, Math.abs(vx) * 150);
        const x2 = Math.max(20 / k, Math.min(maxX, S.x + sgn * dist));
        return play('squash', 420, () => {
          if(Math.abs(x2 - S.x) < 4) return sulk(1600);
          S.moveDir = sgn;
          travel(x2, 'roll', sgn, Math.abs(x2 - S.x), () => chance(.5) ? sulk(1600) : null);
        });
      }
      play('squash', 420, () => chance(.5) ? sulk(1600) : play('wobble', 500));
    };
    S.lift = 0;
    if(calm() || L < 2){ place(); paint(); dust(S.x * G.k, -1); dust(S.x * G.k, 1); return land(); }
    /* 떨어진다 - 높을수록 오래, 점점 빨라지게. 그림자는 같은 곡선으로 제자리를 지킨다 */
    const dur = 120 + Math.sqrt(L) * 28, ease = 'cubic-bezier(.55,0,1,.45)';
    S.move = 'fall'; paint();
    guy.animate([{transform: at(S.x, L)}, {transform: at(S.x, 0)}], {duration: dur, easing: ease});
    guy.animate([{transform: 'translateY(' + L.toFixed(1) + 'px) scaleX(' + Math.max(.35, 1 - L / 160).toFixed(3) + ')'},
                 {transform: 'none'}], {duration: dur, easing: ease, pseudoElement: '::before'});
    guy.style.transform = at(S.x, 0);
    shade(0);
    later(() => {
      S.move = null;
      dust(S.x * G.k, -1); dust(S.x * G.k, 1);
      land();
    }, dur);
  }

  /* ── 설정 '돌멩이 움직임' ──
     끄는 순간: 하던 일(이동 · 한숨 · 못 본 척 · 올려다보기 …)을 그 자리에서 멈추고,
     가운데까지 딱 한 번 총총(멀면 굴러) 간 뒤 앉는다. 그 뒤로는 스스로 움직이지 않고
     눈만 굴린다 - 깜빡이고, 커서를 보고, 누르면 움찔한다. 밤이면 가운데에서 잔다.
     켜는 순간: 평상시로 돌아와 그때의 상태를 새로 판단한다.
     예전에는 하늘을 다시 그릴 때(stage)에만 설정을 봐서, 다른 일을 하던 중에 끄면
     그 자리에 남았고, 개요가 바뀌지 않는 한 다시 그리지 않으니 그대로 머물렀다. */
  let wasOff = off();
  new MutationObserver(() => {
    const o = off();
    if(o === wasOff) return;
    wasOff = o;
    if(!G) return;
    if(o){
      if(D){ D = null; S.drag = false; S.lift = 0; document.body.classList.remove('pb-drag'); }
      halt(); place(); paint();
      if(S.mode === 'sleep') return;               /* 자는 중이면 깨우지 않는다 */
      homing = true;
      moveTo(450, 'auto', () => { homing = false; paint(); });
    } else {
      homing = false;
      if(S.mode !== 'sleep' && S.mode !== 'nap') S.mode = 'idle';
      paint(); settle();
    }
  }).observe(document.body, {attributes: true, attributeFilter: ['class']});

  /* 창 · 되돌리기 띠가 열리고 닫히는 것을 지켜본다 - 열리면 깨우고, 닫히고 6초 뒤 다시 판단(잠) */
  new MutationObserver(() => {
    const w = workingNow();
    if(w === wasWork) return;
    wasWork = w;
    lastWork = Date.now();
    if(w) settle(); else later(settle, WORK_LINGER + 50);
  }).observe(document.body, {attributes: true, attributeFilter: ['class'], subtree: true});

  /* 5분 · 15분 · 10분 전 같은 시간 신호는 사건이 없으니 스스로 들여다본다 */
  setInterval(() => { if(onScreen()) settle(); }, 15000);

  return {
    /* drawSky - 무대(폭 · 궤도 · 해 지는 곳 · 빛)가 새로 그려졌다 */
    stage(g){
      const first = !G;
      G = g; S.dir = g.dir;
      if(first && off()) S.x = 450;                /* 끈 채로 켜면 처음부터 가운데 */
      place();
      if(first){ paint(); }
      settle();
    },
    /* 창이 숨는다 - 하던 움직임은 곧바로 끝자리로 보낸다 (뒤에서 굴러다니지 않게) */
    rest(){ guy.getAnimations({subtree: true}).forEach(a => { try{ a.finish(); }catch(e){} }); },
    /* relight - 빛(해)의 방향만 바뀌었다 */
    sun(dir){ S.dir = dir; if(!S.gaze && !S.cursor) paint(); },
    /* 완료 - 팔짝. 6초 안에 또 완료하면 너무 신나서 한 바퀴 뒤집힌다 */
    done(){
      lastWork = Date.now();
      if(S.mode === 'sleep' || S.mode === 'bed'){ S.mode = 'idle'; S.peek = false; }   /* 밤에 완료해도 깨어 같이 기뻐한다 */
      if(S.mode === 'nap') S.mode = 'idle';
      const combo = Date.now() - lastDone < 6000;
      lastDone = Date.now();
      sparks();
      play(combo ? 'topple' : 'hop', combo ? 1400 : 720);
    },
    state: () => Object.assign({}, S),               /* 확인용 (e2e) */
    idleFor(sec){ lastInput = Date.now() - sec * 1000; settle(); },   /* 확인용: 입력 없이 sec 초가 지난 셈 */
  };
})();
