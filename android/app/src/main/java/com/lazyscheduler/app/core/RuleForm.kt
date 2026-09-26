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
 * What the routine editor holds, now that the engine does the thinking:
 * one example date, a unit, and how many units apart. Everything else
 * (basis · n · k · months) comes back from Recur.suggest, so the phone never
 * builds those by hand - except the weekly rule, where several weekdays can be
 * chosen at once and one suggestion could not carry them.
 */
object RulePick {
    val UNITS = listOf("day" to "일", "week" to "주", "month" to "월", "year" to "년")
    val EVERY = mapOf(
        "week" to listOf(1 to "매주", 2 to "격주"),
        "month" to listOf(1 to "매달", 2 to "격월", 3 to "분기", 6 to "반기"),
    )
    val SHIFTS = listOf("prev" to "앞 영업일로", "next" to "다음 영업일로", "none" to "그대로")

    /**
     * 화면에 보일 간격. 예전에 저장한 값(2달마다 등)이 목록에 없으면 그 줄만 하나 더 붙인다 -
     * 고치려고 연 규칙이 소리 없이 다른 주기로 바뀌면 안 된다.
     */
    fun everyOpts(unit: String, cur: Int): List<Pair<Int, String>> {
        val o = EVERY[unit] ?: return emptyList()
        if (o.any { it.first == cur }) return o
        return (o + (cur to "$cur${if (unit == "week") "주" else "달"}마다")).sortedBy { it.first }
    }

    /** A saved rule -> where the editor should start (unit, how many apart). */
    fun unitOf(rule: Map<String, Any?>?): Pair<String, Int> {
        if (rule.isNullOrEmpty()) return "month" to 1
        val r = Recur.normalize(rule)
        return when (r["period"] as? String) {
            "day" -> "day" to 1
            "week" -> "week" to ((r["interval"] as? Number)?.toInt() ?: 1)
            "quarter" -> "month" to 3                      // old quarter rules: the nearest seat
            else -> {
                val m = (r["months"] as? List<*>)?.map { (it as Number).toInt() }
                when {
                    m == null || m.size >= 12 -> "month" to 1
                    m.size == 1 -> "year" to 1
                    12 % m.size == 0 -> "month" to (12 / m.size)
                    else -> "month" to 1
                }
            }
        }
    }

    /** Counting business days can never land on a weekend or a holiday. */
    fun countsBusinessDays(rule: Map<String, Any?>?): Boolean {
        if (rule == null) return false
        val basis = rule["basis"] as? String
        return basis == "business_day" || basis == "before_end_bd" ||
            (rule["period"] == "day" && rule["business_only"] == true)
    }

    /** The weekly rule, built here because a week can hold several weekdays. */
    fun weekRule(weekdays: Set<Int>, every: Int, anchor: LocalDate, shift: String? = null): Map<String, Any?>? {
        if (weekdays.isEmpty()) return null
        return mapOf(
            "period" to "week",
            "weekdays" to weekdays.sorted(),
            "interval" to every.coerceIn(1, 52),
            "anchor" to anchor.toString(),
            // A weekend day asked for on purpose must not be moved off it
            "holiday_shift" to (shift ?: if (weekdays.all { it < 5 }) "prev" else "none"),
        )
    }
}

/** "9/23(수)" for the next [count] dates, or the error. */
fun previewDates(rule: Map<String, Any?>, today: LocalDate, count: Int = 5): List<String> {
    val w = "월화수목금토일"
    return Recur.occurrences(rule, today, today.plusDays(430)).take(count)
        .map { "${it.monthValue}/${it.dayOfMonth}(${w[it.dayOfWeek.value - 1]})" }
}
