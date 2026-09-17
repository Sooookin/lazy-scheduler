package com.lazyscheduler.app.core

import java.time.LocalDate
import java.time.LocalTime

/**
 * An item as stored in Firestore (users/{uid}/tasks/{id}). Field names follow the PC's
 * data.json, with done_dates / skip_dates as {date: true} maps (docs/sync.md section 3).
 */
data class Task(
    val id: String,
    val title: String,
    val note: String = "",
    val kind: String = "deadline",           // routine | deadline | floating
    val tag: String = "",
    val dueDate: String? = null,
    val dueTime: String = "",
    val notifyMin: Int? = null,
    val muted: Boolean = false,
    val pinned: Boolean = false,
    val done: Boolean = false,
    val rule: Map<String, Any?>? = null,
    val created: String? = null,
    val doneDates: Set<String> = emptySet(),
    val skipDates: Set<String> = emptySet(),
    val deleted: Boolean = false,
) {
    val ruleText: String get() = if (kind == "routine") Recur.describe(rule) else ""

    companion object {
        /** Firestore document → Task. A malformed document gives null instead of crashing the list. */
        fun from(id: String, m: Map<String, Any?>?): Task? {
            if (m == null) return null
            if (m["deleted"] == true) return Task(id = id, title = "", deleted = true)
            val title = m["title"] as? String ?: return null
            @Suppress("UNCHECKED_CAST")
            return Task(
                id = id,
                title = title,
                note = m["note"] as? String ?: "",
                kind = (m["kind"] as? String)?.takeIf { it in setOf("routine", "deadline", "floating") } ?: "deadline",
                tag = m["tag"] as? String ?: "",
                dueDate = m["due_date"] as? String,
                dueTime = m["due_time"] as? String ?: "",
                notifyMin = (m["notify_min"] as? Number)?.toInt(),
                muted = m["muted"] == true,
                pinned = m["pinned"] == true,
                done = m["done"] == true,
                rule = m["rule"] as? Map<String, Any?>,
                created = m["created"] as? String,
                doneDates = dateSet(m["done_dates"]),
                skipDates = dateSet(m["skip_dates"]),
            )
        }

        private fun dateSet(v: Any?): Set<String> = when (v) {
            is Map<*, *> -> v.filterValues { it == true }.keys.filterIsInstance<String>().toSet()
            is List<*> -> v.filterIsInstance<String>().toSet()      // older PC format
            else -> emptySet()
        }
    }
}

/** One occurrence on the list: an item on a date (or no date for memos). */
data class Instance(val task: Task, val date: LocalDate?, val done: Boolean) {
    val kind get() = task.kind
    val time get() = task.dueTime
}

data class Overview(
    val today: LocalDate,
    val overdue: List<Instance>,
    val todays: List<Instance>,
    val upcoming: List<Instance>,
    val routines: List<Pair<Task, Instance?>>,      // item + its next occurrence
    val floating: List<Instance>,
) {
    val left: Int get() = todays.count { !it.done } + overdue.size
}

/** The same grouping as store.overview on the PC. */
object Plan {
    fun instances(tasks: List<Task>, lo: LocalDate, hi: LocalDate): List<Instance> {
        val out = ArrayList<Instance>()
        for (t in tasks) {
            if (t.deleted) continue
            runCatching {
                when (t.kind) {
                    "floating" -> out.add(Instance(t, null, t.done))
                    "routine" -> {
                        val born = t.created?.take(10)?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                        val start = if (born != null && born.isAfter(lo)) born else lo
                        for (d in Recur.occurrences(t.rule, start, hi)) {
                            val iso = d.toString()
                            if (iso !in t.skipDates) out.add(Instance(t, d, iso in t.doneDates))
                        }
                    }
                    else -> out.add(Instance(t, t.dueDate?.let { LocalDate.parse(it) }, t.done))
                }
            }                                          // a broken item is skipped, the rest still show
        }
        return out
    }

    private val order = compareBy<Instance>({ it.kind != "deadline" }, { it.date ?: LocalDate.MAX }, { it.time.ifEmpty { "99:99" } })

    fun overview(tasks: List<Task>, today: LocalDate): Overview {
        val ins = instances(tasks, today.minusDays(10), today.plusDays(75))
        val past = ins.filter { it.date != null && it.date.isBefore(today) && !it.done }
        val overdue = ArrayList(past.filter { it.kind == "deadline" })
        val limit = today.minusDays(7)
        val seen = HashSet<String>()
        for (i in past.filter { it.kind == "routine" }.sortedByDescending { it.date }) {
            val daily = Recur.normalize(i.task.rule)["period"] == "day"
            if (daily || i.task.id in seen || i.date!!.isBefore(limit)) continue
            seen.add(i.task.id)
            overdue.add(i)
        }
        val todays = ins.filter { it.date == today }.sortedWith(compareBy<Instance> { it.done }.then(order))
        val week = today.plusDays(7)
        val upcoming = ins.filter {
            it.kind == "deadline" && it.date != null && it.date.isAfter(today) && !it.date.isAfter(week) && !it.done
        }.sortedWith(order)
        val next = HashMap<String, Instance>()
        for (i in ins) {
            if (i.kind != "routine" || i.date == null || i.date.isBefore(today)) continue
            val cur = next[i.task.id]
            if (cur == null || i.date.isBefore(cur.date)) next[i.task.id] = i
        }
        val routines = tasks.filter { !it.deleted && it.kind == "routine" }
            .map { it to next[it.id] }
            .sortedWith(compareBy({ it.second?.date ?: LocalDate.MAX }, { it.first.dueTime.ifEmpty { "99:99" } }))
        val floating = ins.filter { it.kind == "floating" && !it.done }.sortedBy { !it.task.pinned }
        return Overview(today, overdue.sortedWith(order), todays, upcoming, routines, floating)
    }

    /** "지남" when the time has passed today, "임박" within 90 minutes. */
    fun urgency(i: Instance, today: LocalDate, now: LocalTime): String? {
        if (i.done || i.date == null) return null
        if (i.date.isBefore(today)) return "late"
        if (i.date != today || i.time.isEmpty()) return null
        val t = runCatching { LocalTime.parse(i.time) }.getOrNull() ?: return null
        return when {
            t.isBefore(now) -> "late"
            java.time.Duration.between(now, t).toMinutes() <= 90 -> "soon"
            else -> null
        }
    }
}
