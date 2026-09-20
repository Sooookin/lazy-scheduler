package com.lazyscheduler.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
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

    /** Whatever the engine offers must save cleanly and read back to the same seat. */
    @Test
    fun everySuggestionSavesCleanlyAndReadsBack() {
        val day = LocalDate.of(2026, 9, 30)
        for ((unit, every) in listOf("day" to 1, "week" to 1, "week" to 2, "month" to 1, "month" to 3,
                "month" to 6, "year" to 1)) {
            val items = Recur.suggest(day, unit, every)
            assertTrue("$unit/$every", items.isNotEmpty())
            for ((text, rule) in items) {
                val (ok, err) = RuleCheck.validate(rule)
                assertNull("$text -> $err", err)
                assertEquals(text, rule, ok)
                assertEquals(text, unit to every, RulePick.unitOf(rule).let { (u, e) ->
                    if (unit == "day" || unit == "year") u to 1 else u to e
                })
            }
        }
    }

    @Test
    fun theExampleMonthDecidesWhichMonthsRun() {
        val sep = LocalDate.of(2026, 9, 30)
        val oct = LocalDate.of(2026, 10, 30)
        assertEquals(listOf(3, 6, 9, 12), Recur.monthsEvery(sep, 3))
        assertEquals(listOf(1, 4, 7, 10), Recur.monthsEvery(oct, 3))
        assertEquals(listOf(3, 9), Recur.monthsEvery(sep, 6))
        assertNull(Recur.monthsEvery(sep, 1))
    }

    @Test
    fun weeklyRuleKeepsAWeekendOnPurpose() {
        val sat = LocalDate.of(2026, 9, 26)
        val weekend = RulePick.weekRule(setOf(5), 1, sat)!!
        assertEquals("none", weekend["holiday_shift"])
        val workdays = RulePick.weekRule(setOf(0, 2), 2, sat)!!
        assertEquals("prev", workdays["holiday_shift"])
        assertEquals(2, workdays["interval"])
        assertNull(RulePick.weekRule(emptySet(), 1, sat))
        assertEquals("격주 월·수요일", Recur.describe(workdays))
    }

    @Test
    fun readsRulesSavedByThePcWithLongNumbers() {
        val pc = mapOf<String, Any?>("period" to "month", "basis" to "weekday", "n" to -1L, "weekday" to 3L,
            "holiday_shift" to "prev")
        assertEquals("월" to 1, RulePick.unitOf(pc).let { (u, e) -> (if (u == "month") "월" else u) to e })
        assertEquals("매월 마지막 목요일", Recur.describe(pc))
    }

    @Test
    fun wordingReadsLikeKorean() {
        assertEquals("매월 첫째 금요일", Recur.describe(mapOf("period" to "month", "basis" to "weekday", "n" to 1, "weekday" to 4)))
        assertEquals("매월 말일 3일 전", Recur.describe(mapOf("period" to "month", "basis" to "before_end", "k" to 3)))
        assertEquals("매월 말일 2영업일 전", Recur.describe(mapOf("period" to "month", "basis" to "before_end_bd", "k" to 2)))
    }

    @Test
    fun previewShowsTheNextDates() {
        val rule = mapOf<String, Any?>("period" to "month", "basis" to "business_day", "n" to 2)
        assertEquals(listOf("10/2(금)", "11/3(화)"), previewDates(rule, LocalDate.of(2026, 9, 18), 2))
    }
}
