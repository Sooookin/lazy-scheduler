package com.lazyscheduler.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.RuleCheck
import com.lazyscheduler.app.core.RuleForm
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.core.previewDates
import java.time.Instant
import java.time.LocalDate
import java.time.YearMonth
import java.time.ZoneOffset

/** The three kinds, called the same everywhere: 할 일 · 루틴 · 메모. */
internal val KIND_NAME = mapOf("deadline" to "할 일", "routine" to "루틴", "floating" to "메모")

/**
 * Add or edit one item, with the same choices as the PC form. The rule is checked by
 * RuleCheck before anything is written.
 *
 * onSave gets the editable fields in stored form (title, note, kind, due_date, due_time,
 * notify_min, muted, rule). Delete · skip · later close the sheet at once; the list shows
 * "되돌리기" for five seconds instead of asking first.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ItemEditor(
    existing: Task?,
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
    var rule by remember { mutableStateOf(if (existing?.rule != null) RuleForm.from(existing.rule) else RuleForm.fresh(today)) }
    var date by remember {
        mutableStateOf(existing?.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: if (businessOnly) Recur.nextBusinessDay(today.plusDays(1)) else today.plusDays(1))
    }
    var time by remember { mutableStateOf(existing?.dueTime ?: "") }
    var lead by remember { mutableStateOf(existing?.notifyMin) }
    var alarm by remember { mutableStateOf(!(existing?.muted ?: false)) }
    var error by remember { mutableStateOf<String?>(null) }
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }

    val builtRule = rule.toRule()
    val (checkedRule, ruleError) = if (kind == "routine") (rule.problem()?.let { null to it } ?: RuleCheck.validate(builtRule))
        else (null to null)

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
        Column(
            Modifier.padding(horizontal = 20.dp).padding(bottom = 28.dp).imePadding().verticalScroll(rememberScrollState()),
        ) {
            Text(if (editing) (KIND_NAME[kind] ?: "항목") + " 고치기" else "새 " + KIND_NAME[kind],
                style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(14.dp))
            if (!editing) {
                Seg(listOf("deadline" to "할 일", "routine" to "루틴", "floating" to "메모"), kind) { kind = it; error = null }
                Spacer(Modifier.height(14.dp))
            }
            InField(title, "이름") { if (it.length <= 200) title = it }
            Spacer(Modifier.height(10.dp))
            InField(note, "메모 (선택)") { if (it.length <= 2000) note = it }

            when (kind) {
                "routine" -> {
                    Step("날짜 하나로 시작", "그 일을 하는 날을 누르세요")
                    // A weekly suggestion carries its anchor (the picked date) inside the rule
                    StartFromDate(today) { picked -> rule = RuleForm.from(picked) }
                    Step("문장으로 확인 · 고치기", null)
                    Sentence(rule, businessOnly, today) { rule = it }
                    Preview(ruleError, builtRule, today)
                }
                "deadline" -> {
                    Step("언제까지", dateLabel(date, today))
                    val quick = listOf(0L, 1L, 2L, 7L, 30L).map { today.plusDays(it) }
                        .map { d -> (if (businessOnly) Recur.nextBusinessDay(d) else d) }.distinct()
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        for (d in quick) Chip(dateLabel(d, today), d == date) { date = d }
                        Chip("직접 고르기…", date !in quick) { pickDate = true }
                    }
                    if (businessOnly && !Recur.isBusinessDay(date)) {
                        val alt = Recur.nextBusinessDay(date, forward = false)
                        Spacer(Modifier.height(10.dp))
                        Chip("이 날은 영업일이 아닙니다 · ${dateLabel(alt, today)}로 ›", false) { date = alt }
                    }
                }
            }

            if (kind != "floating") {
                Step("언제 · 알림", null)
                Line("시각") {
                    Box(Modifier.inset(12.dp).clip(RoundedCornerShape(12.dp)).tap { pickTime = true }
                        .padding(horizontal = 16.dp, vertical = 12.dp)) {
                        Text(if (time.isEmpty()) "시각 없음" else timeLabel(time), style = MaterialTheme.typography.bodyLarge,
                            color = if (time.isEmpty()) Ink.faint else Ink.ink2)
                    }
                }
                Line("알림") {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Switch(checked = alarm, onCheckedChange = { alarm = it },
                            colors = SwitchDefaults.colors(checkedTrackColor = Ink.mid, checkedThumbColor = Ink.light,
                                uncheckedTrackColor = Ink.pale, uncheckedBorderColor = Ink.dark, uncheckedThumbColor = Ink.light))
                        Spacer(Modifier.width(10.dp))
                        Text("알림 받기", style = MaterialTheme.typography.labelLarge, color = Ink.muted)
                    }
                }
                val leads = mutableListOf<Pair<Int?, String>>(null to "기본 (${defaultLead}분)", 0 to "정각", 10 to "10분",
                    30 to "30분", 60 to "1시간", 1440 to "하루")
                lead?.let { l -> if (leads.none { it.first == l }) leads += l to "${l}분" }
                Spacer(Modifier.height(8.dp))
                Seg(leads, lead, enabled = alarm) { lead = it }
            }

            error?.let {
                Spacer(Modifier.height(12.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium, color = Ink.danger)
            }
            Spacer(Modifier.height(22.dp))
            FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp),
                itemVerticalAlignment = Alignment.CenterVertically) {
                if (editing) {
                    Ghost("삭제", Ink.danger) { onDelete() }
                    if (kind == "routine" && skipDate != null) Ghost("${dateLabel(skipDate, today)} 건너뛰기") { onSkip() }
                    if (kind == "deadline" && onLater != null) Ghost("↷ 내일로", Ink.midInk) { onLater() }
                }
            }
            Spacer(Modifier.height(12.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("취소", color = Ink.faint) }
                Spacer(Modifier.width(6.dp))
                Primary(if (editing) "저장" else "추가") { save() }
            }
        }
    }

    if (pickDate) {
        val state = rememberDatePickerState(initialSelectedDateMillis = date.atStartOfDay().toInstant(ZoneOffset.UTC).toEpochMilli())
        DatePickerDialog(
            onDismissRequest = { pickDate = false },
            confirmButton = {
                TextButton(onClick = {
                    state.selectedDateMillis?.let { date = Instant.ofEpochMilli(it).atZone(ZoneOffset.UTC).toLocalDate() }
                    pickDate = false
                }) { Text("확인", color = Ink.midInk) }
            },
            dismissButton = { TextButton(onClick = { pickDate = false }) { Text("취소", color = Ink.faint) } },
        ) { DatePicker(state = state) }
    }

    if (pickTime) TimeDialog(time, onDismiss = { pickTime = false }) { time = it; pickTime = false }
}

// ---------------- "날짜 하나로 시작" ----------------

/** A small month; a tapped date lists every rule that includes it (Recur.suggest, same as the PC). */
@Composable
private fun StartFromDate(today: LocalDate, onPick: (Map<String, Any?>) -> Unit) {
    var month by remember { mutableStateOf(YearMonth.from(today)) }
    var picked by remember { mutableStateOf<LocalDate?>(null) }
    var chosen by remember { mutableStateOf<String?>(null) }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("‹", Modifier.clip(RoundedCornerShape(10.dp)).tap { month = month.minusMonths(1) }.padding(horizontal = 14.dp, vertical = 6.dp),
            style = MaterialTheme.typography.titleMedium, color = Ink.muted)
        Text("${month.year}년 ${month.monthValue}월", Modifier.weight(1f), textAlign = TextAlign.Center,
            style = MaterialTheme.typography.labelLarge, color = Ink.ink2)
        Text("›", Modifier.clip(RoundedCornerShape(10.dp)).tap { month = month.plusMonths(1) }.padding(horizontal = 14.dp, vertical = 6.dp),
            style = MaterialTheme.typography.titleMedium, color = Ink.muted)
    }
    Row(Modifier.padding(top = 4.dp)) {
        for (w in WDS) Text(w, Modifier.weight(1f), textAlign = TextAlign.Center, style = MaterialTheme.typography.bodySmall)
    }
    val first = month.atDay(1)
    var cur = first.minusDays((first.dayOfWeek.value - 1).toLong())
    for (week in 0 until 6) {
        if (week == 5 && cur.month != first.month) break
        Row {
            for (k in 0..6) {
                val d = cur
                val out = d.month != first.month
                val on = d == picked
                val we = k > 4 || Recur.isHoliday(d)
                Box(
                    Modifier.weight(1f).padding(2.dp).height(38.dp).clip(RoundedCornerShape(10.dp))
                        .background(if (on) Ink.mid else androidx.compose.ui.graphics.Color.Transparent)
                        .then(if (d == today && !on) Modifier.border(1.5.dp, Ink.mint, RoundedCornerShape(10.dp)) else Modifier)
                        .tap { picked = d; chosen = null; if (out) month = YearMonth.from(d) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text("${d.dayOfMonth}", style = MaterialTheme.typography.labelLarge,
                        color = when { on -> Ink.onMid; out -> Ink.dim; we -> Ink.faint; else -> Ink.body })
                }
                cur = cur.plusDays(1)
            }
        }
    }
    val p = picked
    Spacer(Modifier.height(8.dp))
    if (p == null) {
        Text("날짜를 누르면 그 날에 맞는 규칙이 나옵니다. “매월 말일쯤 하는 그 일” 이라면 이번 달 말일을 누르세요.",
            style = MaterialTheme.typography.bodySmall)
    } else {
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            for ((text, r) in remember(p) { Recur.suggest(p) }) {
                Chip(text, text == chosen, Modifier.fillMaxWidth()) { chosen = text; onPick(r) }
            }
        }
    }
}

// ---------------- the sentence ----------------

@Composable
private fun Sentence(f: RuleForm, businessOnly: Boolean, today: LocalDate, set: (RuleForm) -> Unit) {
    val freqs = RuleForm.FREQS + if (f.quarter) listOf("quarter" to "매 분기") else emptyList()
    Line("얼마나 자주") {
        Seg(freqs, f.freq) { v ->
            set(when (v) {
                "week" -> f.copy(freq = v, weekdays = f.weekdays.ifEmpty { setOf(today.dayOfWeek.value - 1) },
                    anchor = f.anchor ?: today.toString())
                "year" -> f.copy(freq = v, ymonth = today.monthValue)
                else -> f.copy(freq = v)
            })
        }
    }
    when (f.freq) {
        "day" -> Line("세는 방법") {
            Seg(listOf(false to "달력 날 (날마다)", true to "영업일만"), f.biz) { set(f.copy(biz = it)) }
        }
        "week" -> {
            Line("요일") {
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    WDS.forEachIndexed { i, w ->
                        // Weekends are hidden when working on business days only, unless already chosen.
                        if (businessOnly && i > 4 && i !in f.weekdays) return@forEachIndexed
                        Chip(w, i in f.weekdays) { set(f.copy(weekdays = if (i in f.weekdays) f.weekdays - i else f.weekdays + i)) }
                    }
                }
            }
            Line("간격") { Seg(listOf(1 to "매주", 2 to "격주", 3 to "3주마다", 4 to "4주마다"), f.interval) { set(f.copy(interval = it)) } }
            Line("주말 · 공휴일에 걸리면") { Seg(RuleForm.SHIFTS, f.shift) { set(f.copy(shift = it)) } }
        }
        else -> {
            if (f.freq == "year") Line("달") {
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (m in 1..12) Chip("${m}월", m == f.ymonth) { set(f.copy(ymonth = m)) }
                }
            }
            Line("틀") { Seg(RuleForm.FRAMES, f.frame) { set(f.copy(frame = it)) } }
            Line("언제") {
                when (f.frame) {
                    "weekday" -> Column {
                        Seg(listOf(1 to "첫째", 2 to "둘째", 3 to "셋째", 4 to "넷째", -1 to "마지막"), f.wn) { set(f.copy(wn = it)) }
                        Spacer(Modifier.height(8.dp))
                        Seg(WDS.mapIndexed { i, w -> i to w }, f.weekday) { set(f.copy(weekday = it)) }
                    }
                    "end" -> Stepper(f.k, 0, if (f.quarter) 60 else 27,
                        { k -> if (k == 0) (if (f.quarter) "분기 마지막 날" else "말일 당일") else (if (f.quarter) "분기말 " else "말일 ") + k + (if (f.biz) "영업일 전" else "일 전") }) {
                        set(f.copy(k = it))
                    }
                    else -> NumberGrid(f.nTop, f.n, lastLabel = if (f.biz) "마지막" else (if (f.quarter) "끝날" else "말일"),
                        suffix = if (f.biz) "번째 영업일" else (if (f.quarter) "일째" else "일")) { set(f.copy(n = it)) }
                }
            }
            if (f.frame != "weekday") Line("세는 방법") {
                Seg(listOf(false to "달력 날", true to "영업일"), f.biz) { b -> set(f.copy(biz = b, n = if (f.n > (if (b) 23 else 31)) -1 else f.n)) }
            }
            Line("주말 · 공휴일에 걸리면", if (f.shiftMatters) null else "영업일로 세면 걸리지 않음") {
                Seg(RuleForm.SHIFTS, f.shift, enabled = f.shiftMatters) { set(f.copy(shift = it)) }
            }
            if (f.freq == "month") Line("실행하는 달") {
                Column {
                    Seg(RuleForm.MONTH_SETS.map { it.first to it.second }, f.mset) { v ->
                        set(f.copy(mset = v, months = if (v == "custom" && f.months.isEmpty()) listOf(today.monthValue) else f.months))
                    }
                    if (f.mset == "custom") {
                        Spacer(Modifier.height(8.dp))
                        FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                            for (m in 1..12) Chip("${m}월", m in f.months) {
                                set(f.copy(months = if (m in f.months) f.months - m else (f.months + m).sorted()))
                            }
                        }
                    }
                }
            }
        }
    }
}

/** 1..top in a compact grid plus "last": every day is one tap (no scrolling list). */
@Composable
private fun NumberGrid(top: Int, value: Int, lastLabel: String, suffix: String, set: (Int) -> Unit) {
    Column {
        Text(if (value == -1) lastLabel else "$value$suffix", style = MaterialTheme.typography.labelLarge, color = Ink.ink2)
        Spacer(Modifier.height(6.dp))
        val cells = (1..minOf(top, 31)).toList() + listOf(-1)
        for (row in cells.chunked(7)) Row {
            for (v in row) {
                val on = v == value
                Box(
                    Modifier.weight(1f).padding(2.dp).height(34.dp).clip(RoundedCornerShape(9.dp))
                        .background(if (on) Ink.mid else Ink.pale.copy(alpha = .55f)).tap { set(v) },
                    contentAlignment = Alignment.Center,
                ) {
                    Text(if (v == -1) lastLabel else "$v", style = MaterialTheme.typography.labelMedium,
                        color = if (on) Ink.onMid else Ink.body)
                }
            }
            repeat(7 - row.size) { Spacer(Modifier.weight(1f)) }
        }
        if (top > 31) Text("그보다 뒤는 PC 에서 고르세요", style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
private fun Stepper(value: Int, lo: Int, hi: Int, label: (Int) -> String, set: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        StepButton("−", value > lo) { set(value - 1) }
        Text(label(value), Modifier.padding(horizontal = 14.dp), style = MaterialTheme.typography.labelLarge, color = Ink.ink2)
        StepButton("+", value < hi) { set(value + 1) }
    }
}

@Composable
private fun StepButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(40.dp).raised(20.dp, 2.dp).clip(RoundedCornerShape(20.dp)).tap { if (enabled) onClick() }.alpha(if (enabled) 1f else .4f),
        contentAlignment = Alignment.Center,
    ) { Text(label, style = MaterialTheme.typography.titleMedium, color = Ink.ink2) }
}

@Composable
private fun Preview(error: String?, rule: Map<String, Any?>, today: LocalDate) {
    Spacer(Modifier.height(14.dp))
    Column(Modifier.fillMaxWidth().inset(12.dp).padding(14.dp)) {
        if (error != null) {
            Text("다음 실행 날짜", style = MaterialTheme.typography.labelMedium, color = Ink.muted)
            Text(error, style = MaterialTheme.typography.bodyMedium, color = Ink.danger)
        } else {
            Text(Recur.describe(rule), style = MaterialTheme.typography.labelLarge, color = Ink.ink2)
            Spacer(Modifier.height(4.dp))
            Text(previewDates(rule, today).ifEmpty { listOf("해당 날짜 없음") }.joinToString("  ·  "),
                style = MaterialTheme.typography.bodyMedium, color = Ink.midInk)
        }
    }
}

/** A section of the form: a thin rule, then the name. */
@Composable
private fun Step(text: String, note: String?) {
    Spacer(Modifier.height(18.dp))
    Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.rule2))
    Spacer(Modifier.height(12.dp))
    Row(verticalAlignment = Alignment.Bottom) {
        Text(text, style = MaterialTheme.typography.labelMedium, color = Ink.muted)
        if (note != null) Text("  $note", style = MaterialTheme.typography.bodySmall)
    }
    Spacer(Modifier.height(8.dp))
}

/** One piece of the sentence: a small label over its choices. */
@Composable
private fun Line(label: String, note: String? = null, content: @Composable () -> Unit) {
    Spacer(Modifier.height(10.dp))
    Row(verticalAlignment = Alignment.Bottom) {
        Text(label, style = MaterialTheme.typography.labelSmall, color = Ink.muted)
        if (note != null) Text("  $note", style = MaterialTheme.typography.bodySmall)
    }
    Spacer(Modifier.height(6.dp))
    content()
}
