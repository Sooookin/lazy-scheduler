package com.lazyscheduler.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.SizeTransform
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.animation.core.Animatable
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.wrapContentHeight
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import kotlinx.coroutines.launch
import kotlin.math.abs
import androidx.compose.foundation.gestures.detectVerticalDragGestures
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
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
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Plan
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.Task
import java.time.LocalDate
import java.time.YearMonth

/**
 * 달력 (PC 의 달력 + 하루 목록을 한 화면에). 위는 월 격자 또는 7일 줄, 아래는 고른 날의 목록과
 * 그 날 걸쳐 있는 기간 업무.
 *   월   점: 지난 마감(먹) · 오늘(청록) · 예정(빈 테) · 루틴(옅은 청록). 기간 업무는 칸 아랫단의 색 띠.
 *   7일  고른 날부터 7일. 한 줄에 앞의 둘만 (휴대폰은 짧게) - 전부는 아래 목록에. 줄을 누르면
 *        그 날이 맨 위로 온다. 기간 업무는 왼쪽 세로선.
 * 달력에 다시 들어오면 오늘부터다 (고른 날은 이 화면에만 산다).
 */
@Composable
fun CalendarScreen(
    tasks: List<Task>, today: LocalDate, nowMin: Int, week: Boolean, onWeek: (Boolean) -> Unit,
    onToggle: (Instance) -> Unit, onMenu: (Instance) -> Unit, onAdd: (LocalDate) -> Unit, onOpen: (Task) -> Unit,
) {
    val pal = LocalPal.current
    var month by rememberSaveable { mutableStateOf(YearMonth.from(today).toString()) }
    val ym = YearMonth.parse(month)
    var sel by rememberSaveable { mutableStateOf(today.toString()) }
    val picked = LocalDate.parse(sel)
    val first = ym.atDay(1)
    val start = first.minusDays((first.dayOfWeek.value % 7).toLong())
    val lo = if (week) picked.minusDays(WK_BUF.toLong()) else start          // 7일은 위아래 덤 줄까지
    val hi = if (week) picked.plusDays(6L + WK_BUF) else start.plusDays(41)
    val ins = remember(tasks, lo, hi, picked) { Plan.instances(tasks, minOf(lo, picked), maxOf(hi, picked)) }
    // 기간 업무는 칸 안의 줄이 아니라 띠 · 세로선 · 아래의 "진행 중인 기간 업무"로
    val byDay = remember(ins) { ins.filter { it.date != null && !it.task.isSpan }.groupBy { it.date!! } }
    val spans = remember(tasks) { Spans(tasks) }
    fun pick(d: LocalDate) { sel = d.toString(); month = YearMonth.from(d).toString() }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 14.dp, bottom = 24.dp)) {
        // 머리줄: 월 ↔ 7일 에서 단추가 제자리 (제목 칸의 폭이 정해져 있다)
        Row(verticalAlignment = Alignment.CenterVertically) {
            // 제목은 칸 제목 크기 - 화면 제목(title) 크기는 화살표 사이에서 빽빽했다
            RoundBtn("‹", 30.dp) { if (week) pick(picked.minusDays(1)) else month = ym.minusMonths(1).toString() }
            Text(if (week) "${md(picked)} – ${md(picked.plusDays(6))}" else "${ym.year}년 ${ym.monthValue}월",
                Modifier.weight(1f).padding(horizontal = 8.dp), textAlign = TextAlign.Center, maxLines = 1, softWrap = false,
                style = T.head.lit(pal.text, big = true), color = pal.text)
            RoundBtn("›", 30.dp) { if (week) pick(picked.plusDays(1)) else month = ym.plusMonths(1).toString() }
            Spacer(Modifier.width(14.dp))
            Seg(listOf(false to "월", true to "7일"), week, height = 30.dp, pad = 11.dp) { w ->
                if (w != week) { if (!w) month = YearMonth.from(picked).toString(); onWeek(w) }
            }
            Spacer(Modifier.width(8.dp))
            Box(Modifier.height(30.dp).clip(RoundedCornerShape(15.dp)).border(1.dp, pal.hair2, RoundedCornerShape(15.dp))
                .press { pick(today) }.padding(horizontal = 11.dp),
                contentAlignment = Alignment.Center) { Text("오늘", style = T.body, color = pal.text) }
        }
        Spacer(Modifier.height(16.dp))
        if (week) WeekStrip(picked, today, byDay, spans) { pick(it) }
        else AnimatedContent(
            targetState = ym,
            // 달을 넘기면 격자가 그쪽으로 조금 미끄러지며 바뀐다 (PC 의 cal-grid 와 같다)
            transitionSpec = {
                val dir = if (targetState.isAfter(initialState)) 1 else -1
                (fadeIn(tween(200, 40)) + slideInHorizontally(tween(300, easing = EaseMove)) { dir * it / 14 }) togetherWith
                    fadeOut(tween(90)) using SizeTransform(clip = false)
            },
            label = "month",
        ) { m ->
            val f = m.atDay(1)
            // AnimatedContent 는 속을 겹쳐 쌓는 틀이다 - 격자의 줄들이 한 자리에 포개지지 않게 세로로 묶는다
            Column { MonthGrid(f, f.minusDays((f.dayOfWeek.value % 7).toLong()), picked, today, byDay, spans) { d -> pick(d) } }
        }
        Hair(Modifier.padding(vertical = 14.dp), strong = true)
        // 다른 날을 고르면 아래 목록이 옅게 떠오르며 바뀐다 (같은 날에서 완료 · 삭제는 움직이지 않는다)
        AnimatedContent(
            targetState = picked,
            transitionSpec = { (fadeIn(tween(180, 30)) + slideInVertically(tween(260, easing = EaseMove)) { it / 40 }) togetherWith fadeOut(tween(80, easing = EaseExit)) using SizeTransform(clip = false) },
            label = "day",
        ) { p ->
            Column { DayList(p, today, nowMin, byDay[p].orEmpty(), spans, onToggle, onMenu, onAdd, onOpen) }
        }
    }
}

// ---------------- 월 ----------------

private const val BAND_MAX = 3                  // 한 칸에 띠 셋까지 (PC 와 같다)
private val BAND_TOP = 40.dp
private val BAND_STEP = 4.5.dp

@Composable
private fun MonthGrid(first: LocalDate, start: LocalDate, picked: LocalDate, today: LocalDate,
                      byDay: Map<LocalDate, List<Instance>>, spans: Spans, onPick: (LocalDate) -> Unit) {
    val pal = LocalPal.current
    Row {
        WDS_SUN.forEachIndexed { k, w ->
            Text(w, Modifier.weight(1f), textAlign = TextAlign.Center, style = T.label, color = if (k == 0) pal.hol else pal.text2)
        }
    }
    Spacer(Modifier.height(4.dp))
    val vis = remember(spans, start) { spans.between(start, start.plusDays(41)) }
    val lanes = remember(vis) { Spans.lanes(vis) }
    for (r in 0 until 6) {
        val w0 = start.plusDays(r * 7L); val w1 = w0.plusDays(6)
        val wk = vis.filter { it.dueDate!! >= w0.toString() && it.startDate!! <= w1.toString() && (lanes[it.id] ?: 0) < BAND_MAX }
        val bands = wk.maxOfOrNull { (lanes[it.id] ?: 0) + 1 } ?: 0
        Row(Modifier.fillMaxWidth().height(if (bands == 0) 42.dp else BAND_TOP + BAND_STEP * bands + 1.dp)) {
            for (c in 0 until 7) {
                val d = w0.plusDays(c.toLong())
                val other = d.month != first.month
                Box(Modifier.weight(1f).fillMaxHeight()) {
                    // 오늘은 칸 전체를 옅은 청록으로 (PC 와 같다)
                    if (d == today) Box(Modifier.fillMaxSize().padding(1.dp).clip(RoundedCornerShape(10.dp)).background(pal.teal.copy(alpha = .13f)))
                    Box(Modifier.align(Alignment.TopCenter).padding(top = 4.dp)) {
                        DayCell(d, other, d == picked, d == today, marks(byDay[d].orEmpty(), d, today)) { onPick(d) }
                    }
                    // 기간 띠: 옆 칸 · 옆 달 칸까지 이어진다. 시작 · 끝 칸에서만 둥글게 들어간다
                    val k = d.toString()
                    for (s in wk) {
                        if (s.startDate!! > k || s.dueDate!! < k) continue
                        val st = s.startDate == k; val en = s.dueDate == k
                        val shape = RoundedCornerShape(topStart = if (st) 2.dp else 0.dp, bottomStart = if (st) 2.dp else 0.dp,
                            topEnd = if (en) 2.dp else 0.dp, bottomEnd = if (en) 2.dp else 0.dp)
                        Box(Modifier.offset(y = BAND_TOP + BAND_STEP * (lanes[s.id] ?: 0)).fillMaxWidth()
                            .padding(start = if (st) 4.dp else 0.dp, end = if (en) 4.dp else 0.dp).height(3.dp)
                            .clip(shape).background(spans.color(s).copy(alpha = if (s.done) .3f else if (other) .6f else 1f)))
                    }
                }
            }
        }
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
        other -> pal.faint
        isToday -> pal.teal
        dow == 0 || Recur.isHoliday(d) -> pal.hol
        dow == 6 -> pal.text2
        else -> pal.text
    }
    Box(
        Modifier.size(34.dp).then(if (picked) Modifier.raised(CircleShape, pal) else Modifier)
            .glow(pal.teal, 10.dp, 17.dp, if (picked) pal.glowL else 0f).clip(CircleShape)
            .background(if (picked) pal.teal else Color.Transparent)
            .tap(onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text("${d.dayOfMonth}", style = if (isToday) T.leadM else T.lead, color = color)
        if (!other && marks.isNotEmpty()) Row(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp), horizontalArrangement = Arrangement.spacedBy(2.dp)) {
            for (m in marks) {
                val c = if (picked) pal.onTeal else when (m) { "past" -> pal.text; "routine" -> pal.teal.copy(alpha = .45f); else -> pal.teal }
                Box(Modifier.size(5.dp).clip(CircleShape).then(if (m == "ring") Modifier.border(1.2.dp, c, CircleShape) else Modifier.background(c)))
            }
        }
    }
}

// ---------------- 7일 ----------------

private val WK_H = 44.dp                     // 한 줄의 높이 (앞의 둘까지 보인다)
private val WK_GAP = 6.dp
private val RAIL_STEP = 7.dp
private const val WK_BUF = 2                 // 위아래로 더 그려 두는 줄 (하루 · 이틀 넘길 때 빈자리가 없다)
private val TIME_W = 52.dp                   // "11:00" 이 잘리지 않는 폭 (이름이 이 뒤에서 줄을 맞춘다)

/**
 * 고른 날부터 7일. 한 줄: 날짜 · 요일 | 앞의 둘 (시각 · 이름, 시각이 없으면 점) | 건수.
 * 루틴은 한 줄로 접는다 ("루틴 3"). 줄을 누르면 그 날이 맨 위로 오고, 몇 칸 굴렀는지 손에
 * 남게 위아래로 미끄러진다.
 *
 * 위아래로 끌면 하루씩 끊어서 굴러간다 (PC 의 휠 한 눈금 = 하루와 같다). 이어서 흐르지 않고,
 * 손가락이 한 줄 높이만큼 가면 하루 넘기고 톡 떨림을 준다. 놓아도 관성으로 더 가지 않는다.
 * 7일 위에서 끄는 것은 이 몫이라 화면은 스크롤되지 않는다 - 아래 목록 쪽을 끌면 화면이 움직인다.
 */
@Composable
private fun WeekStrip(picked: LocalDate, today: LocalDate, byDay: Map<LocalDate, List<Instance>>, spans: Spans, onPick: (LocalDate) -> Unit) {
    val cur = rememberUpdatedState(picked)
    val pick = rememberUpdatedState(onPick)
    val haptic = LocalHapticFeedback.current
    val density = LocalDensity.current
    val stepPx = with(density) { (WK_H + WK_GAP).toPx() }
    // 줄은 날짜로 묶어 두고 (key) 자리만 옮긴다: 하루 넘기면 새로 그리는 것은 들어오는 한 줄뿐이다.
    // 위아래로 WK_BUF 줄씩 더 그려 두어, 미끄러지는 동안 빈자리가 보이지 않는다.
    val shift = remember { Animatable(0f) }
    val fade = remember { Animatable(1f) }
    var prev by remember { mutableStateOf(picked) }
    LaunchedEffect(picked) {
        val n = days(prev, picked)
        prev = picked
        if (n == 0) return@LaunchedEffect
        if (abs(n) <= WK_BUF) {
            shift.snapTo(n * stepPx)
            shift.animateTo(0f, tween(260, easing = EaseMove))
        } else {                                        // 멀리 뛰면 (줄을 누르면) 옅게 떴다가 자리 잡는다 - PC 와 같다
            launch { fade.snapTo(.4f); fade.animateTo(1f, tween(260, easing = EaseMove)) }
            shift.snapTo(if (n > 0) 18 * density.density else -18 * density.density)
            shift.animateTo(0f, tween(280, easing = EaseMove))
        }
    }
    val lo = picked.minusDays(WK_BUF.toLong())
    val rows = 7 + 2 * WK_BUF
    val vis = remember(spans, lo) { spans.between(lo, lo.plusDays(rows - 1L)) }
    val lanes = remember(vis) { Spans.lanes(vis) }
    val nl = (lanes.values.maxOrNull() ?: -1) + 1
    Box(
        Modifier.fillMaxWidth().height(WK_H * 7 + WK_GAP * 6).clipToBounds()
            .pointerInput(Unit) {
                val step = stepPx * .8f
                var acc = 0f
                detectVerticalDragGestures(onDragStart = { acc = 0f }) { ch, dy ->
                    ch.consume()
                    acc += dy
                    var n = 0
                    while (acc <= -step) { acc += step; n++ }          // 위로 끌면 뒷날이 올라온다
                    while (acc >= step) { acc -= step; n-- }
                    if (n != 0) {
                        pick.value(cur.value.plusDays(n.toLong()))
                        haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove)
                    }
                }
            },
    ) {
        Row(
            Modifier.fillMaxWidth().wrapContentHeight(Alignment.Top, unbounded = true)
                .graphicsLayer { translationY = shift.value - WK_BUF * stepPx; alpha = fade.value },
        ) {
            if (nl > 0) Rails(lo, rows, vis, lanes, spans, Modifier.width(RAIL_STEP * nl + 3.dp).height(WK_H * rows + WK_GAP * (rows - 1)))
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(WK_GAP)) {
                for (k in 0 until rows) {
                    val d = lo.plusDays(k.toLong())
                    val shown = k - WK_BUF in 0 until 7          // 위아래 덤 줄은 눌리지 않는다 (머리줄 단추 위에 걸친다)
                    key(d) { WeekRow(d, d == picked, d == today, today, byDay[d].orEmpty(), if (shown) ({ onPick(d) }) else null) }
                }
            }
        }
    }
}

/** 기간의 세로선: 걸친 줄의 위에서 아래까지. 이 7일 안에서 시작 · 끝나면 그 줄 안쪽에서 멈춘다. */
@Composable
private fun Rails(first: LocalDate, rows: Int, vis: List<Task>, lanes: Map<String, Int>, spans: Spans, modifier: Modifier) {
    val pal = LocalPal.current
    val last = first.plusDays(rows - 1L)
    Canvas(modifier) {
        val h = WK_H.toPx(); val gap = WK_GAP.toPx(); val w = 4.dp.toPx(); val inset = 8.dp.toPx()
        for (s in vis) {
            val a = maxOf(s.start(), first); val b = minOf(s.end(), last)
            val st = !s.start().isBefore(first); val en = !s.end().isAfter(last)
            val top = days(first, a) * (h + gap) + if (st) inset else 0f
            val bot = days(first, b) * (h + gap) + h - if (en) inset else 0f
            val x = (lanes[s.id] ?: 0) * RAIL_STEP.toPx()
            val c = spans.color(s).copy(alpha = if (s.done) .3f else 1f)
            if (!s.done && pal.glowL > 0f) drawRoundRect(c.copy(alpha = pal.glowL * 1.2f), Offset(x - 1.dp.toPx(), top - 1.dp.toPx()),
                Size(w + 2.dp.toPx(), bot - top + 2.dp.toPx()), CornerRadius(3.dp.toPx()))
            drawRoundRect(c, Offset(x, top), Size(w, maxOf(w, bot - top)), CornerRadius(2.dp.toPx()))
        }
    }
}

@Composable
private fun WeekRow(d: LocalDate, sel: Boolean, isToday: Boolean, today: LocalDate, list: List<Instance>, onClick: (() -> Unit)?) {
    val pal = LocalPal.current
    val dow = d.dayOfWeek.value % 7
    val hol = Recur.isHoliday(d)
    val dls = list.filter { it.kind != "routine" }.sortedBy { it.time.ifEmpty { "99:99" } }
    val rts = list.filter { it.kind == "routine" }
    val numC = when { isToday -> pal.teal; dow == 0 || hol -> pal.hol; dow == 6 -> pal.text2; else -> pal.text }
    val shape = RoundedCornerShape(10.dp)
    Row(
        Modifier.fillMaxWidth().height(WK_H)
            .then(if (sel) Modifier.glow(pal.teal, 8.dp, 10.dp, pal.glowL * .5f) else Modifier)
            .clip(shape)
            .background(if (isToday) pal.teal.copy(alpha = .13f) else if (sel) pal.field else Color.Transparent)
            .then(if (sel) Modifier.border(1.4.dp, pal.teal, shape) else Modifier)
            .then(if (onClick != null) Modifier.tap(onClick) else Modifier).padding(start = 6.dp, end = 4.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // 날짜 · 요일은 한 줄로 ("30 수") - 위아래로 쌓으면 세로로 적힌 것처럼 읽혔다
        Row(Modifier.width(44.dp), verticalAlignment = Alignment.Bottom) {
            Text("${d.dayOfMonth}", Modifier.alignByBaseline(), style = T.leadM.lit(numC), color = numC, maxLines = 1, softWrap = false)
            Spacer(Modifier.width(4.dp))
            Text(WDS_SUN[dow], Modifier.alignByBaseline(), style = T.label, maxLines = 1, softWrap = false,
                color = if (isToday || sel) pal.teal else if (dow == 0 || hol) pal.hol else pal.text2)
        }
        Spacer(Modifier.width(4.dp))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(1.dp)) {
            val lines = dls.take(2)
            if (lines.isEmpty() && rts.isEmpty()) Text(if (hol) "공휴일" else "비어 있음", Modifier.padding(start = TIME_W + 8.dp), style = T.label, color = if (hol) pal.hol else pal.faint)
            for (i in lines) WeekLine(i, today)
            if (lines.size < 2 && rts.isNotEmpty()) Row(verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(TIME_W), contentAlignment = Alignment.CenterEnd) {
                    if (rts.all { it.done }) Text("✓", style = T.label, color = pal.teal)
                    else Box(Modifier.padding(end = 3.dp).size(5.dp).clip(CircleShape).background(pal.teal.copy(alpha = .45f)))
                }
                Spacer(Modifier.width(8.dp))
                Text("루틴 ${rts.size}", style = T.label, color = pal.text2, maxLines = 1)
            }
        }
        val n = dls.size + rts.size
        if (n > 0) Text(if (dls.size > 2) "+${n - 2}" else "$n", Modifier.padding(start = 6.dp), style = T.label, color = pal.text2, maxLines = 1, softWrap = false)
        Text("›", Modifier.padding(horizontal = 6.dp), style = T.lead, color = if (sel) pal.teal else pal.faint)
    }
}

/** 7일 줄 안의 한 줄: 시각(없으면 점 · 끝낸 것은 ✓) + 이름. */
@Composable
private fun WeekLine(i: Instance, today: LocalDate) {
    val pal = LocalPal.current
    val past = !i.done && i.date != null && i.date.isBefore(today)
    Row(verticalAlignment = Alignment.CenterVertically) {
        Box(Modifier.width(TIME_W), contentAlignment = Alignment.CenterEnd) {
            when {
                i.done -> Text("✓", style = T.label, color = pal.teal)
                i.time.isNotEmpty() -> Text(apText(t12(i.time)), style = T.time.copy(fontSize = T.label.fontSize).lit(if (past) pal.late else pal.text2),
                    color = if (past) pal.late else pal.text2, maxLines = 1)
                else -> Box(Modifier.padding(end = 3.dp).size(5.dp).clip(CircleShape).background(if (past) pal.text.copy(alpha = .75f) else pal.teal))
            }
        }
        Spacer(Modifier.width(8.dp))
        Text(i.task.title, style = T.label, color = if (i.done) pal.text2 else pal.text, maxLines = 1, overflow = TextOverflow.Ellipsis,
            textDecoration = if (i.done) T.strike else null)
    }
}

// ---------------- 고른 날 ----------------

@Composable
private fun DayList(
    picked: LocalDate, today: LocalDate, nowMin: Int, list: List<Instance>, spans: Spans,
    onToggle: (Instance) -> Unit, onMenu: (Instance) -> Unit, onAdd: (LocalDate) -> Unit, onOpen: (Task) -> Unit,
) {
    val pal = LocalPal.current
    val items = list.filter { it.kind != "routine" }.sortedWith(compareBy({ it.time.ifEmpty { "99:99" } }))
    val routines = list.filter { it.kind == "routine" }.sortedBy { it.time.ifEmpty { "99:99" } }
    Row(verticalAlignment = Alignment.Bottom) {
        Text("${picked.monthValue}월 ${picked.dayOfMonth}일 ${WDS[picked.dayOfWeek.value - 1]}요일", style = T.head.lit(pal.text, big = true), color = pal.text)
        Spacer(Modifier.width(8.dp))
        val gap = days(today, picked)
        Text(if (gap == 0) "오늘" else if (gap > 0) "${gap}일 뒤" else "${-gap}일 전", style = T.label, color = if (gap == 0) pal.teal else pal.text2)
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
    var open by remember(picked) { mutableStateOf(false) }
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

    // 그 날 걸쳐 있는 기간 업무: 색 · 이름 · 기간 · 남은 날, 아래에 지나온 만큼의 막대
    val on = spans.on(picked)
    if (on.isNotEmpty()) {
        Row(Modifier.fillMaxWidth().padding(top = 18.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("진행 중인 기간 업무", style = T.label.lit(pal.text2), color = pal.text2)
            Spacer(Modifier.width(8.dp))
            Text("${on.size}", style = T.label, color = pal.text2)
            Spacer(Modifier.width(10.dp))
            Hair(Modifier.weight(1f))
        }
        for (s in on) SpanRow(s, picked, spans.color(s), onOpen = { onOpen(s) }, onMenu = { onMenu(Instance(s, s.end(), s.done)) })
    }
}

@Composable
private fun SpanRow(s: Task, at: LocalDate, c: Color, onOpen: () -> Unit, onMenu: () -> Unit) {
    val pal = LocalPal.current
    val len = maxOf(1, days(s.start(), s.end()))
    val pr = (days(s.start(), at).toFloat() / len).coerceIn(0f, 1f)
    val left = days(at, s.end())
    Column(Modifier.fillMaxWidth().padding(vertical = 2.dp).clip(RoundedCornerShape(10.dp)).press(onLong = onMenu, onClick = onOpen)
        .padding(horizontal = 6.dp, vertical = 8.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Box(Modifier.size(10.dp).glow(c, 5.dp, 3.dp, if (s.done) 0f else pal.glowL * 1.2f).clip(RoundedCornerShape(3.dp)).background(c.copy(alpha = if (s.done) .4f else 1f)))
            Spacer(Modifier.width(10.dp))
            Text(s.title, Modifier.weight(1f), style = T.lead, color = if (s.done) pal.text2 else pal.text, maxLines = 1,
                overflow = TextOverflow.Ellipsis, textDecoration = if (s.done) T.strike else null)
            Text(spanRange(s), Modifier.padding(start = 8.dp), style = T.time.lit(pal.text2), color = pal.text2)
            val soon = !s.done && left <= 1
            Text(if (s.done) "완료" else if (left == 0) "오늘 마감" else "D-$left", Modifier.padding(start = 8.dp),
                style = T.micro, color = if (soon) pal.hol else pal.teal)
        }
        Spacer(Modifier.height(6.dp))
        Box(Modifier.padding(start = 20.dp).fillMaxWidth().height(4.dp).clip(RoundedCornerShape(2.dp)).background(pal.hair)) {
            Box(Modifier.fillMaxWidth(pr).fillMaxHeight().clip(RoundedCornerShape(2.dp)).background(c.copy(alpha = if (s.done) .4f else 1f)))
        }
    }
}

@Composable
private fun AddHere(onClick: () -> Unit) {
    val pal = LocalPal.current
    Box(Modifier.height(30.dp).clip(RoundedCornerShape(15.dp)).border(1.dp, pal.hair2, RoundedCornerShape(15.dp))
        .press(onClick = onClick).padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
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
