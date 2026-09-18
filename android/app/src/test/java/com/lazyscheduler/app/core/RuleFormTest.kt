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
            RuleForm(period = "day", businessOnly = false),
            RuleForm(period = "week", weekdays = setOf(0, 3), interval = 2, anchor = "2026-09-14"),
        )
        for (period in listOf("month", "quarter")) for ((key, _, _) in RuleForm.BASES) {
            forms += RuleForm(period = period, basisKey = key, n = 2, k = 3, weekday = 3,
                months = if (period == "month") listOf(3, 6, 9, 12) else null)
        }
        for (f in forms) {
            val rule = f.toRule()
            val (ok, err) = RuleCheck.validate(rule)
            assertNull("$f -> $err", err)
            assertEquals(f.toString(), rule, RuleForm.from(ok).toRule())
        }
    }

    @Test
    fun readsRulesSavedByThePcWithLongNumbers() {
        val pc = mapOf<String, Any?>("period" to "month", "basis" to "weekday", "n" to -1L, "weekday" to 3L,
            "holiday_shift" to "prev")
        val f = RuleForm.from(pc)
        assertEquals("wd_last", f.basisKey)
        assertEquals(3, f.weekday)
        assertEquals("매월 마지막 목요일", Recur.describe(f.toRule()))
    }

    @Test
    fun previewShowsTheNextDates() {
        val rule = RuleForm(period = "month", basisKey = "bd_n", n = 2).toRule()
        assertEquals(listOf("10/2(금)", "11/3(화)"), previewDates(rule, LocalDate.of(2026, 9, 18), 2))
    }
}
