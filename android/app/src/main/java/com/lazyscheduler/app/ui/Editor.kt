package com.lazyscheduler.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.RuleCheck
import com.lazyscheduler.app.core.RulePick
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.core.previewDates
import java.time.LocalDate
import java.time.YearMonth

/** The three kinds, called the same everywhere: 할 일 · 루틴 · 메모. */
internal val KIND_NAME = mapOf("deadline" to "할 일", "routine" to "루틴", "floating" to "메모")

/** Minutes before: the four common ones. A saved value outside them is shown as a fifth. */
private val LEADS = listOf(10, 30, 60, 180)
private fun leadLabel(m: Int) = when {
    m == 0 -> "정각"
    m % 60 == 0 -> "${m / 60}시간 전"
    else -> "${m}분 전"
}

/**
 * Add or edit one item, with the same choices as the PC form. The rule is checked by
 * RuleCheck before anything is written.
 *
 * The sheet has one frame for every kind: name and note at the top, the kind's own part
 * in the middle (it scrolls), time · alarm and the buttons at the bottom. Switching
 * between 할 일 · 루틴 · 메모 changes only the middle; nothing else moves.
 *
 * onSave gets the editable fields in stored form (title, note, kind, due_date, due_time,
 * notify_min, muted, rule). Delete · skip · later close the sheet at once; the list shows
 * "되돌리기" for five seconds instead of asking first.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemEditor(
    existing: Task?,
    others: List<Task>,
    today: LocalDate,
    businessOnly: Boolean,
    defaultLead: Int,
    skipDate: LocalDate?,
    onDismiss: () -> Unit,
    onSave: (Map<String, Any?>) -> Unit,
    onDelete: () -> Unit,
    onSkip: () -> Unit,
    onLater: (() -> Unit)?,
) {
    val editing = existing != null
    var title by remember { mutableStateOf(existing?.title ?: "") }
    var note by remember { mutableStateOf(existing?.note ?: "") }
    var kind by remember { mutableStateOf(existing?.kind ?: "deadline") }
    // The rule itself, as stored. Untouched until the person picks another line.
    var rule by remember { mutableStateOf(existing?.rule) }
    var date by remember {
        mutableStateOf(existing?.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: if (businessOnly) Recur.nextBusinessDay(today.plusDays(1)) else today.plusDays(1))
    }
    var time by remember { mutableStateOf(existing?.dueTime ?: "") }
    var lead by remember { mutableStateOf(existing?.notifyMin) }      // null = the default in settings
    var alarm by remember { mutableStateOf(!(existing?.muted ?: false)) }
    var error by remember { mutableStateOf<String?>(null) }
    var pickTime by remember { mutableStateOf(false) }

    val (checkedRule, ruleError) = when {
        kind != "routine" -> null to null
        rule == null -> null to "규칙을 하나 고르세요"
        else -> RuleCheck.validate(rule)
    }

    fun save() {
        val t = title.trim()
        if (t.isEmpty()) { error = "이름을 입력하세요"; return }
        if (kind == "routine" && ruleError != null) { error = ruleError; return }
        val fields = linkedMapOf<String, Any?>("title" to t.take(200), "note" to note.trim().take(2000), "kind" to kind)
        when (kind) {
            "routine" -> fields += mapOf("rule" to checkedRule, "due_date" to null, "due_time" to time,
                "notify_min" to lead, "muted" to !alarm)
            "deadline" -> fields += mapOf("rule" to null, "due_date" to date.toString(), "due_time" to time,
                "notify_min" to lead, "muted" to !alarm)
            else -> fields += mapOf("rule" to null, "due_date" to null, "due_time" to "", "notify_min" to null, "muted" to false)
        }
        onSave(fields)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ink.card,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(Modifier.fillMaxHeight().padding(horizontal = 20.dp).padding(bottom = 20.dp).imePadding()) {
            // ---- top: always here ----
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(if (editing) (KIND_NAME[kind] ?: "항목") + " 고치기" else "새 " + KIND_NAME[kind],
                    Modifier.width(92.dp), style = MaterialTheme.typography.titleMedium)
                if (!editing) Seg(listOf("deadline" to "할 일", "routine" to "루틴", "floating" to "메모"), kind) { kind = it; error = null }
            }
            Spacer(Modifier.height(14.dp))
            InField(title, "이름") { if (it.length <= 200) title = it }
            Spacer(Modifier.height(10.dp))
            // 메모는 달력도 문장도 없으니 그 자리를 통째로 쓴다 - 이름 칸과 단추는 제자리다
            val memoOnly = kind == "floating"
            InField(note, "메모 (선택)", if (memoOnly) Modifier.weight(1f) else Modifier, singleLine = !memoOnly) {
                if (it.length <= 2000) note = it
            }

            // ---- middle: the kind's own part; only this changes, and it scrolls ----
            Column(
                (if (memoOnly) Modifier else Modifier.weight(1f))
                    .fillMaxWidth().verticalScroll(rememberScrollState()),
            ) {
                when (kind) {
                    "routine" -> RoutinePick(today, rule, existing?.ruleText.orEmpty()) { rule = it }
                    "deadline" -> DueDate(date, today, businessOnly, others.filter { it.id != existing?.id }) { date = it }
                    else -> Unit
                }
                Spacer(Modifier.height(8.dp))
            }

            // ---- bottom: time · alarm (a memo keeps the space, empty) ----
            val on = kind != "floating"
            Column(Modifier.alpha(if (on) 1f else 0f)) {
                Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.rule2))
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Box(Modifier.inset(12.dp).clip(RoundedCornerShape(12.dp)).then(if (on) Modifier.tap { pickTime = true } else Modifier)
                        .padding(horizontal = 16.dp, vertical = 11.dp)) {
                        Text(if (time.isEmpty()) "시각 없음" else timeLabel(time), style = MaterialTheme.typography.bodyLarge,
                            color = if (time.isEmpty()) Ink.faint else Ink.ink2)
                    }
                    Spacer(Modifier.weight(1f))
                    Text("알림", style = MaterialTheme.typography.labelLarge, color = Ink.muted)
                    Spacer(Modifier.width(8.dp))
                    Switch(checked = alarm, onCheckedChange = { if (on) alarm = it }, enabled = on,
                        colors = SwitchDefaults.colors(checkedTrackColor = Ink.mid, checkedThumbColor = Ink.light,
                            uncheckedTrackColor = Ink.pale, uncheckedBorderColor = Ink.dark, uncheckedThumbColor = Ink.light))
                }
                Spacer(Modifier.height(8.dp))
                val cur = lead ?: defaultLead
                val opts = (LEADS + if (cur in LEADS) emptyList() else listOf(cur)).sorted().map { it to leadLabel(it) }
                Seg(opts, cur, enabled = on && alarm) { lead = it }
            }

            error?.let {
                Spacer(Modifier.height(8.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium, color = Ink.danger)
            }
            Spacer(Modifier.height(14.dp))
            if (editing) {
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Ghost("삭제", Ink.danger) { onDelete() }
                    if (kind == "routine" && skipDate != null) Ghost("${dateLabel(skipDate, today)} 건너뛰기") { onSkip() }
                    if (kind == "deadline" && onLater != null) Ghost("↷ 내일로", Ink.midInk) { onLater() }
                }
                Spacer(Modifier.height(10.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("취소", color = Ink.faint) }
                Spacer(Modifier.width(6.dp))
                Primary(if (editing) "저장" else "추가") { save() }
            }
        }
    }

    if (pickTime) TimeDialog(time, onDismiss = { pickTime = false }) { time = it; pickTime = false }
}

// ---------------- the small month (할 일's date, 루틴's example date) ----------------

/** Always six rows, so the parts below never move when the month changes. Dots = days that already have something. */
@Composable
private fun MiniCal(today: LocalDate, start: LocalDate, picked: LocalDate?, marks: Set<String> = emptySet(), onPick: (LocalDate) -> Unit) {
    var month by remember { mutableStateOf(YearMonth.from(start)) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("‹", Modifier.clip(RoundedCornerShape(10.dp)).tap { month = month.minusMonths(1) }.padding(horizontal = 14.dp, vertical = 3.dp),
            style = MaterialTheme.typography.titleMedium, color = Ink.muted)
        Text("${month.year}년 ${month.monthValue}월", Modifier.weight(1f), textAlign = TextAlign.Center,
            style = MaterialTheme.typography.labelLarge, color = Ink.ink2)
        Text("›", Modifier.clip(RoundedCornerShape(10.dp)).tap { month = month.plusMonths(1) }.padding(horizontal = 14.dp, vertical = 3.dp),
            style = MaterialTheme.typography.titleMedium, color = Ink.muted)
    }
    Row(Modifier.padding(top = 2.dp)) {
        WDS_SUN.forEachIndexed { k, w ->
            Text(w, Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall,
                color = if (k == 0) Ink.hol else if (k == 6) Ink.midInk else Ink.faint)
        }
    }
    val first = month.atDay(1)
    // 그 달의 첫 주 일요일부터 (DayOfWeek 는 월=1 … 일=7 이라 7 로 나눈 나머지가 일요일 기준 자리다)
    var cur = first.minusDays((first.dayOfWeek.value % 7).toLong())
    repeat(6) {
        Row {
            repeat(7) {
                val d = cur
                val out = d.month != first.month
                val on = d == picked
                val dw = d.dayOfWeek.value % 7                 // 0 일요일 … 6 토요일
                val hol = Recur.isHoliday(d)
                Box(
                    Modifier.weight(1f).padding(1.5.dp).height(32.dp).clip(RoundedCornerShape(9.dp))
                        .background(if (on) Ink.mid else Color.Transparent)
                        .then(if (d == today && !on) Modifier.border(1.5.dp, Ink.mint, RoundedCornerShape(10.dp)) else Modifier)
                        .tap { if (out) month = YearMonth.from(d); onPick(d) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${d.dayOfMonth}", style = MaterialTheme.typography.labelLarge,
                        color = when {
                            on -> Ink.onMid
                            out -> Ink.dim
                            hol || dw == 0 -> Ink.hol         // 진짜 달력처럼: 공휴일과 일요일은 빨강
                            dw == 6 -> Ink.midInk             // 토요일은 팔레트의 청록
                            else -> Ink.body
                        })
                    if (d.toString() in marks) Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 3.dp).size(4.dp)
                        .clip(RoundedCornerShape(2.dp)).background(if (on) Ink.onMid else Ink.mid))
                }
                cur = cur.plusDays(1)
            }
        }
    }
}

/** 할 일: the date only by the calendar, then what else is due that day. */
@Composable
private fun ColumnScope.DueDate(date: LocalDate, today: LocalDate, businessOnly: Boolean, others: List<Task>, set: (LocalDate) -> Unit) {
    Step("마감 날짜", null)
    val open = others.filter { it.kind == "deadline" && !it.done && it.dueDate != null }
    MiniCal(today, date, date, open.mapNotNull { it.dueDate }.toSet()) { set(it) }
    Spacer(Modifier.height(12.dp))
    Row(verticalAlignment = Alignment.Bottom) {
        Text("${date.monthValue}월 ${date.dayOfMonth}일 ${WDS[date.dayOfWeek.value - 1]}요일", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.width(10.dp))
        Text(dateLabel(date, today), style = MaterialTheme.typography.labelMedium, color = Ink.midInk)
    }
    if (businessOnly && !Recur.isBusinessDay(date)) {
        val alt = Recur.nextBusinessDay(date, forward = false)
        Spacer(Modifier.height(10.dp))
        Chip("이 날은 영업일이 아닙니다 · ${dateLabel(alt, today)}로 ›", false) { set(alt) }
    }
    val same = open.filter { it.dueDate == date.toString() }.sortedBy { it.dueTime.ifEmpty { "99:99" } }
    Step("같은 날 마감", if (same.isEmpty()) null else "${same.size}건")
    if (same.isEmpty()) Text("없음", style = MaterialTheme.typography.bodySmall)
    for (t in same.take(6)) Row(Modifier.padding(vertical = 6.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(t.dueTime.ifEmpty { "—" }, Modifier.width(48.dp), style = MaterialTheme.typography.bodySmall)
        Text(t.title, style = MaterialTheme.typography.labelLarge, color = Ink.body, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

// ---------------- "날짜 하나로 시작" ----------------

/**
 * The routine picker: an example date, a unit (and how many units apart), then one of the
 * ways that day can be read. The engine makes that last list (Recur.suggest), so every line
 * on screen is a rule that really runs on the day the person pointed at - and the words
 * basis · n · k never show up.
 *
 * The interval decides the months too: September + every three months is 3·6·9·12, October
 * is 1·4·7·10. Nothing else to choose.
 */
@Composable
private fun ColumnScope.RoutinePick(today: LocalDate, rule: Map<String, Any?>?, savedText: String, set: (Map<String, Any?>?) -> Unit) {
    val seat = remember { RulePick.unitOf(rule) }
    var date by remember { mutableStateOf(today) }
    var unit by remember { mutableStateOf(seat.first) }
    var every by remember { mutableStateOf(seat.second) }
    // 저장된 주 규칙은 요일이 여럿일 수 있다. 달력을 건드리기 전까지만 그대로 둔다
    val savedWds = remember { (rule?.get("weekdays") as? List<*>)?.map { (it as Number).toInt() }?.toSet() }
    var moved by remember { mutableStateOf(false) }
    var wds by remember { mutableStateOf(savedWds ?: setOf(today.dayOfWeek.value - 1)) }
    var text by remember { mutableStateOf(savedText) }

    val items = remember(date, unit, every) { if (unit == "week") emptyList() else Recur.suggest(date, unit, every) }
    val daily = unit == "day"

    // 달력은 접어 둔다. 휴대폰에서는 이것 하나가 화면 셋 중 하나를 차지했고,
    // 대개는 오늘 그대로 두고 아래 제안만 고른다.
    var calOpen by remember { mutableStateOf(false) }
    Step("기준 날짜", null)
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp))
            .then(if (daily) Modifier else Modifier.tap { calOpen = !calOpen })
            .padding(vertical = 5.dp).alpha(if (daily) .32f else 1f),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text("${date.monthValue}월 ${date.dayOfMonth}일 (${WDS[date.dayOfWeek.value - 1]})",
            style = MaterialTheme.typography.bodyLarge, color = Ink.ink2)
        Spacer(Modifier.width(8.dp))
        Text(if (calOpen) "▴ 접기" else "▾ 달력", style = MaterialTheme.typography.labelSmall, color = Ink.midInk)
    }
    if (calOpen && !daily) Column {
        MiniCal(today, date, date) { date = it; moved = true; wds = setOf(it.dayOfWeek.value - 1); text = "" }
    }
    Line("단위") {
        Seg(RulePick.UNITS, unit) { u ->
            // 달력에서 목요일을 짚고 단위를 "주" 로 바꾸면 목요일이 켜져 있어야 한다
            if (u == "week" && unit != "week") wds = (if (!moved) savedWds else null) ?: setOf(date.dayOfWeek.value - 1)
            unit = u; every = 1; text = ""
        }
    }
    RulePick.everyOpts(unit, every).takeIf { it.isNotEmpty() }?.let { opts ->
        Line("간격") { Seg(opts, every) { e -> every = e; text = "" } }
    }

    if (unit == "week") {
        Line("요일", wide = true) {
            FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                WDS.forEachIndexed { i, w ->
                    Chip(w, i in wds) { wds = if (i in wds) wds - i else wds + i }
                }
            }
        }
        val built = RulePick.weekRule(wds, every, date, rule?.get("holiday_shift") as? String)
        LaunchedEffect(built) { set(built) }
        Spacer(Modifier.height(12.dp))
        if (built == null) Text("요일을 하나 이상 고르세요", style = MaterialTheme.typography.bodySmall, color = Ink.danger)
        else {
            Text(Recur.describe(built), style = MaterialTheme.typography.labelLarge, color = Ink.ink2)
            Text(previewDates(built, today, 3).joinToString("  ·  "), style = MaterialTheme.typography.bodySmall, color = Ink.midInk)
        }
    } else {
        // The saved rule stays on the list even when nothing offered matches it (old quarter rules)
        val rows = items.map { it.first to it.second } +
            if (text.isNotEmpty() && items.none { it.first == text }) listOf(text to null) else emptyList()
        Line("규칙 제안", wide = true) {
            Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
                for ((label, r) in rows) {
                    val on = label == text || (text.isEmpty() && r != null && r == rule)
                    Column(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(11.dp))
                            .background(if (on) Ink.mid else Color.Transparent)
                            .tap { if (r != null) { set(r); text = label } }
                            .padding(horizontal = 12.dp, vertical = if (on) 8.dp else 6.dp),
                    ) {
                        Text(label, style = MaterialTheme.typography.labelLarge, color = if (on) Ink.onMid else Ink.body)
                        // 날짜는 고른 줄에만. 모든 줄에 적으면 목록이 두 배로 길어진다
                        if (on && !daily && r != null) Text(previewDates(r, date, 3).joinToString("  ·  "),
                            style = MaterialTheme.typography.bodySmall, color = Ink.onMid.copy(alpha = .82f))
                    }
                }
            }
        }
        // Pick the most common reading as soon as a new date or unit is in play
        LaunchedEffect(items) {
            if (items.isNotEmpty() && items.none { it.first == text } && (text.isEmpty() || rule == null)) {
                set(items[0].second)
                text = items[0].first
            }
        }
    }

    if (!daily && !RulePick.countsBusinessDays(rule)) Quiet(rule?.get("holiday_shift") as? String ?: "prev") { v ->
        rule?.let { set(it + ("holiday_shift" to v)) }
    }
}

/** "주말 · 공휴일에 걸리면 앞 영업일로 ▾": one small line, a menu on tap. Rarely touched. */
@Composable
private fun Quiet(shift: String, set: (String) -> Unit) {
    var open by remember { mutableStateOf(false) }
    Spacer(Modifier.height(14.dp))
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("주말 · 공휴일에 걸리면 ", style = MaterialTheme.typography.bodySmall)
        Box {
            Text((RulePick.SHIFTS.firstOrNull { it.first == shift }?.second ?: shift) + " ▾",
                Modifier.clip(RoundedCornerShape(8.dp)).tap { open = true }.padding(horizontal = 6.dp, vertical = 4.dp),
                style = MaterialTheme.typography.labelMedium, color = Ink.midInk)
            DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = Ink.card) {
                for ((v, label) in RulePick.SHIFTS) DropdownMenuItem(text = { Text(label) }, onClick = { open = false; set(v) })
            }
        }
    }
}

/** A section of the form: a thin rule, then the name. */
@Composable
private fun Step(text: String, note: String?) {
    Spacer(Modifier.height(14.dp))
    Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.rule2))
    Spacer(Modifier.height(8.dp))
    Row(verticalAlignment = Alignment.Bottom) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = Ink.muted)
        if (note != null) Text("  $note", style = MaterialTheme.typography.bodySmall)
    }
    Spacer(Modifier.height(6.dp))
}

/**
 * One line of the form. Short choices (단위 · 간격) sit beside their name, which saves a
 * whole row each; a wide one (요일 · 규칙 제안) goes underneath.
 */
@Composable
private fun Line(label: String, wide: Boolean = false, content: @Composable () -> Unit) {
    Spacer(Modifier.height(if (wide) 10.dp else 6.dp))
    if (wide) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = Ink.muted)
        Spacer(Modifier.height(6.dp))
        content()
    } else {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(label, Modifier.width(46.dp), style = MaterialTheme.typography.labelSmall, color = Ink.muted)
            content()
        }
    }
}
