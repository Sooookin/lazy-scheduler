package com.lazyscheduler.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Overview
import java.time.LocalDate

/** 홈의 한 줄. n 은 하늘의 구슬 번호와 같다. band: 0 지난 일 · 1 오전 · 2 오후 · 3 저녁 · 4 아무 때나. */
data class HomeRow(val n: Int, val i: Instance, val band: Int, val late: Boolean, val next: Boolean)

private val BANDS = listOf("지난 일", "오전", "오후", "저녁", "아무 때나")

/** 오늘 할 것 (지난 것 포함)을 시각의 무리로 나누고 번호를 매긴다. 끝낸 것도 제자리에 남는다. */
fun homeRows(o: Overview, today: LocalDate, nowMin: Int): List<HomeRow> {
    fun band(i: Instance): Int {
        if (i.date != null && i.date.isBefore(today)) return 0
        val m = minsOf(i.time) ?: return 4
        return if (m < 720) 1 else if (m < 1080) 2 else 3
    }
    val all = (o.overdue + o.todays).sortedWith(compareBy({ band(it) }, { it.date ?: LocalDate.MAX }, { it.time.ifEmpty { "99:99" } }))
    val next = all.filter { !it.done && it.date == today }.mapNotNull { i -> minsOf(i.time)?.let { i to it } }
        .filter { it.second >= nowMin }.minByOrNull { it.second }?.first
    return all.mapIndexed { k, i ->
        val m = minsOf(i.time)
        val late = !i.done && ((i.date != null && i.date.isBefore(today)) || (m != null && m < nowMin))
        HomeRow(k + 1, i, band(i), late, i === next)
    }
}

@Composable
fun Home(o: Overview?, rows: List<HomeRow>, today: LocalDate, nowMin: Int, onToggle: (Instance) -> Unit, onMenu: (Instance) -> Unit) {
    val pal = LocalPal.current
    val done = rows.count { it.i.done }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 24.dp)) {
        item(key = "head") {
            Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(bottom = 6.dp)) {
                Text("오늘", style = T.head, color = pal.text)
                Spacer(Modifier.width(8.dp))
                Text("${rows.size}", style = T.head.copy(fontWeight = androidx.compose.ui.text.font.FontWeight.Light), color = pal.text2)
                Spacer(Modifier.weight(1f))
                val all = rows.isNotEmpty() && done == rows.size
                Text("${shortDay(today)} · ", style = T.body, color = pal.text2)
                Text(if (all) "전부 완료 ${hhmm(nowMin)}" else "완료 $done", style = T.body, color = if (all) pal.teal else pal.text2)
            }
            Hair(strong = true)
        }
        if (o == null) item { Empty("불러오는 중…", "") }
        else if (rows.isEmpty()) item {
            val nx = o.upcoming.firstOrNull()
            Empty("오늘 할 일이 없습니다", nx?.let { "다음 마감은 ${dateLabel(it.date!!, today)} · ${it.task.title}" } ?: "다가오는 7일에도 마감이 없습니다")
        }
        var last = -1
        for (r in rows) {
            if (r.band != last) {
                val b = r.band
                item(key = "band$b") { Band(BANDS[b], if (b == 0) pal.late else null) }
                last = b
            }
            item(key = r.i.task.id + "@" + r.i.date) {
                ItemLine(r.n, r.i, r.late, r.next, if (r.band == 0) dateLabel(r.i.date!!, today) else null,
                    onTap = { onToggle(r.i) }, onMenu = { onMenu(r.i) })
            }
        }
    }
}

/**
 * 한 줄: 동그라미 · 이름 · (다음) · 시각 · ›. 줄을 누르면 완료, › 나 길게 누르면 메뉴.
 * 다음에 할 것은 청록 테를 두른다.
 */
@Composable
internal fun ItemLine(n: Int?, i: Instance, late: Boolean, next: Boolean, dayTag: String?, onTap: () -> Unit, onMenu: () -> Unit) {
    val pal = LocalPal.current
    val bg by animateColorAsState(if (next) pal.teal.copy(alpha = .07f) else Color.Transparent, tween(200), label = "row")
    Column {
        Row(
            Modifier.fillMaxWidth().padding(vertical = 2.dp).clip(RoundedCornerShape(10.dp)).background(bg)
                .then(if (next) Modifier.border(1.2.dp, pal.teal, RoundedCornerShape(10.dp)) else Modifier)
                .press(onLong = onMenu, onClick = onTap).height(44.dp).padding(start = 6.dp, end = 2.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            NumDot(n, i.done, late)
            Spacer(Modifier.width(12.dp))
            Text(i.task.title, Modifier.weight(1f), style = T.lead, color = if (i.done) pal.text2 else pal.text,
                textDecoration = if (i.done) T.strike else null, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (next) Text("다음", Modifier.padding(start = 8.dp), style = T.micro, color = pal.teal)
            val w = listOfNotNull(dayTag, i.time.ifEmpty { null }).joinToString(" ")
            if (w.isNotEmpty()) Text(w, Modifier.padding(start = 8.dp), style = T.time, color = if (late) pal.late else pal.text2)
            Box(Modifier.clip(RoundedCornerShape(8.dp)).tap(onMenu).padding(horizontal = 6.dp, vertical = 10.dp)) {
                Text("›", style = T.lead, color = pal.text2.copy(alpha = .6f))
            }
        }
        if (!next) Hair(Modifier.padding(horizontal = 4.dp))
    }
}

@Composable
internal fun Empty(title: String, body: String) {
    val pal = LocalPal.current
    Column(Modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = T.head, color = pal.text2)
        if (body.isNotEmpty()) { Spacer(Modifier.height(6.dp)); Text(body, style = T.body, color = pal.text2) }
    }
}
