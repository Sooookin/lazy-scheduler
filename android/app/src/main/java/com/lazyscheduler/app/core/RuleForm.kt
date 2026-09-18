package com.lazyscheduler.app.core

import java.time.LocalDate

/**
 * Rule checking, ported from recur.validate_rule. The phone writes straight to Firestore,
 * so nothing else checks a rule before the PC reads it: a broken rule saved here would
 * make that item vanish from every list. Same limits, same messages.
 */
object RuleCheck {
    private val PERIODS = setOf("day", "week", "month", "quarter")
    private val BASES = setOf("day", "business_day", "weekday", "before_end", "before_end_bd")
    private val SHIFTS = setOf("none", "prev", "next")

    /** Whole numbers only: Int and Long (Firestore), whole Double (JSON). Never Boolean or String. */
    private fun int(v: Any?): Int? = when (v) {
        is Int -> v
        is Long -> v.toInt()
        is Double -> if (v % 1.0 == 0.0) v.toInt() else null
        else -> null
    }

    private fun intIn(v: Any?, lo: Int, hi: Int) = int(v)?.takeIf { it in lo..hi }

    /** (clean rule, null) or (null, message). */
    fun validate(rule: Any?): Pair<Map<String, Any?>?, String?> {
        @Suppress("UNCHECKED_CAST")
        val raw = rule as? Map<String, Any?> ?: return null to "반복 규칙을 정하세요"
        val r = Recur.normalize(raw)
        val period = r["period"] as? String
        if (period !in PERIODS) return null to "반복 주기를 선택하세요"
        val shift = r["holiday_shift"] ?: "prev"
        if (shift !in SHIFTS) return null to "휴일 보정 방식이 올바르지 않습니다"
        val out = linkedMapOf<String, Any?>("period" to period, "holiday_shift" to shift)

        if (period == "day") {
            val b = r["business_only"] ?: true
            if (b !is Boolean) return null to "주말·공휴일 제외 값이 올바르지 않습니다"
            out["business_only"] = b
            return out to null
        }

        if (period == "week") {
            val wds = (r["weekdays"] as? List<*>)?.map { intIn(it, 0, 6) }
            if (wds.isNullOrEmpty() || wds.any { it == null }) return null to "요일을 하나 이상 선택하세요"
            out["weekdays"] = wds.filterNotNull().toSortedSet().toList()
            val iv = intIn(r["interval"] ?: 1, 1, 52) ?: return null to "반복 간격은 1~52주 사이여야 합니다"
            out["interval"] = iv
            val a = r["anchor"]
            if (a != null) {
                if (a !is String || a.length != 10 || runCatching { LocalDate.parse(a) }.isFailure)
                    return null to "기준 주 날짜가 올바르지 않습니다"
                out["anchor"] = a
            }
            return out to null
        }

        val q = period == "quarter"
        val basis = r["basis"] ?: "day"
        if (basis !in BASES) return null to "어느 날에 할지 기준을 선택하세요"
        out["basis"] = basis
        if (basis in setOf("day", "business_day", "weekday")) {
            val top = when (basis) {
                "day" -> if (q) 92 else 31
                "business_day" -> if (q) 66 else 23
                else -> if (q) 13 else 5
            }
            val n = int(r["n"] ?: 1)
            if (n == null || !(n == -1 || n in 1..top)) return null to "몇 번째인지는 1~${top} 사이여야 합니다"
            out["n"] = n
            if (basis == "weekday") {
                out["weekday"] = intIn(r["weekday"] ?: 0, 0, 6) ?: return null to "요일이 올바르지 않습니다"
            }
        } else {
            val top = if (q) 60 else 27
            out["k"] = intIn(r["k"] ?: 0, 0, top) ?: return null to "말일 기준 일수는 0~${top} 사이여야 합니다"
        }
        if (!q && r["months"] != null) {
            val ms = (r["months"] as? List<*>)?.map { intIn(it, 1, 12) }
            if (ms.isNullOrEmpty() || ms.any { it == null }) return null to "실행할 달을 하나 이상 선택하세요"
            out["months"] = ms.filterNotNull().toSortedSet().toList()
        }
        return out to null
    }
}

/**
 * The routine editor's state: a sentence built from pieces, the same as the PC form
 * (web/app.js ruleToS / sToRule).
 *
 *   얼마나 자주  매일 · 매주 · 매월 · 매년 (매 분기: old rules only)
 *   틀           날짜로 · 요일로 · 말일부터
 *   세는 방법    달력 날 · 영업일          (business days are an option, not a period)
 *   주말·공휴일  앞 영업일로 · 뒤로 · 그대로
 *   실행하는 달  매월 · 분기 말 · 분기 초 · 반기 · 직접
 *
 * The stored rule format is unchanged; "매년" is a monthly rule with one month.
 */
data class RuleForm(
    val freq: String = "month",
    val frame: String = "date",
    val biz: Boolean = false,
    val n: Int = 1,                         // 날짜로: day / business day (-1 = last)
    val k: Int = 0,                         // 말일부터: days before the end
    val wn: Int = 1,                        // 요일로: 1..4, -1 = last
    val weekday: Int = 0,
    val weekdays: Set<Int> = emptySet(),
    val interval: Int = 1,
    val anchor: String? = null,
    val shift: String = "prev",
    val mset: String = "all",
    val months: List<Int> = emptyList(),    // mset == "custom"
    val ymonth: Int = 1,                    // 매년
) {
    val quarter get() = freq == "quarter"
    /** The largest "n-th" for the chosen counting. */
    val nTop get() = if (quarter) (if (biz) 66 else 92) else (if (biz) 23 else 31)
    /** Counting business days never lands on a weekend, so the holiday choice does nothing then. */
    val shiftMatters get() = freq == "week" || (freq != "day" && (frame == "weekday" || !biz))

    fun toRule(): Map<String, Any?> {
        val r = linkedMapOf<String, Any?>("period" to (if (freq == "year") "month" else freq), "holiday_shift" to shift)
        when (freq) {
            "day" -> r["business_only"] = biz
            "week" -> {
                r["weekdays"] = weekdays.sorted()
                r["interval"] = interval
                if (anchor != null) r["anchor"] = anchor
            }
            else -> {
                when (frame) {
                    "weekday" -> { r["basis"] = "weekday"; r["n"] = wn; r["weekday"] = weekday }
                    "end" -> { r["basis"] = if (biz) "before_end_bd" else "before_end"; r["k"] = k }
                    else -> { r["basis"] = if (biz) "business_day" else "day"; r["n"] = n }
                }
                if (freq == "year") r["months"] = listOf(ymonth)
                else if (freq == "month" && mset != "all") {
                    val set = if (mset == "custom") months.sorted() else MONTH_SETS.first { it.first == mset }.third!!
                    if (set.isNotEmpty() && set.size < 12) r["months"] = set
                }
            }
        }
        return r
    }

    /** What is still missing, or null. */
    fun problem(): String? = when {
        freq == "week" && weekdays.isEmpty() -> "요일을 하나 이상 고르세요"
        freq == "month" && mset == "custom" && months.isEmpty() -> "실행하는 달을 하나 이상 고르세요"
        else -> null
    }

    companion object {
        val FREQS = listOf("day" to "매일", "week" to "매주", "month" to "매월", "year" to "매년")
        val FRAMES = listOf("date" to "날짜로", "weekday" to "요일로", "end" to "말일부터")
        val SHIFTS = listOf("prev" to "앞 영업일로", "next" to "뒤로", "none" to "그대로")
        val MONTH_SETS = listOf(
            Triple("all", "매월", null),
            Triple("q1", "분기 말", listOf(3, 6, 9, 12)),
            Triple("q2", "분기 초", listOf(1, 4, 7, 10)),
            Triple("half", "반기", listOf(6, 12)),
            Triple("custom", "직접", null),
        )

        private fun num(v: Any?, d: Int) = (v as? Number)?.toInt() ?: d

        /** A new routine starts as "매월 (today)일", counted in calendar days. */
        fun fresh(today: LocalDate) = RuleForm(n = today.dayOfMonth)

        /** From a saved rule (any format the PC ever wrote). */
        fun from(rule: Map<String, Any?>?): RuleForm {
            if (rule.isNullOrEmpty()) return RuleForm()
            val r = Recur.normalize(rule)
            val base = RuleForm(anchor = r["anchor"] as? String, shift = r["holiday_shift"] as? String ?: "prev")
            when (r["period"] as? String) {
                "day" -> return base.copy(freq = "day", biz = r["business_only"] as? Boolean ?: true)
                "week" -> return base.copy(freq = "week",
                    weekdays = ((r["weekdays"] as? List<*>)?.map { num(it, 0) } ?: emptyList()).toSet(),
                    interval = num(r["interval"], 1))
                "month", "quarter" -> {}
                else -> return base
            }
            var f = base.copy(freq = r["period"] as String)
            f = when (r["basis"] as? String ?: "day") {
                "weekday" -> f.copy(frame = "weekday", wn = num(r["n"], 1), weekday = num(r["weekday"], 0))
                "before_end" -> f.copy(frame = "end", k = num(r["k"], 0))
                "before_end_bd" -> f.copy(frame = "end", biz = true, k = num(r["k"], 0))
                "business_day" -> f.copy(biz = true, n = num(r["n"], 1))
                else -> f.copy(n = num(r["n"], 1))
            }
            val ms = (r["months"] as? List<*>)?.map { num(it, 0) }?.sorted()
            if (f.freq == "month" && ms != null && ms.size == 1) return f.copy(freq = "year", ymonth = ms[0])
            if (f.freq == "month" && ms != null && ms.isNotEmpty() && ms.size < 12) {
                val hit = MONTH_SETS.firstOrNull { it.third == ms }
                return f.copy(mset = hit?.first ?: "custom", months = ms)
            }
            return f
        }
    }
}

/** "9/23(수)" for the next [count] dates, or the error. */
fun previewDates(rule: Map<String, Any?>, today: LocalDate, count: Int = 5): List<String> {
    val w = "월화수목금토일"
    return Recur.occurrences(rule, today, today.plusDays(430)).take(count)
        .map { "${it.monthValue}/${it.dayOfMonth}(${w[it.dayOfWeek.value - 1]})" }
}
