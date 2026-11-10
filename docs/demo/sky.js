/* web/sky.js - 화면의 빛 (낮 · 밤)

   app.js 에서 떼어 냈다. app.js 가 개요를 그릴 때 relight() 를 부르고, 설정에서 화면 모드를 고르면 themeTo() 를 부른다.
   여기는 STATE · THEME 을 읽기만 한다. 불러오는 차례: when.js → app.js → sky.js.

   2026-11 XX. 예전에는 해 높이로 분마다 색을 섞었다 (해 뜸 · 노을 · 밤, 오늘 일을 다 마치면 밤으로).
   화면 모드는 이제 셋이다 - 자동(Windows 의 앱 모드를 따른다) · 낮 · 밤. 색은 이 둘 사이를 바뀔 때 한 번만
   흘러간다 (dk: 0 낮 ~ 1 밤). 해를 따라 저절로 어두워지는 것은 무엇을 알리는 일이 아니었고, 일을 다 마친 순간
   화면이 뒤집히는 것은 놀라게 했다. */

const hx = c => { c = c.replace('#',''); return [0,2,4].map(i => parseInt(c.slice(i,i+2),16)); };
const mixc = (a,b,t) => { const A = hx(a), B = hx(b);
  return '#' + [0,1,2].map(i => ('0' + Math.round(A[i] + (B[i]-A[i])*t).toString(16)).slice(-2)).join(''); };
/* 상대 휘도 (WCAG). 글자를 먹빛으로 둘지 흰빛으로 둘지 면의 실제 밝기로 정할 때 쓴다 */
const lum = c => { const [r, g, b] = hx(c).map(v => { v /= 255; return v <= .04045 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); });
  return .2126 * r + .7152 * g + .0722 * b; };

/* tokens.py 가 넣어 둔 재료를 읽는다 - 색을 여기 또 적으면 언젠가 어긋난다 */
const LIT = (() => {
  const cs = getComputedStyle(document.documentElement), o = {};
  ['panel','base','base-top','shelf','lens','ink','ink2','teal','accent','night','base-n','base-top-n','shelf-n','lens-n','pale','pale2',
   'teal-lit','teal-deep','accent-lit','lens-a','lens-a-n',
   'late','late-lit','hol','hol-lit','danger','danger-lit','imp','imp-lit']
    .forEach(k => { o[k] = cs.getPropertyValue('--lit-' + k).trim(); });
  return o;
})();

/* 뿌리(:root)의 변수를 하나라도 쓰면 브라우저는 화면 전체의 스타일을 다시 셈한다. 값이 그대로인 것은 쓰지 않는다. */
const _lit = {};
function setLit(k, v){
  if(_lit[k] === v) return;
  _lit[k] = v;
  document.documentElement.style.setProperty(k, v);
}

let THEME = 'auto';
const DARK_OS = matchMedia('(prefers-color-scheme: dark)');
/* 지금 원하는 밤의 정도: 0 낮 · 1 밤. 갈무리 중 '밤' 화면은 밤으로 못 박는다 */
const wantDark = () => (typeof SHOT_MIN !== 'undefined' && SHOT_MIN === 0) ? 1
  : THEME === 'dark' ? 1 : THEME === 'light' ? 0 : (DARK_OS.matches ? 1 : 0);

function applyLight(dk){
  const surface = mixc(LIT.panel, LIT.night, dk);
  const flip = lum(surface) < .3 ? 1 : 0;
  const txt = flip ? LIT.pale : LIT.ink;
  setLit('--surface', surface);
  setLit('--lens',    mixc(LIT.lens, LIT['lens-n'], dk));
  setLit('--field',   mixc(LIT.lens, LIT['lens-n'], dk));
  /* 바탕: 카드가 떠 있는 하늘빛 안개. 위 끝(머리 뒤)이 가장 맑다. 선반 카드는 한 겹 하늘빛 */
  setLit('--bg',      mixc(LIT.base, LIT['base-n'], dk));
  setLit('--bg-top',  mixc(LIT['base-top'], LIT['base-top-n'], dk));
  setLit('--shelfbg', mixc(LIT.shelf, LIT['shelf-n'], dk));
  /* 카드 그림자의 빛깔: 낮에는 바탕의 하늘을 머금은 먹, 밤에는 검정 */
  setLit('--shade',   flip ? '0,0,0' : '28,52,60');
  /* 도자기 카드의 윗변 빛 · 결: 밤에는 거의 지운다 (어두운 면의 흰 빛은 테두리처럼 보인다) */
  setLit('--hi',      flip ? 'rgba(255,255,255,.06)' : 'rgba(255,255,255,.9)');
  setLit('--face-a',  flip ? '.025' : '.6');
  /* 해시계 하늘의 빛: 밤에는 달빛처럼 옅은 하늘 */
  setLit('--sun-day', flip ? 'rgba(156,203,205,.07)' : 'rgba(255,255,255,.75)');
  setLit('--sun-eve', flip ? 'rgba(235,200,170,.06)' : 'rgba(255,244,232,.85)');
  /* 글자는 섞지 않고 한 번에 뒤집는다 - 섞으면 그 사이에 회색 글자가 생긴다 */
  setLit('--text',    txt);
  setLit('--text2',   flip ? LIT.pale2 : LIT.ink2);
  setLit('--faint',   mixc(flip ? LIT.pale2 : LIT.ink2, surface, .32));
  setLit('--teal',    flip ? LIT['teal-lit'] : LIT.teal);
  setLit('--accent',  flip ? LIT['accent-lit'] : LIT.accent);
  /* 렌즈: 화면에서 유일하게 뒤집힌 면 - 낮에는 흑연에 흰 글자, 밤에는 밝은 종이에 먹 글자. 글자는 렌즈 밝기로 정한다 */
  const la = mixc(LIT['lens-a'], LIT['lens-a-n'], dk), lf = lum(la) < .3;
  setLit('--lensa',       la);
  setLit('--lensa-text',  lf ? LIT.pale : LIT.ink);
  setLit('--lensa-text2', lf ? LIT.pale2 : LIT.ink2);
  setLit('--lensa-teal',  lf ? LIT['teal-lit'] : LIT['teal-deep']);
  setLit('--lensa-late',  lf ? LIT['late-lit'] : LIT.late);
  setLit('--late',    flip ? LIT['late-lit'] : LIT.late);
  setLit('--hol',     flip ? LIT['hol-lit'] : LIT.hol);
  setLit('--danger',  flip ? LIT['danger-lit'] : LIT.danger);
  setLit('--imp',     flip ? LIT['imp-lit'] : LIT.imp);
  setLit('--on-teal', flip ? LIT.night : '#fff');
  const ink = hx(txt).join(',');
  setLit('--hair',     'rgba(' + ink + ',' + (flip ? '.12' : '.09') + ')');
  setLit('--hair2',    'rgba(' + ink + ',' + (flip ? '.2' : '.18') + ')');
  setLit('--hover',    'rgba(' + ink + ',' + (flip ? '.04' : '.035') + ')');
  setLit('--hover-hi', 'rgba(' + ink + ',' + (flip ? '.08' : '.07') + ')');
  document.body.classList.toggle('night-ink', flip === 1);
  document.documentElement.style.colorScheme = flip ? 'dark' : 'light';
}

/* 밝기를 바꾸면 화면이 한 번에 뒤집히지 않고 0.6초 동안 흘러간다. 움직임을 꺼 두었으면 한 번에 */
let DK = null, _lightA = 0;
function relight(){
  const want = wantDark();
  if(DK === null || calm()){ DK = want; cancelAnimationFrame(_lightA); _lightA = 0; applyLight(DK); return; }
  if(DK === want || _lightA) return;
  const from = DK, t0 = performance.now(), dur = 600;
  const step = t => {
    const u = Math.min(1, (t - t0) / dur), e = u < .5 ? 4 * u * u * u : 1 - Math.pow(-2 * u + 2, 3) / 2;
    DK = from + (wantDark() - from) * e;
    applyLight(DK);
    _lightA = u < 1 ? requestAnimationFrame(step) : 0;
    if(!_lightA) DK = wantDark();
  };
  _lightA = requestAnimationFrame(step);
}
function themeTo(change){ change(); relight(); }
DARK_OS.addEventListener('change', relight);
relight();
