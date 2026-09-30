package com.lazyscheduler.app.ui

import androidx.compose.ui.graphics.Color
import com.lazyscheduler.app.core.Task
import java.time.LocalDate
import java.time.temporal.ChronoUnit

/**
 * 기간 업무 (PC 의 app.js "기간 업무"와 같은 규칙). 시작일(start_date)이 있는 할 일이고 끝나는
 * 날이 마감일이다 - 알림 · 홈의 목록은 그대로 끝나는 날에 걸린다. 달력에서는 칸 안의 줄 대신
 * 띠(월) · 세로선(7일)으로 그린다. 이름은 띠 위에 적지 않는다.
 */
internal class Spans(tasks: List<Task>) {
    val all: List<Task> = tasks.filter { !it.deleted && it.isSpan }
        .sortedWith(compareBy({ it.startDate }, { it.id }))

    /** 색: 시작일 차례로 놓으며, 같은 때 겹치는 앞의 기간이 쓰는 색은 피한다 (데이터만으로 정해진다). */
    private val colorOf: Map<String, Int> = run {
        val map = HashMap<String, Int>()
        val placed = ArrayList<Task>()
        for (s in all) {
            val used = placed.filter { it.startDate!! <= s.dueDate!! && s.startDate!! <= it.dueDate!! }.map { map[it.id] }.toSet()
            var c = 0
            while (c in used && c < SpanColors.size - 1) c++
            map[s.id] = c
            placed += s
        }
        map
    }

    fun color(t: Task): Color = SpanColors[colorOf[t.id] ?: 0]

    fun between(lo: LocalDate, hi: LocalDate): List<Task> {
        val a = lo.toString(); val b = hi.toString()
        return all.filter { it.dueDate!! >= a && it.startDate!! <= b }
    }

    /** 그 날 걸쳐 있는 기간들 (먼저 끝나는 것부터). */
    fun on(d: LocalDate): List<Task> {
        val k = d.toString()
        return all.filter { it.startDate!! <= k && k <= it.dueDate!! }.sortedBy { it.dueDate }
    }

    companion object {
        /** 보이는 구간에서 겹치지 않게 줄(lane)을 나눈다. 시작이 이른 것부터 빈 줄 맨 앞에. */
        fun lanes(list: List<Task>): Map<String, Int> {
            val ends = ArrayList<String>()
            val out = HashMap<String, Int>()
            for (s in list.sortedWith(compareBy({ it.startDate }, { it.id }))) {
                var k = ends.indexOfFirst { it < s.startDate!! }
                if (k < 0) { k = ends.size; ends += "" }
                ends[k] = s.dueDate!!
                out[s.id] = k
            }
            return out
        }
    }
}

internal fun Task.start(): LocalDate = LocalDate.parse(startDate)
internal fun Task.end(): LocalDate = LocalDate.parse(dueDate)
internal fun days(a: LocalDate, b: LocalDate): Int = ChronoUnit.DAYS.between(a, b).toInt()
internal fun md(d: LocalDate) = "${d.monthValue}/${d.dayOfMonth}"
internal fun spanRange(t: Task) = "${md(t.start())} – ${md(t.end())}"

/** 끝나는 날까지: 완료 · 오늘 마감 · D-3 · 2일 지남. */
internal fun spanLeft(t: Task, at: LocalDate): String {
    val n = days(at, t.end())
    return if (t.done) "완료" else if (n == 0) "오늘 마감" else if (n > 0) "D-$n" else "${-n}일 지남"
}
