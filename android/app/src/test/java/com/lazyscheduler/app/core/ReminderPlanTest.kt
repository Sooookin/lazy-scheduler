package com.lazyscheduler.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate
import java.time.LocalDateTime

class ReminderPlanTest {
    private val day = LocalDate.of(2026, 9, 18)
    private fun at(h: Int, m: Int = 0) = LocalDateTime.of(day, java.time.LocalTime.of(h, m))
    private fun deadline(id: String, time: String, vararg extra: Pair<String, Any?>) =
        Task.from(id, mapOf("title" to id, "kind" to "deadline", "due_date" to day.toString(), "due_time" to time) + extra)!!

    @Test
    fun remindsAtDueMinusTheDefaultLead() {
        val alarms = ReminderPlan.plan(listOf(deadline("a", "10:00")), mapOf("notify_min" to 30L), at(8))
        assertEquals(listOf(at(9, 30)), alarms.map { it.at })
        assertEquals("a:2026-09-18:10:00", alarms.single().key)       // same key format as the PC
    }

    @Test
    fun itemLeadWinsOverTheDefault() {
        val alarms = ReminderPlan.plan(listOf(deadline("a", "10:00", "notify_min" to 5L)), mapOf("notify_min" to 30L), at(8))
        assertEquals(at(9, 55), alarms.single().at)
    }

    @Test
    fun noReminderForDoneMutedUntimedOrTooLate() {
        val tasks = listOf(
            deadline("done", "10:00", "done" to true),
            deadline("muted", "10:00", "muted" to true),
            deadline("untimed", ""),
            deadline("late", "06:00"),                                  // 08:00 is > 90 min after 06:00
        )
        assertTrue(ReminderPlan.plan(tasks, emptyMap(), at(8)).isEmpty())
    }

    @Test
    fun aMissedReminderWithinTheGraceComesNow() {
        val alarms = ReminderPlan.plan(listOf(deadline("a", "07:30")), emptyMap(), at(8))
        assertEquals(at(8), alarms.single().at)
    }

    @Test
    fun routineCompletedTodayIsNotReminded() {
        val rule = mapOf("period" to "day", "business_only" to false)
        val open = Task.from("r", mapOf("title" to "r", "kind" to "routine", "due_time" to "10:00", "rule" to rule,
            "created" to "2026-01-01T00:00:00"))!!
        val doneToday = open.copy(doneDates = setOf(day.toString()))
        assertEquals(1, ReminderPlan.plan(listOf(open), emptyMap(), at(8)).count { it.date == day.toString() })
        assertEquals(0, ReminderPlan.plan(listOf(doneToday), emptyMap(), at(8)).count { it.date == day.toString() })
    }

    @Test
    fun earlyReminderComesTheDayBeforeBesideTheUsualOne() {
        val t = Task.from("a", mapOf("title" to "a", "kind" to "deadline", "due_date" to day.plusDays(1).toString(),
            "due_time" to "15:00", "early_days" to 1L))!!
        val early = ReminderPlan.plan(listOf(t), emptyMap(), at(8)).single { it.key.startsWith("early:") }
        assertEquals(at(15), early.at)
        assertEquals("early:a:${day.plusDays(1)}:1", early.key)        // same key as the PC
        assertEquals("내일 마감", early.rel)
        // 다음 날에는 보통 알림 (30분 전)만
        val next = ReminderPlan.plan(listOf(t), emptyMap(), at(8).plusDays(1))
        assertEquals(listOf(at(14, 30).plusDays(1)), next.map { it.at })
    }

    @Test
    fun untimedEarlyReminderUsesTheBriefTimeAndOnlyThatDay() {
        val t = Task.from("b", mapOf("title" to "b", "kind" to "deadline", "due_date" to day.plusDays(3).toString(),
            "early_days" to 3L))!!
        val s = mapOf("brief_time" to "08:30")
        assertEquals(listOf(at(8, 30)), ReminderPlan.plan(listOf(t), s, at(7)).map { it.at })
        assertEquals(listOf(at(21)), ReminderPlan.plan(listOf(t), s, at(21)).map { it.at })     // 늦게 켜도 그 날 안이면 지금
        assertTrue(ReminderPlan.plan(listOf(t), s, at(9).plusDays(1)).isEmpty())                // 그 날이 지났다
    }

    @Test
    fun briefingIsTodayUntilTwoHoursPastThenTomorrow() {
        val s = mapOf("brief_time" to "08:30")
        assertEquals(at(8, 30), ReminderPlan.nextBrief(s, at(7)))
        assertEquals(at(8, 30), ReminderPlan.nextBrief(s, at(10, 0)))
        assertEquals(at(8, 30).plusDays(1), ReminderPlan.nextBrief(s, at(11)))
        assertNull(ReminderPlan.nextBrief(mapOf("brief_time" to ""), at(7)))
    }
}
