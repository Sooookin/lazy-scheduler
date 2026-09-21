package com.lazyscheduler.app.ui

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.Animatable
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.Orientation
import androidx.compose.foundation.gestures.draggable
import androidx.compose.foundation.gestures.rememberDraggableState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.onSizeChanged
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.google.firebase.auth.FirebaseUser
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Plan
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.ReminderPlan
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.data.Cloud
import com.lazyscheduler.app.reminders.Reminders
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import androidx.compose.ui.window.Dialog
import androidx.compose.material3.TextButton
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

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
        Text(title, style = MaterialTheme.typography.titleMedium)
        Spacer(Modifier.height(8.dp))
        Text(body, style = MaterialTheme.typography.bodyMedium)
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
        Text("LazyScheduler", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(10.dp))
        Text("PC 와 같은 Google 계정으로 로그인하면\n일정이 그대로 이어집니다.", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(28.dp))
        Primary(if (busy) "로그인하는 중…" else "Google 계정으로 로그인", enabled = !busy) {
            busy = true
            error = null
            scope.launch {
                error = Cloud.signIn(activity)
                busy = false
            }
        }
        error?.let {
            Spacer(Modifier.height(14.dp))
            Text(it, style = MaterialTheme.typography.bodyMedium, color = Ink.danger)
        }
    }
}

// ---------------- home ----------------

private enum class Tab(val label: String) { TODAY("오늘"), UPCOMING("다가오는"), ROUTINES("루틴"), MEMOS("메모") }

/** "되돌리기" for five seconds after complete · skip · later · delete. */
private class Undo(val text: String, val undo: () -> Unit)

/** A row's swipe-left buttons. */
private class Act(val label: String, val color: Color, val run: () -> Unit)

@Composable
private fun Home(user: FirebaseUser) {
    val uid = user.uid
    val tasks by remember(uid) { Cloud.tasksFlow(uid) }.collectAsState(initial = null)
    val settings by remember(uid) { Cloud.settingsFlow(uid) }.collectAsState(initial = emptyMap())
    val context = LocalContext.current
    val scope = rememberCoroutineScope()

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
    val businessOnly = settings["business_only"] != false

    var tab by remember { mutableStateOf(Tab.TODAY) }
    // The editor: null = closed. Editing(null, …) = a new item. The date is the occurrence
    // that "건너뛰기" skips.
    var editor by remember { mutableStateOf<Editing?>(null) }
    var menu by remember { mutableStateOf(false) }
    var overview by remember { mutableStateOf(false) }
    var askDelete by remember { mutableStateOf(false) }
    var deleting by remember { mutableStateOf(false) }
    var deleteError by remember { mutableStateOf<String?>(null) }
    var openRow by remember { mutableStateOf<String?>(null) }

    // ---- undo ----
    var undo by remember { mutableStateOf<Undo?>(null) }
    LaunchedEffect(undo) { if (undo != null) { delay(5_000); undo = null } }

    // Deleting waits five seconds (so "되돌리기" really undoes it); the list hides it at once.
    val gone = remember { mutableStateMapOf<String, Task>() }
    val jobs = remember { HashMap<String, Job>() }
    fun flushDeletes() {
        for (id in jobs.keys.toList()) {
            jobs.remove(id)?.cancel()
            gone[id]?.let { Cloud.delete(uid, it) }
        }
    }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { flushDeletes() }     // leaving the app: send now
    DisposableEffect(uid) { onDispose { flushDeletes() } }

    fun removeSoon(t: Task) {
        gone[t.id] = t
        jobs.remove(t.id)?.cancel()
        jobs[t.id] = scope.launch {
            delay(5_000)
            jobs.remove(t.id)
            Cloud.delete(uid, t)
        }
        undo = Undo("「${t.title}」 삭제") { jobs.remove(t.id)?.cancel(); gone.remove(t.id) }
    }
    fun toggle(i: Instance) {
        if (i.done) { Cloud.setDone(uid, i, false); return }
        Cloud.setDone(uid, i, true)
        undo = Undo("「${i.task.title}」 완료") { Cloud.setDone(uid, i, false) }
    }
    fun skip(i: Instance) {
        val d = i.date ?: return
        Cloud.skip(uid, i)
        undo = Undo("${dateLabel(d, today)} 「${i.task.title}」 건너뜀") { Cloud.unskip(uid, i) }
    }
    /** 오늘 · 지난 것은 내일로, 앞으로의 것은 하루 뒤로 (영업일만 쓰면 주말 · 공휴일을 건너뛴다). */
    fun later(t: Task) {
        val from = t.dueDate
        val cur = from?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        val base = if (cur != null && cur.isAfter(today)) cur else today
        val to = base.plusDays(1).let { if (businessOnly) Recur.nextBusinessDay(it) else it }
        Cloud.save(uid, t, mapOf("due_date" to to.toString()))
        undo = Undo("「${t.title}」 → ${dateLabel(to, today)}") {
            Cloud.save(uid, t.copy(dueDate = to.toString()), mapOf("due_date" to from))
        }
    }

    // ---- reminders on this phone ----
    var remindOn by remember { mutableStateOf(Reminders.enabled(context)) }
    var canExact by remember { mutableStateOf(Reminders.canExact(context)) }
    val askNotify = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) {
        if (Build.VERSION.SDK_INT >= 33 && !Reminders.canNotify(context)) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS)
    }
    LaunchedEffect(now) { canExact = Reminders.canExact(context) }      // re-checked after returning from settings

    val loaded = tasks
    LaunchedEffect(loaded, settings, remindOn, canExact) {
        loaded?.let { Reminders.reschedule(context, it, settings) }
    }
    val visible = remember(loaded, gone.toMap()) { loaded?.filter { it.id !in gone } }
    // Holidays first, in the same step: the business-day dates below depend on them.
    val o = remember(visible, today, extraHolidays) {
        Recur.setHolidays(extraHolidays)
        visible?.let { Plan.overview(it, today) }
    }

    Box(Modifier.fillMaxSize().background(Ink.bg)) {
        Column(Modifier.fillMaxSize().statusBarsPadding()) {
            // ---- header: date | ring (centre) | settings ----
            Row(Modifier.fillMaxWidth().padding(start = 22.dp, end = 16.dp, top = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f)) {
                    Text("${today.monthValue}월 ${today.dayOfMonth}일", style = MaterialTheme.typography.bodyMedium)
                    Text("${WDS[today.dayOfWeek.value - 1]}요일", style = MaterialTheme.typography.headlineMedium)
                }
                Box {
                    val all = o?.let { it.overdue + it.todays } ?: emptyList()
                    Ring(o?.left ?: 0, all.count { it.done }, all.size) { overview = true }
                    DropdownMenu(expanded = overview, onDismissRequest = { overview = false }, containerColor = Ink.card,
                        shape = RoundedCornerShape(16.dp)) {
                        TodayOverview(all, today)
                    }
                }
                Box(Modifier.weight(1f), contentAlignment = Alignment.CenterEnd) {
                    Box(Modifier.size(44.dp).raised(22.dp, 2.5.dp).clip(CircleShape).tap { menu = true }, contentAlignment = Alignment.Center) {
                        Gear()
                    }
                    DropdownMenu(expanded = menu, onDismissRequest = { menu = false }, containerColor = Ink.card) {
                        DropdownMenuItem(text = { Text(user.email ?: "로그인됨") }, onClick = {}, enabled = false)
                        DropdownMenuItem(
                            text = { Text(if (remindOn) "✓ 이 휴대폰에서 알림 받기" else "이 휴대폰에서 알림 받기") },
                            onClick = {
                                remindOn = !remindOn
                                Reminders.setEnabled(context, remindOn, loaded, settings)
                                menu = false
                            })
                        DropdownMenuItem(text = { Text("로그아웃") }, onClick = { menu = false; Cloud.signOut(context) })
                        DropdownMenuItem(
                            text = { Text("계정 · 데이터 삭제", color = Ink.danger) },
                            onClick = { menu = false; askDelete = true })
                    }
                }
            }
            if (remindOn && !canExact) {
                // Android 14+ turns exact alarms off by default. Without them reminders can be minutes late.
                Row(
                    Modifier.padding(horizontal = 16.dp).padding(top = 10.dp).fillMaxWidth().inset(12.dp)
                        .clip(RoundedCornerShape(12.dp))
                        .tap {
                            runCatching {
                                context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM,
                                    Uri.parse("package:" + context.packageName)))
                            }
                        }
                        .padding(horizontal = 14.dp, vertical = 10.dp),
                ) {
                    Text("정확한 시각에 알리려면 '알람 및 리마인더' 를 허용해 주세요 ›",
                        style = MaterialTheme.typography.labelMedium, color = Ink.muted)
                }
            }
            Spacer(Modifier.height(18.dp))

            // ---- the paper: index tabs on a stack of sheets ----
            val counts = mapOf(
                Tab.TODAY to ((o?.overdue?.size ?: 0) + (o?.todays?.size ?: 0)),
                Tab.UPCOMING to (o?.upcoming?.size ?: 0),
                Tab.ROUTINES to (o?.routines?.size ?: 0),
                Tab.MEMOS to (o?.floating?.size ?: 0),
            )
            Row(Modifier.padding(start = 12.dp).height(38.dp), horizontalArrangement = Arrangement.spacedBy(3.dp),
                verticalAlignment = Alignment.Bottom) {
                for (t in Tab.entries) {
                    val on = t == tab
                    Row(
                        Modifier.height(if (on) 38.dp else 34.dp)
                            .clip(RoundedCornerShape(topStart = 14.dp, topEnd = 14.dp))
                            .background(if (on) Ink.card else Ink.sheet2)
                            .tap { tab = t; openRow = null }
                            .padding(horizontal = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        if (on) {
                            Box(Modifier.width(3.dp).height(13.dp).clip(RoundedCornerShape(2.dp)).background(Ink.mid))
                            Spacer(Modifier.width(6.dp))
                        }
                        Text(t.label, style = MaterialTheme.typography.labelLarge, color = if (on) Ink.ink2 else Ink.faint)
                        Spacer(Modifier.width(5.dp))
                        Text("${counts[t]}", style = MaterialTheme.typography.labelMedium, color = Ink.midInk)
                    }
                }
            }
            val sheet = RoundedCornerShape(topStart = 4.dp, topEnd = 18.dp, bottomStart = 0.dp, bottomEnd = 0.dp)
            Box(Modifier.weight(1f).fillMaxWidth().padding(start = 12.dp, end = 12.dp)) {
                val d = LocalDensity.current
                Box(Modifier.matchParentSize().graphicsLayer {
                    translationX = with(d) { 9.dp.toPx() }; translationY = with(d) { 9.dp.toPx() }; rotationZ = .35f
                }.shadow(3.dp, sheet, spotColor = Ink.dark).background(Ink.sheet3, sheet))
                Box(Modifier.matchParentSize().graphicsLayer {
                    translationX = with(d) { 4.5.dp.toPx() }; translationY = with(d) { 4.5.dp.toPx() }; rotationZ = -.2f
                }.shadow(3.dp, sheet, spotColor = Ink.dark).background(Ink.sheet2, sheet))
                Box(Modifier.matchParentSize().shadow(5.dp, sheet, spotColor = Ink.dark).background(Ink.card, sheet)) {
                    if (o == null) {
                        Message("불러오는 중…", "처음에는 서버에서 받아 오느라 조금 걸립니다.")
                    } else {
                        TabList(tab, o, today, now, openRow, { openRow = it },
                            open = { t, d -> editor = Editing(t, d) },
                            toggle = ::toggle,
                            actsFor = { i ->
                                when {
                                    i.done -> if (i.kind == "routine") emptyList() else listOf(Act("삭제", Ink.danger) { removeSoon(i.task) })
                                    i.kind == "routine" -> listOf(Act("건너뛰기", Ink.midInk) { skip(i) })
                                    i.kind == "deadline" -> listOf(
                                        Act(if (i.date != null && i.date.isAfter(today)) "↷ 하루 뒤로" else "↷ 내일로", Ink.midInk) { later(i.task) },
                                        Act("삭제", Ink.danger) { removeSoon(i.task) })
                                    else -> listOf(Act("삭제", Ink.danger) { removeSoon(i.task) })
                                }
                            },
                            routineActs = { t, next ->
                                listOfNotNull(
                                    next?.takeIf { !it.done }?.let { n -> Act("건너뛰기", Ink.midInk) { skip(n) } },
                                    Act("삭제", Ink.danger) { removeSoon(t) },
                                )
                            })
                    }
                }
            }
        }

        // ---- new item ----
        Box(
            Modifier.align(Alignment.BottomEnd).navigationBarsPadding().padding(end = 20.dp, bottom = 22.dp)
                .shadow(8.dp, RoundedCornerShape(27.dp), spotColor = Ink.midShadow)
                .clip(RoundedCornerShape(27.dp)).background(Ink.mid).tap { editor = Editing(null, null) }
                .padding(horizontal = 22.dp, vertical = 16.dp),
        ) { Text("＋  새 항목", style = MaterialTheme.typography.labelLarge, color = Ink.onMid) }

        // ---- undo ----
        AnimatedVisibility(
            visible = undo != null,
            modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = 92.dp),
            enter = fadeIn() + slideInVertically { it / 2 }, exit = fadeOut() + slideOutVertically { it / 2 },
        ) {
            var shown by remember { mutableStateOf<Undo?>(null) }
            undo?.let { shown = it }
            val u = shown
            Row(
                Modifier.widthIn(max = 360.dp).shadow(10.dp, RoundedCornerShape(24.dp), spotColor = Ink.deep)
                    .clip(RoundedCornerShape(24.dp)).background(Ink.deep).padding(start = 18.dp, end = 6.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(u?.text ?: "", Modifier.weight(1f, fill = false).padding(vertical = 14.dp),
                    style = MaterialTheme.typography.labelLarge, color = Ink.onMid, maxLines = 1, overflow = TextOverflow.Ellipsis)
                Spacer(Modifier.width(12.dp))
                Box(
                    Modifier.clip(RoundedCornerShape(16.dp)).background(Color.White.copy(alpha = .14f))
                        .tap { u?.undo?.invoke(); undo = null }.padding(horizontal = 14.dp, vertical = 8.dp),
                ) { Text("되돌리기", style = MaterialTheme.typography.labelLarge, color = Color.White) }
            }
        }
    }

    if (askDelete) DeleteAccount(
        busy = deleting,
        error = deleteError,
        onDismiss = { if (!deleting) { askDelete = false; deleteError = null } },
        onConfirm = {
            deleting = true
            deleteError = null
            scope.launch {
                val err = Cloud.deleteAccount()
                deleting = false
                if (err == null) askDelete = false else deleteError = err
            }
        },
    )

    editor?.let { e ->
        ItemEditor(
            existing = e.task,
            others = visible ?: emptyList(),
            today = today,
            businessOnly = businessOnly,
            defaultLead = ReminderPlan.defaultLead(settings),
            skipDate = e.date,
            onDismiss = { editor = null },
            onSave = { fields -> Cloud.save(uid, e.task, fields); editor = null },
            onDelete = { e.task?.let { removeSoon(it) }; editor = null },
            onSkip = {
                if (e.task != null && e.date != null) skip(Instance(e.task, e.date, false))
                editor = null
            },
            onLater = e.task?.takeIf { it.kind == "deadline" && !it.done && it.dueDate != null }?.let { t -> { later(t); editor = null } },
        )
    }
}

/** What the editor is open on: an existing item (and the occurrence it was opened from), or null for new. */
private data class Editing(val task: Task?, val date: LocalDate?)

@Composable
private fun TabList(
    tab: Tab, o: com.lazyscheduler.app.core.Overview, today: LocalDate, now: LocalTime,
    openRow: String?, setOpen: (String?) -> Unit,
    open: (Task, LocalDate?) -> Unit, toggle: (Instance) -> Unit,
    actsFor: (Instance) -> List<Act>, routineActs: (Task, Instance?) -> List<Act>,
) {
    LazyColumn(contentPadding = PaddingValues(start = 8.dp, end = 8.dp, top = 10.dp, bottom = 120.dp)) {
        when (tab) {
            Tab.ROUTINES -> {
                if (o.routines.isEmpty()) item { Empty("루틴이 없습니다", "＋ 새 항목 → 루틴") }
                items(o.routines, key = { it.first.id }) { (task, next) ->
                    SwipeRow(task.id, openRow, setOpen, routineActs(task, next), null, onTap = { open(task, next?.date) }) { hide ->
                        RoutineRow(task, next, today, hide)
                    }
                    Rule()
                }
            }
            else -> {
                val rows: List<Instance> = when (tab) {
                    Tab.TODAY -> (o.overdue + o.todays).sortedWith(compareBy({ it.done }, { it.date ?: LocalDate.MAX }, { it.time.ifEmpty { "99:99" } }))
                    Tab.UPCOMING -> o.upcoming
                    else -> o.floating
                }
                if (rows.isEmpty()) item {
                    when (tab) {
                        Tab.TODAY -> Empty("오늘 할 일이 없습니다", o.upcoming.firstOrNull()?.let {
                            "다음 마감은 ${dateLabel(it.date!!, today)} · ${it.task.title}"
                        } ?: "다가오는 7일에도 마감이 없습니다.")
                        Tab.UPCOMING -> Empty("앞으로 7일, 마감 없음", "")
                        else -> Empty("메모가 없습니다", "＋ 새 항목 → 메모")
                    }
                }
                // Today: "지난 일" and "오늘" get a name when both are there
                val late = if (tab == Tab.TODAY) rows.filter { it.date != null && it.date.isBefore(today) && !it.done } else emptyList()
                val rest = rows.filter { it !in late }
                if (late.isNotEmpty()) item(key = "g-late") { Group("지난 일") }
                items(late, key = { "L" + it.task.id + "@" + it.date }) { i -> InstanceRow(i, today, now, tab, openRow, setOpen, open, toggle, actsFor) }
                if (late.isNotEmpty() && rest.isNotEmpty()) item(key = "g-today") { Group("오늘") }
                items(rest, key = { it.task.id + "@" + it.date }) { i -> InstanceRow(i, today, now, tab, openRow, setOpen, open, toggle, actsFor) }
            }
        }
    }
}

@Composable
private fun InstanceRow(
    i: Instance, today: LocalDate, now: LocalTime, tab: Tab, openRow: String?, setOpen: (String?) -> Unit,
    open: (Task, LocalDate?) -> Unit, toggle: (Instance) -> Unit, actsFor: (Instance) -> List<Act>,
) {
    val id = i.task.id + "@" + i.date
    SwipeRow(id, openRow, setOpen, actsFor(i), onSwipeRight = if (i.done) null else ({ toggle(i) }),
        onTap = { open(i.task, i.date) }) { hide ->
        ItemRow(i, today, now, showDate = tab == Tab.UPCOMING, hide = hide) { toggle(i) }
    }
    Rule()
}

/**
 * 계정 지우기. 되돌릴 수 없으니 무엇이 지워지는지 먼저 적는다. 성공하면 로그인이
 * 풀려서 화면이 저절로 로그인 화면으로 돌아간다 - 따로 닫아 줄 것이 없다.
 */
@Composable
private fun DeleteAccount(busy: Boolean, error: String?, onDismiss: () -> Unit, onConfirm: () -> Unit) {
    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.clip(RoundedCornerShape(22.dp)).background(Ink.card).padding(22.dp)) {
            Text("계정과 데이터를 지울까요?", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.height(10.dp))
            Text("계정에 올라간 일정이 모두 지워지고 로그인이 끊깁니다. PC 에서도 사라집니다. 되돌릴 수 없습니다.",
                style = MaterialTheme.typography.bodyMedium)
            if (error != null) {
                Spacer(Modifier.height(10.dp))
                Text(error, style = MaterialTheme.typography.bodyMedium, color = Ink.danger)
            }
            Spacer(Modifier.height(18.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Spacer(Modifier.weight(1f))
                TextButton(onClick = onDismiss, enabled = !busy) { Text("취소", color = Ink.faint) }
                Spacer(Modifier.width(4.dp))
                Box(
                    Modifier.clip(RoundedCornerShape(22.dp)).background(if (busy) Ink.pale else Ink.danger)
                        .then(if (busy) Modifier else Modifier.tap(onConfirm))
                        .padding(horizontal = 20.dp, vertical = 12.dp),
                ) {
                    Text(if (busy) "지우는 중…" else "삭제", style = MaterialTheme.typography.labelLarge,
                        color = if (busy) Ink.faint else Color.White)
                }
            }
        }
    }
}

@Composable
private fun Group(text: String) {
    Text(text, Modifier.padding(start = 12.dp, top = 12.dp, bottom = 2.dp), style = MaterialTheme.typography.bodySmall)
}

@Composable
private fun Rule() {
    Box(Modifier.padding(horizontal = 10.dp).fillMaxWidth().height(1.dp).background(Ink.rule))
}

@Composable
private fun Empty(title: String, body: String) {
    Column(Modifier.fillMaxWidth().padding(vertical = 48.dp), horizontalAlignment = Alignment.CenterHorizontally) {
        Text(title, style = MaterialTheme.typography.titleMedium, color = Ink.muted)
        if (body.isNotEmpty()) {
            Spacer(Modifier.height(6.dp))
            Text(body, style = MaterialTheme.typography.bodyMedium)
        }
    }
}

/** 줄이 제자리로 돌아가는 용수철: 짧고 또렷하게, 남은 꼬리 없이. */
private val SNAP = spring<Float>(
    dampingRatio = Spring.DampingRatioNoBouncy,
    stiffness = 800f,
    visibilityThreshold = 0.5f,
)

/**
 * One row that slides. Left: the buttons (36dp pills, 8dp apart, 10dp from the edge,
 * 16dp from the row's rounded end; the row's time fades out so nothing touches).
 * Right, past 96dp: done. A tap on an open row closes it; on a closed row opens the item.
 */
@Composable
private fun SwipeRow(
    id: String, openId: String?, setOpen: (String?) -> Unit, actions: List<Act>,
    onSwipeRight: (() -> Unit)?, onTap: () -> Unit, content: @Composable RowScope.(hide: () -> Float) -> Unit,
) {
    val density = LocalDensity.current
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    var actW by remember { mutableIntStateOf(0) }
    val reveal = if (actions.isEmpty()) 0f else actW + with(density) { 26.dp.toPx() }
    val doneAt = with(density) { 96.dp.toPx() }
    LaunchedEffect(openId) { if (openId != id && offset.value < 0f) offset.animateTo(0f, SNAP) }
    /* 미끄러지는 값(offset.value)을 조합 단계에서 읽으면, 손가락을 움직이는 프레임마다
       줄 전체가 다시 만들어진다(모양 · 그림자 · 색까지 새로 고른다). 그래서 여기서는
       읽지 않고, 그리기 단계의 람다(graphicsLayer · hide()) 안에서만 읽는다 - 같은 줄을
       위치만 바꿔 다시 그릴 뿐이다. 이것이 "밀 때 끈적인다" 의 가장 큰 원인이었다. */
    val hide: () -> Float = { if (reveal > 0f) (-offset.value / reveal).coerceIn(0f, 1f) else 0f }
    val endShape = RoundedCornerShape(topEnd = 16.dp, bottomEnd = 16.dp)

    Box(Modifier.fillMaxWidth()) {
        if (onSwipeRight != null) Box(
            Modifier.matchParentSize().padding(vertical = 4.dp)
                .graphicsLayer { alpha = (offset.value / doneAt).coerceIn(0f, 1f) }
                .clip(RoundedCornerShape(14.dp)).background(Ink.mint.copy(alpha = .7f)),
            contentAlignment = Alignment.CenterStart,
        ) { Text("✓  완료", Modifier.padding(start = 18.dp), style = MaterialTheme.typography.labelLarge, color = Ink.deep) }
        if (actions.isNotEmpty()) Row(
            Modifier.align(Alignment.CenterEnd).padding(end = 10.dp)
                .graphicsLayer { alpha = hide() }.onSizeChanged { actW = it.width },
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            for (a in actions) Box(
                Modifier.height(36.dp).raised(18.dp, 2.5.dp).clip(RoundedCornerShape(18.dp))
                    .tap { setOpen(null); scope.launch { offset.animateTo(0f, SNAP) }; a.run() }
                    .padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) { Text(a.label, style = MaterialTheme.typography.labelMedium, color = a.color, maxLines = 1) }
        }
        Row(
            Modifier.graphicsLayer {
                val v = offset.value
                translationX = v
                shape = endShape
                clip = v != 0f
                shadowElevation = if (v < 0f) 5.dp.toPx() else 0f
                spotShadowColor = Ink.dark
                ambientShadowColor = Ink.dark
            }.fillMaxWidth().background(Ink.card)
                .draggable(
                    orientation = Orientation.Horizontal,
                    state = rememberDraggableState { dx ->
                        scope.launch {
                            val max = if (onSwipeRight != null) doneAt * 1.4f else 0f
                            offset.snapTo((offset.value + dx).coerceIn(-reveal * 1.12f, max))
                        }
                    },
                    onDragStarted = { if (openId != null && openId != id) setOpen(null) },
                    onDragStopped = {
                        val v = offset.value
                        when {
                            v >= doneAt && onSwipeRight != null -> { offset.animateTo(0f, SNAP); onSwipeRight() }
                            reveal > 0f && v < -reveal / 2 -> { offset.animateTo(-reveal, SNAP); setOpen(id) }
                            else -> { offset.animateTo(0f, SNAP); if (openId == id) setOpen(null) }
                        }
                    },
                )
                .tap { if (offset.value < 0f) { scope.launch { offset.animateTo(0f, SNAP) }; setOpen(null) } else onTap() }
                .heightIn(min = 60.dp).padding(start = 2.dp, end = 14.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) { content(hide) }
    }
}

@Composable
private fun RowScope.ItemRow(i: Instance, today: LocalDate, now: LocalTime, showDate: Boolean, hide: () -> Float, onCheck: () -> Unit) {
    CheckDot(i.done, onCheck)
    Column(Modifier.weight(1f).padding(vertical = 10.dp)) {
        Text(
            i.task.title, style = MaterialTheme.typography.bodyLarge,
            color = if (i.done) Ink.dim else Ink.body,
            textDecoration = if (i.done) TextDecoration.LineThrough else null,
            maxLines = 1, overflow = TextOverflow.Ellipsis,
        )
        val sub = when {
            i.kind == "routine" -> "루틴 · " + i.task.ruleText
            i.date != null && i.date.isBefore(today) -> dateLabel(i.date, today) + (if (i.time.isNotEmpty()) " " + i.time else "")
            else -> ""
        }
        if (sub.isNotEmpty()) Text(sub, style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Row(Modifier.graphicsLayer { alpha = 1f - hide() }, verticalAlignment = Alignment.CenterVertically) {
        when (Plan.urgency(i, today, now)) {
            "late" -> Badge(if (i.date != null && i.date.isBefore(today)) dateLabel(i.date, today) else "지남", Ink.deep, Ink.onMid)
            "soon" -> Badge("임박", Ink.mint, Ink.deep)
        }
        val whenText = if (showDate && i.date != null) dateLabel(i.date, today) + (if (i.time.isNotEmpty()) " " + i.time else "") else i.time
        if (whenText.isNotEmpty()) {
            Spacer(Modifier.width(8.dp))
            Text(whenText, style = MaterialTheme.typography.labelLarge, color = if (i.done) Ink.dim else Ink.body)
        }
    }
}

@Composable
private fun RowScope.RoutineRow(task: Task, next: Instance?, today: LocalDate, hide: () -> Float) {
    Column(Modifier.weight(1f).padding(start = 14.dp, top = 10.dp, bottom = 10.dp)) {
        Text(task.title, style = MaterialTheme.typography.bodyLarge, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Text(task.ruleText + (if (task.dueTime.isNotEmpty()) " · " + task.dueTime else ""),
            style = MaterialTheme.typography.bodySmall, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
    Box(Modifier.graphicsLayer { alpha = 1f - hide() }) {
        when {
            next?.date == null -> Text("예정 없음", style = MaterialTheme.typography.labelMedium, color = Ink.faint)
            next.date == today -> if (next.done) Badge("완료", Ink.pale, Ink.muted) else Badge("오늘", Ink.deep, Ink.onMid)
            else -> Text(dateLabel(next.date, today), style = MaterialTheme.typography.labelLarge, color = Ink.body)
        }
    }
}

/** The ring's popover: what is left today, without leaving the tab you are on. */
@Composable
private fun TodayOverview(all: List<Instance>, today: LocalDate) {
    val left = all.filter { !it.done }.sortedWith(compareBy({ it.date ?: LocalDate.MAX }, { it.time.ifEmpty { "99:99" } }))
    Column(Modifier.widthIn(min = 250.dp, max = 300.dp).padding(horizontal = 16.dp, vertical = 6.dp)) {
        Row(verticalAlignment = Alignment.Bottom) {
            Text(if (left.isEmpty()) "다 끝났습니다" else "${left.size}건 남음", style = MaterialTheme.typography.titleMedium)
            Spacer(Modifier.weight(1f))
            val late = left.count { it.date != null && it.date.isBefore(today) }
            if (late > 0) Text("지난 것 ${late}건", style = MaterialTheme.typography.bodySmall)
        }
        Spacer(Modifier.height(8.dp))
        Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.rule2))
        if (left.isEmpty()) Text("오늘 남은 일이 없습니다.", Modifier.padding(vertical = 14.dp), style = MaterialTheme.typography.bodyMedium)
        for (i in left.take(6)) {
            Row(Modifier.padding(vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                Box(Modifier.width(3.dp).height(13.dp).clip(RoundedCornerShape(2.dp))
                    .background(when (i.kind) { "routine" -> Ink.mid; "floating" -> Ink.mint; else -> Ink.ink2 }))
                Spacer(Modifier.width(10.dp))
                Text(i.task.title, Modifier.weight(1f), style = MaterialTheme.typography.labelLarge, color = Ink.body,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                val over = i.date != null && i.date.isBefore(today)
                Text(if (over) dateLabel(i.date!!, today) else i.time, style = MaterialTheme.typography.bodySmall,
                    color = if (over) Ink.midInk else Ink.faint)
            }
        }
        Box(Modifier.fillMaxWidth().height(1.dp).background(Ink.rule))
        Text((if (left.size > 6) "외 ${left.size - 6}건 · " else "") + "완료 ${all.count { it.done }} · 전체 ${all.size}",
            Modifier.fillMaxWidth().padding(top = 8.dp, bottom = 4.dp), style = MaterialTheme.typography.bodySmall,
            textAlign = androidx.compose.ui.text.style.TextAlign.Center)
    }
}

@Composable
private fun Badge(text: String, bg: Color, fg: Color) {
    Box(Modifier.padding(start = 6.dp).clip(RoundedCornerShape(8.dp)).background(bg).padding(horizontal = 8.dp, vertical = 3.dp)) {
        Text(text, style = MaterialTheme.typography.labelSmall, color = fg)
    }
}

/** A drawn gear (the font has no symbol for it). */
@Composable
private fun Gear() {
    Canvas(Modifier.size(18.dp)) {
        val c = Offset(size.width / 2, size.height / 2)
        val w = 1.7.dp.toPx()
        drawCircle(Ink.muted, radius = size.minDimension * .27f, center = c, style = Stroke(w))
        drawCircle(Ink.muted, radius = size.minDimension * .11f, center = c, style = Stroke(w))
        for (k in 0 until 8) {
            val a = Math.toRadians(k * 45.0)
            val r0 = size.minDimension * .32f
            val r1 = size.minDimension * .46f
            drawLine(Ink.muted, Offset(c.x + r0 * cos(a).toFloat(), c.y + r0 * sin(a).toFloat()),
                Offset(c.x + r1 * cos(a).toFloat(), c.y + r1 * sin(a).toFloat()), strokeWidth = w * 1.4f)
        }
    }
}
