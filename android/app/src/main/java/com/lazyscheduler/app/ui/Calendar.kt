package com.lazyscheduler.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Plan
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.Task
import java.time.LocalDate
import java.time.YearMonth

/**
 * 달력 (PC 의 달력 + 하루 목록을 한 화면에). 위는 달 격자 - 점: 지난 마감(먹) · 오늘(청록) ·
 * 예정(빈 테) · 루틴(옅은 청록). 아래는 고른 날의 목록. 루틴은 한 줄로 접어 두고 누르면 편다.
 */
@Composable
fun CalendarScreen(tasks: List<Task>, today: LocalDate, nowMin: Int, onToggle: (Instance) -> Unit, onMenu: (Instance) -> Unit, onAdd: (LocalDate) -> Unit) {
    val pal = LocalPal.current
    var month by rememberSaveable { mutableStateOf(YearMonth.from(today).toString()) }
    val ym = YearMonth.parse(month)
    var sel by rememberSaveable { mutableStateOf(today.toString()) }
    val picked = LocalDate.parse(sel)
    val first = ym.atDay(1)
    val start = first.minusDays((first.dayOfWeek.value % 7).toLong())
    val ins = remember(tasks, month) { Plan.instances(tasks, start, start.plusDays(42)) }
    val byDay = remember(ins) { ins.filter { it.date != null }.groupBy { it.date!! } }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 14.dp, bottom = 24.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            RoundBtn("‹") { month = ym.minusMonths(1).toString() }
            Text("${ym.year}년 ${ym.monthValue}월", Modifier.padding(horizontal = 14.dp), style = T.title, color = pal.text)
            RoundBtn("›") { month = ym.plusMonths(1).toString() }
            Spacer(Modifier.weight(1f))
            Box(Modifier.height(34.dp).clip(RoundedCornerShape(17.dp)).border(1.dp, pal.hair2, RoundedCornerShape(17.dp))
                .press { month = YearMonth.from(today).toString(); sel = today.toString() }.padding(horizontal = 16.dp),
                contentAlignment = Alignment.Center) { Text("오늘", style = T.body, color = pal.text) }
        }
        Spacer(Modifier.height(12.dp))
        Row {
            WDS_SUN.forEachIndexed { k, w ->
                Text(w, Modifier.weight(1f), textAlign = TextAlign.Center, style = T.label,
                    color = if (k == 0) pal.hol else pal.text2)
            }
        }
        Spacer(Modifier.height(4.dp))
        for (r in 0 until 6) Row(Modifier.fillMaxWidth()) {
            for (c in 0 until 7) {
                val d = start.plusDays((r * 7 + c).toLong())
                Box(Modifier.weight(1f).height(46.dp), contentAlignment = Alignment.Center) {
                    DayCell(d, d.month != first.month, d == picked, d == today, marks(byDay[d].orEmpty(), d, today)) {
                        sel = d.toString(); if (d.month != first.month) month = YearMonth.from(d).toString()
                    }
                }
            }
        }
        Hair(Modifier.padding(vertical = 10.dp), strong = true)

        // ---- 고른 날 ----
        val list = byDay[picked].orEmpty()
        val items = list.filter { it.kind != "routine" }.sortedWith(compareBy({ it.time.ifEmpty { "99:99" } }))
        val routines = list.filter { it.kind == "routine" }.sortedBy { it.time.ifEmpty { "99:99" } }
        Row(verticalAlignment = Alignment.Bottom) {
            Text("${picked.monthValue}월 ${picked.dayOfMonth}일 ${WDS[picked.dayOfWeek.value - 1]}요일", style = T.head, color = pal.text)
            if (picked == today) { Spacer(Modifier.width(8.dp)); Text("오늘", style = T.label, color = pal.teal) }
            if (Recur.isHoliday(picked)) { Spacer(Modifier.width(8.dp)); Text("공휴일", style = T.label, color = pal.hol) }
            Spacer(Modifier.weight(1f))
            Text("${items.size}건" + (if (routines.isNotEmpty()) " · 루틴 ${routines.size}" else ""), style = T.label, color = pal.text2)
        }
        Spacer(Modifier.height(6.dp))
        if (items.isEmpty() && routines.isEmpty()) Text("일정 없음", Modifier.padding(vertical = 12.dp), style = T.body, color = pal.text2)
        for (i in items) {
            val m = minsOf(i.time)
            val late = !i.done && (picked.isBefore(today) || (picked == today && m != null && m < nowMin))
            ItemLine(null, i, late, false, null, onTap = { onToggle(i) }, onMenu = { onMenu(i) })
        }
        var open by remember(sel) { mutableStateOf(false) }
        if (routines.isNotEmpty()) {
            Row(Modifier.fillMaxWidth().padding(top = 6.dp), verticalAlignment = Alignment.CenterVertically) {
                Row(Modifier.weight(1f).clip(RoundedCornerShape(10.dp)).tap { open = !open }.padding(vertical = 10.dp, horizontal = 4.dp),
                    verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.size(5.dp).clip(CircleShape).background(pal.teal.copy(alpha = .45f)))
                    Spacer(Modifier.width(10.dp))
                    Text(if (open) "루틴 ${routines.size}건 접기" else if (picked.isAfter(today)) "루틴 ${routines.size}건은 그날 아침에 나타납니다"
                        else "루틴 ${routines.size}건 · 완료 ${routines.count { it.done }}", style = T.body, color = pal.text2)
                }
                AddHere { onAdd(picked) }
            }
            if (open) for (i in routines) {
                val m = minsOf(i.time)
                val late = !i.done && (picked.isBefore(today) || (picked == today && m != null && m < nowMin))
                ItemLine(null, i, late, false, null, onTap = { if (!picked.isAfter(today)) onToggle(i) }, onMenu = { onMenu(i) })
            }
        } else Row(Modifier.fillMaxWidth().padding(top = 6.dp), horizontalArrangement = Arrangement.End) { AddHere { onAdd(picked) } }
    }
}

@Composable
private fun AddHere(onClick: () -> Unit) {
    val pal = LocalPal.current
    Box(Modifier.height(34.dp).clip(RoundedCornerShape(17.dp)).border(1.dp, pal.hair2, RoundedCornerShape(17.dp))
        .press(onClick = onClick).padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
        Text("+ 이 날에", style = T.body, color = pal.text)
    }
}

@Composable
internal fun RoundBtn(label: String, size: Dp = 34.dp, onClick: () -> Unit) {
    val pal = LocalPal.current
    Box(Modifier.size(size).clip(CircleShape).border(1.dp, pal.hair2, CircleShape).press(onClick = onClick), contentAlignment = Alignment.Center) {
        Text(label, style = T.lead, color = pal.text2)
    }
}

/** 칸 아래의 점 (최대 둘). */
private fun marks(list: List<Instance>, d: LocalDate, today: LocalDate): List<String> {
    val out = ArrayList<String>()
    val dl = list.filter { it.kind == "deadline" }
    if (dl.isNotEmpty()) out += when { d.isBefore(today) -> "past"; d == today -> "today"; else -> "ring" }
    if (list.any { it.kind == "routine" }) out += "routine"
    return out.take(2)
}

@Composable
private fun DayCell(d: LocalDate, other: Boolean, picked: Boolean, isToday: Boolean, marks: List<String>, onClick: () -> Unit) {
    val pal = LocalPal.current
    val dow = d.dayOfWeek.value % 7
    val color = when {
        picked -> pal.onTeal
        other -> pal.text.copy(alpha = .3f)
        dow == 0 || Recur.isHoliday(d) -> pal.hol
        dow == 6 -> pal.text2
        else -> pal.text
    }
    Box(
        Modifier.size(38.dp).then(if (picked) Modifier.raised(CircleShape, pal) else Modifier).clip(CircleShape)
            .background(if (picked) pal.teal else Color.Transparent)
            .then(if (isToday && !picked) Modifier.border(1.4.dp, pal.teal, CircleShape) else Modifier)
            .tap(onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text("${d.dayOfMonth}", style = T.lead, color = color)
        if (!other && marks.isNotEmpty()) Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            for (m in marks) {
                val c = if (picked) pal.onTeal else when (m) { "past" -> pal.text; "routine" -> pal.teal.copy(alpha = .45f); else -> pal.teal }
                Box(Modifier.size(5.dp).clip(CircleShape).then(if (m == "ring") Modifier.border(1.2.dp, c, CircleShape) else Modifier.background(c)))
            }
        }
    }
}
