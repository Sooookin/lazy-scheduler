/* ══════════ 글에서 날짜 · 시각 알아듣기 ══════════
   "내일3시 보고서" · "보고서 금욜 오후 두시반" · "sodlf 3tl 회의" (한/영을 안 바꾸고 친 내일 3시) ·
   "10/12~16 출장" 처럼 아무렇게나 써도 날짜 · 기간 · 시각을 찾는다. 규칙은 이렇다:

   1. 글자를 자모로 푼다. 낱말 사전과 비교할 때 자모 단위 편집 거리를 쓰되, 바꿔 치기 쉬운 것은 싸게
      센다 - ㅐ/ㅔ (모래 → 모레), 예사소리/된소리 (담쭈 → 담주), 두벌식 자판에서 이웃한 글쇠 (내잉 → 내일).
      그래서 오타가 나도 가까운 낱말로 읽힌다. 짧은 낱말(시 · 분 · 월)은 틀려서는 안 되므로 정확히만 받는다.
   2. 띄어쓰기는 보지 않는다. 낱말 안의 빈칸("다음 주")도, 붙여 쓴 것("내일3시")도 같다.
   3. 순서도 보지 않는다. 날짜 · 시각 후보를 글 전체에서 모두 찾고, 겹치지 않는 것 가운데
      가장 그럴듯한 조합(날짜 하나 · 시각 하나)을 고른다. 떨어져 있는 "오후" 나 "다음 주" 도 붙여 읽는다.
   4. 영문 자판인 채로 친 글자(sodlf)는 두벌식으로 옮겨 읽어 본다 - 사전 낱말이 될 때만 받는다.
   5. 흔한 낱말이 날짜 낱말과 닮았으면 (매일 ↔ 내일, 월간) 오타로 보지 않는다.

   날짜는 정답이 하나이므로 계산은 코드가 한다 (언어모델에 맡기지 않는다).
   결과: {date, start, time, rest, spans:[[시작, 끝, 종류]], notes:[…]} 또는 null.
   이 파일은 화면(app.js)과 tests/vectors/when.json 의 검사가 같이 쓴다. */
(function(root){
'use strict';

/* ---------- 자모 ---------- */
const CHO = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const JUNG = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const JONG = ['', 'ㄱ', 'ㄲ', 'ㄳ', 'ㄴ', 'ㄵ', 'ㄶ', 'ㄷ', 'ㄹ', 'ㄺ', 'ㄻ', 'ㄼ', 'ㄽ', 'ㄾ', 'ㄿ', 'ㅀ',
              'ㅁ', 'ㅂ', 'ㅄ', 'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ'];
const isSyl = c => c >= '가' && c <= '힣';
const isHan = c => isSyl(c) || (c >= 'ㄱ' && c <= 'ㅣ');
function jamo(s){
  const out = [];
  for(const c of s){
    if(isSyl(c)){
      const k = c.charCodeAt(0) - 0xAC00;
      out.push(CHO[Math.floor(k / 588)], JUNG[Math.floor(k % 588 / 28)]);
      if(k % 28) out.push(JONG[k % 28]);
    }else out.push(c);
  }
  return out;
}

/* ---------- 두벌식 자판 ----------
   글쇠의 자리 (줄, 칸). 이웃한 글쇠를 잘못 누른 것은 싸게 센다. 영문 자판인 채로 친 글을
   한글로 옮길 때도 이 표를 쓴다. */
const KEYS = [['q', 'ㅂ'], ['w', 'ㅈ'], ['e', 'ㄷ'], ['r', 'ㄱ'], ['t', 'ㅅ'], ['y', 'ㅛ'], ['u', 'ㅕ'], ['i', 'ㅑ'], ['o', 'ㅐ'], ['p', 'ㅔ'],
              ['a', 'ㅁ'], ['s', 'ㄴ'], ['d', 'ㅇ'], ['f', 'ㄹ'], ['g', 'ㅎ'], ['h', 'ㅗ'], ['j', 'ㅓ'], ['k', 'ㅏ'], ['l', 'ㅣ'],
              ['z', 'ㅋ'], ['x', 'ㅌ'], ['c', 'ㅊ'], ['v', 'ㅍ'], ['b', 'ㅠ'], ['n', 'ㅜ'], ['m', 'ㅡ']];
const SHIFT = {Q:'ㅃ', W:'ㅉ', E:'ㄸ', R:'ㄲ', T:'ㅆ', O:'ㅒ', P:'ㅖ'};
const KEYPOS = {};
KEYS.forEach(([k, j], n) => {
  const row = n < 10 ? 0 : n < 19 ? 1 : 2, col = n < 10 ? n : n < 19 ? n - 10 : n - 19;
  KEYPOS[j] = [row, col + [0, .25, .75][row]];
});
const KEY2J = Object.fromEntries(KEYS);

/* 바꿔 치기 값. 같으면 0, 흔히 헷갈리는 것은 싸게, 나머지는 1 */
const PAIRS = [['ㅐ', 'ㅔ', .3], ['ㅒ', 'ㅖ', .3], ['ㅙ', 'ㅞ', .3], ['ㅚ', 'ㅞ', .3], ['ㅚ', 'ㅙ', .3],
               ['ㄱ', 'ㄲ', .45], ['ㄷ', 'ㄸ', .45], ['ㅂ', 'ㅃ', .45], ['ㅅ', 'ㅆ', .45], ['ㅈ', 'ㅉ', .45],
               ['ㄱ', 'ㅋ', .6], ['ㄷ', 'ㅌ', .6], ['ㅂ', 'ㅍ', .6], ['ㅈ', 'ㅊ', .6], ['ㅓ', 'ㅕ', .6], ['ㅗ', 'ㅛ', .6],
               ['ㅜ', 'ㅠ', .6], ['ㅡ', 'ㅜ', .7]];
const SUB = {};
PAIRS.forEach(([a, b, w]) => { SUB[a + b] = SUB[b + a] = w; });
function sub(a, b){
  if(a === b) return 0;
  if(SUB[a + b] != null) return SUB[a + b];
  const p = KEYPOS[a], q = KEYPOS[b];
  if(p && q && Math.hypot(p[0] - q[0], p[1] - q[1]) < 1.3) return .7;
  return 1;
}
/* 자모 열 두 개의 거리 (바꿔 치기 · 넣기 · 빼기 · 이웃 둘 뒤바꾸기). 받침 하나를 빼먹는 일이 흔해
   넣고 빼는 값도 1 보다 조금 싸다. */
function dist(a, b){
  const n = a.length, m = b.length, D = [];
  for(let i = 0; i <= n; i++){ D.push(new Array(m + 1).fill(0)); D[i][0] = i * .8; }
  for(let j = 0; j <= m; j++) D[0][j] = j * .8;
  for(let i = 1; i <= n; i++) for(let j = 1; j <= m; j++){
    let v = Math.min(D[i - 1][j] + .8, D[i][j - 1] + .8, D[i - 1][j - 1] + sub(a[i - 1], b[j - 1]));
    if(i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, D[i - 2][j - 2] + .6);
    D[i][j] = v;
  }
  return D[n][m];
}

/* ---------- 영문 자판으로 친 한글 → 한글 ---------- */
const JW = {'ㅗㅏ':'ㅘ', 'ㅗㅐ':'ㅙ', 'ㅗㅣ':'ㅚ', 'ㅜㅓ':'ㅝ', 'ㅜㅔ':'ㅞ', 'ㅜㅣ':'ㅟ', 'ㅡㅣ':'ㅢ'};
const JJ = {'ㄱㅅ':'ㄳ', 'ㄴㅈ':'ㄵ', 'ㄴㅎ':'ㄶ', 'ㄹㄱ':'ㄺ', 'ㄹㅁ':'ㄻ', 'ㄹㅂ':'ㄼ', 'ㄹㅅ':'ㄽ', 'ㄹㅌ':'ㄾ', 'ㄹㅍ':'ㄿ', 'ㄹㅎ':'ㅀ', 'ㅂㅅ':'ㅄ'};
const isV = j => JUNG.includes(j);
function toHangul(latin){
  const js = [];
  for(const c of latin){
    const j = SHIFT[c] || KEY2J[c.toLowerCase()];
    if(!j) return null;
    js.push(j);
  }
  /* 첫소리 · 가운뎃소리 · 끝소리를 차례로 모은다. 끝소리 뒤에 홀소리가 오면 그 닿소리는 다음 글자로 간다 */
  let out = '', L = null, V = null, T = '';
  const flush = () => {
    if(L && V) out += String.fromCharCode(0xAC00 + (CHO.indexOf(L) * 21 + JUNG.indexOf(V)) * 28 + JONG.indexOf(T));
    else out += (L || '') + (V || '') + T;
    L = V = null; T = '';
  };
  for(const j of js){
    if(isV(j)){
      if(L && V && !T && JW[V + j]){ V = JW[V + j]; continue; }
      if(L && V && T){
        const last = T.length > 1 ? null : T;
        let carry;
        const two = Object.keys(JJ).find(k => JJ[k] === T);
        if(two){ T = two[0]; carry = two[1]; } else { carry = last; T = ''; }
        flush(); L = carry; V = j; continue;
      }
      if(L && !V){ V = j; continue; }
      flush(); V = j; flush(); continue;
    }
    if(!L){ L = j; continue; }
    if(!V){ flush(); L = j; continue; }
    if(!T && JONG.includes(j)){ T = j; continue; }
    if(T && JJ[T + j]){ T = JJ[T + j]; continue; }
    flush(); L = j;
  }
  flush();
  return out;
}

/* ---------- 사전 ----------
   [낱말, 종류, 값, 오타 허용]. 같은 종류 안의 여러 말은 같은 뜻이다. */
const LEX = [];
const add = (k, v, words, fz) => words.split('|').forEach(w => LEX.push({w, k, v, fz: !!fz, j: jamo(w)}));
add('day', 0, '오늘|금일|당일|today', 1);
add('day', 1, '내일|낼|명일|익일|tomorrow|tmr|tmrw', 1);
add('day', 2, '모레|내일모레|낼모레', 1);
add('day', 3, '글피', 1);
add('wk', 0, '이번주|이번 주|금주|this week', 1);
add('wk', 1, '다음주|담주|차주|next week', 1);
add('wk', 2, '다다음주|다담주', 1);
const WDN = '월화수목금토일';
[...WDN].forEach((c, i) => {
  add('wd', i, c + '요일|' + c + '욜', 1);
  add('wds', i, c);
});
'mon tue wed thu fri sat sun'.split(' ').forEach((w, i) => add('wd', i, w + '|' + ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'][i]));
add('ap', 'am', '오전|am|a.m.|a', 1);
add('ap', 'pm', '오후|pm|p.m.|p', 1);
add('ap', 'early', '새벽', 1);
add('ap', 'morning', '아침', 1);
add('ap', 'noon', '점심|낮', 1);
add('ap', 'evening', '저녁', 1);
add('ap', 'night', '밤', 0);
add('pt', '12:00', '정오|noon', 1);
add('pt', '09:00', '출근', 1);
add('pt', '18:00', '퇴근', 1);
add('u', 'h', '시');
add('u', 'min', '분');
add('u', 'half', '반');
add('u', 'mon', '월');
add('u', 'day', '일');
add('u', 'week', '주|주일');
add('u', 'month', '달|개월');
add('pos', 'end', '말');
add('pos', 'start', '초');
add('pos', 'mid', '중순');
add('mpos', 'end', '월말', 1);
add('mpos', 'start', '월초', 1);
add('mrel', 0, '이번달|이번 달|이달|금월', 1);
add('mrel', 1, '다음달|다음 달|담달|익월', 1);
add('wkend', 0, '주말|weekend', 1);
add('after', 1, '뒤|후|later');
add('dur', 1, '간|동안');
add('from', 1, '부터|에서');
add('to', 1, '까지|까진|전까지|until');
add('glue', 1, '에|쯤|경|즈음|날|때');
add('pre', 1, '오는|돌아오는|coming');
/* 고유어 수: 시(한 시 · 열두 시)와 날 수(하루 · 이틀) */
'한 두 세 네 다섯 여섯 일곱 여덟 아홉 열 열한 열두'.split(' ').forEach((w, i) => add('kn', i + 1, w));
'하루 이틀 사흘 나흘 닷새 엿새 이레'.split(' ').forEach((w, i) => add('kd', i + 1, w, 1));
add('kd', 7, '일주일', 1);
add('kd', 14, '이주일|2주일', 0);
'십 이십 삼십 사십 오십'.split(' ').forEach((w, i) => add('sm', (i + 1) * 10, w));
add('sm', 15, '십오');
add('sm', 45, '사십오');
/* 날짜 낱말과 닮았지만 다른 뜻인 흔한 말. 이 말이 그대로 있으면 오타로 보지 않는다 */
const KEEP = ('메일 매일 매주 매월 매달 매년 매번 월간 주간 일간 연간 내용 내부 내역 모델 오류 오른 오픈 저작 저널 ' +
              '이번에 다음에 다음은 다른 아침밥 금요 주말농장 오프 일정 전날').split(' ');
const MAXW = Math.max(...LEX.map(e => e.w.replace(/ /g, '').length));

/* ---------- 1. 낱말로 나누기 ----------
   자리마다 사전의 모든 낱말을 대 보고 가장 그럴듯한 것을 고른다 (정확히 맞는 긴 것 > 오타 > 짧은 것).
   낱말 안의 빈칸은 건너뛰고 잰다 ("다음 주" = "다음주"). */
function lex(s){
  const toks = [];
  let i = 0;
  const keepAt = new Array(s.length).fill(false);
  KEEP.forEach(w => { let k = s.indexOf(w); while(k >= 0){ for(let x = k; x < k + w.length; x++) keepAt[x] = true; k = s.indexOf(w, k + 1); } });
  while(i < s.length){
    const c = s[i];
    if(/\s/.test(c)){ i++; continue; }
    if(/\d/.test(c)){
      let j = i; while(j < s.length && /\d/.test(s[j])) j++;
      toks.push({k:'num', v:+s.slice(i, j), n:j - i, s:i, e:j, c:1});
      i = j; continue;
    }
    if('~∼〜–—-/.:'.includes(c)){ toks.push({k:'sep', v:c === '∼' || c === '〜' ? '~' : c === '—' || c === '–' ? '-' : c, s:i, e:i + 1, c:1}); i++; continue; }
    let best = null;
    /* 빈칸을 빼고 글자 L 개를 모은다 (빈칸은 낱말 안에 하나까지) */
    const grab = L => {
      let t = '', j = i, sp = 0;
      while(t.length < L && j < s.length){
        if(s[j] === ' '){ if(++sp > 1 || !t) return null; j++; continue; }
        t += s[j]; j++;
      }
      return t.length === L ? [t, j] : null;
    };
    for(let L = 1; L <= MAXW + 1; L++){
      const g = grab(L);
      if(!g) break;
      const [t, j] = g;
      const low = t.toLowerCase();
      for(const e of LEX){
        const ew = e.w.replace(/ /g, '');
        let c = 0;
        /* 영어 낱말은 통째로만 (monitor 의 mon 은 월요일이 아니다) */
        if(/^[a-z]/.test(ew) && (/[a-z]/i.test(s[i - 1] || '') || /[a-z]/i.test(s[j] || ''))) continue;
        if(ew === low) c = 1;
        else if(!aloneIn(s, i, j)) continue;          /* 오타로 읽는 것은 홀로 선 낱말만 (모래시계 ≠ 모레) */
        else if(e.fz && ew.length >= 2 && Math.abs(ew.length - L) <= 1 && [...t].every(isHan) && !keepAt[i]){
          /* 짧은 낱말은 싼 실수 하나까지 (모래 · 내잉 · 담쭈), 긴 낱말은 실수 둘까지. 메일 ≠ 내일 */
          const tol = e.j.length >= 7 ? 1.5 : e.j.length >= 4 ? .75 : 0;
          const d = dist(jamo(t), e.j);
          if(d <= tol) c = 1 - d * .35;
        }
        if(!c) continue;
        /* 점수: 맞은 정도 × 길이. 한 글자 낱말은 낮게 - 긴 낱말이 있으면 그쪽이 이긴다 */
        const sc = c * (L === 1 ? .9 : L);
        if(!best || sc > best.sc) best = {k:e.k, v:e.v, w:ew, s:i, e:j, c, sc};
      }
    }
    if(best){ toks.push(best); i = best.e; }
    else { toks.push({k:'x', s:i, e:i + 1, c:0}); i++; }
  }
  return toks;
}

/* ---------- 날짜 셈 ---------- */
const P2 = n => String(n).padStart(2, '0');
const key = d => d.getFullYear() + '-' + P2(d.getMonth() + 1) + '-' + P2(d.getDate());
const day0 = k => new Date(+k.slice(0, 4), +k.slice(5, 7) - 1, +k.slice(8, 10), 12);
const plus = (k, n) => { const d = day0(k); d.setDate(d.getDate() + n); return key(d); };
const wdOf = k => (day0(k).getDay() + 6) % 7;             /* 월요일이 0 */

function Ctx(o){
  const today = o.today, biz = o.isBiz || (() => true);
  const back = k => { for(let n = 0; n < 15 && !biz(k); n++) k = plus(k, -1); return k; };
  const fwd = k => { for(let n = 0; n < 15 && !biz(k); n++) k = plus(k, 1); return k; };
  const valid = (y, m, d) => { const t = new Date(y, m - 1, d, 12); return t.getMonth() === m - 1 ? key(t) : null; };
  return {
    today,
    /* 달 · 날. 한 달 넘게 지난 날이면 내년 (12월에 쓴 "1/5") */
    md(m, d){
      const y = +today.slice(0, 4);
      const k = valid(y, m, d);
      if(!k) return null;
      return k < plus(today, -30) ? valid(y + 1, m, d) : k;
    },
    /* 날만: 이번 달, 지났으면 다음 달 */
    d(dd){
      const y = +today.slice(0, 4), m = +today.slice(5, 7);
      let k = valid(y, m, dd);
      if(!k || k < today){ const t = new Date(y, m, 1, 12); k = valid(t.getFullYear(), t.getMonth() + 1, dd); }
      return k;
    },
    rel: n => plus(today, n),
    week(w, wd){
      const k = plus(plus(today, -wdOf(today)), w * 7 + wd);
      return w === 0 && k < today ? plus(k, 7) : k;    /* 일요일에 쓴 "이번 주 금" 은 오는 금요일 */
    },
    next: wd => plus(today, (wd - wdOf(today) + 7) % 7),
    /* 달의 끝 · 처음 · 가운데. 영업일만 쓰면 끝은 마지막 영업일, 처음은 첫 영업일 */
    month(y, m, pos){
      if(pos === 'end') return back(key(new Date(y, m, 0, 12)));
      if(pos === 'start') return fwd(key(new Date(y, m - 1, 1, 12)));
      return fwd(key(new Date(y, m - 1, 15, 12)));
    },
    monthRel(r, pos){
      const t = day0(today);
      let y = t.getFullYear(), m = t.getMonth() + 1 + r;
      if(m > 12){ m -= 12; y++; }
      let k = this.month(y, m, pos);
      if(r === 0 && k < today && pos !== 'mid'){ m++; if(m > 12){ m = 1; y++; } k = this.month(y, m, pos); }
      if(r === 0 && pos === 'start' && k <= today){ m = +today.slice(5, 7) + 1; y = +today.slice(0, 4); if(m > 12){ m = 1; y++; } k = this.month(y, m, pos); }
      return k;
    },
    monthN(mo, pos){
      const y = +today.slice(0, 4);
      let k = this.month(y, mo, pos);
      return k < plus(today, -30) ? this.month(y + 1, mo, pos) : k;
    },
    months(n){
      const t = day0(today);
      t.setMonth(t.getMonth() + n);
      return key(t);
    },
  };
}

/* ---------- 2. 틀에 맞추기 ----------
   낱말 열에서 날짜 · 시각이 되는 틀을 모두 찾는다. 틀 사이의 빈칸 · 토씨(에 · 쯤)는 건너뛴다. */
/* "월" · "일" 은 요일 글자로 읽혔어도 달 · 날의 단위다 */
const UW = {0: 'mon', 6: 'day'};

/* 낱말이 홀로 서 있나: 앞뒤가 다른 한글 글자에 붙어 있지 않다 (뒤에 붙은 토씨는 괜찮다) */
const PART = /^(까지|까진|에서|에|부터|쯤|경|즈음|때|은|는|이|가|을|를|도|만|엔)/;
const aloneIn = (s, a, b) => !isSyl(s[a - 1] || '') && (!isSyl(s[b] || '') || PART.test(s.slice(b)));

function readAll(toks, cx, s){
  const C = [];
  const alone = t => aloneIn(s, t.s, t.e);
  const T = i => toks[i];
  const is = (i, k, v) => T(i) && (T(i).k === k || (k === 'u' && T(i).k === 'wds' && UW[T(i).v] === v))
    && (v === undefined || T(i).v === v || (k === 'u' && UW[T(i).v] === v));
  /* 사이에 낀 토씨는 건너뛴 다음 낱말 */
  const nx = i => { let j = i + 1; while(is(j, 'glue')) j++; return j; };
  const add = (slot, i0, i1, val, conf, extra) =>
    C.push(Object.assign({slot, s:T(i0).s, e:T(i1).e, i0, i1, val, conf}, extra || {}));
  const conf = (a, b) => { let c = 1; for(let i = a; i <= b; i++) if(toks[i].c) c = Math.min(c, toks[i].c); return c; };
  const hourNum = i => is(i, 'num') && T(i).n <= 2 && T(i).v <= 24 ? T(i).v : is(i, 'kn') ? T(i).v : null;

  for(let i = 0; i < toks.length; i++){
    const t = T(i);
    /* ── 시각 ── */
    /* [오전/오후] 3 시 [30 분 | 반] [오전/오후] - 한 시 · 열두 시 같은 고유어 수도 */
    const h = hourNum(i);
    if(h != null && is(nx(i), 'u', 'h') && s[T(nx(i)).e] !== '간'){        /* 3시간 은 시각이 아니다 */
      let j = nx(i), m = 0;
      if(is(nx(j), 'u', 'half')){ j = nx(j); m = 30; }
      else if(is(nx(j), 'num') && T(nx(j)).v < 60 && is(nx(nx(j)), 'u', 'min')){ m = T(nx(j)).v; j = nx(nx(j)); }
      else if(is(nx(j), 'sm') && is(nx(nx(j)), 'u', 'min')){ m = T(nx(j)).v; j = nx(nx(j)); }
      let a = i, ap = null;
      if(i > 0 && is(i - 1, 'ap')){ a = i - 1; ap = T(i - 1).v; }
      else if(is(nx(j), 'ap')){ j = nx(j); ap = T(j).v; }
      add('time', a, j, {h, m, ap}, conf(a, j), {w:2 + (m ? 1 : 0) + (ap ? 1 : 0)});
    }
    /* 15:30 · 3:30pm · 3:30 오후 */
    if(is(i, 'num') && t.n <= 2 && is(i + 1, 'sep', ':') && is(i + 2, 'num') && T(i + 2).n === 2 && t.v <= 24 && T(i + 2).v < 60){
      let a = i, j = i + 2, ap = null;
      if(i > 0 && is(i - 1, 'ap')){ a = i - 1; ap = T(i - 1).v; }
      else if(is(nx(j), 'ap')){ j = nx(j); ap = T(j).v; }
      add('time', a, j, {h:t.v, m:T(i + 2).v, ap, h24:!ap}, conf(a, j), {w:3 + (ap ? 1 : 0)});
    }
    /* 3pm · 3 pm · 3p (a · p 한 글자는 숫자에 붙여 쓴 것만) */
    if(is(i, 'num') && t.n <= 2 && t.v >= 1 && t.v <= 12 && is(i + 1, 'ap') && /^[ap]/.test(T(i + 1).w)
       && (T(i + 1).w.length > 1 || T(i + 1).s === t.e))
      add('time', i, i + 1, {h:t.v, m:0, ap:T(i + 1).v}, conf(i, i + 1), {w:3});
    /* 정오 · 출근 · 퇴근 · 아침 (시각이 따로 없을 때만 쓰인다. 낱말 가운데의 "밤"(밤샘)은 아니다) */
    if(is(i, 'pt') && alone(t)) add('time', i, i, {fixed:t.v}, t.c * .8, {w:1});
    if(is(i, 'ap') && alone(t) && ['morning', 'noon', 'evening', 'night'].includes(t.v))
      add('time', i, i, {fixed:{morning:'09:00', noon:'12:00', evening:'18:00', night:'21:00'}[t.v]}, t.c * .5, {w:.5});

    /* ── 날짜 ── */
    if(is(i, 'day')) add('date', i, i, {date:cx.rel(t.v)}, t.c, {w:2});
    /* 10월 12일 · 10월 말 · 12월 초 */
    if(is(i, 'num') && t.n <= 2 && is(nx(i), 'u', 'mon')){
      const j = nx(i);
      if(is(nx(j), 'num') && T(nx(j)).n <= 2 && is(nx(nx(j)), 'u', 'day')){
        const k = cx.md(t.v, T(nx(j)).v);
        if(k) add('date', i, nx(nx(j)), {date:k}, conf(i, nx(nx(j))), {w:4});
      }else if(is(nx(j), 'pos') && t.v >= 1 && t.v <= 12) add('date', i, nx(j), {date:cx.monthN(t.v, T(nx(j)).v)}, 1, {w:3});
    }
    /* 11월말 · 11월 말 ("월말" 이 한 낱말로 읽힌다) */
    if(is(i, 'num') && t.n <= 2 && t.v >= 1 && t.v <= 12 && is(nx(i), 'mpos'))
      add('date', i, nx(i), {date:cx.monthN(t.v, T(nx(i)).v)}, 1, {w:3});
    /* 10/12 · 10.12 · 2026-10-12 */
    if(is(i, 'num') && t.n <= 2 && is(i + 1, 'sep') && '/.-'.includes(T(i + 1).v) && is(i + 2, 'num') && T(i + 2).n <= 2
       && T(i + 1).s === t.e && T(i + 2).s === T(i + 1).e){
      const after = toks[i + 3];
      const dot = T(i + 1).v === '.', dash = T(i + 1).v === '-';
      /* 2.5% · v1.2 같은 것은 날짜가 아니다: 점 · 줄표는 그 뒤에 아무것도 붙지 않을 때만 */
      const glued = (after && after.s === T(i + 2).e && after.k === 'x') || /[A-Za-z]/.test(s[t.s - 1] || '');
      if(!((dot || dash) && glued)){
        const k = cx.md(t.v, T(i + 2).v);
        if(k) add('date', i, i + 2, {date:k}, dot || dash ? .8 : 1, {w:3, md:[t.v, T(i + 2).v]});
      }
    }
    if(is(i, 'num') && t.n === 4 && is(i + 1, 'sep') && is(i + 2, 'num') && is(i + 3, 'sep') && is(i + 4, 'num')){
      const k = (() => { const d = new Date(t.v, T(i + 2).v - 1, T(i + 4).v, 12); return d.getDate() === T(i + 4).v ? key(d) : null; })();
      if(k) add('date', i, i + 4, {date:k}, 1, {w:5});
    }
    /* 12일 (뒤에 간 · 동안 · 뒤 · 후가 오면 날 수다) */
    if(is(i, 'num') && t.n <= 2 && t.v >= 1 && t.v <= 31 && is(nx(i), 'u', 'day') && !(i > 0 && is(i - 1, 'u', 'mon'))){
      const j = nx(i), n2 = toks[nx(j)];
      if(!(n2 && (n2.k === 'after' || n2.k === 'dur')) && !(toks[j + 1] && toks[j + 1].s === T(j).e && toks[j + 1].k === 'x'))
        add('date', i, j, {date:cx.d(t.v), dom:t.v}, .9, {w:2});
    }
    /* N일 뒤 · 3주 후 · 2달 뒤 · 이틀 뒤 · 일주일 후 */
    if((is(i, 'num') && t.n <= 3) || is(i, 'kd')){
      let j = i, n = t.v, per = 1;
      if(is(i, 'num')){
        j = nx(i);
        if(is(j, 'u', 'day')) per = 1; else if(is(j, 'u', 'week')) per = 7; else if(is(j, 'u', 'month')) per = 30; else j = -1;
      }
      if(j >= 0 && is(nx(j), 'after')){
        const k = per === 30 ? cx.months(n) : cx.rel(n * per);
        add('date', i, nx(j), {date:k}, conf(i, nx(j)), {w:3});
      }
    }
    /* 다음 주 금요일 · 다음주 금 · 금요일 다음 주 · 금요일 */
    if(is(i, 'wk') && (is(nx(i), 'wd') || (is(nx(i), 'wds') && aloneIn(s, T(nx(i)).s, T(nx(i)).e))))      /* 다음주 금리 ≠ 금요일 */
      add('date', i, nx(i), {date:cx.week(t.v, T(nx(i)).v)}, conf(i, nx(i)), {w:4});
    if(is(i, 'wd')){
      if(is(nx(i), 'wk')) add('date', i, nx(i), {date:cx.week(T(nx(i)).v, t.v)}, conf(i, nx(i)), {w:4});
      add('date', i, i, {date:cx.next(t.v), wd:t.v}, t.c, {w:2});
    }
    /* 다음 주(까지) → 그 주 금요일 */
    if(is(i, 'wk')) add('date', i, i, {date:cx.week(t.v, 4), wk:t.v}, t.c * .7, {w:1});
    /* 이번 주말 · 다음주말 ("주말" 이 "주" + "말" 로 나뉘어 읽힌 것) */
    if(is(i, 'wk') && is(i + 1, 'pos', 'end') && T(i + 1).s === T(i).e)
      add('date', i, i + 1, {date:cx.week(t.v, 5)}, t.c, {w:3});
    /* 주말 · 다음 주말 */
    if(is(i, 'wkend')){
      const w = i > 0 && is(i - 1, 'wk') ? T(i - 1).v : 0;
      add('date', w && i > 0 && is(i - 1, 'wk') ? i - 1 : i, i, {date:cx.week(w, 5)}, t.c, {w:2});
    }
    /* 월말 · 이번 달 말 · 다음 달 초 · 다음 달 15일 */
    if(is(i, 'mpos')) add('date', i, i, {date:cx.monthRel(0, t.v)}, t.c, {w:2});
    if(is(i, 'mrel')){
      const j = nx(i);
      if(is(j, 'pos')) add('date', i, j, {date:cx.monthRel(t.v, T(j).v)}, conf(i, j), {w:3});
      else if(is(j, 'num') && is(nx(j), 'u', 'day')){
        const base = day0(cx.today); base.setDate(1); base.setMonth(base.getMonth() + t.v);
        const d = new Date(base.getFullYear(), base.getMonth(), T(j).v, 12);
        if(d.getMonth() === base.getMonth()) add('date', i, nx(j), {date:key(d)}, conf(i, nx(j)), {w:4});
      }
    }
  }
  return C;
}

/* 기간: 날짜 ~ 날짜 · 날짜부터 날짜까지 · 날짜부터 N일간 · 10/12~16 · 12~16일 */
function readRanges(toks, C, cx){
  const out = [];
  const dates = C.filter(c => c.slot === 'date');
  const is = (i, k, v) => toks[i] && (toks[i].k === k || (k === 'u' && toks[i].k === 'wds' && UW[toks[i].v] === v))
    && (v === undefined || toks[i].v === v || (k === 'u' && UW[toks[i].v] === v));
  for(const a of dates){
    let j = a.i1 + 1;
    while(is(j, 'glue')) j++;
    if(!(is(j, 'sep', '~') || is(j, 'sep', '-') || is(j, 'from'))) continue;
    const sepI = j;
    j++;
    /* 오른쪽: 날짜 후보 · 아니면 날만 (16 · 16일) */
    const b = dates.filter(d => d.i0 === j).sort((x, y) => y.w - x.w)[0];
    let end = null, i1 = null;
    if(b){ end = b.val.date; i1 = b.i1; }
    /* 부터 3일간 · 부터 이틀 동안 */
    else if(is(sepI, 'from') && is(j, 'num') && is(j + 1, 'u', 'day') && is(j + 2, 'dur')){
      end = plus(a.val.date, toks[j].v - 1); i1 = j + 2;
    }else if(is(sepI, 'from') && is(j, 'kd') && is(j + 1, 'dur')){
      end = plus(a.val.date, toks[j].v - 1); i1 = j + 1;
    }else if(is(j, 'num') && toks[j].n <= 2){
      const m0 = +a.val.date.slice(5, 7), y0 = +a.val.date.slice(0, 4);
      let d = new Date(y0, m0 - 1, toks[j].v, 12);
      if(d.getMonth() !== m0 - 1) continue;
      if(key(d) <= a.val.date){ d = new Date(y0, m0, toks[j].v, 12); }
      end = key(d); i1 = is(j + 1, 'u', 'day') ? j + 1 : j;
    }
    if(!end || end <= a.val.date) continue;
    if(is(i1 + 1, 'to')) i1++;
    out.push({slot:'date', s:a.s, e:toks[i1].e, i0:a.i0, i1, val:{date:end, start:a.val.date}, conf:a.conf, w:a.w + 4});
  }
  /* 12~16일: 왼쪽이 날만 (12) 이고 오른쪽이 "16일" */
  for(let i = 0; i + 2 < toks.length; i++){
    if(is(i, 'num') && toks[i].n <= 2 && is(i + 1, 'sep', '~') && is(i + 2, 'num') && is(i + 3, 'u', 'day')){
      const b = cx.d(toks[i].v);
      if(!b) continue;
      const end = plus(b, toks[i + 2].v - toks[i].v);
      if(end > b) out.push({slot:'date', s:toks[i].s, e:toks[i + 3].e, i0:i, i1:i + 3, val:{date:end, start:b}, conf:.9, w:6});
    }
  }
  return out;
}

/* 시각 값 → "HH:MM". 오전 · 오후가 없으면 업무 시간으로 읽는다 (1~7시는 오후) */
function clock(v, notes){
  if(v.fixed) return v.fixed;
  let h = v.h, m = v.m;
  const ap = v.ap;
  if(h === 24){ h = 0; }
  if(ap === 'pm' || ap === 'evening' || ap === 'night'){ if(h < 12) h += 12; }
  else if(ap === 'noon'){ if(h < 6) h += 12; }
  else if(ap === 'am' || ap === 'morning' || ap === 'early'){ if(h === 12) h = 0; }
  else if(!v.h24 && h >= 1 && h <= 7){ h += 12; notes.push(v.h + '시 → 오후로 읽음'); }
  if(h > 23 || m > 59) return null;
  m = Math.round(m / 5) * 5;
  if(m === 60){ m = 0; h = (h + 1) % 24; }
  return P2(h) + ':' + P2(m);
}

/* ---------- 3. 고르기 ----------
   겹치지 않는 날짜 하나 · 시각 하나의 조합 가운데 점수가 가장 큰 것. 점수 = 틀의 무게 × 맞은 정도 */
function pick(C){
  const sc = c => c.w * c.conf;
  const ds = C.filter(c => c.slot === 'date').sort((a, b) => sc(b) - sc(a) || (b.e - b.s) - (a.e - a.s));
  const ts = C.filter(c => c.slot === 'time').sort((a, b) => sc(b) - sc(a));
  let best = null;
  const cands = [null].concat(ds.slice(0, 12));
  for(const d of cands) for(const t of [null].concat(ts.slice(0, 12))){
    if(d && t && d.s < t.e && t.s < d.e) continue;
    const v = (d ? sc(d) : 0) + (t ? sc(t) : 0);
    if(!best || v > best.v) best = {d, t, v};
  }
  return best;
}

function parse(text, opt){
  if(!text || !text.trim()) return null;
  const wr = weekRange(text, opt);
  if(wr) return wr;
  return parseOne(text, opt);
}

/* ---------- 4. 요일 범위 ----------
   "다음 주 월~금" · "월-수 교육". 위의 틀은 범위의 끝 요일만 날짜로 읽는다 - 여기서 앞뒤를 잇는다.
   주를 말하지 않았는데 시작 요일이 이미 지났으면 다음 주로 읽는다 (수요일에 쓴 "월~수"). */
const WDS = '월화수목금토일';
const WR = new RegExp('(다다음\\s*주|다담\\s*주|이번\\s*주|금주|다음\\s*주|담\\s*주|오는\\s*주)?\\s*([' + WDS + '])(?:요일|욜)?\\s*[~\\-–]\\s*([' + WDS + '])(?:요일|욜)?');
function weekRange(text, opt){
  const m = WR.exec(text);
  if(!m) return null;
  const today = opt.today, mon = plus(today, -wdOf(today));
  const off = !m[1] ? 0 : /다다음|다담/.test(m[1]) ? 14 : /이번|금주/.test(m[1]) ? 0 : 7;
  let a = plus(mon, off + WDS.indexOf(m[2])), b = plus(mon, off + WDS.indexOf(m[3]));
  if(b <= a) return null;
  if(!m[1] && a < today){ a = plus(a, 7); b = plus(b, 7); }
  /* 나머지 글에서 시각을 읽는다 (범위 자리는 같은 길이의 빈칸으로 덮어 자리를 지킨다) */
  const s0 = m.index, s1 = m.index + m[0].length;
  const r = parseOne(text.slice(0, s0) + ' '.repeat(s1 - s0) + text.slice(s1), opt);
  const time = r && r.time || null;
  const spans = [[s0, s1, 'range']].concat(r && time ? r.spans.filter(x => x[2] === 'time') : []).sort((x, y) => x[0] - y[0]);
  let rest = '', at = 0;
  for(const [x, y] of spans){ rest += text.slice(at, x) + ' '; at = y; }
  rest = (rest + text.slice(at)).replace(/\s+/g, ' ').replace(/^[\s~\-–,·]+|[\s~\-–,·]+$/g, '').trim();
  return {date:b, start:a, time, rest, spans, notes:[]};
}

/* ---------- 5. 반복 ----------
   "매달 마지막 영업일" · "매주 월수" · "격주 화" · "매달 넷째 목" · "분기마다 말일" · "매년 3월 31일" · "영업일마다".
   돌려주는 규칙은 저장 형식(core/recur.py)과 같다. 기준 날짜가 있어야 정해지는 것은 need 로 알린다:
     need 'day'   "매달" 처럼 그 달의 어느 날인지 없다     need 'wd'  "매주" 처럼 요일이 없다
     every 2      "격월" - 어느 달부터인지는 기준 날짜의 달        year  "매년" - 몇 월인지는 기준 날짜
   결과: {rule, span:[시작, 끝], need, every, year} 또는 null. 띄어쓰기는 보지 않는다. */
const ORD = {'첫':1, '첫째':1, '첫번째':1, '둘째':2, '두번째':2, '셋째':3, '세번째':3, '넷째':4, '네번째':4, '다섯째':5, '마지막':-1, '막':-1};
function readRule(text){
  const idx = [], cs = [];
  [...text].forEach((ch, i) => { if(!/\s/.test(ch)){ cs.push(ch); idx.push(i); } });
  const c = cs.join('');
  const span = (a, b) => [idx[a], idx[b - 1] + 1];
  let m;
  if((m = /(매일|날마다|매영업일|영업일마다|평일마다|평일매일|매일평일|매평일)(영업일만)?/.exec(c)))
    return {rule:{period:'day', business_only:/영업일|평일/.test(m[0])}, span:span(m.index, m.index + m[0].length), need:null};
  if((m = new RegExp('(매주|격주|2주마다)((?:[' + WDS + '](?:요일|욜)?[,·와과및]?)*)').exec(c))){
    const wds = [];
    m[2].replace(new RegExp('([' + WDS + '])(?:요일|욜)?', 'g'), (_, w) => { const i = WDS.indexOf(w); if(!wds.includes(i)) wds.push(i); });
    return {rule:{period:'week', weekdays:wds.sort(), interval:m[1] === '매주' ? 1 : 2}, span:span(m.index, m.index + m[0].length), need:wds.length ? null : 'wd'};
  }
  const pre = /(매달|매월|달마다|격월|매분기|분기마다|분기별|반기마다|매년(\d{1,2})월|매년)/.exec(c);
  if(!pre) return null;
  const tail = c.slice(pre.index + pre[0].length);
  let r = null, t;
  if((t = /^(?:말일|마지막날)(\d)일전/.exec(tail))) r = {basis:'before_end', k:+t[1]};
  else if((t = /^마지막영업일(\d)일전/.exec(tail))) r = {basis:'before_end_bd', k:+t[1]};
  else if((t = /^(?:마지막|막)영업일/.exec(tail))) r = {basis:'business_day', n:-1};
  else if((t = /^(?:(\d{1,2})(?:번째|째)|첫(?:번째|째)?)영업일/.exec(tail))) r = {basis:'business_day', n:t[1] ? +t[1] : 1};
  else if((t = new RegExp('^(첫번째|첫째|첫|둘째|두번째|셋째|세번째|넷째|네번째|다섯째|마지막|막)주?([' + WDS + '])(?:요일|욜)?').exec(tail)))
    r = {basis:'weekday', n:ORD[t[1]], weekday:WDS.indexOf(t[2])};
  else if((t = /^(?:말일|마지막날|월말|말)/.exec(tail))) r = {basis:'day', n:-1};
  else if((t = /^(\d{1,2})일/.exec(tail))) r = {basis:'day', n:+t[1]};
  const end = pre.index + pre[0].length + (t ? t[0].length : 0);
  const p = pre[1];
  const toEnd = !!r && (r.n === -1 || r.basis === 'before_end' || r.basis === 'before_end_bd');
  const out = {rule:r ? Object.assign({period:'month'}, r) : null, span:span(pre.index, end), need:r ? null : 'day'};
  if(/분기/.test(p)) out.months = toEnd ? [3, 6, 9, 12] : [1, 4, 7, 10];
  else if(/반기/.test(p)) out.months = toEnd ? [6, 12] : [1, 7];
  else if(p === '격월') out.every = 2;
  else if(/^매년/.test(p)){ if(pre[2]) out.months = [+pre[2]]; else out.year = true; }
  if(out.rule && out.months) out.rule.months = out.months;
  return out;
}
root.whenRule = readRule;

function parseOne(text, opt){
  const cx = Ctx(opt);
  /* 영문 자판으로 친 덩어리는 한글로 옮겨 보고, 그것이 날짜 · 시각 낱말이 되면 그 읽기를 쓴다.
     옮긴 글과 원래 글의 자리를 이어 두어 빼낼 자리가 맞게 한다. */
  let s = '';
  const map = [];                         /* 옮긴 글의 글자마다 원래 글의 [시작, 끝] */
  const runs = text.split(/([A-Za-z]+)/).filter(Boolean);
  const conv = runs.map(r => {
    if(!/^[A-Za-z]{2,}$/.test(r) || LEX.some(e => e.w === r.toLowerCase())) return null;
    const h = toHangul(r);
    return h && lex(h).every(t => t.k !== 'x' && t.c === 1) ? h : null;
  });
  /* 한 덩어리라도 옮겨졌다면 한/영을 잊고 친 것이다 - 온전한 한글 글자로만 옮겨지는 나머지 덩어리도
     옮겨 둔다 ("ekdmawn ghldml" → 다음주 회의). 영어 낱말(report)은 온전한 글자가 되지 않아 남는다 */
  const forgot = conv.some(Boolean);
  let o = 0;
  runs.forEach((r, n) => {
    let use = conv[n] || r;
    if(forgot && !conv[n] && /^[A-Za-z]{2,}$/.test(r)){
      const h = toHangul(r);
      if(h && [...h].every(isSyl)) use = h;
    }
    for(let k = 0; k < use.length; k++) map.push(use === r ? [o + k, o + k + 1] : [o, o + r.length]);
    s += use; o += r.length;
  });
  const toks = lex(s);
  const C = readAll(toks, cx, s);
  C.push(...readRanges(toks, C, cx));
  const best = pick(C);
  if(!best || (!best.d && !best.t)) return null;
  const notes = [];
  let date = null, start = null, time = null;
  const spans = [];
  const used = new Set();
  const take = (c, kind) => { spans.push([c.s, c.e, kind]); for(let i = c.i0; i <= c.i1; i++) used.add(i); };
  if(best.d){ date = best.d.val.date; start = best.d.val.start || null; take(best.d, start ? 'range' : 'date'); }
  if(best.t){
    const tv = Object.assign({}, best.t.val);
    take(best.t, 'time');
    const nx = toks[best.t.i1 + 1];
    if(nx && nx.k === 'sep' && (nx.v === '~' || nx.v === '-')){
      const t2 = C.find(c => c.slot === 'time' && c.i0 === best.t.i1 + 2);
      if(t2){ spans[spans.length - 1][1] = t2.e; for(let i = t2.i0; i <= t2.i1; i++) used.add(i); }
    }
    /* 떨어져 있는 오전/오후: "오후 보고서 3시" */
    if(tv.h != null && !tv.ap && !tv.h24){
      const k = toks.findIndex((t, i) => t.k === 'ap' && !used.has(i));
      if(k >= 0){ tv.ap = toks[k].v; spans.push([toks[k].s, toks[k].e, 'time']); used.add(k); }
    }
    time = clock(tv, notes);
    if(!time){ spans.pop(); }
  }
  /* 떨어져 있는 "다음 주": "금요일 보고서 다음주" */
  if(best.d && best.d.val.wd != null){
    const k = toks.findIndex((t, i) => t.k === 'wk' && !used.has(i));
    if(k >= 0){ date = cx.week(toks[k].v, best.d.val.wd); spans.push([toks[k].s, toks[k].e, 'date']); used.add(k); }
  }
  if(best.d && best.d.conf < 1) notes.push('비슷한 말로 읽음');
  /* 낱말 뒤에 붙은 토씨(까지 · 에 · 부터)도, 앞의 "오는" 도 함께 뺀다 */
  for(const sp of spans){
    const k = toks.findIndex(x => x.s === sp[0]);
    if(k > 0 && toks[k - 1].k === 'pre') sp[0] = toks[k - 1].s;
    let t;
    while((t = toks.find(x => x.s === sp[1])) && (t.k === 'to' || t.k === 'glue' || t.k === 'from')) sp[1] = t.e;
  }
  /* 옮긴 글의 자리 → 원래 글의 자리 */
  const orig = spans.map(([a, b, k]) => [map[a][0], map[b - 1][1], k]).sort((x, y) => x[0] - y[0]);
  let rest = '', at = 0;
  for(const [a, b] of spans.slice().sort((x, y) => x[0] - y[0])){ if(a >= at){ rest += s.slice(at, a) + ' '; at = b; } }
  rest = (rest + s.slice(at)).replace(/\s+/g, ' ').replace(/^[\s~\-–,·]+|[\s~\-–,·]+$/g, '').trim();
  return {date, start, time, rest, spans:orig, notes};
}

root.whenParse = parse;
root.whenJamo = {jamo, dist, toHangul, lex};
})(typeof window !== 'undefined' ? window : globalThis);
