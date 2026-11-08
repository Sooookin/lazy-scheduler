package com.lazyscheduler.app.core

import java.time.LocalDate
import kotlin.math.abs
import kotlin.math.hypot

/**
 * 글에서 날짜 · 시각 알아듣기 — PC 앱의 web/when.js 를 줄마다 옮긴 것.
 *
 * "내일3시 보고서" · "보고서 금욜 오후 두시반" · "sodlf 3tl 회의" (한/영을 안 바꾸고 친 내일 3시) ·
 * "10/12~16 출장" 처럼 아무렇게나 써도 날짜 · 기간 · 시각을 찾는다. 규칙은 when.js 머리말과 같다:
 *   1. 글자를 자모로 푼다. 사전과 비교할 때 자모 단위 편집 거리를 쓰되, 바꿔 치기 쉬운 것은 싸게 센다.
 *   2. 띄어쓰기는 보지 않는다.  3. 순서도 보지 않는다 - 겹치지 않는 가장 그럴듯한 조합을 고른다.
 *   4. 영문 자판인 채로 친 글자는 두벌식으로 옮겨 읽어 본다.  5. 흔한 낱말(매일 · 월간)은 오타로 보지 않는다.
 *
 * 두 구현은 tests/vectors/when.json 의 답을 똑같이 내야 한다 (WhenVectorsTest 가 돌린다).
 * when.js 를 고치면 여기도 같이 고친다. 자바스크립트의 셈을 그대로 따른다:
 *   - 글자 자리(span)는 UTF-16 자리다 (String 의 Char 자리와 같다).
 *   - \s 는 자바스크립트의 빈칸 모임(유니코드 빈칸 포함), \d 는 ASCII 숫자다.
 *   - 날짜는 "YYYY-MM-DD" 글로 다루고 글끼리 비교한다. new Date(y, m, d) 처럼 넘친 달 · 날은 다음으로 넘기고,
 *     0~99 년은 1900 년대로 읽으며, 범위를 벗어난 날은 "NaN-NaN-NaN" 이 된다.
 *   - 자바스크립트가 TypeError 로 멈추는 자리(날짜가 없는 후보로 기간을 만들 때)에서는 null 을 돌려준다.
 */
object When {

    /** 찾아낸 자리: [start, end) 는 원래 글의 UTF-16 자리, kind 는 "date" · "range" · "time" */
    data class Span(val start: Int, val end: Int, val kind: String)

    /**
     * 읽은 결과 (when.js 의 {date, start, time, rest, spans, notes}).
     * date: "YYYY-MM-DD" (기간이면 끝 날) · start: 기간의 첫 날 · time: "HH:MM" · rest: 날짜 · 시각을 뺀 나머지 글
     */
    data class Parsed(
        val date: String?,
        val start: String?,
        val time: String?,
        val rest: String,
        val spans: List<Span>,
        val notes: List<String>,
    )

    /**
     * 반복 말 (when.js readRule 의 {rule, span, need, every, year, months}).
     * rule 은 저장 형식(core/recur.py · Recur.kt)과 같은 키의 맵이다: period · business_only · weekdays · interval ·
     * basis · n · k · weekday · months. 수는 Int, 목록은 List<Int>.
     *   need "day"  "매달" 처럼 그 달의 어느 날인지 없다 (rule 은 null)
     *   need "wd"   "매주" 처럼 요일이 없다 (weekdays 가 빈 목록)
     *   every 2     "격월" - 어느 달부터인지는 기준 날짜의 달
     *   year true   "매년" - 몇 월인지는 기준 날짜
     *   months      분기 · 반기 · "매년 3월" 의 달 (rule 이 있으면 rule["months"] 에도 들어 있다)
     * span 은 [시작, 끝] 두 수. 자바스크립트처럼 코드 포인트 차례로 센다 (BMP 글자만 있으면 UTF-16 자리와 같다).
     */
    data class RuleHit(
        val rule: Map<String, Any?>?,
        val span: List<Int>,
        val need: String?,
        val every: Int? = null,
        val year: Boolean? = null,
        val months: List<Int>? = null,
    )

    /** 글에서 날짜 · 기간 · 시각을 읽는다 (whenParse). today 는 "YYYY-MM-DD", isBiz 가 없으면 모든 날이 영업일 */
    fun parse(text: String, today: String, isBiz: ((String) -> Boolean)? = null): Parsed? {
        if (jsTrim(text).isEmpty()) return null
        return try {
            weekRange(text, today, isBiz) ?: parseOne(text, today, isBiz)
        } catch (_: JsTypeError) {
            null
        }
    }

    /** 반복 말을 저장 형식의 규칙으로 (whenRule). 띄어쓰기는 보지 않는다 */
    fun rule(text: String): RuleHit? = readRule(text)

    /* 자바스크립트라면 TypeError 로 멈출 자리 (null.slice) */
    private class JsTypeError : RuntimeException()

    /* ══════════ 자바스크립트 흉내 ══════════ */

    /** 자바스크립트 \s: 빈칸 · 줄바꿈과 유니코드 빈칸 */
    private fun isWs(c: Char): Boolean = when (c) {
        '\t', '\n', '\u000B', '\u000C', '\r', ' ', ' ', ' ', ' ', ' ', ' ', ' ',
        '　', '﻿' -> true
        else -> c in ' '..' '
    }

    private fun isWs(s: String) = s.length == 1 && isWs(s[0])

    private fun jsTrim(s: String): String {
        var a = 0
        var b = s.length
        while (a < b && isWs(s[a])) a++
        while (b > a && isWs(s[b - 1])) b--
        return s.substring(a, b)
    }

    /** String.prototype.slice: 음수는 끝에서, 범위 밖은 잘라 맞추고, 거꾸로면 빈 글 */
    private fun slice(s: String, a: Int, b: Int = s.length): String {
        val n = s.length
        val x = if (a < 0) maxOf(n + a, 0) else minOf(a, n)
        val y = if (b < 0) maxOf(n + b, 0) else minOf(b, n)
        return if (x >= y) "" else s.substring(x, y)
    }

    /** s[i] (없으면 '') */
    private fun at(s: String, i: Int): String = if (i in s.indices) s[i].toString() else ""

    /** 글 → 수 (+"12"). 날짜 글의 조각만 받으므로 십진수 · 빈 글만 다룬다 */
    private fun jsNum(s: String): Double {
        val t = jsTrim(s)
        if (t.isEmpty()) return 0.0
        return if (Regex("[+-]?(\\d+\\.?\\d*|\\.\\d+)([eE][+-]?\\d+)?").matches(t)) t.toDouble() else Double.NaN
    }

    /** for (const c of s): 코드 포인트마다 한 글 */
    private fun chars(s: String): List<String> {
        val out = ArrayList<String>()
        var p = 0
        while (p < s.length) {
            val cp = s.codePointAt(p)
            val n = Character.charCount(cp)
            out.add(s.substring(p, p + n))
            p += n
        }
        return out
    }

    private fun isAsciiLetter(s: String) = s.length == 1 && (s[0] in 'a'..'z' || s[0] in 'A'..'Z')

    /** /^[A-Za-z]{2,}$/ */
    private fun isLatinRun(s: String) = s.length >= 2 && s.all { it in 'a'..'z' || it in 'A'..'Z' }

    /** 자바스크립트 \s 모임 (정규식 안에 넣는 것) */
    private const val WS = "[\\t\\n\\u000B\\f\\r \\u00A0\\u1680\\u2000-\\u200A\\u2028\\u2029\\u202F\\u205F\\u3000\\uFEFF]"

    /* ══════════ 자모 ══════════ */
    private const val CHO = "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"
    private const val JUNG = "ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ"
    private val JONG = listOf(
        "", "ㄱ", "ㄲ", "ㄳ", "ㄴ", "ㄵ", "ㄶ", "ㄷ", "ㄹ", "ㄺ", "ㄻ", "ㄼ", "ㄽ", "ㄾ", "ㄿ", "ㅀ",
        "ㅁ", "ㅂ", "ㅄ", "ㅅ", "ㅆ", "ㅇ", "ㅈ", "ㅊ", "ㅋ", "ㅌ", "ㅍ", "ㅎ",
    )

    /* 글끼리 비교한다 (자바스크립트의 c >= '가' 와 같다 - 빈 글 · 두 칸 글자도 같은 답) */
    private fun isSyl(c: String) = c >= "가" && c <= "힣"
    private fun isHan(c: String) = isSyl(c) || (c >= "ㄱ" && c <= "ㅣ")

    private fun jamo(s: String): List<String> {
        val out = ArrayList<String>()
        for (c in chars(s)) {
            if (isSyl(c)) {
                val k = c[0].code - 0xAC00
                out.add(CHO[k / 588].toString())
                out.add(JUNG[k % 588 / 28].toString())
                if (k % 28 != 0) out.add(JONG[k % 28])
            } else out.add(c)
        }
        return out
    }

    /* ══════════ 두벌식 자판 ══════════
       글쇠의 자리 (줄, 칸). 이웃한 글쇠를 잘못 누른 것은 싸게 센다. 영문 자판인 채로 친 글을
       한글로 옮길 때도 이 표를 쓴다. */
    private val KEYS = listOf(
        "q" to "ㅂ", "w" to "ㅈ", "e" to "ㄷ", "r" to "ㄱ", "t" to "ㅅ", "y" to "ㅛ", "u" to "ㅕ", "i" to "ㅑ", "o" to "ㅐ", "p" to "ㅔ",
        "a" to "ㅁ", "s" to "ㄴ", "d" to "ㅇ", "f" to "ㄹ", "g" to "ㅎ", "h" to "ㅗ", "j" to "ㅓ", "k" to "ㅏ", "l" to "ㅣ",
        "z" to "ㅋ", "x" to "ㅌ", "c" to "ㅊ", "v" to "ㅍ", "b" to "ㅠ", "n" to "ㅜ", "m" to "ㅡ",
    )
    private val SHIFT = mapOf("Q" to "ㅃ", "W" to "ㅉ", "E" to "ㄸ", "R" to "ㄲ", "T" to "ㅆ", "O" to "ㅒ", "P" to "ㅖ")
    private val KEYPOS: Map<String, DoubleArray> = HashMap<String, DoubleArray>().apply {
        KEYS.forEachIndexed { n, (_, j) ->
            val row = if (n < 10) 0 else if (n < 19) 1 else 2
            val col = if (n < 10) n else if (n < 19) n - 10 else n - 19
            put(j, doubleArrayOf(row.toDouble(), col + doubleArrayOf(0.0, .25, .75)[row]))
        }
    }
    private val KEY2J: Map<String, String> = KEYS.toMap()

    /* 바꿔 치기 값. 같으면 0, 흔히 헷갈리는 것은 싸게, 나머지는 1 */
    private val SUB: Map<String, Double> = HashMap<String, Double>().apply {
        listOf(
            Triple("ㅐ", "ㅔ", .3), Triple("ㅒ", "ㅖ", .3), Triple("ㅙ", "ㅞ", .3), Triple("ㅚ", "ㅞ", .3), Triple("ㅚ", "ㅙ", .3),
            Triple("ㄱ", "ㄲ", .45), Triple("ㄷ", "ㄸ", .45), Triple("ㅂ", "ㅃ", .45), Triple("ㅅ", "ㅆ", .45), Triple("ㅈ", "ㅉ", .45),
            Triple("ㄱ", "ㅋ", .6), Triple("ㄷ", "ㅌ", .6), Triple("ㅂ", "ㅍ", .6), Triple("ㅈ", "ㅊ", .6), Triple("ㅓ", "ㅕ", .6),
            Triple("ㅗ", "ㅛ", .6), Triple("ㅜ", "ㅠ", .6), Triple("ㅡ", "ㅜ", .7),
        ).forEach { (a, b, w) -> put(a + b, w); put(b + a, w) }
    }

    private fun sub(a: String, b: String): Double {
        if (a == b) return 0.0
        SUB[a + b]?.let { return it }
        val p = KEYPOS[a]
        val q = KEYPOS[b]
        if (p != null && q != null && hypot(p[0] - q[0], p[1] - q[1]) < 1.3) return .7
        return 1.0
    }

    /** 자모 열 두 개의 거리 (바꿔 치기 · 넣기 · 빼기 · 이웃 둘 뒤바꾸기). 넣고 빼는 값은 1 보다 조금 싸다 */
    private fun dist(a: List<String>, b: List<String>): Double {
        val n = a.size
        val m = b.size
        val d = Array(n + 1) { i -> DoubleArray(m + 1).also { it[0] = i * .8 } }
        for (j in 0..m) d[0][j] = j * .8
        for (i in 1..n) for (j in 1..m) {
            var v = minOf(d[i - 1][j] + .8, d[i][j - 1] + .8, d[i - 1][j - 1] + sub(a[i - 1], b[j - 1]))
            if (i > 1 && j > 1 && a[i - 1] == b[j - 2] && a[i - 2] == b[j - 1]) v = minOf(v, d[i - 2][j - 2] + .6)
            d[i][j] = v
        }
        return d[n][m]
    }

    /* ══════════ 영문 자판으로 친 한글 → 한글 ══════════ */
    private val JW = mapOf("ㅗㅏ" to 'ㅘ', "ㅗㅐ" to 'ㅙ', "ㅗㅣ" to 'ㅚ', "ㅜㅓ" to 'ㅝ', "ㅜㅔ" to 'ㅞ', "ㅜㅣ" to 'ㅟ', "ㅡㅣ" to 'ㅢ')
    private val JJ = linkedMapOf(
        "ㄱㅅ" to 'ㄳ', "ㄴㅈ" to 'ㄵ', "ㄴㅎ" to 'ㄶ', "ㄹㄱ" to 'ㄺ', "ㄹㅁ" to 'ㄻ', "ㄹㅂ" to 'ㄼ', "ㄹㅅ" to 'ㄽ',
        "ㄹㅌ" to 'ㄾ', "ㄹㅍ" to 'ㄿ', "ㄹㅎ" to 'ㅀ', "ㅂㅅ" to 'ㅄ',
    )

    private fun toHangul(latin: String): String? {
        val js = ArrayList<Char>()
        for (c in chars(latin)) {
            val j = SHIFT[c] ?: KEY2J[c.lowercase()] ?: return null
            js.add(j[0])
        }
        /* 첫소리 · 가운뎃소리 · 끝소리를 차례로 모은다. 끝소리 뒤에 홀소리가 오면 그 닿소리는 다음 글자로 간다 */
        val out = StringBuilder()
        var l: Char? = null
        var v: Char? = null
        var t: Char? = null
        fun flush() {
            val l0 = l
            val v0 = v
            val t0 = t
            if (l0 != null && v0 != null) {
                val ti = if (t0 == null) 0 else JONG.indexOf(t0.toString())
                out.append((0xAC00 + (CHO.indexOf(l0) * 21 + JUNG.indexOf(v0)) * 28 + ti).toChar())
            } else {
                if (l0 != null) out.append(l0)
                if (v0 != null) out.append(v0)
                if (t0 != null) out.append(t0)
            }
            l = null; v = null; t = null
        }
        for (j in js) {
            if (j in JUNG) {
                if (l != null && v != null && t == null && JW["$v$j"] != null) { v = JW["$v$j"]; continue }
                if (l != null && v != null && t != null) {
                    val two = JJ.entries.firstOrNull { it.value == t }?.key
                    val carry: Char
                    if (two != null) { t = two[0]; carry = two[1] } else { carry = t!!; t = null }
                    flush(); l = carry; v = j; continue
                }
                if (l != null && v == null) { v = j; continue }
                flush(); v = j; flush(); continue
            }
            if (l == null) { l = j; continue }
            if (v == null) { flush(); l = j; continue }
            if (t == null && JONG.contains(j.toString())) { t = j; continue }
            if (t != null && JJ["$t$j"] != null) { t = JJ["$t$j"]; continue }
            flush(); l = j
        }
        flush()
        return out.toString()
    }

    /* ══════════ 사전 ══════════
       [낱말, 종류, 값, 오타 허용]. 같은 종류 안의 여러 말은 같은 뜻이다. 수 값은 자바스크립트처럼 Double. */
    private class Lx(val w: String, val k: String, val v: Any, val fz: Boolean, val j: List<String>) {
        val ew = w.replace(" ", "")
        val latin = ew.isNotEmpty() && ew[0] in 'a'..'z'          // /^[a-z]/.test(ew)
    }

    private val LEX: List<Lx> = ArrayList<Lx>().apply {
        fun put(k: String, v: Any, words: String, fz: Boolean = false) =
            words.split('|').forEach { add(Lx(it, k, v, fz, jamo(it))) }
        put("day", 0.0, "오늘|금일|당일|today", true)
        put("day", 1.0, "내일|낼|명일|익일|tomorrow|tmr|tmrw", true)
        put("day", 2.0, "모레|내일모레|낼모레", true)
        put("day", 3.0, "글피", true)
        put("wk", 0.0, "이번주|이번 주|금주|this week", true)
        put("wk", 1.0, "다음주|담주|차주|next week", true)
        put("wk", 2.0, "다다음주|다담주", true)
        "월화수목금토일".forEachIndexed { i, c ->
            put("wd", i.toDouble(), "${c}요일|${c}욜", true)
            put("wds", i.toDouble(), c.toString())
        }
        val full = listOf("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
        "mon tue wed thu fri sat sun".split(' ').forEachIndexed { i, w -> put("wd", i.toDouble(), w + "|" + full[i]) }
        put("ap", "am", "오전|am|a.m.|a", true)
        put("ap", "pm", "오후|pm|p.m.|p", true)
        put("ap", "early", "새벽", true)
        put("ap", "morning", "아침", true)
        put("ap", "noon", "점심|낮", true)
        put("ap", "evening", "저녁", true)
        put("ap", "night", "밤", false)
        put("pt", "12:00", "정오|noon", true)
        put("pt", "09:00", "출근", true)
        put("pt", "18:00", "퇴근", true)
        put("u", "h", "시")
        put("u", "min", "분")
        put("u", "half", "반")
        put("u", "mon", "월")
        put("u", "day", "일")
        put("u", "week", "주|주일")
        put("u", "month", "달|개월")
        put("pos", "end", "말")
        put("pos", "start", "초")
        put("pos", "mid", "중순")
        put("mpos", "end", "월말", true)
        put("mpos", "start", "월초", true)
        put("mrel", 0.0, "이번달|이번 달|이달|금월", true)
        put("mrel", 1.0, "다음달|다음 달|담달|익월", true)
        put("wkend", 0.0, "주말|weekend", true)
        put("after", 1.0, "뒤|후|later")
        put("dur", 1.0, "간|동안")
        put("from", 1.0, "부터|에서")
        put("to", 1.0, "까지|까진|전까지|until")
        put("glue", 1.0, "에|쯤|경|즈음|날|때")
        put("pre", 1.0, "오는|돌아오는|coming")
        /* 고유어 수: 시(한 시 · 열두 시)와 날 수(하루 · 이틀) */
        "한 두 세 네 다섯 여섯 일곱 여덟 아홉 열 열한 열두".split(' ').forEachIndexed { i, w -> put("kn", (i + 1).toDouble(), w) }
        "하루 이틀 사흘 나흘 닷새 엿새 이레".split(' ').forEachIndexed { i, w -> put("kd", (i + 1).toDouble(), w, true) }
        put("kd", 7.0, "일주일", true)
        put("kd", 14.0, "이주일|2주일", false)
        "십 이십 삼십 사십 오십".split(' ').forEachIndexed { i, w -> put("sm", ((i + 1) * 10).toDouble(), w) }
        put("sm", 15.0, "십오")
        put("sm", 45.0, "사십오")
    }

    /* 날짜 낱말과 닮았지만 다른 뜻인 흔한 말. 이 말이 그대로 있으면 오타로 보지 않는다 */
    private val KEEP = ("메일 매일 매주 매월 매달 매년 매번 월간 주간 일간 연간 내용 내부 내역 모델 오류 오른 오픈 저작 저널 " +
        "이번에 다음에 다음은 다른 아침밥 금요 주말농장 오프 일정 전날").split(' ')
    private val MAXW = LEX.maxOf { it.ew.length }

    /* ══════════ 1. 낱말로 나누기 ══════════
       자리마다 사전의 모든 낱말을 대 보고 가장 그럴듯한 것을 고른다 (정확히 맞는 긴 것 > 오타 > 짧은 것).
       낱말 안의 빈칸은 건너뛰고 잰다 ("다음 주" = "다음주"). */

    /** 낱말 하나. v 는 수(Double) 또는 글(String), n 은 숫자의 자릿수, w 는 사전의 낱말 */
    private class Tok(
        val k: String, val v: Any?, val s: Int, val e: Int, val c: Double,
        val n: Int = 0, val w: String = "", val sc: Double = 0.0,
    ) {
        val nv: Double get() = (v as? Double) ?: Double.NaN
    }

    private const val SEPS = "~∼〜–—-/.:"

    private fun lex(s: String): List<Tok> {
        val toks = ArrayList<Tok>()
        var i = 0
        val keepAt = BooleanArray(s.length)
        for (w in KEEP) {
            var k = s.indexOf(w)
            while (k >= 0) {
                for (x in k until k + w.length) keepAt[x] = true
                k = s.indexOf(w, k + 1)
            }
        }
        while (i < s.length) {
            val c = s[i]
            if (isWs(c)) { i++; continue }
            if (c in '0'..'9') {
                var j = i
                while (j < s.length && s[j] in '0'..'9') j++
                toks.add(Tok("num", s.substring(i, j).toDouble(), i, j, 1.0, n = j - i))
                i = j; continue
            }
            if (c in SEPS) {
                val v = if (c == '∼' || c == '〜') "~" else if (c == '—' || c == '–') "-" else c.toString()
                toks.add(Tok("sep", v, i, i + 1, 1.0)); i++; continue
            }
            var best: Tok? = null
            /* 빈칸을 빼고 글자 L 개를 모은다 (빈칸은 낱말 안에 하나까지) */
            fun grab(len: Int): Pair<String, Int>? {
                val t = StringBuilder()
                var j = i
                var sp = 0
                while (t.length < len && j < s.length) {
                    if (s[j] == ' ') { if (++sp > 1 || t.isEmpty()) return null; j++; continue }
                    t.append(s[j]); j++
                }
                return if (t.length == len) t.toString() to j else null
            }
            for (len in 1..MAXW + 1) {
                val (t, j) = grab(len) ?: break
                val low = t.lowercase()
                for (e in LEX) {
                    val ew = e.ew
                    var cf = 0.0
                    /* 영어 낱말은 통째로만 (monitor 의 mon 은 월요일이 아니다) */
                    if (e.latin && (isAsciiLetter(at(s, i - 1)) || isAsciiLetter(at(s, j)))) continue
                    if (ew == low) cf = 1.0
                    else if (!aloneIn(s, i, j)) continue          /* 오타로 읽는 것은 홀로 선 낱말만 (모래시계 ≠ 모레) */
                    else if (e.fz && ew.length >= 2 && abs(ew.length - len) <= 1 && chars(t).all(::isHan) && !keepAt[i]) {
                        /* 짧은 낱말은 싼 실수 하나까지 (모래 · 내잉 · 담쭈), 긴 낱말은 실수 둘까지. 메일 ≠ 내일 */
                        val tol = if (e.j.size >= 7) 1.5 else if (e.j.size >= 4) .75 else 0.0
                        val d = dist(jamo(t), e.j)
                        if (d <= tol) cf = 1 - d * .35
                    }
                    if (cf == 0.0) continue
                    /* 점수: 맞은 정도 × 길이. 한 글자 낱말은 낮게 - 긴 낱말이 있으면 그쪽이 이긴다 */
                    val sc = cf * (if (len == 1) .9 else len.toDouble())
                    if (best == null || sc > best.sc) best = Tok(e.k, e.v, i, j, cf, w = ew, sc = sc)
                }
            }
            val b = best
            if (b != null) { toks.add(b); i = b.e }
            else { toks.add(Tok("x", null, i, i + 1, 0.0)); i++ }
        }
        return toks
    }

    /* ══════════ 날짜 셈 ══════════
       날짜는 "YYYY-MM-DD" 글. 자바스크립트 Date 처럼 넘친 달 · 날은 다음으로 넘긴다. */
    private const val BAD = "NaN-NaN-NaN"

    private fun p2(n: Int): String = n.toString().padStart(2, '0')

    /** MakeDay(y, m0, d): 달 · 날이 넘치면 넘긴다. 자바스크립트 Date 의 범위(±1억 날)를 벗어나면 null */
    private fun makeDay(y: Double, m0: Double, d: Double): LocalDate? {
        if (!y.isFinite() || !m0.isFinite() || !d.isFinite()) return null
        if (abs(y) > 1e7 || abs(m0) > 1e9 || abs(d) > 1e10) return null
        val ym = y.toLong() + Math.floorDiv(m0.toLong(), 12L)
        val mn = Math.floorMod(m0.toLong(), 12L)
        if (abs(ym) > 400_000) return null
        val r = LocalDate.of(ym.toInt(), (mn + 1).toInt(), 1).plusDays(d.toLong() - 1)
        return if (r.toEpochDay() in -100_000_000L..100_000_000L) r else null
    }

    /** new Date(y, m0, d, 12): 0~99 년은 1900 년대 */
    private fun ctor(y: Double, m0: Double, d: Double): LocalDate? {
        if (y.isNaN()) return null
        val yy = if (y >= 0 && y <= 99) 1900 + y else y
        return makeDay(yy, m0, d)
    }

    private fun key(d: LocalDate?): String = if (d == null) BAD else "${d.year}-${p2(d.monthValue)}-${p2(d.dayOfMonth)}"

    private fun day0(k: String?): LocalDate? {
        if (k == null) throw JsTypeError()
        return ctor(jsNum(slice(k, 0, 4)), jsNum(slice(k, 5, 7)) - 1, jsNum(slice(k, 8, 10)))
    }

    private fun plus(k: String?, n: Double): String {
        val d = day0(k) ?: return BAD
        return key(makeDay(d.year.toDouble(), (d.monthValue - 1).toDouble(), d.dayOfMonth + n))
    }

    /** 월요일이 0 */
    private fun wdOf(k: String): Double {
        val d = day0(k) ?: return Double.NaN
        return (d.dayOfWeek.value - 1).toDouble()
    }

    private class Ctx(val today: String, isBiz: ((String) -> Boolean)?) {
        private val biz: (String) -> Boolean = isBiz ?: { true }

        private fun back(k0: String): String {
            var k = k0
            var n = 0
            while (n < 15 && !biz(k)) { k = plus(k, -1.0); n++ }
            return k
        }

        private fun fwd(k0: String): String {
            var k = k0
            var n = 0
            while (n < 15 && !biz(k)) { k = plus(k, 1.0); n++ }
            return k
        }

        private fun valid(y: Double, m: Double, d: Double): String? {
            val t = ctor(y, m - 1, d) ?: return null
            return if ((t.monthValue - 1).toDouble() == m - 1) key(t) else null
        }

        private val ty get() = jsNum(slice(today, 0, 4))
        private val tm get() = jsNum(slice(today, 5, 7))

        /** 달 · 날. 한 달 넘게 지난 날이면 내년 (12월에 쓴 "1/5") */
        fun md(m: Double, d: Double): String? {
            val y = ty
            val k = valid(y, m, d) ?: return null
            return if (k < plus(today, -30.0)) valid(y + 1, m, d) else k
        }

        /** 날만: 이번 달, 지났으면 다음 달 */
        fun d(dd: Double): String? {
            val y = ty
            val m = tm
            var k = valid(y, m, dd)
            if (k == null || k < today) {
                val t = ctor(y, m, 1.0)
                k = if (t == null) null else valid(t.year.toDouble(), t.monthValue.toDouble(), dd)
            }
            return k
        }

        fun rel(n: Double) = plus(today, n)

        fun week(w: Double, wd: Double): String {
            val k = plus(plus(today, -wdOf(today)), w * 7 + wd)
            return if (w == 0.0 && k < today) plus(k, 7.0) else k    /* 일요일에 쓴 "이번 주 금" 은 오는 금요일 */
        }

        fun next(wd: Double) = plus(today, (wd - wdOf(today) + 7) % 7)

        /** 달의 끝 · 처음 · 가운데. 영업일만 쓰면 끝은 마지막 영업일, 처음은 첫 영업일 */
        fun month(y: Double, m: Double, pos: Any?): String = when (pos) {
            "end" -> back(key(ctor(y, m, 0.0)))
            "start" -> fwd(key(ctor(y, m - 1, 1.0)))
            else -> fwd(key(ctor(y, m - 1, 15.0)))
        }

        fun monthRel(r: Double, pos: Any?): String {
            val t = day0(today)
            var y = t?.year?.toDouble() ?: Double.NaN
            var m = (t?.monthValue?.toDouble() ?: Double.NaN) + r
            if (m > 12) { m -= 12; y++ }
            var k = month(y, m, pos)
            if (r == 0.0 && k < today && pos != "mid") { m++; if (m > 12) { m = 1.0; y++ }; k = month(y, m, pos) }
            if (r == 0.0 && pos == "start" && k <= today) {
                m = tm + 1; y = ty
                if (m > 12) { m = 1.0; y++ }
                k = month(y, m, pos)
            }
            return k
        }

        fun monthN(mo: Double, pos: Any?): String {
            val y = ty
            val k = month(y, mo, pos)
            return if (k < plus(today, -30.0)) month(y + 1, mo, pos) else k
        }

        fun months(n: Double): String {
            val t = day0(today) ?: return BAD
            return key(makeDay(t.year.toDouble(), (t.monthValue - 1) + n, t.dayOfMonth.toDouble()))
        }
    }

    /* ══════════ 2. 틀에 맞추기 ══════════
       낱말 열에서 날짜 · 시각이 되는 틀을 모두 찾는다. 틀 사이의 빈칸 · 토씨(에 · 쯤)는 건너뛴다. */

    /** "월" · "일" 은 요일 글자로 읽혔어도 달 · 날의 단위다 */
    private fun uw(t: Tok): String? = when (t.v) {
        0.0 -> "mon"
        6.0 -> "day"
        else -> null
    }

    /** 낱말이 홀로 서 있나: 앞뒤가 다른 한글 글자에 붙어 있지 않다 (뒤에 붙은 토씨는 괜찮다) */
    private val PART = listOf("까지", "까진", "에서", "에", "부터", "쯤", "경", "즈음", "때", "은", "는", "이", "가", "을", "를", "도", "만", "엔")

    private fun aloneIn(s: String, a: Int, b: Int): Boolean =
        !isSyl(at(s, a - 1)) && (!isSyl(at(s, b)) || slice(s, b).let { r -> PART.any { r.startsWith(it) } })

    /** is(i, k, v): i 번째 낱말이 종류 k (값 v) 인가. v 가 null 이면 값은 보지 않는다 */
    private fun isTok(toks: List<Tok>, i: Int, k: String, v: String? = null): Boolean {
        val t = toks.getOrNull(i) ?: return false
        if (!(t.k == k || (k == "u" && t.k == "wds" && uw(t) == v))) return false
        return v == null || t.v == v || (k == "u" && uw(t) == v)
    }

    /** 후보의 값. 날짜 후보는 date (· start · wd), 시각 후보는 h · m · ap (· h24) 또는 fixed */
    private data class Val(
        val date: String? = null,
        val start: String? = null,
        val wd: Double? = null,
        val h: Int? = null,
        val m: Int = 0,
        val ap: String? = null,
        val h24: Boolean = false,
        val fixed: String? = null,
    )

    private class Cand(
        val slot: String, val s: Int, val e: Int, val i0: Int, val i1: Int,
        val v: Val, val conf: Double, val w: Double,
    )

    private fun readAll(toks: List<Tok>, cx: Ctx, s: String): MutableList<Cand> {
        val cs = ArrayList<Cand>()
        fun tk(i: Int) = toks[i]
        fun isK(i: Int, k: String, v: String? = null) = isTok(toks, i, k, v)
        fun alone(t: Tok) = aloneIn(s, t.s, t.e)
        /* 사이에 낀 토씨는 건너뛴 다음 낱말 */
        fun nx(i: Int): Int { var j = i + 1; while (isK(j, "glue")) j++; return j }
        fun add(slot: String, i0: Int, i1: Int, v: Val, conf: Double, w: Double) =
            cs.add(Cand(slot, tk(i0).s, tk(i1).e, i0, i1, v, conf, w))
        fun conf(a: Int, b: Int): Double {
            var c = 1.0
            for (i in a..b) if (toks[i].c != 0.0) c = minOf(c, toks[i].c)
            return c
        }
        fun hourNum(i: Int): Int? =
            if (isK(i, "num") && tk(i).n <= 2 && tk(i).nv <= 24) tk(i).nv.toInt()
            else if (isK(i, "kn")) tk(i).nv.toInt() else null

        for (i in toks.indices) {
            val t = tk(i)
            /* ── 시각 ── */
            /* [오전/오후] 3 시 [30 분 | 반] [오전/오후] - 한 시 · 열두 시 같은 고유어 수도 */
            val h = hourNum(i)
            if (h != null && isK(nx(i), "u", "h") && at(s, tk(nx(i)).e) != "간") {        /* 3시간 은 시각이 아니다 */
                var j = nx(i)
                var m = 0
                if (isK(nx(j), "u", "half")) { j = nx(j); m = 30 }
                else if (isK(nx(j), "num") && tk(nx(j)).nv < 60 && isK(nx(nx(j)), "u", "min")) { m = tk(nx(j)).nv.toInt(); j = nx(nx(j)) }
                else if (isK(nx(j), "sm") && isK(nx(nx(j)), "u", "min")) { m = tk(nx(j)).nv.toInt(); j = nx(nx(j)) }
                var a = i
                var ap: String? = null
                if (i > 0 && isK(i - 1, "ap")) { a = i - 1; ap = tk(i - 1).v as String }
                else if (isK(nx(j), "ap")) { j = nx(j); ap = tk(j).v as String }
                add("time", a, j, Val(h = h, m = m, ap = ap), conf(a, j), 2.0 + (if (m != 0) 1 else 0) + (if (ap != null) 1 else 0))
            }
            /* 15:30 · 3:30pm · 3:30 오후 */
            if (isK(i, "num") && t.n <= 2 && isK(i + 1, "sep", ":") && isK(i + 2, "num") && tk(i + 2).n == 2 && t.nv <= 24 && tk(i + 2).nv < 60) {
                var a = i
                var j = i + 2
                var ap: String? = null
                if (i > 0 && isK(i - 1, "ap")) { a = i - 1; ap = tk(i - 1).v as String }
                else if (isK(nx(j), "ap")) { j = nx(j); ap = tk(j).v as String }
                add("time", a, j, Val(h = t.nv.toInt(), m = tk(i + 2).nv.toInt(), ap = ap, h24 = ap == null), conf(a, j), 3.0 + (if (ap != null) 1 else 0))
            }
            /* 3pm · 3 pm · 3p (a · p 한 글자는 숫자에 붙여 쓴 것만) */
            if (isK(i, "num") && t.n <= 2 && t.nv >= 1 && t.nv <= 12 && isK(i + 1, "ap") &&
                (tk(i + 1).w.startsWith("a") || tk(i + 1).w.startsWith("p")) &&
                (tk(i + 1).w.length > 1 || tk(i + 1).s == t.e)
            )
                add("time", i, i + 1, Val(h = t.nv.toInt(), m = 0, ap = tk(i + 1).v as String), conf(i, i + 1), 3.0)
            /* 정오 · 출근 · 퇴근 · 아침 (시각이 따로 없을 때만 쓰인다. 낱말 가운데의 "밤"(밤샘)은 아니다) */
            if (isK(i, "pt") && alone(t)) add("time", i, i, Val(fixed = t.v as String), t.c * .8, 1.0)
            if (isK(i, "ap") && alone(t) && (t.v as String) in listOf("morning", "noon", "evening", "night"))
                add("time", i, i, Val(fixed = mapOf("morning" to "09:00", "noon" to "12:00", "evening" to "18:00", "night" to "21:00")[t.v as String]), t.c * .5, .5)

            /* ── 날짜 ── */
            if (isK(i, "day")) add("date", i, i, Val(date = cx.rel(t.nv)), t.c, 2.0)
            /* 10월 12일 · 10월 말 · 12월 초 */
            if (isK(i, "num") && t.n <= 2 && isK(nx(i), "u", "mon")) {
                val j = nx(i)
                if (isK(nx(j), "num") && tk(nx(j)).n <= 2 && isK(nx(nx(j)), "u", "day")) {
                    val k = cx.md(t.nv, tk(nx(j)).nv)
                    if (k != null) add("date", i, nx(nx(j)), Val(date = k), conf(i, nx(nx(j))), 4.0)
                } else if (isK(nx(j), "pos") && t.nv >= 1 && t.nv <= 12) add("date", i, nx(j), Val(date = cx.monthN(t.nv, tk(nx(j)).v)), 1.0, 3.0)
            }
            /* 11월말 · 11월 말 ("월말" 이 한 낱말로 읽힌다) */
            if (isK(i, "num") && t.n <= 2 && t.nv >= 1 && t.nv <= 12 && isK(nx(i), "mpos"))
                add("date", i, nx(i), Val(date = cx.monthN(t.nv, tk(nx(i)).v)), 1.0, 3.0)
            /* 10/12 · 10.12 · 2026-10-12 */
            if (isK(i, "num") && t.n <= 2 && isK(i + 1, "sep") && (tk(i + 1).v as String) in "/.-" && isK(i + 2, "num") && tk(i + 2).n <= 2 &&
                tk(i + 1).s == t.e && tk(i + 2).s == tk(i + 1).e
            ) {
                val after = toks.getOrNull(i + 3)
                val dot = tk(i + 1).v == "."
                val dash = tk(i + 1).v == "-"
                /* 2.5% · v1.2 같은 것은 날짜가 아니다: 점 · 줄표는 그 뒤에 아무것도 붙지 않을 때만 */
                val glued = (after != null && after.s == tk(i + 2).e && after.k == "x") || isAsciiLetter(at(s, t.s - 1))
                if (!((dot || dash) && glued)) {
                    val k = cx.md(t.nv, tk(i + 2).nv)
                    if (k != null) add("date", i, i + 2, Val(date = k), if (dot || dash) .8 else 1.0, 3.0)
                }
            }
            if (isK(i, "num") && t.n == 4 && isK(i + 1, "sep") && isK(i + 2, "num") && isK(i + 3, "sep") && isK(i + 4, "num")) {
                val d = ctor(t.nv, tk(i + 2).nv - 1, tk(i + 4).nv)
                val k = if (d != null && d.dayOfMonth.toDouble() == tk(i + 4).nv) key(d) else null
                if (k != null) add("date", i, i + 4, Val(date = k), 1.0, 5.0)
            }
            /* 12일 (뒤에 간 · 동안 · 뒤 · 후가 오면 날 수다) */
            if (isK(i, "num") && t.n <= 2 && t.nv >= 1 && t.nv <= 31 && isK(nx(i), "u", "day") && !(i > 0 && isK(i - 1, "u", "mon"))) {
                val j = nx(i)
                val n2 = toks.getOrNull(nx(j))
                val nj = toks.getOrNull(j + 1)
                if (!(n2 != null && (n2.k == "after" || n2.k == "dur")) && !(nj != null && nj.s == tk(j).e && nj.k == "x"))
                    add("date", i, j, Val(date = cx.d(t.nv)), .9, 2.0)
            }
            /* N일 뒤 · 3주 후 · 2달 뒤 · 이틀 뒤 · 일주일 후 */
            if ((isK(i, "num") && t.n <= 3) || isK(i, "kd")) {
                var j = i
                val n = t.nv
                var per = 1
                if (isK(i, "num")) {
                    j = nx(i)
                    if (isK(j, "u", "day")) per = 1 else if (isK(j, "u", "week")) per = 7 else if (isK(j, "u", "month")) per = 30 else j = -1
                }
                if (j >= 0 && isK(nx(j), "after")) {
                    val k = if (per == 30) cx.months(n) else cx.rel(n * per)
                    add("date", i, nx(j), Val(date = k), conf(i, nx(j)), 3.0)
                }
            }
            /* 다음 주 금요일 · 다음주 금 · 금요일 다음 주 · 금요일 */
            if (isK(i, "wk") && (isK(nx(i), "wd") || (isK(nx(i), "wds") && aloneIn(s, tk(nx(i)).s, tk(nx(i)).e))))      /* 다음주 금리 ≠ 금요일 */
                add("date", i, nx(i), Val(date = cx.week(t.nv, tk(nx(i)).nv)), conf(i, nx(i)), 4.0)
            if (isK(i, "wd")) {
                if (isK(nx(i), "wk")) add("date", i, nx(i), Val(date = cx.week(tk(nx(i)).nv, t.nv)), conf(i, nx(i)), 4.0)
                add("date", i, i, Val(date = cx.next(t.nv), wd = t.nv), t.c, 2.0)
            }
            /* 다음 주(까지) → 그 주 금요일 */
            if (isK(i, "wk")) add("date", i, i, Val(date = cx.week(t.nv, 4.0)), t.c * .7, 1.0)
            /* 이번 주말 · 다음주말 ("주말" 이 "주" + "말" 로 나뉘어 읽힌 것) */
            if (isK(i, "wk") && isK(i + 1, "pos", "end") && tk(i + 1).s == t.e)
                add("date", i, i + 1, Val(date = cx.week(t.nv, 5.0)), t.c, 3.0)
            /* 주말 · 다음 주말 */
            if (isK(i, "wkend")) {
                val w = if (i > 0 && isK(i - 1, "wk")) tk(i - 1).nv else 0.0
                add("date", if (w != 0.0 && i > 0 && isK(i - 1, "wk")) i - 1 else i, i, Val(date = cx.week(w, 5.0)), t.c, 2.0)
            }
            /* 월말 · 이번 달 말 · 다음 달 초 · 다음 달 15일 */
            if (isK(i, "mpos")) add("date", i, i, Val(date = cx.monthRel(0.0, t.v)), t.c, 2.0)
            if (isK(i, "mrel")) {
                val j = nx(i)
                if (isK(j, "pos")) add("date", i, j, Val(date = cx.monthRel(t.nv, tk(j).v)), conf(i, j), 3.0)
                else if (isK(j, "num") && isK(nx(j), "u", "day")) {
                    val t0 = day0(cx.today)
                    val base = if (t0 == null) null else makeDay(t0.year.toDouble(), (t0.monthValue - 1) + t.nv, 1.0)
                    val d = if (base == null) null else ctor(base.year.toDouble(), (base.monthValue - 1).toDouble(), tk(j).nv)
                    if (d != null && base != null && d.monthValue == base.monthValue) add("date", i, nx(j), Val(date = key(d)), conf(i, nx(j)), 4.0)
                }
            }
        }
        return cs
    }

    /** 기간: 날짜 ~ 날짜 · 날짜부터 날짜까지 · 날짜부터 N일간 · 10/12~16 · 12~16일 */
    private fun readRanges(toks: List<Tok>, cs: List<Cand>, cx: Ctx): List<Cand> {
        val out = ArrayList<Cand>()
        val dates = cs.filter { it.slot == "date" }
        fun isK(i: Int, k: String, v: String? = null) = isTok(toks, i, k, v)
        for (a in dates) {
            var j = a.i1 + 1
            while (isK(j, "glue")) j++
            if (!(isK(j, "sep", "~") || isK(j, "sep", "-") || isK(j, "from"))) continue
            val sepI = j
            j++
            /* 오른쪽: 날짜 후보 · 아니면 날만 (16 · 16일) */
            val jj = j
            val b = dates.filter { it.i0 == jj }.sortedWith { x, y -> sgn(y.w - x.w) }.firstOrNull()
            var end: String? = null
            var i1 = -1
            if (b != null) { end = b.v.date; i1 = b.i1 }
            /* 부터 3일간 · 부터 이틀 동안 */
            else if (isK(sepI, "from") && isK(j, "num") && isK(j + 1, "u", "day") && isK(j + 2, "dur")) {
                end = plus(a.v.date, toks[j].nv - 1); i1 = j + 2
            } else if (isK(sepI, "from") && isK(j, "kd") && isK(j + 1, "dur")) {
                end = plus(a.v.date, toks[j].nv - 1); i1 = j + 1
            } else if (isK(j, "num") && toks[j].n <= 2) {
                val ad = a.v.date ?: throw JsTypeError()
                val m0 = jsNum(slice(ad, 5, 7))
                val y0 = jsNum(slice(ad, 0, 4))
                var d = ctor(y0, m0 - 1, toks[j].nv)
                if (d == null || (d.monthValue - 1).toDouble() != m0 - 1) continue
                if (key(d) <= ad) d = ctor(y0, m0, toks[j].nv)
                end = key(d); i1 = if (isK(j + 1, "u", "day")) j + 1 else j
            }
            if (end.isNullOrEmpty()) continue
            /* end <= a.date: 자바스크립트에서 날짜가 null 이면 비교는 거짓 */
            val ad = a.v.date
            if (ad != null && end <= ad) continue
            if (isK(i1 + 1, "to")) i1++
            out.add(Cand("date", a.s, toks[i1].e, a.i0, i1, Val(date = end, start = ad), a.conf, a.w + 4))
        }
        /* 12~16일: 왼쪽이 날만 (12) 이고 오른쪽이 "16일" */
        var i = 0
        while (i + 2 < toks.size) {
            if (isK(i, "num") && toks[i].n <= 2 && isK(i + 1, "sep", "~") && isK(i + 2, "num") && isK(i + 3, "u", "day")) {
                val b = cx.d(toks[i].nv)
                if (b != null) {
                    val end = plus(b, toks[i + 2].nv - toks[i].nv)
                    if (end > b) out.add(Cand("date", toks[i].s, toks[i + 3].e, i, i + 3, Val(date = end, start = b), .9, 6.0))
                }
            }
            i++
        }
        return out
    }

    private fun sgn(x: Double): Int = if (x > 0) 1 else if (x < 0) -1 else 0

    /** 시각 값 → "HH:MM". 오전 · 오후가 없으면 업무 시간으로 읽는다 (1~7시는 오후) */
    private fun clock(v: Val, notes: MutableList<String>): String? {
        if (v.fixed != null) return v.fixed
        var h = v.h ?: return null
        var m = v.m
        val ap = v.ap
        if (h == 24) h = 0
        if (ap == "pm" || ap == "evening" || ap == "night") { if (h < 12) h += 12 }
        else if (ap == "noon") { if (h < 6) h += 12 }
        else if (ap == "am" || ap == "morning" || ap == "early") { if (h == 12) h = 0 }
        else if (!v.h24 && h >= 1 && h <= 7) { h += 12; notes.add("${v.h}시 → 오후로 읽음") }
        if (h > 23 || m > 59) return null
        m = (Math.round(m / 5.0) * 5).toInt()
        if (m == 60) { m = 0; h = (h + 1) % 24 }
        return p2(h) + ":" + p2(m)
    }

    /* ══════════ 3. 고르기 ══════════
       겹치지 않는 날짜 하나 · 시각 하나의 조합 가운데 점수가 가장 큰 것. 점수 = 틀의 무게 × 맞은 정도 */
    private class Best(val d: Cand?, val t: Cand?, val v: Double)

    private fun pick(cs: List<Cand>): Best? {
        fun sc(c: Cand) = c.w * c.conf
        val ds = cs.filter { it.slot == "date" }.sortedWith { a, b ->
            val x = sgn(sc(b) - sc(a))
            if (x != 0) x else (b.e - b.s) - (a.e - a.s)
        }
        val ts = cs.filter { it.slot == "time" }.sortedWith { a, b -> sgn(sc(b) - sc(a)) }
        var best: Best? = null
        val dc = listOf<Cand?>(null) + ds.take(12)
        val tc = listOf<Cand?>(null) + ts.take(12)
        for (d in dc) for (t in tc) {
            if (d != null && t != null && d.s < t.e && t.s < d.e) continue
            val v = (if (d != null) sc(d) else 0.0) + (if (t != null) sc(t) else 0.0)
            if (best == null || v > best.v) best = Best(d, t, v)
        }
        return best
    }

    /* ══════════ 4. 요일 범위 ══════════
       "다음 주 월~금" · "월-수 교육". 위의 틀은 범위의 끝 요일만 날짜로 읽는다 - 여기서 앞뒤를 잇는다.
       주를 말하지 않았는데 시작 요일이 이미 지났으면 다음 주로 읽는다 (수요일에 쓴 "월~수"). */
    private const val WDS = "월화수목금토일"
    private val WR = Regex(
        "(다다음$WS*주|다담$WS*주|이번$WS*주|금주|다음$WS*주|담$WS*주|오는$WS*주)?$WS*([$WDS])(?:요일|욜)?$WS*[~\\-–]$WS*([$WDS])(?:요일|욜)?"
    )

    private fun weekRange(text: String, today: String, isBiz: ((String) -> Boolean)?): Parsed? {
        val m = WR.find(text) ?: return null
        val g1 = m.groups[1]?.value
        val mon = plus(today, -wdOf(today))
        val off = if (g1 == null) 0 else if (Regex("다다음|다담").containsMatchIn(g1)) 14 else if (Regex("이번|금주").containsMatchIn(g1)) 0 else 7
        var a = plus(mon, (off + WDS.indexOf(m.groupValues[2])).toDouble())
        var b = plus(mon, (off + WDS.indexOf(m.groupValues[3])).toDouble())
        if (b <= a) return null
        if (g1 == null && a < today) { a = plus(a, 7.0); b = plus(b, 7.0) }
        /* 나머지 글에서 시각을 읽는다 (범위 자리는 같은 길이의 빈칸으로 덮어 자리를 지킨다) */
        val s0 = m.range.first
        val s1 = m.range.first + m.value.length
        val r = parseOne(slice(text, 0, s0) + " ".repeat(s1 - s0) + slice(text, s1), today, isBiz)
        val time = r?.time
        val spans = (listOf(Span(s0, s1, "range")) + (if (r != null && time != null) r.spans.filter { it.kind == "time" } else emptyList()))
            .sortedBy { it.start }
        val rest = StringBuilder()
        var at = 0
        for (sp in spans) { rest.append(slice(text, at, sp.start)).append(' '); at = sp.end }
        return Parsed(b, a, time, tidy(rest.toString() + slice(text, at)), spans, emptyList())
    }

    /** .replace(/\s+/g, ' ').replace(/^[\s~\-–,·]+|[\s~\-–,·]+$/g, '').trim() */
    private fun tidy(x: String): String {
        val sb = StringBuilder()
        var inWs = false
        for (ch in x) {
            if (isWs(ch)) { if (!inWs) sb.append(' '); inWs = true }
            else { sb.append(ch); inWs = false }
        }
        fun edge(ch: Char) = isWs(ch) || ch == '~' || ch == '-' || ch == '–' || ch == ',' || ch == '·'
        var a = 0
        var b = sb.length
        while (a < b && edge(sb[a])) a++
        while (b > a && edge(sb[b - 1])) b--
        return jsTrim(sb.substring(a, b))
    }

    /* ══════════ 5. 반복 ══════════
       "매달 마지막 영업일" · "매주 월수" · "격주 화" · "매달 넷째 목" · "분기마다 말일" · "매년 3월 31일" · "영업일마다".
       돌려주는 규칙은 저장 형식(core/recur.py)과 같다. 기준 날짜가 있어야 정해지는 것은 need 로 알린다. */
    private val ORD = mapOf(
        "첫" to 1, "첫째" to 1, "첫번째" to 1, "둘째" to 2, "두번째" to 2, "셋째" to 3, "세번째" to 3,
        "넷째" to 4, "네번째" to 4, "다섯째" to 5, "마지막" to -1, "막" to -1,
    )
    private val R_DAY = Regex("(매일|날마다|매영업일|영업일마다|평일마다|평일매일|매일평일|매평일)(영업일만)?")
    private val R_WEEK = Regex("(매주|격주|2주마다)((?:[$WDS](?:요일|욜)?[,·와과및]?)*)")
    private val R_WD = Regex("([$WDS])(?:요일|욜)?")
    private val R_PRE = Regex("(매달|매월|달마다|격월|매분기|분기마다|분기별|반기마다|매년(\\d{1,2})월|매년)")
    private val R_BEFORE_END = Regex("^(?:말일|마지막날)(\\d)일전")
    private val R_BEFORE_END_BD = Regex("^마지막영업일(\\d)일전")
    private val R_LAST_BD = Regex("^(?:마지막|막)영업일")
    private val R_NTH_BD = Regex("^(?:(\\d{1,2})(?:번째|째)|첫(?:번째|째)?)영업일")
    private val R_NTH_WD = Regex("^(첫번째|첫째|첫|둘째|두번째|셋째|세번째|넷째|네번째|다섯째|마지막|막)주?([$WDS])(?:요일|욜)?")
    private val R_LAST_DAY = Regex("^(?:말일|마지막날|월말|말)")
    private val R_DAY_N = Regex("^(\\d{1,2})일")

    private fun readRule(text: String): RuleHit? {
        /* 빈칸을 뺀 글과, 그 글자마다 원래 글의 자리. 자리는 [...text] 의 차례(코드 포인트)다 */
        val idx = ArrayList<Int>()
        val cs = StringBuilder()
        chars(text).forEachIndexed { i, ch -> if (!isWs(ch)) { cs.append(ch); idx.add(i) } }
        val c = cs.toString()
        fun span(a: Int, b: Int) = listOf(idx.getOrElse(a) { -1 }, idx.getOrElse(b - 1) { -2 } + 1)

        R_DAY.find(c)?.let { m ->
            val rule = linkedMapOf<String, Any?>("period" to "day", "business_only" to Regex("영업일|평일").containsMatchIn(m.value))
            return RuleHit(rule, span(m.range.first, m.range.first + m.value.length), null)
        }
        R_WEEK.find(c)?.let { m ->
            val wds = ArrayList<Int>()
            R_WD.findAll(m.groupValues[2]).forEach { w -> val i = WDS.indexOf(w.groupValues[1]); if (i !in wds) wds.add(i) }
            val sorted = wds.sortedBy { it.toString() }               /* 자바스크립트 sort() 는 글로 견준다 */
            val rule = linkedMapOf<String, Any?>("period" to "week", "weekdays" to sorted, "interval" to if (m.groupValues[1] == "매주") 1 else 2)
            return RuleHit(rule, span(m.range.first, m.range.first + m.value.length), if (sorted.isNotEmpty()) null else "wd")
        }
        val pre = R_PRE.find(c) ?: return null
        val tail = slice(c, pre.range.first + pre.value.length)
        var r: LinkedHashMap<String, Any?>? = null
        var t: MatchResult?
        t = R_BEFORE_END.find(tail)
        if (t != null) r = linkedMapOf("basis" to "before_end", "k" to t.groupValues[1].toInt())
        else {
            t = R_BEFORE_END_BD.find(tail)
            if (t != null) r = linkedMapOf("basis" to "before_end_bd", "k" to t.groupValues[1].toInt())
            else {
                t = R_LAST_BD.find(tail)
                if (t != null) r = linkedMapOf("basis" to "business_day", "n" to -1)
                else {
                    t = R_NTH_BD.find(tail)
                    if (t != null) r = linkedMapOf("basis" to "business_day", "n" to (t.groups[1]?.value?.toInt() ?: 1))
                    else {
                        t = R_NTH_WD.find(tail)
                        if (t != null) r = linkedMapOf("basis" to "weekday", "n" to ORD.getValue(t.groupValues[1]), "weekday" to WDS.indexOf(t.groupValues[2]))
                        else {
                            t = R_LAST_DAY.find(tail)
                            if (t != null) r = linkedMapOf("basis" to "day", "n" to -1)
                            else {
                                t = R_DAY_N.find(tail)
                                if (t != null) r = linkedMapOf("basis" to "day", "n" to t.groupValues[1].toInt())
                            }
                        }
                    }
                }
            }
        }
        val end = pre.range.first + pre.value.length + (t?.value?.length ?: 0)
        val p = pre.groupValues[1]
        val toEnd = r != null && (r["n"] == -1 || r["basis"] == "before_end" || r["basis"] == "before_end_bd")
        val rule: LinkedHashMap<String, Any?>? = if (r == null) null else LinkedHashMap<String, Any?>().apply { put("period", "month"); putAll(r) }
        var months: List<Int>? = null
        var every: Int? = null
        var year: Boolean? = null
        if (p.contains("분기")) months = if (toEnd) listOf(3, 6, 9, 12) else listOf(1, 4, 7, 10)
        else if (p.contains("반기")) months = if (toEnd) listOf(6, 12) else listOf(1, 7)
        else if (p == "격월") every = 2
        else if (p.startsWith("매년")) { val g = pre.groups[2]?.value; if (!g.isNullOrEmpty()) months = listOf(g.toInt()) else year = true }
        if (rule != null && months != null) rule["months"] = months
        return RuleHit(rule, span(pre.range.first, end), if (r != null) null else "day", every, year, months)
    }

    /* ══════════ 한 번 읽기 ══════════ */
    private class SpanM(var a: Int, var b: Int, val kind: String)

    private fun parseOne(text: String, today: String, isBiz: ((String) -> Boolean)?): Parsed? {
        val cx = Ctx(today, isBiz)
        /* 영문 자판으로 친 덩어리는 한글로 옮겨 보고, 그것이 날짜 · 시각 낱말이 되면 그 읽기를 쓴다.
           옮긴 글과 원래 글의 자리를 이어 두어 빼낼 자리가 맞게 한다. */
        val sb = StringBuilder()
        val map = ArrayList<IntArray>()                 /* 옮긴 글의 글자마다 원래 글의 [시작, 끝] */
        val runs = splitLatin(text)
        val conv = runs.map { r ->
            if (!isLatinRun(r) || LEX.any { it.w == r.lowercase() }) null
            else {
                val h = toHangul(r)
                if (!h.isNullOrEmpty() && lex(h).all { it.k != "x" && it.c == 1.0 }) h else null
            }
        }
        /* 한 덩어리라도 옮겨졌다면 한/영을 잊고 친 것이다 - 온전한 한글 글자로만 옮겨지는 나머지 덩어리도
           옮겨 둔다 ("ekdmawn ghldml" → 다음주 회의). 영어 낱말(report)은 온전한 글자가 되지 않아 남는다 */
        val forgot = conv.any { it != null }
        var o = 0
        runs.forEachIndexed { n, r ->
            var use = conv[n] ?: r
            if (forgot && conv[n] == null && isLatinRun(r)) {
                val h = toHangul(r)
                if (!h.isNullOrEmpty() && chars(h).all(::isSyl)) use = h
            }
            for (k in use.indices) map.add(if (use == r) intArrayOf(o + k, o + k + 1) else intArrayOf(o, o + r.length))
            sb.append(use); o += r.length
        }
        val s = sb.toString()
        val toks = lex(s)
        val cs = readAll(toks, cx, s)
        cs.addAll(readRanges(toks, cs, cx))
        val best = pick(cs)
        if (best == null || (best.d == null && best.t == null)) return null
        val notes = ArrayList<String>()
        var date: String? = null
        var start: String? = null
        var time: String? = null
        val spans = ArrayList<SpanM>()
        val used = HashSet<Int>()
        fun take(c: Cand, kind: String) { spans.add(SpanM(c.s, c.e, kind)); for (i in c.i0..c.i1) used.add(i) }
        val bd = best.d
        val bt = best.t
        if (bd != null) {
            date = bd.v.date; start = bd.v.start?.ifEmpty { null }
            take(bd, if (start != null) "range" else "date")
        }
        if (bt != null) {
            var tv = bt.v
            take(bt, "time")
            val nx = toks.getOrNull(bt.i1 + 1)
            if (nx != null && nx.k == "sep" && (nx.v == "~" || nx.v == "-")) {
                val t2 = cs.firstOrNull { it.slot == "time" && it.i0 == bt.i1 + 2 }
                if (t2 != null) { spans[spans.size - 1].b = t2.e; for (i in t2.i0..t2.i1) used.add(i) }
            }
            /* 떨어져 있는 오전/오후: "오후 보고서 3시" */
            if (tv.h != null && tv.ap == null && !tv.h24) {
                val k = toks.indices.firstOrNull { toks[it].k == "ap" && it !in used }
                if (k != null) { tv = tv.copy(ap = toks[k].v as String); spans.add(SpanM(toks[k].s, toks[k].e, "time")); used.add(k) }
            }
            time = clock(tv, notes)
            if (time == null) spans.removeAt(spans.size - 1)
        }
        /* 떨어져 있는 "다음 주": "금요일 보고서 다음주" */
        if (bd?.v?.wd != null) {
            val k = toks.indices.firstOrNull { toks[it].k == "wk" && it !in used }
            if (k != null) { date = cx.week(toks[k].nv, bd.v.wd); spans.add(SpanM(toks[k].s, toks[k].e, "date")); used.add(k) }
        }
        if (bd != null && bd.conf < 1) notes.add("비슷한 말로 읽음")
        /* 낱말 뒤에 붙은 토씨(까지 · 에 · 부터)도, 앞의 "오는" 도 함께 뺀다 */
        for (sp in spans) {
            val k = toks.indexOfFirst { it.s == sp.a }
            if (k > 0 && toks[k - 1].k == "pre") sp.a = toks[k - 1].s
            while (true) {
                val t = toks.firstOrNull { it.s == sp.b } ?: break
                if (t.k == "to" || t.k == "glue" || t.k == "from") sp.b = t.e else break
            }
        }
        /* 옮긴 글의 자리 → 원래 글의 자리 */
        val orig = spans.map { Span(map[it.a][0], map[it.b - 1][1], it.kind) }.sortedBy { it.start }
        val rest = StringBuilder()
        var at = 0
        for (sp in spans.sortedBy { it.a }) { if (sp.a >= at) { rest.append(slice(s, at, sp.a)).append(' '); at = sp.b } }
        return Parsed(date, start, time, tidy(rest.toString() + slice(s, at)), orig, notes)
    }

    /** text.split(/([A-Za-z]+)/).filter(Boolean): 영문 글자 덩어리와 나머지 덩어리를 차례로 */
    private fun splitLatin(text: String): List<String> {
        val out = ArrayList<String>()
        var i = 0
        while (i < text.length) {
            val latin = text[i] in 'a'..'z' || text[i] in 'A'..'Z'
            var j = i
            while (j < text.length && (text[j] in 'a'..'z' || text[j] in 'A'..'Z') == latin) j++
            out.add(text.substring(i, j))
            i = j
        }
        return out
    }
}
