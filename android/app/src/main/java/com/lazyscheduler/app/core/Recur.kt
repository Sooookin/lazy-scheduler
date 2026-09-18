package com.lazyscheduler.app.core

import java.time.LocalDate
import java.time.YearMonth
import java.time.temporal.ChronoUnit

/**
 * Recurrence rules, ported line by line from the PC app's recur.py.
 *
 * Both implementations must produce exactly the dates in tests/vectors/recurrence.json
 * (RecurVectorsTest runs that file). Change a rule here only together with recur.py.
 *
 *   period : "day" | "week" | "month" | "quarter"
 *   basis  : "day" | "business_day" | "weekday" | "before_end" | "before_end_bd"
 *   holiday_shift : "none" | "prev" | "next"   (default prev)
 *
 * Weekdays are Monday = 0 … Sunday = 6, as in Python.
 */
object Recur {
    const val SHIFT_REACH = 31L
    private val WEEK_EPOCH: LocalDate = LocalDate.of(2024, 1, 1)
    private const val W = "월화수목금토일"

    val DEFAULT_HOLIDAYS: Set<String> = setOf(
        "2026-01-01", "2026-02-16", "2026-02-17", "2026-02-18", "2026-03-01", "2026-03-02",
        "2026-05-05", "2026-05-24", "2026-05-25", "2026-06-03", "2026-06-06", "2026-08-15",
        "2026-08-17", "2026-09-24", "2026-09-25", "2026-09-26", "2026-10-03", "2026-10-05",
        "2026-10-09", "2026-12-25",
        "2027-01-01", "2027-02-06", "2027-02-07", "2027-02-08", "2027-02-09", "2027-03-01",
        "2027-05-05", "2027-05-13", "2027-06-06", "2027-06-07", "2027-08-15", "2027-08-16",
        "2027-09-14", "2027-09-15", "2027-09-16", "2027-10-03", "2027-10-04", "2027-10-09",
        "2027-10-11", "2027-12-25",
    )

    val HOLIDAY_NAMES: Map<String, String> = mapOf(
        "2026-01-01" to "신정",
        "2026-02-16" to "설날 연휴", "2026-02-17" to "설날", "2026-02-18" to "설날 연휴",
        "2026-03-01" to "삼일절", "2026-03-02" to "대체공휴일",
        "2026-05-05" to "어린이날", "2026-05-24" to "부처님오신날", "2026-05-25" to "대체공휴일",
        "2026-06-03" to "지방선거", "2026-06-06" to "현충일",
        "2026-08-15" to "광복절", "2026-08-17" to "대체공휴일",
        "2026-09-24" to "추석 연휴", "2026-09-25" to "추석", "2026-09-26" to "추석 연휴",
        "2026-10-03" to "개천절", "2026-10-05" to "대체공휴일", "2026-10-09" to "한글날",
        "2026-12-25" to "성탄절",
        "2027-01-01" to "신정",
        "2027-02-06" to "설날 연휴", "2027-02-07" to "설날",
        "2027-02-08" to "설날 연휴", "2027-02-09" to "대체공휴일",
        "2027-03-01" to "삼일절",
        "2027-05-05" to "어린이날", "2027-05-13" to "부처님오신날",
        "2027-06-06" to "현충일", "2027-06-07" to "대체공휴일",
        "2027-08-15" to "광복절", "2027-08-16" to "대체공휴일",
        "2027-09-14" to "추석 연휴", "2027-09-15" to "추석", "2027-09-16" to "추석 연휴",
        "2027-10-03" to "개천절", "2027-10-04" to "대체공휴일",
        "2027-10-09" to "한글날", "2027-10-11" to "대체공휴일",
        "2027-12-25" to "성탄절",
    )

    // Replaced as a whole (never edited in place): the UI and reminders read it from other threads.
    @Volatile
    private var holidays: Set<LocalDate> = parseDates(DEFAULT_HOLIDAYS)

    private fun parseDates(src: Collection<String>): Set<LocalDate> =
        src.mapNotNull { runCatching { LocalDate.parse(it) }.getOrNull() }.toSet()

    /** Built-in holidays plus the extra ones from settings (the "holidays" list). */
    fun setHolidays(extra: Collection<String>?) {
        holidays = parseDates(DEFAULT_HOLIDAYS + (extra ?: emptyList()))
    }

    fun isHoliday(d: LocalDate) = d in holidays

    fun weekday(d: LocalDate) = d.dayOfWeek.value - 1          // Monday = 0

    fun isBusinessDay(d: LocalDate) = weekday(d) < 5 && d !in holidays

    fun nextBusinessDay(d: LocalDate, forward: Boolean = true): LocalDate {
        val step = if (forward) 1L else -1L
        var cur = d
        repeat(SHIFT_REACH.toInt()) {
            if (isBusinessDay(cur)) return cur
            cur = cur.plusDays(step)
        }
        return d
    }

    private fun span(d0: LocalDate, d1: LocalDate): List<LocalDate> {
        val out = ArrayList<LocalDate>()
        var d = d0
        while (!d.isAfter(d1)) {
            out.add(d)
            d = d.plusDays(1)
        }
        return out
    }

    private fun shift(d: LocalDate, mode: String): LocalDate =
        if (mode == "none" || isBusinessDay(d)) d else nextBusinessDay(d, forward = mode == "next")

    private fun num(v: Any?, default: Int): Int = when (v) {
        is Number -> v.toInt()
        is String -> v.toIntOrNull() ?: default
        else -> default
    }

    private fun ints(v: Any?): List<Int>? = (v as? List<*>)?.map { num(it, 0) }

    /** Old rule formats → current format (recur.normalize). */
    fun normalize(rule: Map<String, Any?>?): MutableMap<String, Any?> {
        val r = (rule ?: emptyMap()).toMutableMap()
        if (!r.containsKey("period")) {
            val k = (r.remove("kind") as? String) ?: "daily"
            when (k) {
                "daily" -> r["period"] = "day"
                "weekly" -> r["period"] = "week"
                "yearly" -> {
                    r["period"] = "month"; r["basis"] = "day"
                    r["n"] = r["day"] ?: 1
                    r["months"] = listOf(num(r["month"], 1))
                }
                "quarterly_day" -> {
                    r["period"] = "month"; r["basis"] = "day"
                    r["n"] = r["day"] ?: 1
                    r["months"] = ints(r["months"]) ?: listOf(3, 6, 9, 12)
                }
                else -> {
                    r["period"] = "month"
                    r["basis"] = mapOf(
                        "monthly_day" to "day",
                        "monthly_business_day" to "business_day",
                        "monthly_weekday" to "weekday",
                        "before_month_end" to "before_end",
                        "before_month_end_bd" to "before_end_bd",
                    )[k] ?: "day"
                    if (r["basis"] == "day") r["n"] = r["day"] ?: 1
                }
            }
        }
        if (!r.containsKey("holiday_shift")) r["holiday_shift"] = "prev"
        if (r["period"] == "day" && !r.containsKey("business_only")) r["business_only"] = true
        return r
    }

    private fun byBasis(r: Map<String, Any?>, d0: LocalDate, d1: LocalDate): LocalDate? {
        val days = span(d0, d1)
        val bd by lazy { days.filter(::isBusinessDay) }
        fun pick(list: List<LocalDate>, n: Int): LocalDate? {
            val idx = if (n > 0) n - 1 else list.size + n
            return list.getOrNull(idx)
        }
        return when (r["basis"] as? String ?: "day") {
            "day" -> pick(days, num(r["n"], 1))
            "business_day" -> pick(bd, num(r["n"], 1))
            "weekday" -> {
                val wd = num(r["weekday"], 0)
                pick(days.filter { weekday(it) == wd }, num(r["n"], 1))
            }
            "before_end" -> days.getOrNull(days.size - 1 - num(r["k"], 0))
            "before_end_bd" -> bd.getOrNull(bd.size - 1 - num(r["k"], 0))
            else -> null
        }
    }

    /**
     * Shifted dates that fall inside [start, end]. Candidates are made SHIFT_REACH days wider
     * than the window and cut after shifting, so the answer never depends on the window.
     */
    fun occurrences(rule: Map<String, Any?>?, start: LocalDate, end: LocalDate): List<LocalDate> {
        val r = normalize(rule)
        val period = r["period"] as? String ?: "day"
        val mode = r["holiday_shift"] as? String ?: "prev"

        if (period == "day") {
            val businessOnly = r["business_only"] as? Boolean ?: true
            return span(start, end).filter { !businessOnly || isBusinessDay(it) }
        }

        val lo = start.minusDays(SHIFT_REACH)
        val hi = end.plusDays(SHIFT_REACH)
        val raw = ArrayList<LocalDate?>()

        when (period) {
            "week" -> {
                val wds = (ints(r["weekdays"]) ?: emptyList()).toSet()
                val every = maxOf(1, num(r["interval"], 1))
                val anchor = (r["anchor"] as? String)?.let { runCatching { LocalDate.parse(it) }.getOrNull() } ?: WEEK_EPOCH
                val aMon = anchor.minusDays(weekday(anchor).toLong())
                for (d in span(lo, hi)) {
                    if (weekday(d) in wds) {
                        val mon = d.minusDays(weekday(d).toLong())
                        val weeks = Math.floorDiv(ChronoUnit.DAYS.between(aMon, mon), 7L)
                        if (Math.floorMod(weeks, every.toLong()) == 0L) raw.add(d)
                    }
                }
            }
            "quarter" -> {
                for (y in lo.year..hi.year) {
                    for (q in 0..3) {
                        val d0 = LocalDate.of(y, q * 3 + 1, 1)
                        val d1 = YearMonth.of(y, q * 3 + 3).atEndOfMonth()
                        if (!d1.isBefore(lo) && !d0.isAfter(hi)) raw.add(byBasis(r, d0, d1))
                    }
                }
            }
            else -> {                                              // month
                val months = (ints(r["months"]) ?: (1..12).toList()).toSet()
                var ym = YearMonth.from(lo)
                while (!ym.atDay(1).isAfter(hi)) {
                    if (ym.monthValue in months) raw.add(byBasis(r, ym.atDay(1), ym.atEndOfMonth()))
                    ym = ym.plusMonths(1)
                }
            }
        }
        return raw.filterNotNull().map { shift(it, mode) }.toSet()
            .filter { !it.isBefore(start) && !it.isAfter(end) }.sorted()
    }

    private fun basisText(r: Map<String, Any?>, q: Boolean): String {
        val n = num(r["n"], 1)
        val k = num(r["k"], 0)
        return when (r["basis"] as? String ?: "day") {
            "day" -> if (n == -1) (if (q) "마지막 날" else "말일") else (if (q) "${n}일째" else "${n}일")
            "business_day" -> if (n == -1) "마지막 영업일" else "${n}번째 영업일"
            "weekday" -> {
                val wd = W[num(r["weekday"], 0).coerceIn(0, 6)]
                if (n == -1) "마지막 ${wd}요일" else "${n}번째 ${wd}요일"
            }
            "before_end" -> if (k == 0) (if (q) "마지막 날" else "말일") else "말 ${k}일 전"
            "before_end_bd" -> if (k == 0) "마지막 영업일" else "말 ${k}영업일 전"
            else -> ""
        }
    }

    /** Human description, same wording as recur.describe. */
    fun describe(rule: Map<String, Any?>?): String {
        if (rule.isNullOrEmpty()) return "반복"
        val r = normalize(rule)
        return when (r["period"] as? String ?: "day") {
            // Calendar days first; business days only is the add-on (the old "매 영업일" read as the default)
            "day" -> if (r["business_only"] as? Boolean != false) "매일 · 영업일만" else "매일"
            "week" -> {
                val ds = (ints(r["weekdays"]) ?: emptyList()).sorted().joinToString("·") { W[it.coerceIn(0, 6)].toString() }
                val iv = num(r["interval"], 1)
                val head = mapOf(1 to "매주", 2 to "격주", 3 to "3주마다", 4 to "4주마다")[iv] ?: "${iv}주마다"
                "$head ${ds}요일"
            }
            "quarter" -> "매 분기 " + basisText(r, q = true)
            else -> {
                val months = (ints(r["months"]) ?: (1..12).toList()).toSortedSet()
                val body = basisText(r, q = false)
                when (months.size) {
                    12 -> "매월 $body"
                    1 -> "매년 ${months.first()}월 $body"
                    else -> months.joinToString("·") + "월 " + body
                }
            }
        }
    }

    // ---------- start from one date ----------

    const val SUGGEST_MAX = 7

    /**
     * One example date → the rules that include it, most common first (routine editor,
     * "날짜 하나로 시작"). Same list and order as recur.suggest; tests/vectors/suggest.json
     * holds both to it. A business day keeps the usual "앞 영업일로"; a weekend or holiday
     * gets "그대로", so the picked day itself is never shifted away.
     */
    fun suggest(day: LocalDate): List<Pair<String, Map<String, Any?>>> {
        val ym = YearMonth.from(day)
        val d = day.dayOfMonth
        val last = ym.lengthOfMonth()
        val wd = weekday(day)
        val m = day.monthValue
        val bd = span(ym.atDay(1), ym.atEndOfMonth()).filter(::isBusinessDay)
        val biz = day in bd
        val c = ArrayList<Map<String, Any?>>()
        if (d == last) c += mapOf("period" to "month", "basis" to "day", "n" to -1)
        if (biz && day == bd.last()) c += mapOf("period" to "month", "basis" to "business_day", "n" to -1)
        c += mapOf("period" to "month", "basis" to "day", "n" to d)
        if (biz && day != bd.last() && bd.indexOf(day) < 10)
            c += mapOf("period" to "month", "basis" to "business_day", "n" to bd.indexOf(day) + 1)
        if (d + 7 > last) c += mapOf("period" to "month", "basis" to "weekday", "n" to -1, "weekday" to wd)
        else if ((d - 1) / 7 + 1 <= 4) c += mapOf("period" to "month", "basis" to "weekday", "n" to (d - 1) / 7 + 1, "weekday" to wd)
        c += mapOf("period" to "week", "weekdays" to listOf(wd), "interval" to 1, "anchor" to day.toString())
        if (m in setOf(3, 6, 9, 12) && d == last)
            c += mapOf("period" to "month", "basis" to "day", "n" to -1, "months" to listOf(3, 6, 9, 12))
        c += mapOf("period" to "month", "basis" to "day", "n" to d, "months" to listOf(m))

        val shift = if (biz) "prev" else "none"
        val out = ArrayList<Pair<String, Map<String, Any?>>>()
        val seen = HashSet<String>()
        for (x in c) {
            val rule = RuleCheck.validate(x + ("holiday_shift" to shift)).first ?: continue
            val text = describe(rule)
            if (text in seen || day !in occurrences(rule, day, day)) continue
            seen += text
            out += text to rule
        }
        return out.take(SUGGEST_MAX)
    }
}
