package com.lazyscheduler.app.ui

import android.Manifest
import android.app.Activity
import android.content.Context
import android.os.Build
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.WindowInsets
import androidx.compose.foundation.layout.asPaddingValues
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBars
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBars
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.core.view.WindowCompat
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LifecycleEventEffect
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Plan
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.data.Repo
import com.lazyscheduler.app.reminders.Reminders
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.time.LocalDate
import java.time.LocalTime

/** 이 휴대폰에만 두는 보기 설정 (밝기 · 돌멩이 · 움직임 줄이기). */
class ViewPrefs(ctx: Context) {
    private val p = ctx.getSharedPreferences("view", Context.MODE_PRIVATE)
    var theme by mutableStateOf(p.getString("theme", "auto") ?: "auto"); private set
    var walk by mutableStateOf(p.getBoolean("walk", true)); private set
    var calm by mutableStateOf(p.getBoolean("calm", false)); private set
    fun theme(v: String) { theme = v; p.edit().putString("theme", v).apply() }
    fun walk(v: Boolean) { walk = v; p.edit().putBoolean("walk", v).apply() }
    fun calm(v: Boolean) { calm = v; p.edit().putBoolean("calm", v).apply() }
}

/** 5초 동안의 "되돌리기". */
class Undo(val verb: String, val title: String, val undo: () -> Unit)

/** 열려 있는 편집 종이: 새 항목(kind · 날짜) 또는 있는 항목(과 그 회차). */
data class Editing(val task: Task?, val date: LocalDate?, val kind: String = "deadline")

enum class Tab(val label: String) { HOME("오늘"), CAL("달력"), ALL("전체"), SET("설정") }

/**
 * 한 장의 종이, 두 가지 하늘 높이 (참고 도안 '모바일 화면들').
 *   하늘 230  시각이 의미 있는 화면 (홈 · 새 할 일 · 시각 고르기 · 새 루틴)
 *   하늘 120  나머지 (고치기 · 달력 · 전체 · 설정) - 접히며 궤도가 사라지고 언덕과 돌만 남는다
 * 아래 탭은 홈 · 달력 · 전체 · 설정에서만 보이고, 편집 종이는 탭 자리까지 내려온다.
 */
@Composable
fun App() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val user by remember { Repo.userFlow() }.collectAsState(initial = Repo.user())
    LaunchedEffect(user) { Repo.mergePending() }
    val tasks by remember(user) { Repo.tasksFlow(user) }.collectAsState(initial = null)
    val settings by remember(user) { Repo.settingsFlow(user) }.collectAsState(initial = emptyMap())
    val prefs = remember { ViewPrefs(context) }

    // 시계: 30초마다 (지남 · 다음 · 빛이 이것을 따른다)
    var now by remember { mutableStateOf(LocalTime.now()) }
    var today by remember { mutableStateOf(LocalDate.now()) }
    LaunchedEffect(Unit) { while (true) { delay(30_000); now = LocalTime.now(); today = LocalDate.now() } }
    LifecycleEventEffect(Lifecycle.Event.ON_RESUME) { now = LocalTime.now(); today = LocalDate.now() }
    val nowMin = now.hour * 60 + now.minute

    @Suppress("UNCHECKED_CAST")
    val extraHolidays = settings["holidays"] as? List<String>
    val businessOnly = settings["business_only"] != false

    // ---- 지우기는 5초 기다린다 (되돌리기가 정말 되돌리게) ----
    val gone = remember { mutableStateMapOf<String, Task>() }
    val jobs = remember { HashMap<String, Job>() }
    fun flushDeletes() { for (id in jobs.keys.toList()) { jobs.remove(id)?.cancel(); gone[id]?.let { Repo.delete(it) } } }
    LifecycleEventEffect(Lifecycle.Event.ON_STOP) { flushDeletes() }
    DisposableEffect(Unit) { onDispose { flushDeletes() } }

    val visible = remember(tasks, gone.toMap()) { tasks?.filter { it.id !in gone } }
    val o = remember(visible, today, extraHolidays) { Recur.setHolidays(extraHolidays); visible?.let { Plan.overview(it, today) } }
    val rows = remember(o, nowMin) { o?.let { homeRows(it, today, nowMin) } ?: emptyList() }
    val allDone = rows.isNotEmpty() && rows.all { it.i.done }

    // ---- 알림 ----
    var remindOn by remember { mutableStateOf(Reminders.enabled(context)) }
    val askNotify = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { }
    LaunchedEffect(Unit) { if (Build.VERSION.SDK_INT >= 33 && !Reminders.canNotify(context)) askNotify.launch(Manifest.permission.POST_NOTIFICATIONS) }
    LaunchedEffect(tasks, settings, remindOn) { tasks?.let { Reminders.reschedule(context, it, settings) } }

    // ---- 빛: 시각 · 밝기 설정 · 하루 끝 (다 마치면 자정 쪽으로 흘러간다) ----
    val nightT by animateFloatAsState(if (allDone) 1f else 0f, tween(if (prefs.calm) 0 else 1400), label = "night")
    val litMin = litMinute(nowMin.toDouble(), prefs.theme, nightT.toDouble())
    val pal = remember((litMin * 4).toInt()) { palette(litMin) }
    val sunNight = run { val rs = Sun.riseSet(); nowMin < rs[0] - 20 || nowMin > rs[1] + 30 }

    // 상태 막대 글자색: 하늘이 밝으면 먹빛, 어두우면 흰빛
    val view = LocalView.current
    SideEffect {
        (view.context as? Activity)?.window?.let { w ->
            WindowCompat.getInsetsController(w, view).apply {
                isAppearanceLightStatusBars = pal.light.night < .5 && pal.light.dusk < .6
                isAppearanceLightNavigationBars = !pal.isNight
            }
        }
    }

    // ---- 화면 상태 ----
    var tab by rememberSaveable { mutableStateOf(Tab.HOME) }
    var editing by remember { mutableStateOf<Editing?>(null) }
    val draft = remember { Draft() }
    var menu by remember { mutableStateOf<Instance?>(null) }
    var undo by remember { mutableStateOf<Undo?>(null) }
    var doneTick by remember { mutableIntStateOf(0) }
    LaunchedEffect(undo) { if (undo != null) { delay(5_000); undo = null } }

    fun removeSoon(t: Task) {
        gone[t.id] = t
        jobs.remove(t.id)?.cancel()
        jobs[t.id] = scope.launch { delay(5_000); jobs.remove(t.id); Repo.delete(t) }
        undo = Undo("삭제", t.title) { jobs.remove(t.id)?.cancel(); gone.remove(t.id) }
    }
    fun toggle(i: Instance) {
        if (i.done) { Repo.setDone(i, false); return }
        Repo.setDone(i, true)
        doneTick++
        undo = Undo("완료", i.task.title) { Repo.setDone(i, false) }
    }
    fun skip(i: Instance) {
        val d = i.date ?: return
        Repo.skip(i)
        undo = Undo("${dateLabel(d, today)} 건너뜀", i.task.title) { Repo.unskip(i) }
    }
    /** 오늘 · 지난 것은 내일로, 앞으로의 것은 하루 뒤로 (영업일만 쓰면 주말 · 공휴일을 건너뛴다). */
    fun later(t: Task) {
        val from = t.dueDate
        val cur = from?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        val base = if (cur != null && cur.isAfter(today)) cur else today
        val to = base.plusDays(1).let { if (businessOnly) Recur.nextBusinessDay(it) else it }
        Repo.save(t, mapOf("due_date" to to.toString()))
        undo = Undo("${dateLabel(to, today)}로", t.title) { Repo.save(t.copy(dueDate = to.toString()), mapOf("due_date" to from)) }
    }
    fun openEditor(e: Editing) { draft.load(e, today, businessOnly, settings); editing = e }

    BackHandler(enabled = menu != null || editing != null || tab != Tab.HOME) {
        when {
            menu != null -> menu = null
            draft.picking -> draft.picking = false
            editing != null -> editing = null
            else -> tab = Tab.HOME
        }
    }

    val ed = editing
    // 돌멩이가 자다가도 깨는 때: 적거나 고치는 중 · 메뉴 · 방금 한 일(되돌리기 띠)이 떠 있는 동안, 그리고 끝나고 6초 더
    val busy = ed != null || draft.picking || menu != null || undo != null
    var lingering by remember { mutableStateOf(false) }
    LaunchedEffect(busy) { if (busy) lingering = true else { delay(6_000); lingering = false } }
    val tall = draft.picking || (ed != null && ed.task == null) || (ed == null && tab == Tab.HOME)
    val density = LocalDensity.current
    val top = WindowInsets.statusBars.asPaddingValues().calculateTopPadding()
    val tallH = top + 186.dp
    val skyH by animateDpAsState(if (tall) tallH else top + 86.dp, tween(if (prefs.calm) 0 else 480, easing = EaseMove), label = "sky")
    val ribbon by animateFloatAsState(if (tall) 1f else 0f, tween(if (prefs.calm) 0 else 320), label = "ribbon")

    CompositionLocalProvider(LocalPal provides pal) {
        Box(Modifier.fillMaxSize().background(pal.surface)) {
            Column(Modifier.fillMaxSize()) {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val wPx = with(density) { maxWidth.toPx() }
                    val beads = remember(rows) { rows.filter { it.i.time.isNotEmpty() }.mapNotNull { r -> minsOf(r.i.time)?.let { Bead(r.n, it, r.i.done, r.late, r.next) } } }
                    val ghost = if (ed != null || draft.picking) draft.ghostMinute() else null
                    Sky(
                        height = skyH, tallHeight = tallH, top = top, ribbon = ribbon,
                        beads = beads, nowMin = nowMin, ghost = ghost,
                        onGhost = if (draft.picking || (ed != null && ed.task == null && ed.kind != "floating")) ({ m -> draft.pickFromSky(m) }) else null,
                    ) {
                        val groundY = with(density) { skyH.toPx() - 2 * 206f.let { (tallH.toPx() / it) } }
                        Pebble(width = wPx, groundY = groundY, night = sunNight || allDone || prefs.theme == "dark",
                            walk = prefs.walk, calm = prefs.calm, doneTick = doneTick, awake = busy || lingering,
                            lookX = ghost?.let { g -> SkyGeo(wPx, with(density) { skyH.toPx() }, with(density) { tallH.toPx() }, with(density) { top.toPx() }, density.density).onArc(g.toDouble(), density.density).first.x })
                    }
                }
                Box(Modifier.weight(1f).fillMaxWidth()) {
                    val screen: Any = ed ?: tab
                    AnimatedContent(
                        targetState = screen,
                        transitionSpec = {
                            if (prefs.calm) fadeIn(tween(0)) togetherWith fadeOut(tween(0))
                            else (fadeIn(tween(220, 60)) + slideInVertically(tween(320, easing = EaseMove)) { it / 14 }) togetherWith fadeOut(tween(120))
                        },
                        contentKey = { if (it is Editing) "edit" else it.toString() },
                        label = "screen",
                    ) { s ->
                        when (s) {
                            is Editing -> Editor(
                                e = s, draft = draft, today = today, businessOnly = businessOnly, others = visible.orEmpty(),
                                onClose = { editing = null; draft.picking = false },
                                onSave = { fields -> Repo.save(s.task, fields); editing = null },
                                onDelete = { s.task?.let { removeSoon(it) }; editing = null },
                                onLater = { s.task?.let { later(it) }; editing = null },
                                onSkip = { if (s.task != null && s.date != null) skip(Instance(s.task, s.date, false)); editing = null },
                            )
                            Tab.HOME -> Home(o, rows, today, nowMin, onToggle = ::toggle, onMenu = { menu = it })
                            Tab.CAL -> CalendarScreen(visible.orEmpty(), today, nowMin, onToggle = ::toggle, onMenu = { menu = it },
                                onAdd = { d -> openEditor(Editing(null, d, "deadline")) })
                            Tab.ALL -> AllScreen(visible.orEmpty(), today, onOpen = { t -> openEditor(Editing(t, null)) })
                            Tab.SET -> SettingsScreen(user, settings, prefs, remindOn,
                                setRemind = { remindOn = it; Reminders.setEnabled(context, it, tasks, settings) })
                        }
                    }
                }
                AnimatedVisibility(visible = ed == null, enter = fadeIn(tween(200)), exit = fadeOut(tween(80))) {
                    TabBar(tab, onTab = { tab = it }, onAdd = { openEditor(Editing(null, null, "deadline")) })
                }
            }

            // ---- 되돌리기 ----
            AnimatedVisibility(
                visible = undo != null,
                modifier = Modifier.align(Alignment.BottomCenter).navigationBarsPadding().padding(bottom = if (ed == null) 84.dp else 20.dp),
                enter = fadeIn(tween(160)) + slideInVertically(tween(260, easing = EaseMove)) { it / 2 },
                exit = fadeOut(tween(140)) + slideOutVertically(tween(180)) { it / 3 },
            ) {
                var shown by remember { mutableStateOf<Undo?>(null) }
                undo?.let { shown = it }
                shown?.let { u -> UndoBar(u, key = undo) { u.undo(); undo = null } }
            }

            // ---- 줄 메뉴 ----
            RowMenu(menu, today, onDismiss = { menu = null },
                onDone = { menu?.let(::toggle); menu = null },
                onEdit = { menu?.let { openEditor(Editing(it.task, it.date)) }; menu = null },
                onLater = { menu?.let { later(it.task) }; menu = null },
                onSkip = { menu?.let(::skip); menu = null },
                onDelete = { menu?.let { removeSoon(it.task) }; menu = null })
        }
    }
}

/** 움직임 곡선 (tokens.MOTION 의 ease-move). */
val EaseMove = androidx.compose.animation.core.CubicBezierEasing(.32f, .72f, 0f, 1f)

// ---------------- 아래 탭 ----------------

@Composable
internal fun TabBar(tab: Tab, onTab: (Tab) -> Unit, onAdd: () -> Unit) {
    val pal = LocalPal.current
    Box(Modifier.fillMaxWidth().background(pal.surface).navigationBarsPadding()) {
        Hair(Modifier.align(Alignment.TopCenter))
        Row(Modifier.fillMaxWidth().height(64.dp), verticalAlignment = Alignment.CenterVertically) {
            for (t in listOf(Tab.HOME, Tab.CAL, null, Tab.ALL, Tab.SET)) {
                Box(Modifier.weight(1f), contentAlignment = Alignment.Center) {
                    if (t == null) {
                        Box(
                            Modifier.offset(y = (-10).dp).size(56.dp).shadow(8.dp, CircleShape, spotColor = pal.teal, ambientColor = pal.teal)
                                .clip(CircleShape).background(pal.teal).press(onClick = onAdd),
                            contentAlignment = Alignment.Center,
                        ) {
                            Canvas(Modifier.size(20.dp)) {
                                val w = 1.8.dp.toPx()
                                drawLine(pal.onTeal, Offset(size.width / 2, 0f), Offset(size.width / 2, size.height), w, StrokeCap.Round)
                                drawLine(pal.onTeal, Offset(0f, size.height / 2), Offset(size.width, size.height / 2), w, StrokeCap.Round)
                            }
                        }
                    } else {
                        val on = t == tab
                        val c = if (on) pal.teal else pal.text2
                        Column(Modifier.clip(RoundedCornerShape(12.dp)).tap { onTab(t) }.padding(horizontal = 12.dp, vertical = 6.dp),
                            horizontalAlignment = Alignment.CenterHorizontally) {
                            TabIcon(t, c)
                            Spacer(Modifier.height(4.dp))
                            Text(t.label, style = T.micro, color = c)
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun TabIcon(t: Tab, c: Color) {
    Canvas(Modifier.size(20.dp)) {
        val s = size.width
        val w = 1.4.dp.toPx()
        val st = Stroke(w, cap = StrokeCap.Round)
        when (t) {
            Tab.HOME -> {           // 언덕 위의 돌멩이
                drawLine(c, Offset(s * .1f, s * .82f), Offset(s * .9f, s * .82f), w, StrokeCap.Round)
                val p = Path().apply {
                    moveTo(s * .22f, s * .78f); cubicTo(s * .2f, s * .4f, s * .8f, s * .4f, s * .78f, s * .78f); close()
                }
                drawPath(p, c, style = st)
                drawCircle(c, w * .7f, Offset(s * .42f, s * .62f)); drawCircle(c, w * .7f, Offset(s * .58f, s * .62f))
            }
            Tab.CAL -> {
                drawRoundRect(c, Offset(s * .14f, s * .22f), Size(s * .72f, s * .64f), CornerRadius(3.dp.toPx()), style = st)
                drawLine(c, Offset(s * .14f, s * .42f), Offset(s * .86f, s * .42f), w)
                drawLine(c, Offset(s * .34f, s * .12f), Offset(s * .34f, s * .3f), w, StrokeCap.Round)
                drawLine(c, Offset(s * .66f, s * .12f), Offset(s * .66f, s * .3f), w, StrokeCap.Round)
            }
            Tab.ALL -> for ((k, len) in listOf(.72f, .72f, .48f).withIndex()) {
                val y = s * (.3f + k * .2f)
                drawLine(c, Offset(s * .16f, y), Offset(s * (.16f + len), y), w, StrokeCap.Round)
            }
            Tab.SET -> {
                drawCircle(c, s * .17f, style = st)
                for (k in 0 until 8) {
                    val a = Math.toRadians(k * 45.0)
                    val r0 = s * .3f; val r1 = s * .42f
                    drawLine(c, Offset(s / 2 + r0 * kotlin.math.cos(a).toFloat(), s / 2 + r0 * kotlin.math.sin(a).toFloat()),
                        Offset(s / 2 + r1 * kotlin.math.cos(a).toFloat(), s / 2 + r1 * kotlin.math.sin(a).toFloat()), w, StrokeCap.Round)
                }
            }
        }
    }
}

// ---------------- 되돌리기 띠 ----------------

@Composable
internal fun UndoBar(u: Undo, key: Any?, onUndo: () -> Unit) {
    val pal = LocalPal.current
    val ink = LitTokens.ink
    var left by remember(key) { mutableIntStateOf(5) }
    val prog = remember(key) { androidx.compose.animation.core.Animatable(1f) }
    LaunchedEffect(key) {
        launch { prog.animateTo(0f, tween(5_000, easing = androidx.compose.animation.core.LinearEasing)) }
        while (left > 1) { delay(1_000); left-- }
    }
    Box(Modifier.padding(horizontal = 16.dp).widthIn(max = 420.dp).fillMaxWidth()
        .shadow(12.dp, RoundedCornerShape(14.dp), spotColor = ink).clip(RoundedCornerShape(14.dp)).background(ink)) {
        Row(Modifier.fillMaxWidth().padding(start = 18.dp, end = 8.dp).height(54.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(u.verb, style = T.body, color = LitTokens.pale2.copy(alpha = .7f))
            Spacer(Modifier.width(10.dp))
            Text(u.title, Modifier.weight(1f), style = T.leadM, color = LitTokens.pale, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Column(Modifier.clip(RoundedCornerShape(10.dp)).tap(onUndo).padding(horizontal = 12.dp, vertical = 4.dp),
                horizontalAlignment = Alignment.CenterHorizontally) {
                Text("되돌리기", style = T.leadM, color = LitTokens.tealLit)
                Text("$left", style = T.micro, color = LitTokens.pale2.copy(alpha = .6f))
            }
        }
        Canvas(Modifier.align(Alignment.BottomStart).fillMaxWidth().height(2.dp)) {
            drawLine(LitTokens.tealLit, Offset(0f, size.height / 2), Offset(size.width * prog.value, size.height / 2), size.height)
        }
    }
}

internal val Dp.px: Float @Composable get() = with(LocalDensity.current) { this@px.toPx() }
