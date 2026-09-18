package com.lazyscheduler.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.LocalDate

class RuleFormTest {

    /** The same cases the PC refuses (tests/test_recur.py test_validate_rule_rejects). */
    @Test
    fun refusesWhatThePcRefuses() {
        val bad: List<Any?> = listOf(
            null, emptyList<Any>(), "month",
            mapOf("period" to "year"),
            mapOf("period" to "week", "weekdays" to emptyList<Int>()),
            mapOf("period" to "week", "weekdays" to listOf(7)),
            mapOf("period" to "week", "weekdays" to listOf(true)),
            mapOf("period" to "week", "weekdays" to listOf(0), "interval" to 0),
            mapOf("period" to "week", "weekdays" to listOf(0), "anchor" to "2026/01/01"),
            mapOf("period" to "month", "basis" to "business_day", "n" to 0),
            mapOf("period" to "month", "basis" to "business_day", "n" to "2"),
            mapOf("period" to "month", "basis" to "business_day", "n" to true),
            mapOf("period" to "month", "basis" to "day", "n" to 32),
            mapOf("period" to "month", "basis" to "weekday", "n" to 1, "weekday" to 7),
            mapOf("period" to "month", "basis" to "before_end", "k" to -1),
            mapOf("period" to "month", "basis" to "nope"),
            mapOf("period" to "month", "basis" to "day", "n" to 1, "months" to emptyList<Int>()),
            mapOf("period" to "month", "basis" to "day", "n" to 1, "months" to listOf(13)),
            mapOf("period" to "month", "basis" to "day", "n" to 1, "holiday_shift" to "sideways"),
            mapOf("period" to "day", "business_only" to "yes"),
        )
        for (rule in bad) {
            val (ok, err) = RuleCheck.validate(rule)
            assertNull("should refuse $rule", ok)
            assertNotNull(err)
        }
    }

    @Test
    fun normalizesLikeThePc() {
        val (ok, _) = RuleCheck.validate(mapOf("period" to "week", "weekdays" to listOf(4, 0, 4), "interval" to 2,
            "evil" to "<script>", "anchor" to "2026-09-07"))
        assertEquals(mapOf("period" to "week", "holiday_shift" to "prev", "weekdays" to listOf(0, 4),
            "interval" to 2, "anchor" to "2026-09-07"), ok)
    }

    @Test
    fun everyFormChoiceMakesAValidRuleThatReadsBackTheSame() {
        val forms = mutableListOf(
            RuleForm(freq = "day", biz = false),
            RuleForm(freq = "day", biz = true),
            RuleForm(freq = "week", weekdays = setOf(0, 3), interval = 2, anchor = "2026-09-14", shift = "next"),
        )
        for (freq in listOf("month", "year", "quarter")) for (frame in listOf("date", "weekday", "end"))
            for (biz in listOf(false, true)) for (n in listOf(2, -1)) {
                forms += RuleForm(freq = freq, frame = frame, biz = biz, n = n, wn = n, k = 3, weekday = 3,
                    ymonth = 9, shift = "none")
            }
        for (mset in listOf("q1", "q2", "half")) forms += RuleForm(mset = mset, n = 15)
        forms += RuleForm(mset = "custom", months = listOf(2, 5, 8, 11), n = 10)
        for (f in forms) {
            val rule = f.toRule()
            val (ok, err) = RuleCheck.validate(rule)
            assertNull("$f -> $err", err)
            assertEquals(f.toString(), rule, RuleForm.from(ok).toRule())
        }
    }

    @Test
    fun businessDaysAreTheCountingNotThePeriod() {
        // Same sentence, only the counting changes: "매월 3일" <-> "매월 3번째 영업일"
        assertEquals("매월 3일", Recur.describe(RuleForm(n = 3).toRule()))
        assertEquals("매월 3번째 영업일", Recur.describe(RuleForm(n = 3, biz = true).toRule()))
        assertEquals("매일", Recur.describe(RuleForm(freq = "day").toRule()))
        assertEquals("매일 · 영업일만", Recur.describe(RuleForm(freq = "day", biz = true).toRule()))
        assertEquals("매년 9월 말일", Recur.describe(RuleForm(freq = "year", ymonth = 9, n = -1).toRule()))
        assertEquals("3·6·9·12월 말 2일 전", Recur.describe(RuleForm(frame = "end", k = 2, mset = "q1").toRule()))
    }

    @Test
    fun readsRulesSavedByThePcWithLongNumbers() {
        val pc = mapOf<String, Any?>("period" to "month", "basis" to "weekday", "n" to -1L, "weekday" to 3L,
            "holiday_shift" to "prev")
        val f = RuleForm.from(pc)
        assertEquals("weekday", f.frame)
        assertEquals(-1, f.wn)
        assertEquals(3, f.weekday)
        assertEquals("매월 마지막 목요일", Recur.describe(f.toRule()))
    }

    @Test
    fun previewShowsTheNextDates() {
        val rule = RuleForm(biz = true, n = 2).toRule()
        assertEquals(listOf("10/2(금)", "11/3(화)"), previewDates(rule, LocalDate.of(2026, 9, 18), 2))
    }
}
