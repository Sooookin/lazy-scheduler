package com.lazyscheduler.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
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
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Overview
import java.time.LocalDate

/** 홈의 한 줄. band: 0 지난 날짜 · 1 시각 있음 · 4 시각 없음 (축 밖). */
data class HomeRow(val n: Int, val i: Instance, val band: Int, val late: Boolean, val next: Boolean)

/** 오늘 할 것 (지난 것 포함)을 하루 축의 차례로 세운다: 지난 날짜 → 시각 순 → 시각 없는 것. 끝낸 것도 제자리에 남는다. */
fun homeRows(o: Overview, today: LocalDate, nowMin: Int): List<HomeRow> {
    fun band(i: Instance): Int {
        if (i.date != null && i.date.isBefore(today)) return 0
        return if (minsOf(i.time) == null) 4 else 1
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

/*
 * 오늘 = 하루 축 (PC 의 #today). 왼쪽 칸에 시각(지난 날짜면 그 날짜), 그 오른쪽 세로선(축)에 동그라미가 꿰어진다.
 * 지난 날짜의 일도 시간 순서 안 맨 위에. 지금 선이 지나온 일과 남은 일 사이에 놓인다. 시각 없는 일은 축 밖, 맨 아래.
 * 시간대 이름(오전 · 오후 · 저녁)과 "지난 일" 묶음은 걷었다 - 시각이 바로 옆에 있으니 같은 말을 두 번 하는 셈이었다.
 * 늦은 것은 시각 · 끝의 글("2시간 지남")이 빨갛다. 다음 것은 따로 짚지 않는다 - 지금 선 바로 아래라는 자리가 말하고, 머리가 또 말한다.
 */
private val AW = 64.dp          // 시각 칸
private val DOT = 16.dp
private val GAP = 12.dp         // 시각 | 12 | 동그라미 | 12 | 이름 (PC 와 같은 수)
private val ROW = 48.dp         // 줄 높이 - 손가락이 누르는 최소 크기
private val AXIS_X = AW + GAP + DOT / 2

@Composable
fun Home(o: Overview?, rows: List<HomeRow>, today: LocalDate, nowMin: Int, onToggle: (Instance) -> Unit, onMenu: (Instance) -> Unit) {
    val pal = LocalPal.current
    val done = rows.count { it.i.done }
    val lateN = rows.count { it.late }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = DOC, end = DOC, top = 16.dp, bottom = 24.dp)) {
        item(key = "head") {
            // 칸 제목은 32 (밑줄 포함) - 글은 아래에 붙여 밑줄과 8 떨어진다 (PC 의 .home h2)
            Row(Modifier.fillMaxWidth().height(31.dp).padding(bottom = 8.dp), verticalAlignment = Alignment.Bottom) {
                Text("오늘", Modifier.alignByBaseline(), style = T.head, color = pal.text)
                Spacer(Modifier.width(8.dp))
                Text("${rows.size}", Modifier.alignByBaseline(), style = T.head.copy(fontWeight = FontWeight.Light), color = pal.text2)
                Spacer(Modifier.weight(1f))
                val all = rows.isNotEmpty() && done == rows.size
                if (all) Text(apText("전부 완료 ${t12(hhmm(nowMin))}"), Modifier.alignByBaseline(), style = T.label, color = pal.teal)
                else if (rows.isNotEmpty()) {
                    if (lateN > 0) Text("밀린 일 $lateN · ", Modifier.alignByBaseline(), style = T.label, color = pal.late)
                    Text("남은 일 ${rows.size - done - lateN}" + (if (done > 0) " · 완료 $done" else ""), Modifier.alignByBaseline(), style = T.label, color = pal.text2)
                }
            }
            Hair(strong = true)
        }
        if (o == null) item { Empty("불러오는 중…", "") }
        // 오늘이 비면 목록에는 아무것도 쓰지 않는다 - 머리가 "오늘은 할 일이 없습니다" · 다음 마감을 이미 말하고, 제목의 0 이 있다
        val axis = rows.filter { it.band != 4 }
        val free = rows.filter { it.band == 4 }
        var ruled = false
        for ((k, r) in axis.withIndex()) {
            val m = minsOf(r.i.time)
            if (!ruled && r.band == 1 && m != null && m > nowMin) {
                ruled = true
                item(key = "now") { NowRule(nowMin) }
            }
            val isLast = k == axis.lastIndex && ruled
            item(key = r.i.task.id + "@" + r.i.date) {
                Box(Modifier.animateItem(fadeInSpec = tween(220), placementSpec = tween(280, easing = EaseMove), fadeOutSpec = tween(140))) {
                    AxisLine(r, today, nowMin, first = k == 0, last = isLast, onTap = { onToggle(r.i) }, onMenu = { onMenu(r.i) })
                }
            }
        }
        if (axis.isNotEmpty() && !ruled) item(key = "now") { NowRule(nowMin, last = true) }
        if (free.isNotEmpty()) {
            item(key = "free") {
                // 목록 안의 이름표는 이름 축에, 24 높이 아래에 붙여 (뒤따르는 줄들의 머리)
                Box(Modifier.fillMaxWidth().height(24.dp).padding(start = AXIS_X + DOT / 2 + GAP, bottom = 4.dp), contentAlignment = Alignment.BottomStart) {
                    Text("시간 정하지 않은 일", style = T.label, color = pal.text2)
                }
            }
            for (r in free) item(key = r.i.task.id + "@" + r.i.date) {
                Box(Modifier.animateItem(fadeInSpec = tween(220), placementSpec = tween(280, easing = EaseMove), fadeOutSpec = tween(140))) {
                    AxisLine(r, today, nowMin, first = false, last = false, axis = false, onTap = { onToggle(r.i) }, onMenu = { onMenu(r.i) })
                }
            }
        }
    }
}

/** 축 위의 한 줄: [시각 | 동그라미(축) | 이름 | 늦음 · 다음 글 | ›]. 줄을 누르면 완료, 길게 누르거나 › 를 누르면 메뉴 */
@Composable
private fun AxisLine(r: HomeRow, today: LocalDate, nowMin: Int, first: Boolean, last: Boolean, axis: Boolean = true,
                     onTap: () -> Unit, onMenu: () -> Unit) {
    val pal = LocalPal.current
    val i = r.i
    val imp = i.task.pinned && !i.done
    val bg by animateColorAsState(if (imp) pal.imp.copy(alpha = .12f) else Color.Transparent, tween(200), label = "row")
    val old = i.date != null && i.date.isBefore(today)
    val m = minsOf(i.time)
    Row(
        Modifier.fillMaxWidth().height(ROW)
            .drawBehind {
                if (!axis) return@drawBehind
                val x = AXIS_X.toPx()
                drawLine(pal.hair2, Offset(x, if (first) size.height / 2 else 0f), Offset(x, if (last) size.height / 2 else size.height), 1.dp.toPx())
            }
            .clip(RoundedCornerShape(6.dp)).background(bg)
            .press(onLong = onMenu, onClick = onTap),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        val w = (if (old) dateLabel(i.date!!, today) + (if (i.time.isNotEmpty()) " " else "") else "") + (if (i.time.isNotEmpty()) t12(i.time) else "")
        Text(apText(w), Modifier.width(AW), style = T.label.copy(fontFeatureSettings = "tnum"), textAlign = TextAlign.End,
            color = if (i.done) pal.faint else if (r.late) pal.late else pal.text2, maxLines = 1)
        Spacer(Modifier.width(GAP))
        Dot(i.done, DOT)
        Spacer(Modifier.width(GAP))
        val tc by animateColorAsState(if (i.done) pal.text2 else pal.text, tween(420), label = "title")
        Text(i.task.title, Modifier.weight(1f), style = T.lead, color = tc,
            textDecoration = if (i.done) T.strike else null, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (r.late && !old && m != null) Text(agoText(nowMin - m), Modifier.padding(start = 8.dp), style = T.label, color = pal.late, maxLines = 1)
        Box(Modifier.clip(RoundedCornerShape(6.dp)).tap(onMenu).padding(horizontal = 8.dp, vertical = 12.dp)) {
            Text("›", style = T.lead, color = pal.text2.copy(alpha = .6f))
        }
    }
}

/** 지금 선: 축 위의 점 하나와 오른쪽 끝까지 가는 선 */
@Composable
private fun NowRule(nowMin: Int, last: Boolean = false) {
    val pal = LocalPal.current
    Row(Modifier.fillMaxWidth().height(32.dp).drawBehind {
        val x = AXIS_X.toPx()
        drawLine(pal.hair2, Offset(x, 0f), Offset(x, if (last) size.height / 2 else size.height), 1.dp.toPx())
        drawCircle(pal.teal, 4.dp.toPx(), Offset(x, size.height / 2))
        drawLine(pal.teal.copy(alpha = .5f), Offset(x + 8.dp.toPx(), size.height / 2), Offset(size.width, size.height / 2), 1.dp.toPx())
    }, verticalAlignment = Alignment.CenterVertically) {
        // '지금' 한 마디 - 몇 시인지는 머리의 큰 시계가 말한다 (예전 "지금 10:00 AM" 은 64dp 칸에서 AM 이 잘렸다)
        Text("지금", Modifier.width(AW), style = T.label.copy(fontWeight = FontWeight.Medium, fontFeatureSettings = "tnum"),
            textAlign = TextAlign.End, color = pal.teal, maxLines = 1)
    }
}

/**
 * 다른 목록(달력의 하루 · 메뉴)의 한 줄: 동그라미 · 이름 · (다음) · 시각 · ›. 줄을 누르면 완료, › 나 길게 누르면 메뉴.
 * 다음에 할 것은 옅은 면 하나 (예전의 왼쪽 강조 선은 면 · 글과 같은 말을 세 번째로 했다).
 */
@Composable
internal fun ItemLine(n: Int?, i: Instance, late: Boolean, next: Boolean, dayTag: String?, onTap: () -> Unit, onMenu: () -> Unit) {
    val pal = LocalPal.current
    val imp = i.task.pinned && !i.done
    val bg by animateColorAsState(if (imp) pal.imp.copy(alpha = .12f) else if (next) pal.teal.copy(alpha = .07f) else Color.Transparent, tween(200), label = "row")
    Column {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).background(bg)
                .press(onLong = onMenu, onClick = onTap).height(ROW).padding(start = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Dot(i.done, DOT)
            Spacer(Modifier.width(12.dp))
            val tc by animateColorAsState(if (i.done) pal.text2 else pal.text, tween(420), label = "title")
            Text(i.task.title, Modifier.weight(1f), style = T.lead, color = tc,
                textDecoration = if (i.done) T.strike else null, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (next) Text("다음", Modifier.padding(start = 8.dp), style = T.label, color = pal.teal)
            // 기간 업무는 시작일을 앞에 (끝나는 날이 이 줄의 날이다): "9/28 ~ 17:00"
            val w = listOfNotNull(dayTag, if (i.task.isSpan) "${md(i.task.start())} ~" else null, i.time.ifEmpty { null }?.let(::t12)).joinToString(" ")
            if (w.isNotEmpty()) Text(apText(w), Modifier.padding(start = 8.dp), style = T.time, color = if (late) pal.late else pal.text2)
            Box(Modifier.clip(RoundedCornerShape(6.dp)).tap(onMenu).padding(horizontal = 8.dp, vertical = 12.dp)) {
                Text("›", style = T.lead, color = pal.text2.copy(alpha = .6f))
            }
        }
        if (!next) Hair()
    }
}

@Composable
internal fun Empty(title: String, body: String) {
    val pal = LocalPal.current
    Column(Modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = T.head, color = pal.text2)
        if (body.isNotEmpty()) { Spacer(Modifier.height(8.dp)); Text(body, style = T.body, color = pal.text2) }
    }
}
