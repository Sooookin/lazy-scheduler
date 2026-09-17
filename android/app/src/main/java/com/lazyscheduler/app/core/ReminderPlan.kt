package com.lazyscheduler.app.core

import java.time.LocalDate
import java.time.LocalDateTime
import java.time.LocalTime

/** One reminder to schedule. [key] is the same "id:date:time" the PC uses in state.json. */
data class Alarm(
    val key: String,
    val at: LocalDateTime,
    val taskId: String,
    val date: String,
    val title: String,
    val time: String,
    val kind: String,
    val detail: String,
)

/**
 * When to remind, following the PC scheduler (app.py _plan):
 *   remind at (due − lead). lead = the item's notify_min, else the shared default.
 *   no date or no time → no reminder (the morning briefing covers it)
 *   done or muted → none
 *   more than 90 min past due → too late, none
 * Each device reminds from its own copy (docs/sync.md section 8).
 */
object ReminderPlan {
    const val LATE_GRACE_MIN = 90L
    const val BRIEF_WINDOW_MIN = 120L

    fun defaultLead(settings: Map<String, Any?>): Int =
        (settings["notify_min"] as? Number)?.toInt()?.takeIf { it in 0..1440 } ?: 30

    fun plan(tasks: List<Task>, settings: Map<String, Any?>, now: LocalDateTime, horizonHours: Long = 36): List<Alarm> {
        val today = now.toLocalDate()
        val lead = defaultLead(settings)
        val until = now.plusHours(horizonHours)
        val out = ArrayList<Alarm>()
        for (i in Plan.instances(tasks, today.minusDays(1), today.plusDays(2))) {
            val date = i.date ?: continue
            if (i.done || i.task.muted || i.time.isEmpty()) continue
            val time = runCatching { LocalTime.parse(i.time) }.getOrNull() ?: continue
            val due = LocalDateTime.of(date, time)
            if (now.isAfter(due.plusMinutes(LATE_GRACE_MIN))) continue
            val at = due.minusMinutes((i.task.notifyMin ?: lead).toLong())
            if (at.isAfter(until)) continue
            val kindText = mapOf("routine" to "반복", "deadline" to "마감")[i.kind] ?: ""
            out.add(Alarm(
                key = "${i.task.id}:$date:${i.time}",
                at = if (at.isBefore(now)) now else at,
                taskId = i.task.id, date = date.toString(), title = i.task.title, time = i.time, kind = i.kind,
                detail = listOf(kindText, i.task.ruleText).filter { it.isNotEmpty() }.joinToString(" · "),
            ))
        }
        return out.sortedBy { it.at }
    }

    /** Next morning briefing time: today's if not yet 2 h past it, otherwise tomorrow's. Null when turned off. */
    fun nextBrief(settings: Map<String, Any?>, now: LocalDateTime): LocalDateTime? {
        val raw = settings["brief_time"] as? String ?: "08:30"
        if (raw.isEmpty()) return null
        val t = runCatching { LocalTime.parse(raw) }.getOrNull() ?: return null
        val todayAt = LocalDateTime.of(now.toLocalDate(), t)
        return if (now.isAfter(todayAt.plusMinutes(BRIEF_WINDOW_MIN))) todayAt.plusDays(1) else todayAt
    }

    /** Lines for the briefing: overdue first, then today's by time. Empty when nothing is left. */
    fun briefLines(tasks: List<Task>, today: LocalDate): List<String> {
        val o = Plan.overview(tasks, today)
        val lines = ArrayList<String>()
        for (i in o.overdue) lines.add("지남 · ${i.task.title}")
        for (i in o.todays) if (!i.done) lines.add((if (i.time.isNotEmpty()) i.time + " · " else "") + i.task.title)
        return lines
    }
}
