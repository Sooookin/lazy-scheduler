/* web/sky.js - 창 위쪽의 하늘 (해 · 빛 · 능선 · 궤도 · 구슬 · 밤으로 넘어가기)

   app.js 에서 떼어 냈다. 화면(목록 · 달력 · 폼)과 하늘은 서로 주고받는 것이 적다:
   app.js 가 개요를 그릴 때 drawSky(오늘 목록) · nightFor(다 마쳤나) 를 부르고,
   하늘은 PEEK(고르는 시각) · STATE · 설정(THEME) 을 읽기만 한다.
   돌멩이(pebble.js)에게는 무대(PB.stage)와 빛의 방향(PB.sun)을 알려 준다.

   불러오는 차례: app.js → sky.js → pebble.js. 셋 다 같은 전역을 쓰는 평범한
   스크립트다. app.js 는 모두 읽힌 뒤(DOMContentLoaded)에 처음 개요를 받는다 -
   그 전에 개요가 와서 그리기 시작하면 아직 없는 drawSky 를 부르게 된다. */

/* ══════════════════════════════════════════════════════════════════
   하늘

   창 위쪽은 오늘 하루다. 궤도는 서울에서 오늘 해가 실제로 지나는 길이고
   (계절 따라 모양이 바뀐다 - 겨울엔 납작하고 여름엔 높다), 구슬 하나가
   일 하나다. 구슬 안의 번호는 아래 목록의 번호와 같다.

   글자는 하나도 없다. 시각도 이름도 쓰지 않는다 - 마우스를 올려야 나온다.
   덕분에 겹칠 일이 없어, 08:30 과 08:40 처럼 붙어 있는 것은 알약 하나로 묶어
   나란히 늘어놓기만 하면 된다.

   색도 해가 만든다. 아침 · 한낮 · 노을 · 밤이 다른 색이다 (applyLight).
   ══════════════════════════════════════════════════════════════════ */

const SEOUL = {lat: 37.57, lon: 126.98, tzm: 135};

/* 해 높이(도). 표준적인 태양 위치 계산이고 인터넷을 쓰지 않는다. */
/* 날짜로만 정해지는 값(적위 · 균시차)은 하루에 한 번만 구한다. 하늘 한 장을 그릴 때
   sunAlt 를 300번 가까이 부르는데, 예전에는 부를 때마다 날짜를 두 개 만들어 다시 셌다. */
let _sunK = null;
function sunDay(){
  const d = new Date(), key = d.getFullYear() * 400 + d.getMonth() * 32 + d.getDate();
  if(_sunK && _sunK.key === key) return _sunK;
  const rad = Math.PI/180, st = new Date(d.getFullYear(), 0, 0);
  const N = Math.floor((d - st) / 86400000);
  const dc = 23.44 * Math.sin(rad * (360/365) * (284 + N));
  const B = rad * (360/365) * (N - 81);
  const eot = 9.87*Math.sin(2*B) - 7.53*Math.cos(B) - 1.5*Math.sin(B);
  const p = rad * SEOUL.lat, dl = rad * dc;
  return (_sunK = {key, eot, ss: Math.sin(p)*Math.sin(dl), cc: Math.cos(p)*Math.cos(dl)});
}
function sunAlt(min){
  const rad = Math.PI/180, k = sunDay();
  const H = rad * (15 * ((min + 4*(SEOUL.lon - SEOUL.tzm) + k.eot) / 60 - 12));
  return Math.asin(k.ss + k.cc*Math.cos(H)) / rad;
}
let _sunT = null, _sunDay = '';
function sunTimes(){
  const key = new Date().toDateString();
  if(_sunT && _sunDay === key) return _sunT;
  let rise = 380, set = 1100;
  for(let m = 0; m < 1440; m++){ if(sunAlt(m) > -0.83){ rise = m; break; } }
  for(let m = 1439; m > 0; m--){ if(sunAlt(m) > -0.83){ set = m; break; } }
  _sunDay = key;
  return (_sunT = {rise, set});
}

const hx = c => { c = c.replace('#',''); return [0,2,4].map(i => parseInt(c.slice(i,i+2),16)); };
const mixc = (a,b,t) => { const A = hx(a), B = hx(b);
  return '#' + [0,1,2].map(i => ('0' + Math.round(A[i] + (B[i]-A[i])*t).toString(16)).slice(-2)).join(''); };
const smooth = (v,a,b) => { const t = Math.max(0, Math.min(1, (v-a)/(b-a))); return t*t*(3-2*t); };

/* tokens.py 가 넣어 둔 재료를 읽는다 - 색을 여기 또 적으면 언젠가 어긋난다 */
const LIT = (() => {
  const cs = getComputedStyle(document.documentElement), o = {};
  ['base','panel','ink','ink2','teal','warm','night','pale','pale2','teal-lit',
   'hol','hol-lit','late','late-lit','danger','danger-lit','rib-past','sky-hi','sky-lo','hill1','hill2','hill3','ribbon','rib-hi',
   'sky-hi-n','sky-lo-n','hill1-n','hill2-n','hill3-n','ribbon-n','rib-hi-n',
   'sky-hi-d','sky-lo-d','hill1-d','hill2-d','hill3-d','ribbon-d','rib-hi-d','bead-d',
   'ray-hot','ray-hot-d','ray-pale','ray-pale-d','ray-warm','ray-warm-d','ray-shade',
   'moon','moon-cool','guy','guy-n','eye','eye-n','pupil','pupil-n','rib-past-n']
    .forEach(k => { o[k] = cs.getPropertyValue('--lit-' + k).trim(); });
  return o;
})();

/* 해 높이로 바탕 · 면 · 글자색을 만든다.
   낮에는 기준 팔레트 그대로, 해가 지평선 가까우면 따뜻한 쪽으로,
   지고 나면 밤빛으로 간다. 글자는 거꾸로 밝아진다. */
/* 뿌리(:root)의 변수를 하나라도 쓰면 브라우저는 화면 전체의 스타일을 다시 셈한다.
   빛은 몇 분에 한 번 조금씩 바뀔 뿐이라, 값이 그대로인 것은 쓰지 않는다. */
const _lit = {};
function setLit(k, v){
  if(_lit[k] === v) return;
  _lit[k] = v;
  document.documentElement.style.setProperty(k, v);
}
/* 밝기 고정. 설정에서 '밝게 · 어둡게' 를 고르면 하루 중 어느 때든 그 시각의
   빛으로 그린다 - 밝게는 한낮(남중), 어둡게는 한밤(자정)이다. 시계도 궤도도
   실제 시각 그대로 움직인다. 멈추는 것은 빛뿐이다. */
let THEME = 'auto';
/* 하루 끝. '해를 따라' 에서는 해가 지거나, 오늘 일을 다 마치거나 - 둘 중 먼저 오는
   쪽에서 밤이 된다 (설정 '해가 지면 밤 화면 · 오늘 일을 다 마쳐도'). 다 마친 순간
   화면이 한 번에 뒤집히지 않고, 빛이 지금 시각에서 자정 쪽으로 빠르게 흘러가
   노을을 지나 밤에 닿는다. 되돌리기로 일이 다시 남으면 거꾸로 돌아온다.
   NIGHT_T 는 0 (지금 빛) ~ 1 (자정 빛). */
const NIGHT_ON = true;
let NIGHT_T = 0, _nightGo = 0, _nightInit = false;
function nightFor(done){
  const want = NIGHT_ON && done ? 1 : 0, first = !_nightInit;
  _nightInit = true;
  _nightGo = want;
  if(first || calm()){ NIGHT_T = want; return; }   /* 처음 그림은 바로 */
  if(NIGHT_T !== want) lightRun();                 /* 이미 흐르는 중이면 방향만 바뀐다 */
}
/* 빛의 흐름 (밤으로 넘어감 · 밝기 바꿈). 한 프레임에 하는 일은 relight 하나다 -
   예전에는 매 프레임 drawSky 로 능선 · 궤도 · 구슬 SVG 를 통째로 다시 지었다
   (1.4초 동안 여든 번 남짓, 그림자 필터 여섯 벌까지 새로). 모양은 그대로이고
   바뀌는 것은 색과 빛의 방향뿐이다. */
let _lightA = 0;
function lightRun(){
  if(_lightA) return;
  let last = performance.now();
  const step = t => {
    const dt = t - last; last = t;
    if(NIGHT_T !== _nightGo)
      NIGHT_T = Math.max(0, Math.min(1, NIGHT_T + dt / 1400 * (_nightGo ? 1 : -1)));
    relight();
    _lightA = NIGHT_T !== _nightGo || LT ? requestAnimationFrame(step) : 0;
  };
  _lightA = requestAnimationFrame(step);
}
/* 밝기(해를 따라 · 밝게 · 어둡게)를 바꾸면 화면이 한 번에 뒤집히지 않고, 빛이 지금
   시각에서 새 시각까지 가까운 쪽으로 흘러간다 - 밝게 → 어둡게는 노을을 지나 밤에 닿는다.
   change() 안에서 THEME 를 바꾼다 (흐름의 출발점은 바꾸기 전의 빛). */
let LT = null, _litNow = null;
function themeTo(change){
  const from = _litNow;
  change();
  if(from == null || calm() || !STATE){ LT = null; if(SKY_ALL) drawSky(SKY_ALL); return; }
  LT = {from, t0: performance.now(), dur: 1100};
  if(SKY_ALL) drawSky(SKY_ALL);
  lightRun();
}
function litMin(min){
  const m = litAt(min);
  if(!LT) return m;
  const u = (performance.now() - LT.t0) / LT.dur;
  if(u >= 1){ LT = null; return m; }
  const e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;     /* 천천히 · 빨리 · 천천히 */
  const d = ((m - LT.from) % 1440 + 2160) % 1440 - 720;                   /* 가까운 쪽 (-720 ~ 720) */
  return ((LT.from + d * e) % 1440 + 1440) % 1440;
}
function litAt(min){
  if(THEME === 'light'){ const s = sunTimes(); return (s.rise + s.set) / 2; }
  if(THEME === 'dark') return 0;
  if(NIGHT_T > 0){
    const s = sunTimes();
    if(min > s.rise && min < s.set + 60){           /* 이미 밤이면 건드리지 않는다 */
      const e = NIGHT_T * NIGHT_T * (3 - 2 * NIGHT_T);
      return (min + (1440 - min) * e) % 1440;
    }
  }
  return min;
}
/* 하루의 빛 (참고 도안 '디오라마 하루'). 모두 분 단위의 연속 함수라, 1분이
   지날 때마다 조금씩만 움직이고 어디에서도 한 번에 넘어가지 않는다.
     dusk  노을. 해 뜸 · 해 짐에서 가장 짙고(1) 한 시간쯤 멀어지면 사라진다.
     night 밤. 낮에는 0, 해가 지고 15분부터 80분 사이에 1 로 간다 (새벽은 거꾸로).
     dir   광원 쪽. +1 왼쪽(아침) → 0 머리 위(정오) → -1 오른쪽(저녁). 밤에는
           달이 오른쪽에서 왼쪽으로 되돌아가므로 자정에 다시 0 을 지난다.
     wR    오른쪽 광원의 몫. 참고 도안은 정오에 빛이 왼쪽 구석에서 오른쪽 구석으로
           한 번에 옮겨 가고 자정에 달이 되돌아간다 - 여기서는 그 둘레에서 두
           구석의 빛을 겹쳐 가며 넘긴다.
     tL tR 두 광원 각각의 자리 (도안의 t, 0.06 ~ 0.94). */
const cdist = (a, b) => { const d = Math.abs(a - b) % 1440; return Math.min(d, 1440 - d); };
function skyLight(m){
  const s = sunTimes(), inDay = m > s.rise && m < s.set;
  const dTo = Math.min(cdist(m, s.rise), cdist(m, s.set));
  const dusk = Math.exp(-Math.pow(dTo / 55, 2)), night = inDay ? 0 : smooth(dTo, 15, 80);
  let dir, tL = .06, tR = .94;
  if(inDay){
    const u = (m - s.rise) / (s.set - s.rise), tp = .06 + u * .88;
    dir = (.5 - u) * 2; tL = Math.min(tp, .5); tR = Math.max(tp, .5);
  } else {
    const len = 1440 - (s.set - s.rise);
    dir = -1 + 2 * (((m - s.set) % 1440 + 1440) % 1440) / len;
  }
  return {dusk, night, dir, tL, tR, wR: smooth(dir, .2, -.2)};
}
function applyLight(min){
  if(SHOT_MIN != null) min = SHOT_MIN;
  min = litMin(min);
  _litNow = min;
  /* 화면(바탕 · 글자)도 하늘과 같은 때에 어두워진다 - 해 높이로 따로 셈하면
     하늘은 아직 노을인데 글자만 먼저 뒤집히는 때가 생긴다. */
  const sl = skyLight(min), day = 1 - sl.night, warm = sl.dusk;
  /* 땅(면)은 디오라마의 맨 앞 종이이자 목록 판이다 - 노을에는 도안의 노을 땅색으로 */
  const surface = mixc(mixc(LIT.panel, LIT.warm, warm*.85), LIT.night, (1-day)*.80);
  setLit('--bg',      mixc(mixc(LIT.base,  LIT.warm, warm*.70), LIT.night, (1-day)*.88));
  setLit('--surface', surface);
  setLit('--text',    mixc(LIT.ink,  LIT.pale,  1-day));
  setLit('--text2',   mixc(LIT.ink2, LIT.pale2, 1-day));
  setLit('--teal',    mixc(LIT.teal, LIT['teal-lit'], 1-day));
  /* 벽돌빛도 밤에는 밝아진다. 이 색만 고정이면 지난 일 · 공휴일 · 삭제가
     밤 화면에서 셋 다 바탕에 잠긴다 (3.3:1). */
  setLit('--hol',     mixc(LIT.hol, LIT['hol-lit'], 1-day));
  setLit('--late',    mixc(LIT.late, LIT['late-lit'], 1-day));
  setLit('--danger',  mixc(LIT.danger, LIT['danger-lit'], 1-day));
  setLit('--rib-past', mixc(LIT['rib-past'], LIT['rib-past-n'], 1-day));
  /* 궤도 가운데의 점선 - 띠가 종이 두 겹을 이은 솔기처럼 보인다 */
  /* 실선 · 점선도 밤낮 사이를 이어서 섞는다. 예전에는 day .5 에서 먹빛 ↔ 흰빛으로
     한 번에 뒤집혀, 밤으로 흘러가는 동안 선만 툭 바뀌었다. */
  const ink = hx(mixc(LIT.ink, '#e8ece9', smooth(1 - day, .3, .7))).join(',');
  setLit('--rib-dot', 'rgba(' + ink + ',' + (.16 + .08 * (1 - day)).toFixed(3) + ')');
  setLit('--hair',  'rgba(' + ink + ',.12)');
  setLit('--hair2', 'rgba(' + ink + ',.20)');
  /* 채워 쓴 청록 위의 글자. 밤에는 청록 자체가 박하빛으로 밝아지므로 뒤집는다.
     낮에는 밝은 글자, 밤에는 먹빛 글자다. 해질녘의 좁은 구간에서만 건너간다 -
     한낮 내내 서서히 섞으면 중간쯤에서 회색 글자가 청록 위에 얹힌다. */
  /* 채운 청록 위의 글자 · 체크는 밤낮 모두 흰빛이다 (밤의 청록이 가라앉은 색이라) */
  setLit('--on-teal', mixc(LIT.pale, '#edf3ef', 1-day));
  /* 되돌리기 띠처럼 바탕을 뒤집어 쓴 곳의 청록. 위와 반대로 움직인다. */
  setLit('--teal-inv', mixc(LIT.teal, LIT['teal-lit'], day*.85));
  /* 입력칸. 늘 면보다 한 겹 밝아 "여기가 쓰는 곳" 임을 말한다 -
     낮에는 흰 쪽으로, 밤에는 밤빛을 살짝 걷어 내는 쪽으로. */
  setLit('--field', mixc(mixc(surface, '#ffffff', day*.55), LIT.pale, (1-day)*.10));
  /* 디오라마의 종이들. 겹마다 낮 · 노을 · 밤 세 값이 있다 - 하나의 밤빛에
     몰아 섞으면 여섯 겹이 밤에 같은 회색으로 주저앉아 깊이가 사라진다.
     낮 → 노을(dusk) → 밤(night) 순서로 두 번 섞는다 (참고 도안). */
  ['sky-hi','sky-lo','hill1','hill2','hill3','ribbon','rib-hi'].forEach(k => {
    setLit('--' + k, mixc(mixc(LIT[k], LIT[k + '-d'], sl.dusk), LIT[k + '-n'], sl.night));
  });
  /* 구슬은 낮에는 띠의 윗면 색이고 밤에는 띠와 같은 색이다 */
  setLit('--bead', mixc(mixc(LIT['rib-hi'], LIT['bead-d'], sl.dusk), LIT['ribbon-n'], sl.night));
  /* 게으름뱅이는 밤에도 어두운 덩어리다 - 글자색을 따라가면 하얗게 뒤집힌다 */
  setLit('--guy', mixc(LIT.guy, LIT['guy-n'], 1-day));
  setLit('--eye', mixc(LIT.eye, LIT['eye-n'], 1-day));
  setLit('--pupil', mixc(LIT.pupil, LIT['pupil-n'], 1-day));
  /* 접힌 종이의 날. 낮에는 흰 빛, 밤에는 옅은 달빛만 남는다 */
  setLit('--sky-edge', 'rgba(255,255,255,' + (.32 + .58*day).toFixed(2) + ')');
  return Object.assign(sl, {day, min});
}

/* ── 빛 한 벌 (참고 도안의 LSMLight 를 옮긴 것) ──
   left 는 왼쪽 구석의 빛인지, t 는 그 광원의 자리, dusk 는 노을.
   낮의 빛(cinema): 한쪽 구석의 번짐 하나에서 부드러운 빛살 여섯과 가는 속살
   셋이 비스듬히 내려오고, 가로로 한 줄 번쩍이며, 반대쪽 구석에는 그늘이 깔린다.
   밤의 빛(moon): 빛살 없이 서늘한 번짐만 넓게 퍼진다.
   도안의 자는 900×210 이다. 가로는 창 너비로, 세로는 KY 로 옮긴다. */
const rgbOf = h => hx(h).join(',');
function liteSet(left, t, dusk, moon, W, k){
  const s = left ? 1 : -1;
  const ox = left ? (-20 + t * 240) * k : W + (20 - (1 - t) * 240) * k;
  const oy = (-60 + Math.abs(.5 - t) * 80 + dusk * 70) * KY;
  const deg = left ? 115 : 245, px = v => v.toFixed(0) + 'px';
  if(moon){
    const cool = rgbOf(LIT['moon-cool']), cw = rgbOf(LIT.moon);
    return '<div style="background:linear-gradient(' + deg + 'deg, rgba(' + cw + ',.22) 0%, rgba(' + cool + ',.08) 45%, rgba(4,8,14,.35) 100%)"></div>' +
      '<div class="o" style="left:' + px(ox - 260) + ';top:' + px(oy - 260) + ';width:520px;height:520px;background:radial-gradient(circle, rgba(' + cw + ',.55) 0%, rgba(' + cool + ',.22) 30%, rgba(' + cool + ',.06) 60%, rgba(' + cool + ',0) 78%)"></div>' +
      '<div class="o" style="left:' + px(ox - 90) + ';top:' + px(oy - 90) + ';width:180px;height:180px;background:radial-gradient(circle, rgba(255,255,255,.5) 0%, rgba(' + cw + ',.2) 40%, rgba(' + cw + ',0) 70%);filter:blur(6px)"></div>';
  }
  const warm = rgbOf(mixc(LIT['ray-warm'], LIT['ray-warm-d'], dusk));
  const pale = rgbOf(mixc(LIT['ray-pale'], LIT['ray-pale-d'], dusk));
  const hot  = rgbOf(mixc(LIT['ray-hot'],  LIT['ray-hot-d'],  dusk));
  const strip = (off, w, op, blur, flare) => {
    const a = ((left ? 58 : 122) + off) * Math.PI / 180, L = 1000;
    const nx = -Math.sin(a) * w / 2, ny = Math.cos(a) * w / 2, fx = Math.cos(a) * L, fy = Math.sin(a) * L;
    const p = [[ox + nx, oy + ny], [ox - nx, oy - ny], [ox - nx * flare + fx, oy - ny * flare + fy], [ox + nx * flare + fx, oy + ny * flare + fy]];
    return '<div style="clip-path:polygon(' + p.map(q => px(q[0]) + ' ' + px(q[1])).join(',') + ');background:linear-gradient(' +
      (left ? 148 : 212) + 'deg, rgba(' + hot + ',' + (op * 1.3).toFixed(3) + ') 0%, rgba(' + pale + ',' + op + ') 40%, rgba(' + warm + ',' +
      (op * .35).toFixed(3) + ') 75%, rgba(' + warm + ',0) 100%);filter:blur(' + blur + 'px)"></div>';
  };
  const shade = rgbOf(LIT['ray-shade']);
  let o = '<div style="background:linear-gradient(' + deg + 'deg, rgba(' + pale + ',.55) 0%, rgba(' + pale + ',0) 42%, rgba(' + shade + ',' + (.2 + dusk * .18).toFixed(3) + ') 100%)"></div>';
  [[-26, 40, .22, 10, 1.6], [-12, 70, .3, 14, 1.4], [2, 30, .28, 8, 1.8], [12, 90, .26, 16, 1.3], [26, 36, .22, 10, 1.7], [36, 18, .18, 8, 2],
   [-9, 5, .55, 1.2, 2.2], [5, 3, .52, 1, 2.6], [20, 4, .48, 1.2, 2.4]].forEach(r => { o += strip(r[0], r[1], r[2], r[3], r[4]); });
  o += '<div class="o" style="left:' + px(ox - 180) + ';top:' + px(oy - 180) + ';width:360px;height:360px;background:radial-gradient(circle, rgba(' + hot + ',.95) 0%, rgba(' + pale + ',.45) 30%, rgba(' + warm + ',.12) 55%, rgba(' + warm + ',0) 72%)"></div>' +
    '<div class="o" style="border-radius:0;left:' + px(ox - 260) + ';top:' + px(oy - 2) + ';width:520px;height:4px;background:linear-gradient(90deg, rgba(' + warm + ',0), rgba(' + hot + ',.7) 50%, rgba(' + warm + ',0));filter:blur(1.5px);transform:rotate(' + (-8 * s) + 'deg)"></div>';
  return o;
}
/* 네 벌(왼쪽 · 오른쪽 × 낮 · 밤)을 몫대로 겹친다. 몫이 거의 없는 벌은 만들지 않는다.
   광원의 자리(눈이 바라볼 곳)는 몫으로 가중한 평균이다. */
function drawLite(sl, W, k){
  const box = $('#sky-lite');
  const parts = [[true, 1 - sl.wR, sl.tL], [false, sl.wR, sl.tR]];
  let h = '', sx = 0, sy = 0;
  parts.forEach(([left, w, t]) => {
    sx += w * (left ? (-20 + t * 240) * k : W + (20 - (1 - t) * 240) * k);
    sy += w * (-60 + Math.abs(.5 - t) * 80 + sl.dusk * 70) * KY;
    const d = w * (1 - sl.night), n = w * sl.night;
    if(d > .003) h += '<div style="opacity:' + d.toFixed(3) + '">' + liteSet(left, t, sl.dusk, false, W, k) + '</div>';
    if(n > .003) h += '<div style="opacity:' + n.toFixed(3) + '">' + liteSet(left, t, sl.dusk, true, W, k) + '</div>';
  });
  if(box && box._h !== h){ box._h = h; box.innerHTML = h; }
  return [sx, sy];
}

let SKY_BEADS = [];
const svgEsc = t => String(t).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');

/* 점들을 지나는 부드러운 선. 꺾은선으로 그리면 토막마다 모서리가 남고,
   띠가 두꺼울수록(13px) 그 모서리가 그대로 보인다 - 각져 보이던 이유다. */
function bez(p){
  if(p.length < 2) return '';
  let d = 'M' + p[0][0].toFixed(2) + ' ' + p[0][1].toFixed(2);
  for(let i = 0; i < p.length - 1; i++){
    const a = p[i-1] || p[i], b = p[i], c = p[i+1], e = p[i+2] || p[i+1];
    d += 'C' + (b[0] + (c[0]-a[0])/6).toFixed(2) + ' ' + (b[1] + (c[1]-a[1])/6).toFixed(2) +
         ' ' + (c[0] - (e[0]-b[0])/6).toFixed(2) + ' ' + (c[1] - (e[1]-b[1])/6).toFixed(2) +
         ' ' + c[0].toFixed(2) + ' ' + c[1].toFixed(2);
  }
  return d;
}

/* ══════════ 하늘 그리기 ══════════
   참고 도안(디오라마)은 900×210 이다. 가로는 창 너비에 맞춰 늘리고 - 능선이
   완만한 곡선이라 늘어나도 비례가 상하지 않는다 - 세로는 KY(180/206) 만큼
   눌러 쓴다. 위를 잘라 내지 않고 능선 · 궤도 꼭대기 · 땅을 모두 같은 비율로
   내리므로 하늘 전체가 위아래로 납작해진다. 띠 두께 · 구슬 크기 · 글자는
   누르지 않는다 - 그것까지 누르면 구슬이 타원이 되고 번호가 작아진다.

   종이를 여러 겹 세운 무대다. 뒤에서 앞으로:
     하늘(그라데이션) → 먼 능선 셋 → 궤도 띠 → 구슬 → 땅 → 빛.

   해도 달도 동그라미로 그리지 않는다. 하늘에 남는 것은 빛줄기뿐이다.
   빛이 어디서 오는지는 그림자가 말한다 - 아침에는 그림자가 오른쪽으로,
   한낮에는 발밑으로, 저녁에는 왼쪽으로 진다. 앞의 겹일수록 그림자가 길고
   짙다. 깊이는 그 하나로만 말한다. */
const KY = 180 / 206;                  /* 세로 누름 */
const SKY_W = 900, SKY_H = 184;        /* 도안의 자 (210 을 누른 값) */
const SKY_HZ = 180, SKY_PK = 47;       /* 지평선 · 궤도 꼭대기 (206 · 54 를 누른 값) */
const SKY_X0 = 150, SKY_X1 = 760;      /* 해 뜨는 자리 · 지는 자리 */
const SKY_RIB = 13;                    /* 띠 두께 */

function drawSky(all){
  const box = $('#sky-art'), svg = $('#sky-svg');
  if(!box || !svg) return;
  const W = box.clientWidth;
  if(!W) return;
  const k = W / SKY_W, X = v => +(v * k).toFixed(1), Y = v => +(v * KY).toFixed(1);
  /* 도안의 곡선을 그대로 옮긴다. "%가로 세로" 는 도안의 좌표 한 쌍이다. */
  const sc = d => d.replace(/%(-?[\d.]+) (-?[\d.]+)/g, (_, x, y) => X(+x) + ' ' + Y(+y));
  const nowM = SHOT_MIN != null ? SHOT_MIN : mins(STATE.now);
  const lightv = applyLight(nowM);
  const st = sunTimes(), T0 = st.rise, T1 = st.set;
  let altMax = 0;
  for(let m = T0; m <= T1; m += 10) altMax = Math.max(altMax, sunAlt(m));

  /* 궤도 위의 자리. 가로는 해 뜸~해 짐을 X0~X1 에 고르게 펴고, 세로는 그때의
     실제 해 높이다. 해 뜨기 전 · 진 뒤에는 높이가 음수라 호가 지평선 아래로
     내려간다 - 땅이 그 끝을 덮어, 호가 땅에서 자라 나온 것처럼 보인다. */
  const at = m => [X(SKY_X0 + (m - T0) / (T1 - T0) * (SKY_X1 - SKY_X0)),
                   SKY_HZ - sunAlt(m) / altMax * (SKY_HZ - SKY_PK)];
  const arc = (a, b) => {
    const p = [];
    for(let i = 0; i <= 40; i++) p.push(at(a + (b-a)*i/40));
    return bez(p);
  };
  /* 지평선에 너무 붙은 구슬은 땅에 잠긴다. 궤도를 따라 안쪽으로 밀어 올린다 */
  const MINY = SKY_HZ - 18, MID = (T0 + T1) / 2;
  const onArc = m => {
    let mm = Math.max(T0 + 20, Math.min(T1 - 20, m)), q = at(mm), n = 0;
    while(q[1] > MINY && n++ < 400){ mm += m < MID ? 2 : -2; q = at(mm); }
    return {x:q[0], y:q[1], m:mm};
  };
  /* 궤도를 따라 d 픽셀 옆. 한 묶음의 구슬은 가로로 늘어놓지 않고 띠를 탄다 -
     기울어진 자리에서 가로로 놓으면 띠 밖으로 밀려 나간다. */
  const along = (c, d) => {
    if(!d) return [c.x, c.y];
    let m = c.m, q = [c.x, c.y], n = 0;
    while(Math.hypot(q[0]-c.x, q[1]-c.y) < Math.abs(d) && n++ < 600){ m += d > 0 ? .5 : -.5; q = at(m); }
    return q;
  };

  /* 빛이 오는 쪽. +1 이면 왼쪽(아침), 0 이면 머리 위(한낮), -1 이면 오른쪽(저녁).
     그림자의 방향 · 길이가 전부 여기서 나온다. */
  const dir = lightv.dir;
  const F = (id, len, blur, op) =>
    '<filter id="' + id + '" x="-20%" y="-80%" width="140%" height="300%">' +
    '<feDropShadow data-l="' + len + '" dx="' + (dir*len).toFixed(1) + '" dy="' + (len*.85).toFixed(1) +
    '" stdDeviation="' + blur + '" flood-color="#1f2a28" flood-opacity="' + op + '"/></filter>';
  /* 그림자는 필터 사본이 만들고, 같은 도형을 그 위에 또렷하게 한 번 더 그린다.
     필터 결과만 쓰면 화면 배율에 따라 늘어난 래스터가 보인다. */
  const cast = (id, shape) => '<g filter="url(#' + id + ')">' + shape + '</g>' + shape;

  /* 안개. 겹과 겹 사이에 지평선 쪽 하늘빛을 아래로 짙게 깐다 - 멀리 있는 것일수록
     여러 겹의 안개 뒤에 있으므로 옅고 흐려진다. 깊이가 그림자 말고도 색으로 읽힌다. */
  const mist = '<linearGradient id="sMist" x1="0" y1="0" x2="0" y2="1">' +
    '<stop offset="0" style="stop-color:var(--sky-lo);stop-opacity:0"/>' +
    '<stop offset="1" style="stop-color:var(--sky-lo);stop-opacity:.42"/></linearGradient>';
  let g = '<defs>' + mist +
    F('sH1', 2, 1.6, '.14') + F('sH2', 4.5, 2.6, '.24') + F('sH3', 7, 3.4, '.32') +
    F('sRB', 11, 6, '.36') + F('sMK', 13, 5, '.4') + F('sGR', 9, 5, '.42') +
    '<clipPath id="sClip"><rect x="0" y="0" width="' + W + '" height="' + SKY_H + '"/></clipPath>' +
    '</defs>';

  /* ── 능선 셋. 뒤에서 앞으로, 뒤일수록 높고 옅으며 앞일수록 낮고 짙다. 겹마다
        굴곡이 여럿 - 한 겹에 한두 번 오르내리면 풍경이 아니라 띠로 보인다. 겹 사이마다
        안개를 한 장씩 깐다. 그림자는 앞 겹일수록 길고 짙다. ── */
  const mistBand = (y0, y1) => '<rect x="0" y="' + Y(y0) + '" width="' + W + '" height="' + (Y(y1) - Y(y0)).toFixed(1) +
    '" fill="url(#sMist)"/>';
  const ridge = (line, fill, edge) =>
    '<path d="' + line + 'L' + X(906) + ' ' + Y(216) + 'L' + X(-6) + ' ' + Y(216) + 'Z" fill="' + fill + '"/>' +
    '<path d="' + line + '" fill="none" stroke="var(--sky-edge)" stroke-width="1" opacity="' + edge + '"/>';
  [['sH1', 'hill1', .7,  'M%-6 144C%40 132 %82 120 %132 124S%202 146 %252 140S%332 114 %392 118S%472 144 %532 136' +
                        'S%622 106 %692 112S%782 142 %842 134S%892 122 %906 124', [122, 172]],
   ['sH2', 'hill2', .6,  'M%-6 170C%60 160 %112 150 %172 156S%262 178 %332 170S%432 148 %502 154S%602 178 %672 168' +
                        'S%782 146 %852 156S%900 170 %906 168', [148, 194]],
   ['sH3', 'hill3', .45, 'M%-6 192C%70 184 %140 178 %210 184S%320 198 %400 192S%520 176 %600 182S%740 198 %820 190' +
                        'S%890 180 %906 184', null]].forEach(h => {
    g += cast(h[0], ridge(sc(h[3]), 'var(--' + h[1] + ')', h[2]));
    if(h[4]) g += mistBand(h[4][0], h[4][1]);
  });

  /* ── 궤도. 접어 세운 종이띠다: 몸통 · 지나온 쪽 · 윗날 · 아랫그늘.
        해 뜨기 40분 전부터 진 뒤 40분까지 그려 양 끝을 땅에 꽂는다 ── */
  const A0 = T0 - 40, A1 = T1 + 40, orbit = arc(A0, A1);
  let rib = cast('sRB', '<path d="' + orbit + '" fill="none" stroke="var(--ribbon)" stroke-width="' +
    SKY_RIB + '" stroke-linecap="round" stroke-linejoin="round"/>');
  /* 자정에 날이 바뀌어도 궤도가 한 번에 남색으로 돌아가지 않게 한다. 어제 하루를
     다 지나온 하늘색 띠가 자정을 넘어서도 그대로 남아 있다가, 새 날의 띠가 땅에서
     솟기 전 두 시간 동안 천천히 옅어진다 (23:59 과 00:00 이 같은 궤도다). */
  const yday = nowM < A0 ? 1 - smooth(nowM, A0 - 120, A0) : 0;
  if(yday > .003) rib += '<path d="' + orbit + '" fill="none" stroke="var(--rib-past)" stroke-width="' +
    SKY_RIB + '" stroke-linecap="round" stroke-linejoin="round" opacity="' + yday.toFixed(3) + '"/>';
  if(nowM > A0) rib += '<path d="' + arc(A0, Math.min(nowM, A1)) +
    '" fill="none" stroke="var(--rib-past)" stroke-width="' + SKY_RIB +
    '" stroke-linecap="round" stroke-linejoin="round"/>';
  rib += '<path d="' + orbit + '" fill="none" stroke="var(--rib-dot)" stroke-width="1.3" stroke-linecap="round" stroke-dasharray="0.1 5"/>';
  rib += '<path d="' + orbit + '" fill="none" stroke="var(--sky-edge)" stroke-width="1.2" opacity=".8" transform="translate(0,-6)"/>' +
         '<path d="' + orbit + '" fill="none" stroke="#1f2a28" stroke-width="1" opacity=".16" transform="translate(0,6)"/>';


  /* ── 구슬. 줄기 · 알약 · 구슬 · 번호가 한 그림자를 함께 쓴다 ── */
  const nx = nextItem(all);
  const late = i => !i.done && (i.date < STATE.today || (i.time && mins(i.time) < mins(STATE.now)));
  const timed = all.filter(i => i.time).map(i => {
    const c = onArc(mins(i.time));
    return {i, x:c.x};
  });
  SKY_BEADS = [];
  const marks = [], labels = [], groups = [];
  /* 가까운 것은 한 덩어리로 묶는다. 겹쳐서 얼룩이 되는 것을 막는다 */
  timed.sort((a, b) => a.x - b.x).forEach(p => {
    const G = groups[groups.length-1];
    if(G && p.x - G.pts[G.pts.length-1].x < 20) G.pts.push(p); else groups.push({pts:[p]});
  });
  groups.forEach(G => {
    const n = G.pts.length;
    const c0 = onArc(G.pts.reduce((t, p) => t + mins(p.i.time), 0) / n);
    const q1 = at(c0.m - 1), q2 = at(c0.m + 1);
    const ang = Math.atan2(q2[1]-q1[1], q2[0]-q1[0]) * 180/Math.PI;
    /* 아직 안 끝난 것이 있는 묶음만 땅까지 줄기를 내린다 */
    const open = G.pts.filter(p => !p.i.done);
    if(open.length) marks.push('<line x1="' + c0.x.toFixed(1) + '" y1="' + (c0.y + 12).toFixed(1) +
      '" x2="' + c0.x.toFixed(1) + '" y2="' + SKY_HZ + '" stroke="' +
      (open.some(p => late(p.i)) ? 'var(--late)' : 'var(--teal)') + '" stroke-width="1.4" opacity=".7"/>');
    /* 알약은 띠의 기울기를 따라 눕는다 - 궤도 위에 놓인 물건으로 읽힌다 */
    if(n > 1) marks.push('<rect x="' + (c0.x - n*9 - 3).toFixed(1) + '" y="' + (c0.y - 11).toFixed(1) +
      '" width="' + (n*18 + 6) + '" height="22" rx="11" fill="var(--bead)" stroke="var(--teal)" stroke-width="1" transform="rotate(' +
      ang.toFixed(1) + ' ' + c0.x.toFixed(1) + ' ' + c0.y.toFixed(1) + ')"/>');
    G.pts.forEach((p, j) => {
      const i = p.i, done = !!i.done, bad = late(i), isNext = nx && nx.id === i.id;
      const b = along(c0, (j - (n-1)/2) * 18);
      const cx = +b[0].toFixed(1), cy = +b[1].toFixed(1);
      const ring = bad ? 'var(--late)' : 'var(--teal)', fill = done || isNext;
      marks.push('<circle data-n="' + i.n + '" cx="' + cx + '" cy="' + cy + '" r="8.5" fill="' +
        (fill ? 'var(--teal)' : 'var(--bead)') + '" stroke="' + ring +
        '" stroke-width="1.6" opacity="' + (done ? .55 : 1) + '"/>');
      /* 끝낸 것도 채워져 있으므로, 다음에 할 것에는 속에 테를 하나 더 두른다 */
      if(isNext && !done) marks.push('<circle cx="' + cx + '" cy="' + cy +
        '" r="6" fill="none" stroke="var(--on-teal)" stroke-width="1" opacity=".6"/>');
      labels.push('<text data-n="' + i.n + '" x="' + cx + '" y="' + (cy + 3.4).toFixed(1) +
        '" text-anchor="middle" font-size="9.5" font-weight="500" fill="' +
        (fill ? 'var(--on-teal)' : ring) + '" opacity="' + (done ? .55 : 1) + '">' + i.n + '</text>');
      SKY_BEADS.push({n:i.n, x:cx, y:cy, label:(i.time || '') + '  ' +
        (i.title.length > 22 ? i.title.slice(0,21) + '…' : i.title)});
    });
  });
  /* 고르는 중인 시각 (새 항목 · 수정의 시각 칸). 점선 구슬과 점선 줄기 - 저장하면 실선이 된다 */
  if(PEEK != null){
    const pq = onArc(PEEK);
    marks.push('<line x1="' + pq.x.toFixed(1) + '" y1="' + (pq.y + 10).toFixed(1) +
      '" x2="' + pq.x.toFixed(1) + '" y2="' + SKY_HZ + '" stroke="var(--teal)" stroke-width="1.2" stroke-dasharray="2 3" opacity=".8"/>' +
      '<circle cx="' + pq.x.toFixed(1) + '" cy="' + pq.y.toFixed(1) +
      '" r="8.5" fill="var(--bead)" stroke="var(--teal)" stroke-width="1.4" stroke-dasharray="2.4 2"/>');
  }
  /* 지금. 궤도 위의 작은 구슬 하나가 "해가 여기까지 왔다" 를 말한다 */
  const cq = onArc(nowM);
  marks.push('<circle cx="' + cq.x.toFixed(1) + '" cy="' + cq.y.toFixed(1) +
    '" r="5.5" fill="var(--bead)" stroke="var(--teal)" stroke-width="1.4"/>');

  /* 띠와 그 위의 것은 한 무리다. 종이가 열리면 함께 내려앉으며 사라진다 */
  g += '<g class="rib">' + rib + cast('sMK', marks.join('')) + labels.join('') + '</g>';

  /* ── 땅. 디오라마의 맨 앞 종이다. 이 능선이 곧 지평선이고, 아래로는
        창 바닥까지 이어지는 판(.ground)이 같은 색으로 받는다 ── */
  const gl = sc('M%-6 206C%130 202 %290 209 %450 205S%740 201 %906 206');
  g += cast('sGR', '<path d="' + gl + 'L' + X(906) + ' ' + Y(232) + 'L' + X(-6) + ' ' + Y(232) + 'Z" fill="var(--surface)"/>') +
       '<path d="' + gl + '" fill="none" stroke="var(--sky-edge)" stroke-width="1" opacity=".9"/>';

  /* ── 땅의 눈금. 궤도의 가로는 해 뜸 ~ 해 짐을 고르게 편 시간 자라서, 땅에 매시
        눈금을 세우면 구슬에서 내려온 줄기가 닿는 자리가 곧 그 시각이다. 세 시간마다
        (궤도의 숫자가 적힌 시각) 조금 길게. 해가 떠 있는 동안만 - 궤도 밖은 자가 아니다. ── */
  /* 세 시간마다(06 · 09 · 12 · 15 · 18) 그 눈금 바로 아래, 땅의 맨 윗줄에 시각을 적는다
     (#sky-ruler). 궤도의 가로가 곧 시간 자라서 숫자는 자(땅)에 붙는 편이 읽힌다. */
  let ticks = '', ruler = '';
  for(let h = Math.ceil(T0 / 60); h * 60 <= T1; h++){
    const x = at(h * 60)[0], big = h % 3 === 0;
    ticks += '<line x1="' + x.toFixed(1) + '" y1="' + (SKY_HZ - 1) + '" x2="' + x.toFixed(1) + '" y2="' + (SKY_HZ - (big ? 10 : 6)) +
      '" stroke="var(--text)" stroke-width="' + (big ? 1.3 : 1) + '" stroke-linecap="round" opacity="' + (big ? .5 : .32) + '"/>';
    if(big) ruler += '<span style="left:' + x.toFixed(1) + 'px">' + String(h).padStart(2, '0') + '</span>';
  }
  const rl = $('#sky-ruler');
  if(rl && rl._h !== ruler){ rl._h = ruler; rl.innerHTML = ruler; }
  g += '<g class="ticks">' + ticks + '</g>';

  g += '<g id="sky-tip"></g>';
  skyHover._n = undefined;              /* 이름표 자리를 새로 지었다 */
  /* ── 빛. 하늘 위에 따로 깐다 (drawLite). 게으름뱅이의 눈이 그 광원을 본다 ── */
  const src = drawLite(lightv, W, k);
  svg.innerHTML = g;

  /* 게으름뱅이는 궤도가 놓인 만큼을 오간다. 그림자는 빛과 반대쪽으로,
     해가 낮을수록 길게 눕는다 - 능선 · 띠와 같은 빛을 받는다. */
  const guy = $('#guy');
  if(guy){
    guy.style.setProperty('--gy', (SKY_H - SKY_HZ) + 'px');
    guyLight(guy, dir);
  }
  SKY_GEO = {W, k};
  /* 돌멩이(pebble.js)에게 무대를 알려 준다 - 폭 · 궤도 위의 자리 · 해 지는 곳 · 빛의 방향.
     무엇을 할지는 돌이 이 값과 지금 상태(시각 · 완료 · 시각 고르기)를 보고 스스로 정한다. */
  if(window.PB) PB.stage({k, onArc, set: T1, dir});

  svg.onmousemove = e => {
    const r = svg.getBoundingClientRect(), mx = e.clientX - r.left, my = e.clientY - r.top;
    let hit = null;
    for(const b of SKY_BEADS){ if(Math.hypot(b.x-mx, b.y-my) < 12){ hit = b; break; } }
    skyHover(hit ? hit.n : null);
  };
  svg.onmouseleave = () => skyHover(null);
}

/* 게으름뱅이의 그림자. 해가 낮을수록 길게 눕고 빛과 반대쪽으로 밀린다 */
function guyLight(guy, dir){
  guy.style.setProperty('--sw', (46 + Math.abs(dir)*34).toFixed(0) + 'px');
  guy.style.setProperty('--sdx', (dir*22).toFixed(0) + 'px');
  guy.style.setProperty('--gsh', (dir*7).toFixed(1) + 'px');
}
/* 빛만 다시 비춘다 - 색(변수) · 그림자 방향(필터의 dx) · 빛살 · 게으름뱅이의 그림자와 눈.
   능선 · 궤도 · 구슬의 모양은 그대로 두므로 drawSky 보다 훨씬 가볍다. */
let SKY_GEO = null;
function relight(){
  if(!STATE || !SKY_GEO) return;
  const lv = applyLight(SHOT_MIN != null ? SHOT_MIN : mins(STATE.now));
  $$('#sky-svg feDropShadow').forEach(f => f.setAttribute('dx', (lv.dir * f.dataset.l).toFixed(1)));
  const src = drawLite(lv, SKY_GEO.W, SKY_GEO.k);
  const guy = $('#guy');
  if(guy) guyLight(guy, lv.dir);
  if(window.PB) PB.sun(lv.dir);
}

/* 목록 줄과 하늘의 구슬은 번호로 이어져 있다. 한쪽에 마우스를 올리면 둘 다 밝아지고,
   구슬 위에는 이름표가 뜬다 - 평소에는 하늘에 글자가 하나도 없기 때문이다. */
function skyHover(n){
  /* 마우스가 움직일 때마다 불린다 - 같은 구슬 위라면 할 일이 없다 (이름표를 다시
     지으면 떠오르는 움직임이 매번 처음부터 돈다) */
  if(n === skyHover._n) return;
  skyHover._n = n;
  const tip = $('#sky-tip');
  $$('#today .item').forEach(el => el.classList.toggle('hi', n != null && +el.dataset.n === n));
  if(!tip) return;
  const b = n == null ? null : SKY_BEADS.filter(x => x.n === n)[0];
  if(!b){ tip.innerHTML = ''; return; }
  let w = 12;
  for(const ch of b.label) w += ch.charCodeAt(0) > 255 ? 10.5 : 6;
  tip.innerHTML = '<rect x="'+(b.x-w/2).toFixed(1)+'" y="'+(b.y-31)+'" width="'+w.toFixed(0)+
    '" height="20" rx="5" fill="var(--text)" opacity=".92"/>' +
    '<text x="'+b.x.toFixed(1)+'" y="'+(b.y-17)+'" text-anchor="middle" font-size="10.5" fill="var(--bg)">' +
    svgEsc(b.label) + '</text>';
}

/* 창 크기가 바뀌면 궤도도 다시 그린다. 크기를 타는 것은 하늘뿐이다 - 예전에는
   목록 · 달력까지 통째로 다시 지었다. */
let _skyT = 0, SKY_ALL = null, _skyW = 0;
const skyAgain = () => { clearTimeout(_skyT); _skyT = setTimeout(() => { if(STATE && SKY_ALL) drawSky(SKY_ALL); }, 120); };
window.addEventListener('resize', skyAgain);
/* 창 크기(resize)만 보면 놓치는 것이 있다 - 처음 그린 순간의 폭이 배치가 끝나기
   전 값이면 능선이 창 끝에 못 미친 채 남았다. 하늘 폭 자체를 지켜본다. */
if(window.ResizeObserver) new ResizeObserver(en => {
  const w = Math.round(en[0].contentRect.width);
  if(w && w !== _skyW){ _skyW = w; skyAgain(); }
}).observe($('#sky-art'));
/* 해는 계속 움직인다. 1분마다 빛과 궤도를 다시 맞춘다 */
/* 빛만 다시 비춘다 - 그림자 방향도 함께 돈다 (예전에는 색만 바꾸고 그림자는
   다음 번 다시 그릴 때까지 그대로였다) */
setInterval(() => { if(STATE && STATE.now && !document.hidden) relight(); }, 60000);
applyLight(new Date().getHours()*60 + new Date().getMinutes());
