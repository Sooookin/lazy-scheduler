package com.lazyscheduler.app.ui

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.RuleCheck
import com.lazyscheduler.app.core.RuleForm
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.core.previewDates
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneOffset

private val WDS = listOf("월", "화", "수", "목", "금", "토", "일")
private val Danger = Color(0xFF9A3B2E)

/**
 * Add or edit one item. The same choices as the PC form; the rule is checked by
 * RuleCheck before anything is written.
 *
 * onSave gets the editable fields in stored form (title, note, kind, due_date, due_time,
 * notify_min, muted, rule).
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
) {
    val editing = existing != null
    var title by remember { mutableStateOf(existing?.title ?: "") }
    var note by remember { mutableStateOf(existing?.note ?: "") }
    var kind by remember { mutableStateOf(existing?.kind ?: "routine") }
    var rule by remember { mutableStateOf(RuleForm.from(existing?.rule)) }
    var date by remember {
        mutableStateOf(existing?.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
            ?: if (businessOnly) Recur.nextBusinessDay(today) else today)
    }
    var time by remember { mutableStateOf(existing?.dueTime ?: "") }
    var lead by remember { mutableStateOf(existing?.notifyMin) }
    var muted by remember { mutableStateOf(existing?.muted ?: false) }
    var error by remember { mutableStateOf<String?>(null) }
    var confirmDelete by remember { mutableStateOf(false) }
    var pickDate by remember { mutableStateOf(false) }
    var pickTime by remember { mutableStateOf(false) }

    val builtRule = rule.toRule()
    val (checkedRule, ruleError) = if (kind == "routine") RuleCheck.validate(builtRule) else (null to null)

    fun save() {
        val t = title.trim()
        if (t.isEmpty()) { error = "이름을 입력하세요"; return }
        if (kind == "routine" && ruleError != null) { error = ruleError; return }
        val fields = linkedMapOf<String, Any?>("title" to t.take(200), "note" to note.trim().take(2000), "kind" to kind)
        when (kind) {
            "routine" -> fields += mapOf("rule" to checkedRule, "due_date" to null, "due_time" to time,
                "notify_min" to lead, "muted" to muted)
            "deadline" -> fields += mapOf("rule" to null, "due_date" to date.toString(), "due_time" to time,
                "notify_min" to lead, "muted" to muted)
            else -> fields += mapOf("rule" to null, "due_date" to null, "due_time" to "", "notify_min" to null, "muted" to false)
        }
        onSave(fields)
    }

    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ink.light,
        sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)) {
        Column(
            Modifier.padding(horizontal = 22.dp).padding(bottom = 28.dp).imePadding().verticalScroll(rememberScrollState()),
        ) {
            Text(if (editing) "항목 수정 · " + (mapOf("routine" to "반복", "deadline" to "마감", "floating" to "메모")[kind] ?: "")
                else "새 항목", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(14.dp))
            if (!editing) {
                Choice(listOf("routine" to "반복되는 일", "deadline" to "마감이 있는 일", "floating" to "기한 없는 메모"), kind) { kind = it }
                Spacer(Modifier.height(14.dp))
            }
            Field(title, "이름") { if (it.length <= 200) title = it }
            Spacer(Modifier.height(8.dp))
            Field(note, "메모 (선택)") { if (it.length <= 2000) note = it }

            when (kind) {
                "routine" -> {
                    Step("얼마나 자주")
                    Choice(RuleForm.PERIODS, rule.period) { p ->
                        rule = rule.copy(period = p,
                            anchor = if (p == "week") rule.anchor ?: existingAnchor(existing, today) else rule.anchor)
                    }
                    RuleDetail(rule, businessOnly) { rule = it }
                    Preview(ruleError, builtRule, today)
                }
                "deadline" -> {
                    Step("언제까지 · ${dateLabel(date, today)}")
                    val quick = listOf(0L, 1L, 2L, 7L, 30L).map { today.plusDays(it) }
                        .map { d -> (if (businessOnly) Recur.nextBusinessDay(d) else d) }.distinct()
                    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                        for (d in quick) Chip(dateLabel(d, today), d == date) { date = d }
                        Chip("직접 고르기…", date !in quick) { pickDate = true }
                    }
                    if (businessOnly && !Recur.isBusinessDay(date)) {
                        val alt = Recur.nextBusinessDay(date, forward = false)
                        Spacer(Modifier.height(8.dp))
                        Note("이 날은 영업일이 아닙니다 · ${dateLabel(alt, today)}로 옮기기") { date = alt }
                    }
                }
            }

            if (kind != "floating") {
                Step("언제 알릴까")
                val times = listOf("" to "시각 없음", "09:00" to "09:00", "12:00" to "12:00", "15:00" to "15:00", "18:00" to "18:00")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((v, l) in times) Chip(l, v == time) { time = v }
                    Chip(if (time.isNotEmpty() && times.none { it.first == time }) time else "직접…",
                        time.isNotEmpty() && times.none { it.first == time }) { pickTime = true }
                }
                Spacer(Modifier.height(10.dp))
                val leads = listOf(null to "기본 (${defaultLead}분 전)", 10 to "10분 전", 30 to "30분 전", 60 to "1시간 전", 1440 to "하루 전")
                FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    for ((v, l) in leads) Chip(l, v == lead) { lead = v }
                }
                Spacer(Modifier.height(10.dp))
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("이 항목은 알림 띄우지 않기", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = Ink.muted)
                    Switch(checked = muted, onCheckedChange = { muted = it },
                        colors = SwitchDefaults.colors(checkedTrackColor = Ink.mid, checkedThumbColor = Ink.onMid))
                }
            }

            error?.let {
                Spacer(Modifier.height(10.dp))
                Text(it, style = MaterialTheme.typography.bodyMedium, color = Danger)
            }
            Spacer(Modifier.height(20.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (editing) {
                    TextButton(onClick = { confirmDelete = true }) { Text("삭제", color = Danger) }
                    if (kind == "routine" && skipDate != null)
                        TextButton(onClick = onSkip) { Text("${dateLabel(skipDate, today)} 회차 건너뛰기", color = Ink.midInk) }
                }
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss) { Text("취소", color = Ink.faint) }
                Spacer(Modifier.width(4.dp))
                Box(
                    Modifier.clip(RoundedCornerShape(20.dp)).background(Ink.mid)
                        .combinedClickableCompat { save() }.padding(horizontal = 22.dp, vertical = 11.dp),
                ) { Text(if (editing) "저장" else "추가", style = MaterialTheme.typography.labelLarge, color = Ink.onMid) }
            }
        }
    }

    if (confirmDelete) AlertDialog(
        onDismissRequest = { confirmDelete = false }, containerColor = Ink.light,
        title = { Text("삭제할까요?", style = MaterialTheme.typography.titleMedium) },
        text = {
            Text("「${existing?.title}」" + if (kind == "routine") " 반복 일정 전체가 사라집니다. 이번 회차만 빼려면 건너뛰기를 쓰세요." else " 항목을 삭제합니다.",
                style = MaterialTheme.typography.bodyMedium)
        },
        confirmButton = { TextButton(onClick = { confirmDelete = false; onDelete() }) { Text("삭제", color = Danger) } },
        dismissButton = { TextButton(onClick = { confirmDelete = false }) { Text("취소", color = Ink.faint) } },
    )

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

    if (pickTime) {
        val (h, m) = time.split(":").let { (it.getOrNull(0)?.toIntOrNull() ?: 9) to (it.getOrNull(1)?.toIntOrNull() ?: 0) }
        val state = rememberTimePickerState(initialHour = h, initialMinute = m, is24Hour = true)
        AlertDialog(
            onDismissRequest = { pickTime = false }, containerColor = Ink.light,
            text = { TimePicker(state = state) },
            confirmButton = {
                TextButton(onClick = {
                    // 5-minute steps, like the PC form
                    val mm = ((state.minute + 2) / 5 * 5).coerceAtMost(55)
                    time = "%02d:%02d".format(state.hour, mm)
                    pickTime = false
                }) { Text("확인", color = Ink.midInk) }
            },
            dismissButton = { TextButton(onClick = { pickTime = false }) { Text("취소", color = Ink.faint) } },
        )
    }
}

private fun existingAnchor(existing: Task?, today: LocalDate): String =
    (existing?.rule?.get("anchor") as? String) ?: existing?.created?.take(10) ?: today.toString()

@Composable
private fun RuleDetail(f: RuleForm, businessOnly: Boolean, set: (RuleForm) -> Unit) {
    val flow = Arrangement.spacedBy(6.dp)
    when (f.period) {
        "day" -> {
            Spacer(Modifier.height(10.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("주말·공휴일 제외", Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = Ink.muted)
                Switch(checked = f.businessOnly, onCheckedChange = { set(f.copy(businessOnly = it)) },
                    colors = SwitchDefaults.colors(checkedTrackColor = Ink.mid, checkedThumbColor = Ink.onMid))
            }
        }
        "week" -> {
            Step("어느 요일 · 주기")
            FlowRow(horizontalArrangement = flow, verticalArrangement = flow) {
                WDS.forEachIndexed { i, w ->
                    // Weekends are hidden when working on business days only, unless already chosen.
                    if (businessOnly && i > 4 && i !in f.weekdays) return@forEachIndexed
                    Chip(w, i in f.weekdays) { set(f.copy(weekdays = if (i in f.weekdays) f.weekdays - i else f.weekdays + i)) }
                }
            }
            Spacer(Modifier.height(8.dp))
            Choice(listOf(1 to "매주", 2 to "격주", 3 to "3주마다", 4 to "4주마다").map { it.first.toString() to it.second },
                f.interval.toString()) { set(f.copy(interval = it.toInt())) }
        }
        else -> {
            Step(if (f.quarter) "어느 날" else "어느 날 · 실행하는 달")
            FlowRow(horizontalArrangement = flow, verticalArrangement = flow) {
                for ((key, monthly, quarterly) in RuleForm.BASES) Chip(if (f.quarter) quarterly else monthly, key == f.basisKey) {
                    set(f.copy(basisKey = key))
                }
            }
            Spacer(Modifier.height(10.dp))
            when (f.basisKey) {
                "bd_n" -> Stepper("번째 영업일", f.n, 1, if (f.quarter) 66 else 23) { set(f.copy(n = it)) }
                "day_n" -> Stepper(if (f.quarter) "일째" else "일", f.n, 1, if (f.quarter) 92 else 31) { set(f.copy(n = it)) }
                "be_k" -> Stepper("일 전", f.k, 0, if (f.quarter) 60 else 27) { set(f.copy(k = it)) }
                "bebd_k" -> Stepper("영업일 전", f.k, 0, if (f.quarter) 60 else 27) { set(f.copy(k = it)) }
                "wd_n", "wd_last" -> {
                    if (f.basisKey == "wd_n") {
                        Choice(listOf("1" to "첫째", "2" to "둘째", "3" to "셋째", "4" to "넷째"),
                            f.n.coerceIn(1, 5).toString()) { set(f.copy(n = it.toInt())) }
                        Spacer(Modifier.height(8.dp))
                    }
                    FlowRow(horizontalArrangement = flow, verticalArrangement = flow) {
                        WDS.forEachIndexed { i, w ->
                            if (businessOnly && i > 4 && i != f.weekday) return@forEachIndexed
                            Chip(w + "요일", i == f.weekday) { set(f.copy(weekday = i)) }
                        }
                    }
                }
            }
            if (!f.quarter) {
                Spacer(Modifier.height(10.dp))
                val custom = f.months != null && RuleForm.MONTH_SETS.none { it.second == f.months }
                FlowRow(horizontalArrangement = flow, verticalArrangement = flow) {
                    for ((label, set0) in RuleForm.MONTH_SETS) Chip(label, set0 == f.months) { set(f.copy(months = set0)) }
                    if (custom) Chip(f.months.joinToString("·") + "월", true) {}
                }
            }
        }
    }
}

@Composable
private fun Preview(error: String?, rule: Map<String, Any?>, today: LocalDate) {
    Spacer(Modifier.height(12.dp))
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Ink.pale).padding(14.dp)) {
        if (error != null) {
            Text("다음 실행 날짜", style = MaterialTheme.typography.labelMedium, color = Ink.muted)
            Text(error, style = MaterialTheme.typography.bodyMedium, color = Danger)
        } else {
            Text(Recur.describe(rule), style = MaterialTheme.typography.labelLarge, color = Ink.ink2)
            Spacer(Modifier.height(4.dp))
            Text(previewDates(rule, today).ifEmpty { listOf("해당 날짜 없음") }.joinToString("  ·  "),
                style = MaterialTheme.typography.bodyMedium, color = Ink.midInk)
        }
    }
}

@Composable
private fun Stepper(suffix: String, value: Int, lo: Int, hi: Int, set: (Int) -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        StepButton("−", value > lo) { set(value - 1) }
        Text("$value$suffix", Modifier.padding(horizontal = 14.dp), style = MaterialTheme.typography.labelLarge, color = Ink.ink2)
        StepButton("+", value < hi) { set(value + 1) }
    }
}

@Composable
private fun StepButton(label: String, enabled: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.size(38.dp).clip(RoundedCornerShape(19.dp)).background(if (enabled) Ink.pale else Ink.bg)
            .combinedClickableCompat { if (enabled) onClick() },
        contentAlignment = Alignment.Center,
    ) { Text(label, style = MaterialTheme.typography.titleMedium, color = if (enabled) Ink.ink2 else Ink.dim) }
}

@Composable
private fun Field(value: String, label: String, onChange: (String) -> Unit) {
    OutlinedTextField(
        value = value, onValueChange = onChange, label = { Text(label) }, singleLine = true, modifier = Modifier.fillMaxWidth(),
        colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Ink.mid, focusedLabelColor = Ink.midInk, cursorColor = Ink.mid),
    )
}

@Composable
private fun Step(text: String) {
    Spacer(Modifier.height(18.dp))
    Text(text, style = MaterialTheme.typography.labelMedium, color = Ink.muted)
    Spacer(Modifier.height(8.dp))
}

@Composable
private fun Note(text: String, onClick: () -> Unit) {
    Box(Modifier.clip(RoundedCornerShape(10.dp)).background(Ink.pale).combinedClickableCompat(onClick).padding(horizontal = 12.dp, vertical = 8.dp)) {
        Text("$text ›", style = MaterialTheme.typography.labelMedium, color = Ink.midInk)
    }
}

@Composable
private fun Choice(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    FlowRow(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((value, label) in options) Chip(label, value == selected) { onPick(value) }
    }
}

@Composable
internal fun Chip(label: String, on: Boolean, onClick: () -> Unit) {
    Box(
        Modifier.clip(RoundedCornerShape(14.dp)).background(if (on) Ink.mid else Ink.pale)
            .combinedClickableCompat(onClick).padding(horizontal = 12.dp, vertical = 8.dp),
    ) { Text(label, style = MaterialTheme.typography.labelMedium, color = if (on) Ink.onMid else Ink.muted) }
}

@OptIn(ExperimentalFoundationApi::class)
internal fun Modifier.combinedClickableCompat(onClick: () -> Unit): Modifier = this.combinedClickable(onClick = onClick)

internal fun dateLabel(d: LocalDate, today: LocalDate): String {
    val diff = java.time.temporal.ChronoUnit.DAYS.between(today, d)
    return when {
        diff == 0L -> "오늘"
        diff == 1L -> "내일"
        diff == 2L -> "모레"
        diff == -1L -> "어제"
        diff < 0 -> "${-diff}일 지남"
        else -> "${d.monthValue}/${d.dayOfMonth} (${WDS[d.dayOfWeek.value - 1]})"
    }
}
