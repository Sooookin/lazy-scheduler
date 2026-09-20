package com.lazyscheduler.app.core

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/**
 * The phone must agree with the PC on every date. Both run tests/vectors/recurrence.json.
 */
class RecurVectorsTest {

    private fun cases(): List<Map<String, Any?>> {
        val path = System.getProperty("vectors") ?: error("system property 'vectors' is not set")
        val type = object : TypeToken<Map<String, Any?>>() {}.type
        val root: Map<String, Any?> = Gson().fromJson(File(path).readText(Charsets.UTF_8), type)
        @Suppress("UNCHECKED_CAST")
        return root["cases"] as List<Map<String, Any?>>
    }

    @Test
    fun specificationVectors() {
        val all = cases()
        assertTrue("no vectors found", all.isNotEmpty())
        Recur.setHolidays(null)
        for (case in all) {
            @Suppress("UNCHECKED_CAST")
            val got = Recur.occurrences(
                case["rule"] as Map<String, Any?>,
                LocalDate.parse(case["start"] as String),
                LocalDate.parse(case["end"] as String),
            ).map { it.toString() }
            assertEquals(case["name"] as String, case["expect"], got)
        }
    }

    @Test
    fun datesDoNotDependOnTheWindow() {
        val rules = listOf(
            mapOf("period" to "month", "basis" to "day", "n" to 1),
            mapOf("period" to "month", "basis" to "day", "n" to -1, "holiday_shift" to "next"),
            mapOf("period" to "month", "basis" to "weekday", "n" to -1, "weekday" to 3),
            mapOf("period" to "week", "weekdays" to listOf(4), "interval" to 2, "anchor" to "2026-01-02"),
            mapOf("period" to "quarter", "basis" to "before_end_bd", "k" to 3),
            mapOf("period" to "day", "business_only" to true),
        )
        for (rule in rules) {
            val wide = Recur.occurrences(rule, LocalDate.of(2026, 1, 1), LocalDate.of(2027, 12, 31)).toSet()
            var day = LocalDate.of(2026, 1, 1)
            while (!day.isAfter(LocalDate.of(2027, 12, 31))) {
                val narrow = Recur.occurrences(rule, day.minusDays(1), day.plusDays(1))
                assertEquals("$rule $day", day in wide, day in narrow)
                day = day.plusDays(7)
            }
        }
    }

    @Test
    fun describeMatchesThePcWording() {
        assertEquals("매월 2번째 영업일", Recur.describe(mapOf("period" to "month", "basis" to "business_day", "n" to 2)))
        assertEquals("격주 월·수요일", Recur.describe(mapOf("period" to "week", "weekdays" to listOf(0, 2), "interval" to 2)))
        assertEquals("매 분기 말일 3영업일 전", Recur.describe(mapOf("period" to "quarter", "basis" to "before_end_bd", "k" to 3)))
    }

    @Test
    fun numbersFromFirestoreAreLongs() {
        // Firestore gives whole numbers as Long, JSON as Double. Both must work.
        val asLong = Recur.occurrences(mapOf("period" to "month", "basis" to "business_day", "n" to 2L),
            LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30))
        val asDouble = Recur.occurrences(mapOf("period" to "month", "basis" to "business_day", "n" to 2.0),
            LocalDate.of(2026, 9, 1), LocalDate.of(2026, 9, 30))
        assertEquals(listOf(LocalDate.of(2026, 9, 2)), asLong)
        assertEquals(asLong, asDouble)
    }
}
