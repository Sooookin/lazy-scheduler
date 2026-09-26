package com.lazyscheduler.app.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.runtime.CompositionLocalProvider
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import com.github.takahirom.roborazzi.captureRoboImage
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Plan
import com.lazyscheduler.app.core.Task
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import org.robolectric.annotation.GraphicsMode
import java.time.LocalDate

/**
 * 화면 갈무리 - 휴대폰 없이 PC 에서 새 화면을 본다 (참고 도안 '모바일 화면들' 과 나란히 놓고 비교).
 *   ./gradlew testDebugUnitTest --tests '*ScreenShots'   →  app/build/shots/ 의 PNG
 * 자료는 도안과 같은 모양의 본보기다. 저장소 · 계정은 쓰지 않는다.
 */
@RunWith(RobolectricTestRunner::class)
@GraphicsMode(GraphicsMode.Mode.NATIVE)
@Config(sdk = [35], qualifiers = "w402dp-h874dp-xxhdpi", application = android.app.Application::class)
class ScreenShots {
    private val today = LocalDate.now()
    private val top = 30.dp

    private fun daily(id: String, title: String, time: String, done: Set<String> = emptySet()) =
        Task(id = id, title = title, kind = "routine", dueTime = time, rule = mapOf("period" to "day", "business_only" to false),
            created = "2026-01-01T09:00:00", doneDates = done)

    private fun tasks(doneIds: Set<String>): List<Task> {
        val d = today.toString()
        fun dn(id: String) = if (id in doneIds) setOf(d) else emptySet()
        return listOf(
            daily("a", "아침 메일 정리하고 부문별 요약 공유", "08:30", dn("a")),
            daily("b", "팀 스탠드업", "08:40", dn("b")),
            Task(id = "c", title = "거래처 미팅", kind = "routine", dueTime = "10:00", created = "2026-01-01T09:00:00",
                rule = mapOf("period" to "day", "business_only" to false), doneDates = dn("c")),
            daily("d", "주문 현황 업데이트", "10:35", dn("d")),
            daily("e", "오후 자료 점검", "15:00", dn("e")),
            daily("f", "하루 마감 정리", "18:30", dn("f")),
            Task(id = "g", title = "월간 보고서 초안 검토", kind = "deadline", dueDate = d, done = "g" in doneIds),
            Task(id = "h", title = "출장 경비 정산", kind = "deadline", dueDate = d, done = "h" in doneIds),
            Task(id = "i", title = "주간 보고 제출", kind = "deadline", dueDate = today.plusDays(2).toString(), dueTime = "17:00"),
            Task(id = "j", title = "분기 계획 공유", kind = "deadline", dueDate = today.plusDays(6).toString(), dueTime = "15:00"),
            Task(id = "k", title = "월간 보고서 작성", kind = "routine", dueTime = "11:00", created = "2026-01-01T09:00:00",
                rule = mapOf("period" to "month", "basis" to "business_day", "n" to 1)),
            Task(id = "m", title = "새 노트북 알아보기", kind = "floating"),
        )
    }

    @Before fun still() { pebbleStill = true }

    /** 하늘 + 종이 + 탭 (App 과 같은 짜임). */
    @Composable
    private fun Frame(
        nowMin: Int, done: Set<String>, tall: Boolean = true, tabs: Boolean = true, night: Boolean = false,
        ghost: Int? = null, content: @Composable (List<Task>, List<HomeRow>) -> Unit,
    ) {
        val ts = tasks(done)
        val o = Plan.overview(ts, today)
        val rows = homeRows(o, today, nowMin)
        val allDone = rows.all { it.i.done }
        val lit = litMinute(nowMin.toDouble(), "auto", if (allDone) 1.0 else 0.0)
        CompositionLocalProvider(LocalPal provides palette(lit)) {
            val pal = LocalPal.current
            val tallH = top + 186.dp
            val skyH = if (tall) tallH else top + 86.dp
            Column(Modifier.fillMaxSize().background(pal.surface)) {
                BoxWithConstraints(Modifier.fillMaxWidth()) {
                    val d = LocalDensity.current
                    val wPx = with(d) { maxWidth.toPx() }
                    val beads = rows.filter { it.i.time.isNotEmpty() }.mapNotNull { r -> minsOf(r.i.time)?.let { Bead(r.n, it, r.i.done, r.late, r.next) } }
                    Sky(skyH, tallH, top, if (tall) 1f else 0f, beads, nowMin, ghost, null) {
                        Pebble(wPx, with(d) { skyH.toPx() - 2 * tallH.toPx() / 206f }, night || allDone, true, false, 0, null)
                    }
                }
                Box(Modifier.weight(1f)) { content(ts, rows) }
                if (tabs) TabBar(Tab.HOME, {}, {})
            }
        }
    }

    private fun shot(name: String, body: @Composable () -> Unit) = captureRoboImage("build/shots/$name.png") { body() }

    @Test fun home10() = shot("1a-home-1000") {
        Frame(600, setOf("b", "c")) { ts, rows -> Home(Plan.overview(ts, today), rows, today, 600, {}, {}) }
    }

    @Test fun home1830() = shot("1b-home-1830") {
        Frame(1110, setOf("a", "b", "c", "d", "e")) { ts, rows -> Home(Plan.overview(ts, today), rows, today, 1110, {}, {}) }
    }

    @Test fun homeNight() = shot("1c-home-2100") {
        Frame(1260, setOf("a", "b", "c", "d", "e", "f", "g", "h")) { ts, rows -> Home(Plan.overview(ts, today), rows, today, 1260, {}, {}) }
    }

    private fun draft(kind: String, time: String = "15:00", picking: Boolean = false, task: Task? = null) = Draft().apply {
        load(Editing(task, if (task == null) null else today, kind), today, true, emptyMap())
        this.time = if (task == null) time else this.time
        if (picking) { pickMin = 13 * 60 + 30; this.picking = true }
    }

    @Test fun addDeadline() = shot("1d-add") {
        val dr = draft("deadline")
        Frame(600, setOf("b", "c"), tabs = false, ghost = 900) { ts, _ ->
            Editor(Editing(null, null, "deadline"), dr, today, true, ts, {}, {}, {}, {}, {})
        }
    }

    @Test fun pickTime() = shot("1e-time") {
        val dr = draft("deadline", picking = true)
        Frame(600, setOf("b", "c"), tabs = false, ghost = 810) { ts, _ ->
            Editor(Editing(null, null, "deadline"), dr, today, true, ts, {}, {}, {}, {}, {})
        }
    }

    @Test fun addRoutine() = shot("1f-routine") {
        val dr = draft("routine", time = "")
        Frame(600, setOf("b", "c"), tabs = false) { ts, _ ->
            Editor(Editing(null, null, "routine"), dr, today, true, ts, {}, {}, {}, {}, {})
        }
    }

    @Test fun edit() = shot("1g-edit") {
        val t = tasks(emptySet()).first { it.id == "g" }
        val dr = draft("deadline", task = t)
        Frame(600, setOf("b", "c"), tall = false, tabs = false) { ts, _ ->
            Editor(Editing(t, today), dr, today, true, ts, {}, {}, {}, {}, {})
        }
    }

    @Test fun calendar() = shot("1h-cal") {
        Frame(600, setOf("b", "c"), tall = false) { ts, _ -> CalendarScreen(ts, today, 600, {}, {}, {}) }
    }

    @Test fun all() = shot("1i-all") {
        Frame(600, setOf("b", "c"), tall = false) { ts, _ -> AllScreen(ts, today) {} }
    }

    @Test fun settings() = shot("1j-settings") {
        Frame(600, setOf("b", "c"), tall = false) { _, _ ->
            val ctx = androidx.compose.ui.platform.LocalContext.current
            SettingsScreen(null, mapOf("notify_min" to 30L, "brief_time" to "08:30"), androidx.compose.runtime.remember { ViewPrefs(ctx) }, true) {}
        }
    }

    @Test fun menu() = shot("1k-menu") {
        Frame(600, setOf("b", "c")) { ts, rows ->
            Home(Plan.overview(ts, today), rows, today, 600, {}, {})
        }
        Box(Modifier.fillMaxSize()) {
            CompositionLocalProvider(LocalPal provides palette(600.0)) {
                val i = Instance(tasks(emptySet()).first { it.id == "e" }, today, false)
                RowMenu(i, today, {}, {}, {}, {}, {}, {})
            }
        }
    }

    @Test fun undo() = shot("1l-undo") {
        Box(Modifier.fillMaxSize()) {
            Frame(600, setOf("b", "c", "e")) { ts, rows -> Home(Plan.overview(ts, today), rows, today, 600, {}, {}) }
            CompositionLocalProvider(LocalPal provides palette(600.0)) {
                Box(Modifier.align(Alignment.BottomCenter).padding(bottom = 84.dp)) { UndoBar(Undo("완료", "오후 자료 점검") {}, 1) {} }
            }
        }
    }
}
