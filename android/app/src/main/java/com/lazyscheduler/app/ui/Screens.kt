package com.lazyscheduler.app.ui

import android.app.Activity
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
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
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.google.firebase.auth.FirebaseUser
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Plan
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.data.Cloud
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime

private val WD = listOf("월", "화", "수", "목", "금", "토", "일")

private fun dayLabel(d: LocalDate, today: LocalDate): String {
    val diff = java.time.temporal.ChronoUnit.DAYS.between(today, d)
    return when {
        diff == 0L -> "오늘"
        diff == 1L -> "내일"
        diff == 2L -> "모레"
        diff == -1L -> "어제"
        diff < 0 -> "${-diff}일 지남"
        else -> "${d.monthValue}/${d.dayOfMonth} (${WD[d.dayOfWeek.value - 1]})"
    }
}

@Composable
fun App() {
    if (!Cloud.configured) {
        Message("Firebase 설정이 없습니다", "android/firebase.local.properties 의 app_id 를 채운 뒤 다시 빌드하세요.")
        return
    }
    val user by remember { Cloud.userFlow() }.collectAsState(initial = Cloud.user())
    val u = user
    if (u == null) SignIn() else Home(u)
}

@Composable
private fun Message(title: String, body: String) {
    Column(Modifier.fillMaxSize().background(Ink.bg).padding(32.dp), verticalArrangement = Arrangement.Center) {
        Text(title, style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(body, style = androidx.compose.material3.MaterialTheme.typography.bodyMedium)
    }
}

// ---------------- sign-in ----------------

@Composable
private fun SignIn() {
    val activity = LocalContext.current as Activity
    val scope = rememberCoroutineScope()
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    Column(
        Modifier.fillMaxSize().background(Ink.bg).statusBarsPadding().padding(horizontal = 32.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("LazyScheduler", style = androidx.compose.material3.MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(10.dp))
        Text("PC 와 같은 Google 계정으로 로그인하면\n일정이 그대로 이어집니다.",
            style = androidx.compose.material3.MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(28.dp))
        Pill(if (busy) "로그인하는 중…" else "Google 계정으로 로그인", primary = true, enabled = !busy) {
            busy = true
            error = null
            scope.launch {
                error = Cloud.signIn(activity)
                busy = false
            }
        }
        error?.let {
            Spacer(Modifier.height(14.dp))
            Text(it, style = androidx.compose.material3.MaterialTheme.typography.bodyMedium, color = Color(0xFF9A3B2E))
        }
    }
}

// ---------------- home ----------------

private enum class Tab(val label: String) { TODAY("오늘"), UPCOMING("예정"), ROUTINES("반복"), MEMOS("메모") }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun Home(user: FirebaseUser) {
    val uid = user.uid
    val tasks by remember(uid) { Cloud.tasksFlow(uid) }.collectAsState(initial = null)
    val settings by remember(uid) { Cloud.settingsFlow(uid) }.collectAsState(initial = emptyMap())
    val context = LocalContext.current

    // The list depends on the clock ("지남", "임박", today's date): tick every 30 s.
    var now by remember { mutableStateOf(LocalTime.now()) }
    var today by remember { mutableStateOf(LocalDate.now()) }
    LaunchedEffect(Unit) {
        while (true) {
            delay(30_000)
            now = LocalTime.now()
            today = LocalDate.now()
        }
    }
    @Suppress("UNCHECKED_CAST")
    val extraHolidays = (settings["holidays"] as? List<String>)

    var tab by remember { mutableStateOf(Tab.TODAY) }
    var adding by remember { mutableStateOf(false) }
    var menuFor by remember { mutableStateOf<Instance?>(null) }
    var routineMenu by remember { mutableStateOf<Task?>(null) }
    var account by remember { mutableStateOf(false) }

    val loaded = tasks
    // Holidays first, in the same step: the business-day dates below depend on them.
    val o = remember(loaded, today, extraHolidays) {
        Recur.setHolidays(extraHolidays)
        loaded?.let { Plan.overview(it, today) }
    }

    Scaffold(
        containerColor = Ink.bg,
        floatingActionButton = {
            Pill("＋  새 항목", primary = true, modifier = Modifier.navigationBarsPadding()) { adding = true }
        },
    ) { pad ->
        Column(Modifier.fillMaxSize().padding(pad).statusBarsPadding()) {
            // header
            Row(Modifier.fillMaxWidth().padding(start = 22.dp, end = 12.dp, top = 18.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${today.monthValue}월 ${today.dayOfMonth}일 ${WD[today.dayOfWeek.value - 1]}요일",
                        style = androidx.compose.material3.MaterialTheme.typography.headlineMedium)
                    Text(
                        when {
                            o == null -> "불러오는 중…"
                            o.left > 0 -> "남은 일 ${o.left}건"
                            else -> "오늘 할 일을 다 했습니다"
                        },
                        style = androidx.compose.material3.MaterialTheme.typography.bodyMedium,
                        color = if ((o?.left ?: 0) > 0) Ink.midInk else Ink.faint,
                    )
                }
                Box {
                    TextButton(onClick = { account = true }) {
                        Text("⋯", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
                    }
                    DropdownMenu(expanded = account, onDismissRequest = { account = false }) {
                        DropdownMenuItem(text = { Text(user.email ?: "로그인됨") }, onClick = {}, enabled = false)
                        DropdownMenuItem(text = { Text("로그아웃") }, onClick = { account = false; Cloud.signOut(context) })
                    }
                }
            }
            Spacer(Modifier.height(14.dp))
            // tabs
            Row(
                Modifier.padding(horizontal = 18.dp).clip(RoundedCornerShape(12.dp)).background(Ink.pale).padding(3.dp),
            ) {
                for (t in Tab.entries) {
                    val count = when (t) {
                        Tab.TODAY -> (o?.overdue?.size ?: 0) + (o?.todays?.size ?: 0)
                        Tab.UPCOMING -> o?.upcoming?.size ?: 0
                        Tab.ROUTINES -> o?.routines?.size ?: 0
                        Tab.MEMOS -> o?.floating?.size ?: 0
                    }
                    val on = t == tab
                    Box(
                        Modifier.weight(1f).clip(RoundedCornerShape(9.dp))
                            .background(if (on) Ink.light else Color.Transparent)
                            .combinedClickable(onClick = { tab = t })
                            .padding(vertical = 9.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("${t.label} $count", style = androidx.compose.material3.MaterialTheme.typography.labelMedium,
                            color = if (on) Ink.ink2 else Ink.faint)
                    }
                }
            }
            Spacer(Modifier.height(8.dp))

            if (o == null) {
                Message("불러오는 중…", "처음에는 서버에서 받아 오느라 조금 걸립니다.")
                return@Column
            }
            val rows: List<Instance> = when (tab) {
                Tab.TODAY -> (o.overdue + o.todays).sortedWith(compareBy({ it.done }, { it.date ?: LocalDate.MAX }, { it.time.ifEmpty { "99:99" } }))
                Tab.UPCOMING -> o.upcoming
                Tab.MEMOS -> o.floating
                Tab.ROUTINES -> emptyList()
            }
            LazyColumn(contentPadding = PaddingValues(start = 18.dp, end = 18.dp, bottom = 96.dp)) {
                if (tab == Tab.ROUTINES) {
                    if (o.routines.isEmpty()) item { Empty("반복 업무가 없습니다", "반복 업무는 지금은 PC 에서 추가합니다.") }
                    items(o.routines, key = { it.first.id }) { (task, next) ->
                        RoutineRow(task, next, today) { routineMenu = task }
                    }
                } else {
                    if (rows.isEmpty()) item {
                        when (tab) {
                            Tab.TODAY -> Empty("오늘 할 일이 없습니다", o.upcoming.firstOrNull()?.let {
                                "다음 마감은 ${dayLabel(it.date!!, today)} · ${it.task.title}"
                            } ?: "다가오는 7일에도 마감이 없습니다.")
                            Tab.UPCOMING -> Empty("앞으로 7일, 마감 없음", "")
                            else -> Empty("메모가 없습니다", "＋ 새 항목 → 메모")
                        }
                    }
                    items(rows, key = { it.task.id + "@" + it.date }) { i ->
                        ItemRow(i, today, now, showDate = tab == Tab.UPCOMING,
                            onTap = { Cloud.setDone(uid, i, !i.done) },
                            onLong = { menuFor = i })
                    }
                }
            }
        }
    }

    menuFor?.let { i ->
        AlertDialog(
            onDismissRequest = { menuFor = null },
            containerColor = Ink.light,
            title = { Text(i.task.title, style = androidx.compose.material3.MaterialTheme.typography.titleMedium) },
            text = {
                Text(if (i.kind == "routine") "이 회차만 건너뛰거나, 반복 업무 전체를 삭제할 수 있습니다." else "이 항목을 삭제할까요?",
                    style = androidx.compose.material3.MaterialTheme.typography.bodyMedium)
            },
            confirmButton = {
                TextButton(onClick = { Cloud.delete(uid, i.task); menuFor = null }) { Text("삭제", color = Color(0xFF9A3B2E)) }
            },
            dismissButton = {
                Row {
                    if (i.kind == "routine" && i.date != null)
                        TextButton(onClick = { Cloud.skip(uid, i); menuFor = null }) { Text("이번 회차 건너뛰기", color = Ink.midInk) }
                    TextButton(onClick = { menuFor = null }) { Text("취소", color = Ink.faint) }
                }
            },
        )
    }
    routineMenu?.let { t ->
        AlertDialog(
            onDismissRequest = { routineMenu = null },
            containerColor = Ink.light,
            title = { Text(t.title, style = androidx.compose.material3.MaterialTheme.typography.titleMedium) },
            text = { Text(t.ruleText + (if (t.dueTime.isNotEmpty()) " · ${t.dueTime}" else ""),
                style = androidx.compose.material3.MaterialTheme.typography.bodyMedium) },
            confirmButton = {
                TextButton(onClick = { Cloud.delete(uid, t); routineMenu = null }) { Text("반복 업무 삭제", color = Color(0xFF9A3B2E)) }
            },
            dismissButton = { TextButton(onClick = { routineMenu = null }) { Text("닫기", color = Ink.faint) } },
        )
    }
    if (adding) AddSheet(today, onDismiss = { adding = false }) { title, kind, date, time ->
        Cloud.add(uid, title, kind, date, time)
        adding = false
    }
}

@Composable
private fun Empty(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = androidx.compose.material3.MaterialTheme.typography.titleMedium, color = Ink.muted)
        if (body.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(body, style = androidx.compose.material3.MaterialTheme.typography.bodyMedium)
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ItemRow(i: Instance, today: LocalDate, now: LocalTime, showDate: Boolean, onTap: () -> Unit, onLong: () -> Unit) {
    val barColor = when (i.kind) { "routine" -> Ink.mint; "floating" -> Ink.dark; else -> Ink.mid }
    Column {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp))
                .combinedClickable(onClick = onTap, onLongClick = onLong)
                .padding(vertical = 14.dp, horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Box(Modifier.width(3.dp).height(22.dp).clip(RoundedCornerShape(2.dp)).background(barColor))
            Spacer(Modifier.width(12.dp))
            Box(
                Modifier.size(22.dp).clip(CircleShape)
                    .background(if (i.done) Ink.mid else Color.Transparent)
                    .border(1.5.dp, if (i.done) Ink.mid else Ink.dark, CircleShape),
                contentAlignment = Alignment.Center,
            ) {
                if (i.done) Text("✓", color = Ink.onMid, style = androidx.compose.material3.MaterialTheme.typography.labelSmall)
            }
            Spacer(Modifier.width(12.dp))
            Text(
                i.task.title,
                modifier = Modifier.weight(1f),
                style = androidx.compose.material3.MaterialTheme.typography.bodyLarge,
                color = if (i.done) Ink.dim else Ink.body,
                textDecoration = if (i.done) TextDecoration.LineThrough else null,
                maxLines = 2, overflow = TextOverflow.Ellipsis,
            )
            Spacer(Modifier.width(8.dp))
            if (i.kind == "routine") Tag("반복")
            when (Plan.urgency(i, today, now)) {
                "late" -> Badge(if (i.date != null && i.date.isBefore(today)) dayLabel(i.date, today) else "지남", Ink.deep, Ink.onMid)
                "soon" -> Badge("임박", Ink.mint, Ink.deep)
            }
            val whenText = if (showDate && i.date != null) dayLabel(i.date, today) + (if (i.time.isNotEmpty()) " " + i.time else "") else i.time
            if (whenText.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                Text(whenText, style = androidx.compose.material3.MaterialTheme.typography.labelMedium, color = Ink.midInk)
            }
        }
        HorizontalDivider(color = Ink.rule, thickness = 1.dp)
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun RoutineRow(task: Task, next: Instance?, today: LocalDate, onTap: () -> Unit) {
    Column {
        Row(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(10.dp)).combinedClickable(onClick = onTap)
                .padding(vertical = 14.dp, horizontal = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Column(Modifier.weight(1f)) {
                Text(task.title, style = androidx.compose.material3.MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Text(task.ruleText, style = androidx.compose.material3.MaterialTheme.typography.bodyMedium, maxLines = 1)
            }
            val label = when {
                next?.date == null -> "예정 없음"
                next.date == today -> if (next.done) "오늘 완료" else "오늘"
                else -> dayLabel(next.date, today)
            }
            if (next?.date == today && next.done != true) Badge(label, Ink.deep, Ink.onMid)
            else Text(label, style = androidx.compose.material3.MaterialTheme.typography.labelMedium, color = Ink.midInk)
            if (task.dueTime.isNotEmpty()) {
                Spacer(Modifier.width(8.dp))
                Text(task.dueTime, style = androidx.compose.material3.MaterialTheme.typography.labelMedium, color = Ink.midInk)
            }
        }
        HorizontalDivider(color = Ink.rule, thickness = 1.dp)
    }
}

@Composable
private fun Badge(text: String, bg: Color, fg: Color) {
    Box(Modifier.padding(start = 6.dp).clip(RoundedCornerShape(8.dp)).background(bg).padding(horizontal = 8.dp, vertical = 3.dp)) {
        Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelSmall, color = fg)
    }
}

@Composable
private fun Tag(text: String) {
    Box(Modifier.clip(RoundedCornerShape(8.dp)).border(1.dp, Ink.dark, RoundedCornerShape(8.dp)).padding(horizontal = 7.dp, vertical = 2.dp)) {
        Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelSmall, color = Ink.faint)
    }
}

@Composable
private fun Pill(text: String, primary: Boolean, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Button(
        onClick = onClick, enabled = enabled, modifier = modifier.height(48.dp),
        shape = RoundedCornerShape(24.dp),
        colors = ButtonDefaults.buttonColors(
            containerColor = if (primary) Ink.mid else Ink.light, contentColor = if (primary) Ink.onMid else Ink.ink2,
            disabledContainerColor = Ink.pale, disabledContentColor = Ink.faint),
        contentPadding = PaddingValues(horizontal = 22.dp),
    ) { Text(text, style = androidx.compose.material3.MaterialTheme.typography.labelLarge) }
}

// ---------------- add ----------------

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun AddSheet(today: LocalDate, onDismiss: () -> Unit, onSave: (String, String, String?, String) -> Unit) {
    var title by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("deadline") }
    var date by remember { mutableStateOf(Recur.nextBusinessDay(today)) }
    var time by remember { mutableStateOf("") }
    ModalBottomSheet(onDismissRequest = onDismiss, containerColor = Ink.light) {
        Column(Modifier.padding(horizontal = 22.dp).padding(bottom = 24.dp).imePadding()) {
            Text("새 항목", style = androidx.compose.material3.MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(14.dp))
            OutlinedTextField(
                value = title, onValueChange = { if (it.length <= 200) title = it },
                label = { Text("이름") }, singleLine = true, modifier = Modifier.fillMaxWidth(),
                colors = OutlinedTextFieldDefaults.colors(focusedBorderColor = Ink.mid, focusedLabelColor = Ink.midInk, cursorColor = Ink.mid),
            )
            Spacer(Modifier.height(14.dp))
            Chips(listOf("deadline" to "마감이 있는 일", "floating" to "기한 없는 메모"), kind) { kind = it }
            if (kind == "deadline") {
                Spacer(Modifier.height(16.dp))
                Text("언제까지 · ${dayLabel(date, today)}", style = androidx.compose.material3.MaterialTheme.typography.labelMedium, color = Ink.muted)
                Spacer(Modifier.height(8.dp))
                val choices = listOf(0L, 1L, 2L, 7L).map { today.plusDays(it) }
                Chips(choices.map { it.toString() to dayLabel(it, today) }, date.toString()) { date = LocalDate.parse(it) }
                Spacer(Modifier.height(16.dp))
                Text("시각 (선택)", style = androidx.compose.material3.MaterialTheme.typography.labelMedium, color = Ink.muted)
                Spacer(Modifier.height(8.dp))
                Chips(listOf("" to "없음", "09:00" to "09:00", "12:00" to "12:00", "15:00" to "15:00", "18:00" to "18:00"), time) { time = it }
            }
            Spacer(Modifier.height(22.dp))
            Pill("추가", primary = true, enabled = title.isNotBlank(), modifier = Modifier.fillMaxWidth()) {
                onSave(title.trim(), kind, if (kind == "deadline") date.toString() else null, time)
            }
        }
    }
}

@Composable
private fun Chips(options: List<Pair<String, String>>, selected: String, onPick: (String) -> Unit) {
    Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((value, label) in options) {
            val on = value == selected
            Box(
                Modifier.clip(RoundedCornerShape(14.dp))
                    .background(if (on) Ink.mid else Ink.pale)
                    .combinedClickable(onClick = { onPick(value) })
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(label, style = androidx.compose.material3.MaterialTheme.typography.labelMedium, color = if (on) Ink.onMid else Ink.muted)
            }
        }
    }
}

