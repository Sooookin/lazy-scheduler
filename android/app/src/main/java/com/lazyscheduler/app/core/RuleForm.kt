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
 * The rule editor's state, with the same choices as the PC form (web/app.js):
 * how often (period) × which day (basis key) × which months.
 */
data class RuleForm(
    val period: String = "month",
    val businessOnly: Boolean = true,
    val weekdays: Set<Int> = emptySet(),
    val interval: Int = 1,
    val basisKey: String = "bd_n",
    val n: Int = 1,
    val k: Int = 3,
    val weekday: Int = 0,
    val months: List<Int>? = null,            // null = every month
    val anchor: String? = null,
) {
    val quarter get() = period == "quarter"

    fun toRule(): Map<String, Any?> {
        val r = linkedMapOf<String, Any?>("period" to period, "holiday_shift" to "prev")
        when (period) {
            "day" -> r["business_only"] = businessOnly
            "week" -> {
                r["weekdays"] = weekdays.sorted()
                r["interval"] = interval
                if (anchor != null) r["anchor"] = anchor
            }
            else -> {
                r["basis"] = BASIS_OF[basisKey]
                when (basisKey) {
                    "bd_last", "wd_last", "day_last" -> r["n"] = -1
                    "bd_n", "wd_n", "day_n" -> r["n"] = n
                }
                if (basisKey == "wd_n" || basisKey == "wd_last") r["weekday"] = weekday
                if (basisKey == "be_k" || basisKey == "bebd_k") r["k"] = k
                if (period == "month" && months != null && months.size < 12) r["months"] = months
            }
        }
        return r
    }

    companion object {
        val PERIODS = listOf("day" to "매 영업일", "week" to "매주", "month" to "매월", "quarter" to "분기")
        /** key, label for months, label for quarters (same order as the PC). */
        val BASES = listOf(
            Triple("bd_n", "N번째 영업일", "분기 N번째 영업일"),
            Triple("bd_last", "마지막 영업일", "분기 마지막 영업일"),
            Triple("bebd_k", "말일 K영업일 전", "분기말 K영업일 전"),
            Triple("wd_n", "N번째 O요일", "분기 N번째 O요일"),
            Triple("wd_last", "마지막 O요일", "분기 마지막 O요일"),
            Triple("day_n", "N일", "분기 N일째"),
            Triple("day_last", "말일", "분기 마지막 날"),
            Triple("be_k", "말일 K일 전", "분기말 K일 전"),
        )
        val MONTH_SETS = listOf(
            "매월" to null,
            "3·6·9·12월" to listOf(3, 6, 9, 12),
            "1·4·7·10월" to listOf(1, 4, 7, 10),
            "6·12월" to listOf(6, 12),
        )
        private val BASIS_OF = mapOf(
            "bd_n" to "business_day", "bd_last" to "business_day", "wd_n" to "weekday", "wd_last" to "weekday",
            "be_k" to "before_end", "bebd_k" to "before_end_bd", "day_n" to "day", "day_last" to "day",
        )

        private fun num(v: Any?, d: Int) = (v as? Number)?.toInt() ?: d

        /** From a saved rule (any format the PC ever wrote). */
        fun from(rule: Map<String, Any?>?): RuleForm {
            if (rule.isNullOrEmpty()) return RuleForm()
            val r = Recur.normalize(rule)
            val period = r["period"] as? String ?: "month"
            val n = num(r["n"], 1)
            val last = n == -1
            val key = when (r["basis"] as? String ?: "day") {
                "business_day" -> if (last) "bd_last" else "bd_n"
                "weekday" -> if (last) "wd_last" else "wd_n"
                "before_end" -> "be_k"
                "before_end_bd" -> "bebd_k"
                else -> if (last) "day_last" else "day_n"
            }
            val months = (r["months"] as? List<*>)?.map { num(it, 0) }?.sorted()
            return RuleForm(
                period = period,
                businessOnly = r["business_only"] as? Boolean ?: true,
                weekdays = ((r["weekdays"] as? List<*>)?.map { num(it, 0) } ?: emptyList()).toSet(),
                interval = num(r["interval"], 1),
                basisKey = key,
                n = if (last) 1 else n,
                k = num(r["k"], 3),
                weekday = num(r["weekday"], 0),
                months = months?.takeIf { it.size < 12 },
                anchor = r["anchor"] as? String,
            )
        }
    }
}

/** "9/23(수)" for the next [count] dates, or the error. */
fun previewDates(rule: Map<String, Any?>, today: LocalDate, count: Int = 5): List<String> {
    val w = "월화수목금토일"
    return Recur.occurrences(rule, today, today.plusDays(430)).take(count)
        .map { "${it.monthValue}/${it.dayOfMonth}(${w[it.dayOfWeek.value - 1]})" }
}
