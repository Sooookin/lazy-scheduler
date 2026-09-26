package com.lazyscheduler.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.snapping.rememberSnapFlingBehavior
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.itemsIndexed
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.ReminderPlan
import com.lazyscheduler.app.core.RuleCheck
import com.lazyscheduler.app.core.RulePick
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.core.previewDates
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import java.time.LocalDate
import java.time.LocalTime
import java.time.YearMonth
import kotlin.math.abs

/** 알림: 흔한 넷. 저장된 값이 그 밖이면 다섯째로 붙인다. */
private val LEADS = listOf(10, 30, 60, 180)
private fun leadLabel(m: Int) = when { m == 0 -> "정각"; m % 60 == 0 -> "${m / 60}시간"; else -> "${m}분" }

/**
 * 편집 종이에 쓰는 중인 것. App 이 들고 있다 - 시각을 고르는 동안 하늘(점선 구슬)도 이것을 본다.
 */
class Draft {
    var title by mutableStateOf("")
    var note by mutableStateOf("")
    var kind by mutableStateOf("deadline")
    var date by mutableStateOf(LocalDate.now())
    var time by mutableStateOf("")
    var lead by mutableStateOf<Int?>(null)
    var alarm by mutableStateOf(true)
    var rule by mutableStateOf<Map<String, Any?>?>(null)
    var ruleText by mutableStateOf("")
    var base by mutableStateOf(LocalDate.now())
    var unit by mutableStateOf("month")
    var every by mutableIntStateOf(1)
    var wds by mutableStateOf(setOf<Int>())
    var picking by mutableStateOf(false)
    var pickMin by mutableIntStateOf(600)
    var calOpen by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var defaultLead = 30

    fun load(e: Editing, today: LocalDate, businessOnly: Boolean, settings: Map<String, Any?>) {
        val t = e.task
        title = t?.title ?: ""; note = t?.note ?: ""; kind = t?.kind ?: e.kind
        date = t?.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: e.date ?: if (businessOnly && !Recur.isBusinessDay(today)) Recur.nextBusinessDay(today) else today
        time = t?.dueTime ?: ""
        lead = t?.notifyMin; alarm = !(t?.muted ?: false)
        rule = t?.rule; ruleText = t?.ruleText ?: ""
        base = e.date ?: today
        RulePick.unitOf(rule).let { unit = it.first; every = it.second }
        wds = (rule?.get("weekdays") as? List<*>)?.map { (it as Number).toInt() }?.toSet() ?: setOf(base.dayOfWeek.value - 1)
        picking = false; calOpen = false; error = null
        defaultLead = ReminderPlan.defaultLead(settings)
    }

    fun ghostMinute(): Int? = if (picking) pickMin else if (kind == "floating") null else minsOf(time)
    fun pickFromSky(m: Int) { if (picking) pickMin = m else time = hhmm(m) }
    fun openPicker() {
        val now = LocalTime.now()
        pickMin = minsOf(time) ?: (((now.hour * 60 + now.minute) / 5 + 12) * 5).coerceAtMost(23 * 60 + 55)
        picking = true
    }

    /** 저장할 필드 (저장된 모양 그대로). 모자라면 error 를 적고 null. */
    fun fields(): Map<String, Any?>? {
        val t = title.trim()
        if (t.isEmpty()) { error = "이름을 입력하세요"; return null }
        val f = linkedMapOf<String, Any?>("title" to t.take(200), "note" to note.trim().take(2000), "kind" to kind)
        when (kind) {
            "routine" -> {
                val (clean, err) = if (rule == null) null to "규칙을 하나 고르세요" else RuleCheck.validate(rule)
                if (err != null) { error = err; return null }
                f += mapOf("rule" to clean, "due_date" to null, "due_time" to time, "notify_min" to lead, "muted" to !alarm)
            }
            "deadline" -> f += mapOf("rule" to null, "due_date" to date.toString(), "due_time" to time, "notify_min" to lead, "muted" to !alarm)
            else -> f += mapOf("rule" to null, "due_date" to null, "due_time" to "", "notify_min" to null, "muted" to false)
        }
        return f
    }
}

/**
 * 편집 종이. 새 항목(하늘을 편 채)과 고치기(하늘을 접은 채)가 같은 틀을 쓴다:
 * 머리(이름 · 닫기) → 가운데(종류마다 다른 것, 스크롤) → 아래 단추. 시각 칸을 누르면
 * 같은 자리가 시각 고르기로 바뀐다.
 */
@Composable
fun Editor(
    e: Editing, draft: Draft, today: LocalDate, businessOnly: Boolean, others: List<Task>,
    onClose: () -> Unit, onSave: (Map<String, Any?>) -> Unit, onDelete: () -> Unit, onLater: () -> Unit, onSkip: () -> Unit,
) {
    AnimatedContent(draft.picking, transitionSpec = { fadeIn(tween(200, 40)) togetherWith fadeOut(tween(100)) }, label = "pick") { picking ->
        if (picking) TimePanel(draft, onClose = { draft.picking = false })
        else Form(e, draft, today, businessOnly, others, onClose, onSave, onDelete, onLater, onSkip)
    }
}

@Composable
private fun Form(
    e: Editing, d: Draft, today: LocalDate, businessOnly: Boolean, others: List<Task>,
    onClose: () -> Unit, onSave: (Map<String, Any?>) -> Unit, onDelete: () -> Unit, onLater: () -> Unit, onSkip: () -> Unit,
) {
    val pal = LocalPal.current
    val editing = e.task != null
    Column(Modifier.fillMaxSize().navigationBarsPadding().imePadding().padding(horizontal = 20.dp)) {
        Row(Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (editing) "${KIND_NAME[d.kind]} 고치기" else "새 ${KIND_NAME[d.kind]}", style = T.title, color = pal.text)
            Spacer(Modifier.width(12.dp))
            if (!editing) Seg(listOf("deadline" to "할 일", "routine" to "루틴", "floating" to "메모"), d.kind) { d.kind = it; d.error = null }
            Spacer(Modifier.weight(1f))
            CloseX(onClose)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
            Label("이름")
            Field(d.title, "", focused = !editing && d.title.isEmpty()) { if (it.length <= 200) d.title = it }
            when (d.kind) {
                "deadline" -> DeadlinePart(d, today, businessOnly, editing, others.filter { it.id != e.task?.id })
                "routine" -> RoutinePart(d, today)
                else -> {
                    Label("메모")
                    Field(d.note, "기한 없이 목록에만 남습니다", Modifier.height(140.dp), singleLine = false) { if (it.length <= 2000) d.note = it }
                }
            }
            if (d.kind != "floating") TimeAlarm(d, showHint = !editing)
            d.error?.let { Text(it, Modifier.padding(top = 12.dp), style = T.body, color = pal.danger) }
            Spacer(Modifier.height(16.dp))
        }
        Row(Modifier.padding(vertical = 14.dp), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            if (!editing) {
                Ghost("취소", Modifier.weight(.35f), onClick = onClose)
                Primary("추가", Modifier.weight(.65f)) { d.fields()?.let(onSave) }
            } else {
                Ghost("삭제", Modifier.weight(1f), color = pal.late, onClick = onDelete)
                if (d.kind == "deadline" && e.task?.done == false) Ghost("내일로", Modifier.weight(1f), onClick = onLater)
                if (d.kind == "routine" && e.date != null) Ghost("이번만 건너뛰기", Modifier.weight(1.3f), onClick = onSkip)
                Primary("저장", Modifier.weight(1.1f)) { d.fields()?.let(onSave) }
            }
        }
    }
}

// ---------------- 할 일: 마감 ----------------

@Composable
private fun ColumnScope.DeadlinePart(d: Draft, today: LocalDate, businessOnly: Boolean, editing: Boolean, others: List<Task>) {
    val pal = LocalPal.current
    val open = others.filter { it.kind == "deadline" && !it.done && it.dueDate != null }
    Label("마감")
    if (!editing) {
        val tomorrow = today.plusDays(1)
        val nextBiz = Recur.nextBusinessDay(today.plusDays(1))
        val quick = listOf("오늘" to today, "내일" to tomorrow, "다음 영업일" to nextBiz)
        val custom = quick.none { it.second == d.date && !(it.first == "다음 영업일" && nextBiz == tomorrow) } || d.calOpen
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((label, day) in quick) {
                if (label == "다음 영업일" && nextBiz == tomorrow) continue
                Chip(label, !custom && d.date == day) { d.date = day; d.calOpen = false }
            }
            Chip(if (custom) shortDay(d.date) + " ▾" else "날짜 ▾", custom) { d.calOpen = !d.calOpen }
        }
        if (d.calOpen) { Spacer(Modifier.height(10.dp)); MiniCal(today, d.date, open.mapNotNull { it.dueDate }.toSet()) { d.date = it } }
    } else {
        MiniCal(today, d.date, open.mapNotNull { it.dueDate }.toSet()) { d.date = it }
    }
    val same = open.filter { it.dueDate == d.date.toString() }
    Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(dayName(d.date), style = T.leadM, color = pal.text)
        Spacer(Modifier.width(8.dp))
        Text(dateLabel(d.date, today).takeIf { it.length <= 2 } ?: "", style = T.label, color = pal.teal)
        Spacer(Modifier.weight(1f))
        Text(if (same.isEmpty()) "같은 날 마감 없음" else "같은 날 마감 ${same.size}건", style = T.label, color = pal.text2)
    }
    if (businessOnly && !Recur.isBusinessDay(d.date)) {
        val alt = Recur.nextBusinessDay(d.date, forward = false)
        Text("영업일이 아닙니다 · ${shortDay(alt)}로 당기기 ›", Modifier.padding(top = 6.dp).clip(RoundedCornerShape(8.dp)).tap { d.date = alt }.padding(vertical = 4.dp),
            style = T.label, color = pal.teal)
    }
}

// ---------------- 시각 · 알림 ----------------

@Composable
private fun TimeAlarm(d: Draft, showHint: Boolean) {
    Label("시각 · 알림")
    Row(verticalAlignment = Alignment.CenterVertically) {
        Slot(if (d.time.isEmpty()) "시각 없음" else d.time, if (showHint) "하늘에서 보기 ↑" else null, Modifier.weight(1f), dim = d.time.isEmpty()) { d.openPicker() }
        Spacer(Modifier.width(14.dp))
        Toggle(d.alarm, enabled = d.time.isNotEmpty()) { d.alarm = it }
        if (!showHint) { Spacer(Modifier.width(8.dp)); Text("알림", style = T.body, color = LocalPal.current.text2) }
    }
    if (d.time.isNotEmpty() && d.alarm) {
        Spacer(Modifier.height(10.dp))
        val cur = d.lead ?: d.defaultLead
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for (m in (LEADS + if (cur in LEADS) emptyList() else listOf(cur)).sorted()) Chip(leadLabel(m), m == cur) { d.lead = m }
        }
    }
}

// ---------------- 시각 고르기 (1e) ----------------

private val AP = listOf("오전", "오후")
private val HOURS = listOf("12") + (1..11).map { "$it" }
private val MINS = (0 until 12).map { "%02d".format(it * 5) }

/**
 * 큰 시각 · 드럼 세 줄(오전/오후 · 시 · 분 5분 단위) · 빠른 칩. 드럼을 돌리면 하늘의 점선 구슬이
 * 따라가고, 하늘의 구슬을 끌면 드럼이 따라온다.
 */
@Composable
private fun TimePanel(d: Draft, onClose: () -> Unit) {
    val pal = LocalPal.current
    val m = d.pickMin
    Column(Modifier.fillMaxSize().navigationBarsPadding().padding(horizontal = 20.dp)) {
        Row(Modifier.padding(top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("시각", style = T.title, color = pal.text)
            Spacer(Modifier.width(12.dp))
            Text("하늘의 점선 구슬을 끌어도 됩니다", Modifier.weight(1f), style = T.label, color = pal.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
            CloseX(onClose)
        }
        Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.Bottom) {
            Text(hhmm(m), style = T.display, color = pal.text)
            Spacer(Modifier.width(10.dp))
            Text("5분 단위", Modifier.padding(bottom = 8.dp), style = T.label, color = pal.text2)
        }
        Spacer(Modifier.height(10.dp))
        Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(pal.field).border(1.dp, pal.hair, RoundedCornerShape(14.dp))) {
            Box(Modifier.align(Alignment.Center).padding(horizontal = 12.dp).fillMaxWidth().height(44.dp).clip(RoundedCornerShape(10.dp))
                .background(pal.teal.copy(alpha = .06f)).border(1.2.dp, pal.teal, RoundedCornerShape(10.dp)))
            Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp)) {
                val h = m / 60
                Wheel(AP, if (h >= 12) 1 else 0, Modifier.weight(1f)) { i -> d.pickMin = (i * 12 + (d.pickMin / 60) % 12) * 60 + d.pickMin % 60 }
                Wheel(HOURS, h % 12, Modifier.weight(1f)) { i -> d.pickMin = ((d.pickMin / 60 / 12) * 12 + i) * 60 + d.pickMin % 60 }
                Wheel(MINS, (m % 60) / 5, Modifier.weight(1f)) { i -> d.pickMin = (d.pickMin / 60) * 60 + i * 5 }
            }
        }
        Spacer(Modifier.height(14.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            val now = LocalTime.now().let { it.hour * 60 + it.minute }
            Chip("지금", false) { d.pickMin = ((now + 4) / 5 * 5).coerceAtMost(1435) }
            Chip("+1시간", false) { d.pickMin = (d.pickMin + 60).coerceAtMost(1435) }
            Chip("퇴근 전 17:30", false) { d.pickMin = 17 * 60 + 30 }
            Chip("없음", false) { d.time = ""; d.picking = false }
        }
        Spacer(Modifier.weight(1f))
        Primary("${hhmm(m)}으로", Modifier.fillMaxWidth().padding(vertical = 14.dp)) { d.time = hhmm(d.pickMin); d.picking = false }
    }
}

/** 드럼 한 줄. 가운데가 고른 것. 밖에서 값이 바뀌면 (하늘에서 끌면) 그리로 돌아간다. */
@Composable
private fun Wheel(items: List<String>, index: Int, modifier: Modifier, onIndex: (Int) -> Unit) {
    val pal = LocalPal.current
    val itemH = 44.dp
    val hPx = with(LocalDensity.current) { itemH.toPx() }
    val state = rememberLazyListState(initialFirstVisibleItemIndex = index)
    val fling = rememberSnapFlingBehavior(state)
    fun centered() = (state.firstVisibleItemIndex + if (state.firstVisibleItemScrollOffset > hPx / 2) 1 else 0).coerceIn(0, items.size - 1)
    LaunchedEffect(index) { if (!state.isScrollInProgress && centered() != index) state.animateScrollToItem(index) }
    LaunchedEffect(state) {
        snapshotFlow { state.isScrollInProgress }.distinctUntilChanged().filter { !it }.collect { onIndex(centered()) }
    }
    LazyColumn(modifier.height(itemH * 5), state = state, flingBehavior = fling, contentPadding = PaddingValues(vertical = itemH * 2)) {
        itemsIndexed(items) { i, s ->
            Box(Modifier.fillMaxWidth().height(itemH).graphicsLayer {
                val pos = state.firstVisibleItemIndex + state.firstVisibleItemScrollOffset / hPx
                val dist = abs(i - pos)
                alpha = when { dist < .5f -> 1f; dist < 1.5f -> .75f; dist < 2.5f -> .45f; else -> .2f }
                val sc = if (dist < .5f) 1f else if (dist < 1.5f) .94f else .86f
                scaleY = sc; scaleX = if (dist < .5f) 1f else .92f
            }, contentAlignment = Alignment.Center) {
                val on = i == index
                Text(s, style = T.title.copy(fontWeight = if (on) FontWeight.Medium else FontWeight.Light, fontFeatureSettings = "tnum"),
                    color = if (on) pal.text else pal.text2, textAlign = TextAlign.Center)
            }
        }
    }
}

// ---------------- 작은 달력 ----------------

/** 늘 여섯 줄 (달을 넘겨도 아래가 움직이지 않는다). 점 = 이미 마감이 있는 날. */
@Composable
internal fun MiniCal(today: LocalDate, picked: LocalDate, marks: Set<String> = emptySet(), onPick: (LocalDate) -> Unit) {
    val pal = LocalPal.current
    var month by remember { mutableStateOf(YearMonth.from(picked)) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("‹", Modifier.clip(RoundedCornerShape(10.dp)).tap { month = month.minusMonths(1) }.padding(horizontal = 14.dp, vertical = 4.dp),
            style = T.head, color = pal.text2)
        Text("${month.year}년 ${month.monthValue}월", Modifier.weight(1f), textAlign = TextAlign.Center, style = T.lead, color = pal.text)
        Text("›", Modifier.clip(RoundedCornerShape(10.dp)).tap { month = month.plusMonths(1) }.padding(horizontal = 14.dp, vertical = 4.dp),
            style = T.head, color = pal.text2)
    }
    Row(Modifier.padding(top = 4.dp)) {
        WDS_SUN.forEachIndexed { k, w -> Text(w, Modifier.weight(1f), textAlign = TextAlign.Center, style = T.label, color = if (k == 0) pal.hol else pal.text2) }
    }
    val first = month.atDay(1)
    var cur = first.minusDays((first.dayOfWeek.value % 7).toLong())
    repeat(6) {
        Row {
            repeat(7) {
                val day = cur
                val out = day.month != first.month
                val on = day == picked
                val dw = day.dayOfWeek.value % 7
                Box(Modifier.weight(1f).height(38.dp), contentAlignment = Alignment.Center) {
                    Box(
                        Modifier.size(32.dp).then(if (on) Modifier.raised(CircleShape, pal) else Modifier).clip(CircleShape)
                            .background(if (on) pal.teal else Color.Transparent)
                            .then(if (day == today && !on) Modifier.border(1.4.dp, pal.teal, CircleShape) else Modifier)
                            .tap { if (out) month = YearMonth.from(day); onPick(day) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("${day.dayOfMonth}", style = T.body, color = when {
                            on -> pal.onTeal; out -> pal.text.copy(alpha = .3f)
                            Recur.isHoliday(day) || dw == 0 -> pal.hol; dw == 6 -> pal.text2; else -> pal.text
                        })
                        if (day.toString() in marks && !out) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp).size(4.dp)
                            .clip(CircleShape).background(if (on) pal.onTeal else pal.teal))
                    }
                }
                cur = cur.plusDays(1)
            }
        }
    }
}

// ---------------- 루틴 (1f) ----------------

/**
 * 단위 · 간격을 고르면 기준 날짜를 읽는 방법들이 카드로 나온다 (엔진이 만든다 - Recur.suggest).
 * 화면의 규칙은 모두 기준 날짜에 실제로 도는 것이다. 주는 요일을 여럿 고를 수 있다.
 */
@Composable
private fun RoutinePart(d: Draft, today: LocalDate) {
    val pal = LocalPal.current
    val items = remember(d.base, d.unit, d.every) { if (d.unit == "week") emptyList() else Recur.suggest(d.base, d.unit, d.every) }
    // 단위 · 간격은 한 줄씩 쌓는다 - 월 간격이 넷(매달 · 격월 · 분기 · 반기)이 되니 반 폭에서는 글자가 한 자씩 잘렸다
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(4.dp)) {
        Column(Modifier.fillMaxWidth()) {
            Label("단위")
            Seg(RulePick.UNITS, d.unit, Modifier.fillMaxWidth(), fill = true) { u ->
                if (u == "week" && d.unit != "week") d.wds = setOf(d.base.dayOfWeek.value - 1)
                d.unit = u; d.every = 1; d.ruleText = ""; d.rule = null
            }
        }
        RulePick.everyOpts(d.unit, d.every).takeIf { it.isNotEmpty() }?.let { opts ->
            Column(Modifier.fillMaxWidth()) {
                Label("간격")
                Seg(opts, d.every, Modifier.fillMaxWidth(), fill = true) { d.every = it; d.ruleText = ""; d.rule = null }
            }
        }
    }
    if (d.unit != "day") {
        Row(Modifier.padding(top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("기준 날짜", style = T.label, color = pal.text2)
            Spacer(Modifier.width(10.dp))
            Text("${shortDay(d.base)} ▾", Modifier.clip(RoundedCornerShape(8.dp)).tap { d.calOpen = !d.calOpen }.padding(horizontal = 6.dp, vertical = 4.dp),
                style = T.body, color = pal.teal)
        }
        if (d.calOpen) MiniCal(today, d.base) { d.base = it; d.wds = setOf(it.dayOfWeek.value - 1); d.ruleText = ""; d.rule = null; d.calOpen = false }
    }
    if (d.unit == "week") {
        Label("요일")
        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            WDS.forEachIndexed { i, w -> Chip(w, i in d.wds) { d.wds = if (i in d.wds) d.wds - i else d.wds + i } }
        }
        val built = RulePick.weekRule(d.wds, d.every, d.base, d.rule?.get("holiday_shift") as? String)
        LaunchedEffect(built) { d.rule = built; d.ruleText = built?.let { Recur.describe(it) } ?: "" }
        Label("규칙")
        if (built == null) Text("요일을 하나 이상 고르세요", style = T.body, color = pal.danger)
        else RuleCard(Recur.describe(built), previewDates(built, today, 3).joinToString(" · "), true) {}
    } else {
        Label("규칙")
        val rows = items.map { it.first to it.second } +
            if (d.ruleText.isNotEmpty() && items.none { it.first == d.ruleText } && d.rule != null) listOf(d.ruleText to d.rule!!) else emptyList()
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((label, r) in rows) {
                val on = label == d.ruleText
                RuleCard(label, if (d.unit == "day") "" else previewDates(r, d.base, 3).joinToString(" · "), on) { d.rule = r; d.ruleText = label }
            }
        }
        LaunchedEffect(items) {
            if (items.isNotEmpty() && items.none { it.first == d.ruleText } && (d.ruleText.isEmpty() || d.rule == null)) {
                d.rule = items[0].second; d.ruleText = items[0].first
            }
        }
    }
    if (d.unit != "day" && !RulePick.countsBusinessDays(d.rule)) {
        var open by remember { mutableStateOf(false) }
        val shift = d.rule?.get("holiday_shift") as? String ?: "prev"
        Row(Modifier.padding(top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("주말 · 공휴일이면", style = T.body, color = pal.text2)
            Spacer(Modifier.width(10.dp))
            Box {
                Box(Modifier.height(34.dp).clip(RoundedCornerShape(10.dp)).border(1.dp, pal.hair2, RoundedCornerShape(10.dp)).tap { open = true }
                    .padding(horizontal = 14.dp), contentAlignment = Alignment.Center) {
                    Text((RulePick.SHIFTS.firstOrNull { it.first == shift }?.second ?: shift) + " ▾", style = T.body, color = pal.text)
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = pal.surface) {
                    for ((v, label) in RulePick.SHIFTS) DropdownMenuItem(text = { Text(label, style = T.lead, color = pal.text) },
                        onClick = { open = false; d.rule = d.rule?.plus("holiday_shift" to v) })
                }
            }
        }
    }
}

@Composable
private fun RuleCard(title: String, dates: String, on: Boolean, onClick: () -> Unit) {
    val pal = LocalPal.current
    Column(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(if (on) pal.teal.copy(alpha = .09f) else pal.field)
            .border(if (on) 1.3.dp else 1.dp, if (on) pal.teal else pal.hair2, RoundedCornerShape(12.dp))
            .press(onClick = onClick).padding(horizontal = 16.dp, vertical = 12.dp),
    ) {
        Text(title, style = if (on) T.leadM else T.lead, color = pal.text)
        if (dates.isNotEmpty()) { Spacer(Modifier.height(3.dp)); Text(dates, style = T.label, color = pal.text2) }
    }
}
