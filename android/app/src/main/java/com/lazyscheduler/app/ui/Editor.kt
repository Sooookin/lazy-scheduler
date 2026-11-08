package com.lazyscheduler.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.awaitEachGesture
import androidx.compose.foundation.gestures.awaitFirstDown
import androidx.compose.foundation.gestures.detectDragGesturesAfterLongPress
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.lazyscheduler.app.core.Recur
import com.lazyscheduler.app.core.ReminderPlan
import com.lazyscheduler.app.core.RuleCheck
import com.lazyscheduler.app.core.RulePick
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.core.When
import com.lazyscheduler.app.core.previewDates
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * 새 항목 · 고치기 (PC 와 같은 틀 - app.js 의 Form).
 *
 * 정할 것은 셋이다: 무엇 (이름) · 언제 (날짜 · 시각 · 반복) · 알림. 위에서 아래로 한 줄기:
 *   이름   문장으로 친다 ("교보 자료 수요일 3시 매주" - 날짜 · 시각 · 반복은 바로 읽어 값에 채운다)
 *   값     날짜 · 시각 / 반복 · 알림 (+ 중요 · 설명). 이 칸들이 곧 "무엇이 만들어질지" 다
 *   도구   지금 고르는 칸의 것 하나. 날짜를 고르면 다음은 시각 쪽으로 좁혀 간다
 *          날짜 → 빠른 날 + 달력 · 시각 → 그날의 시간표 + 자주 쓰는 시각 · 반복 → 빈도와 규칙 · 알림 → 알림 고르기
 * 종류(할 일 · 루틴 · 메모)는 고르지 않는다 - 언제를 정한 모양에서 따라 나온다:
 *   날짜 없음 → 메모   하루 → 할 일   이어진 날 → 기간 업무   반복 → 루틴
 * (2026-10 덜어냄: 줄마다 아래로 펼쳐지던 도구 · 시계판 · 맨 아래 요약 문장을 걷었다 - 요약은 값 칸과 같은 정보를
 * 두 번 쓰고 있었고, 시계판은 두 번 정확히 눌러야 했다)
 */

/** 마감 알림: 몇 분 전. "끔" 은 muted 로 저장한다 */
private val LEADS = listOf(0, 10, 30, 60, 180)
private fun leadLabel(m: Int) = when { m == 0 -> "정각"; m % 60 == 0 -> "${m / 60}시간"; else -> "${m}분" }
/** 며칠 앞서 한 번 더 (early_days) */
private val EARLY = listOf(0 to "없음", 1 to "하루", 2 to "이틀", 3 to "3일", 7 to "일주일")
private val EARLY_W = mapOf(1 to "하루", 2 to "이틀", 3 to "3일", 7 to "일주일")
/** 얼마나 자주: 단위와 간격을 한 줄에 (단위를 고르고 다시 간격을 고르던 두 단계를 없앴다) */
private val FREQ = listOf(Triple("day", 1, "매일"), Triple("week", 1, "매주"), Triple("week", 2, "격주"), Triple("month", 1, "매달"),
    Triple("month", 2, "격월"), Triple("month", 3, "분기"), Triple("month", 6, "반기"), Triple("year", 1, "매년"))

private fun mdw(d: LocalDate) = "${d.monthValue}월 ${d.dayOfMonth}일 (${WDS[d.dayOfWeek.value - 1]})"
private fun dOnly(d: LocalDate) = "${d.dayOfMonth}일 (${WDS[d.dayOfWeek.value - 1]})"
private fun relW(d: LocalDate, today: LocalDate): String {
    val n = days(today, d)
    return when { n == 0 -> "오늘"; n == 1 -> "내일"; n == 2 -> "모레"; n == -1 -> "어제"; n > 0 -> "${n}일 뒤"; else -> "${-n}일 지남" }
}
private fun offName(d: LocalDate) = Recur.HOLIDAY_NAMES[d.toString()] ?: when {
    Recur.isHoliday(d) -> "공휴일"; d.dayOfWeek.value == 7 -> "일요일"; else -> "토요일"
}
/** 비어 있을 때 처음 고른 시: 1~7시는 오후 (업무 시간으로 읽는다) */
private fun workHour(k: Int) = if (k == 0) 12 else if (k <= 7) k + 12 else k

/**
 * 쓰는 중인 것. App 이 들고 있다 - 시각을 고르는 동안 하늘(점선 구슬)도 이것을 본다.
 * mode: none (날짜 없음 = 메모) · one · range · rule.  span: 달력이 "여러 날" 로 고르는 중.
 * pending: 여러 날에서 시작만 누르고 끝을 기다리는 중.  freq: 날을 아직 안 고른 반복도 여기 남는다.
 * pane: 펼친 도구 ("" 이면 모두 접힘).
 */
class Draft {
    var title by mutableStateOf("")
    var note by mutableStateOf("")
    var noteOpen by mutableStateOf(false)
    var mode by mutableStateOf("none")
    var date by mutableStateOf<LocalDate?>(null)
    var end by mutableStateOf<LocalDate?>(null)
    var span by mutableStateOf(false)
    var pending by mutableStateOf(false)
    var time by mutableStateOf("")
    var lead by mutableStateOf<Int?>(null)
    var early by mutableIntStateOf(0)
    var alarm by mutableStateOf(true)
    /** 중요 (저장 칸은 pinned) - 목록 · 달력에 음영 */
    var imp by mutableStateOf(false)
    var rule by mutableStateOf<Map<String, Any?>?>(null)
    var ruleText by mutableStateOf("")
    /** 고치기로 연 규칙이 제안에 없으면(예전 분기 규칙 등) 목록 맨 위에 그대로 남긴다 */
    var keep by mutableStateOf<Pair<String, Map<String, Any?>>?>(null)
    var freq by mutableStateOf<Pair<String, Int>?>(null)
    var pane by mutableStateOf("date")
    var apLock by mutableStateOf(false)
    var error by mutableStateOf<String?>(null)
    var defaultLead = 30
    var today: LocalDate = LocalDate.now()

    /** 시각 판이 펼쳐져 있는가 (App: 하늘을 펴고 점선 구슬을 띄운다) */
    var picking: Boolean
        get() = pane == "time"
        set(v) { pane = if (v) "time" else if (pane == "time") "" else pane }

    val kind get() = when (mode) { "none" -> "floating"; "rule" -> "routine"; else -> "deadline" }
    val has get() = mode != "none"
    /** 매일 도는 루틴에는 "미리" 가 뜻이 없다 */
    val daily get() = mode == "rule" && rule?.get("period") == "day"
    val kindWord get() = when (mode) { "none" -> "메모"; "rule" -> "루틴"; "range" -> if (end != null) "기간 업무" else "할 일"; else -> "할 일" }

    fun load(e: Editing, today: LocalDate, businessOnly: Boolean, settings: Map<String, Any?>) {
        this.today = today
        val t = e.task
        title = t?.title ?: ""; note = t?.note ?: ""; noteOpen = false
        mode = "none"; date = null; end = null; span = false; pending = false
        rule = null; ruleText = ""; keep = null; freq = null; apLock = false; error = null
        tSpans = emptyList(); tBase = null; tKeep = null; editing = t != null
        time = t?.dueTime ?: ""; lead = t?.notifyMin; early = t?.earlyDays ?: 0; alarm = !(t?.muted ?: false); imp = t?.pinned ?: false
        defaultLead = ReminderPlan.defaultLead(settings); bizOn = businessOnly
        when {
            t != null && t.kind == "routine" && t.rule != null -> {
                mode = "rule"; rule = t.rule; ruleText = t.ruleText; freq = RulePick.unitOf(t.rule)
                keep = t.ruleText.takeIf { it.isNotEmpty() }?.let { it to t.rule!! }
                date = e.date ?: Recur.occurrences(t.rule, today, today.plusDays(430)).firstOrNull() ?: today
            }
            t != null && t.kind == "deadline" -> t.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }?.let { d ->
                val s = t.takeIf { it.isSpan }?.startDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
                if (s != null && s.isBefore(d)) setRange(s, d) else setOne(d)
            }
            t == null && e.kind != "floating" && e.date != null -> setOne(e.date)
        }
        span = mode == "range"
        // 새 항목은 날짜(루틴은 반복)부터 펼쳐 둔다. 고치기는 모두 접어 한눈에 보이게
        pane = if (t != null) "" else if (e.kind == "routine") "rule" else "date"
    }

    fun setOne(d: LocalDate) { mode = "one"; date = d; end = null; pending = false; rule = null; ruleText = ""; freq = null; keep = null }
    fun setRange(a0: LocalDate, b0: LocalDate) {
        val a = minOf(a0, b0); val b = maxOf(a0, b0)
        if (a == b) { setOne(a); return }
        mode = "range"; date = a; end = b; pending = false; span = true; rule = null; ruleText = ""; freq = null; keep = null
    }
    fun clearWhen() { mode = "none"; date = null; end = null; pending = false; rule = null; ruleText = ""; freq = null; keep = null; time = ""; span = false }

    /** 달력의 한 날을 눌렀다 */
    fun pickDay(k: LocalDate) {
        val f = freq
        if (f != null && f.first != "day") { ruleDay(k); return }
        if (f != null) chooseFreq(null)
        if (span) {
            val s = date
            if (pending && s != null) { setRange(s, k); return }
            mode = "range"; date = k; end = null; pending = true; rule = null; freq = null
            return
        }
        setOne(k)
        toTime()
    }
    /** 하루를 골랐고 시각이 비어 있으면 도구를 시각 쪽으로 좁힌다 */
    fun toTime() { if (mode == "one" && time.isEmpty()) pane = "time" }
    fun spanOn(on: Boolean) {
        span = on
        if (!on && mode == "range") date?.let { setOne(it) }
        else if (on && mode == "one") { mode = "range"; pending = true }
    }

    /** 반복: 빈도를 고르면, 날이 있으면 그 날에 도는 규칙을 고른다. 날이 없으면 달력에서 하나 누르기를 기다린다 */
    fun chooseFreq(f: Pair<String, Int>?) {
        if (f == null) { if (mode == "rule") mode = if (date != null) "one" else "none"; freq = null; rule = null; ruleText = ""; keep = null; return }
        freq = f; keep = null
        if (f.first == "day") {
            val b = (rule?.takeIf { it["period"] == "day" }?.get("business_only") as? Boolean) ?: true
            rule = mapOf("period" to "day", "business_only" to b); ruleText = Recur.describe(rule)
            mode = "rule"; end = null; pending = false; span = false
            date = Recur.occurrences(rule, today, today.plusDays(30)).firstOrNull() ?: today
            return
        }
        val d = date
        if (d != null) { end = null; pending = false; span = false; ruleDay(d) } else { rule = null; ruleText = "" }
    }
    /** 반복의 날. 주: 요일은 그 날을 따라간다 (여럿 골라 둔 것은 지킨다). 달 · 해: 앞서 고른 것과 같은 종류를 먼저 */
    fun ruleDay(k: LocalDate) {
        val (unit, every) = freq ?: return
        date = k; mode = "rule"; keep = null
        val wd = k.dayOfWeek.value - 1
        if (unit == "week") {
            @Suppress("UNCHECKED_CAST")
            val old = (rule?.takeIf { it["period"] == "week" }?.get("weekdays") as? List<Number>)?.map { it.toInt() }?.toSet()
            val wds = if (old != null && old.size > 1 && wd in old) old else setOf(wd)
            rule = RulePick.weekRule(wds, every, k, rule?.get("holiday_shift") as? String ?: if (wd < 5) "prev" else "none")
            ruleText = rule?.let { Recur.describe(it) } ?: ""
            return
        }
        val prev = rule?.takeIf { it["period"] == "month" }
        val items = Recur.suggest(k, unit, every)
        val hit = prev?.let { p -> items.firstOrNull { (_, r) -> r["basis"] == p["basis"] &&
            (r["basis"] != "business_day" || ((r["n"] as? Number)?.toInt() == -1) == ((p["n"] as? Number)?.toInt() == -1)) } }
        val it = hit ?: items.firstOrNull()
        rule = it?.second; ruleText = it?.first ?: ""
    }
    /** 저장할 규칙. 주 규칙의 기준 주는 고른 날의 주다 */
    fun ruleOut(): Map<String, Any?>? {
        val r = rule ?: return null
        return if (r["period"] == "week") r + ("anchor" to (r["anchor"] ?: (date ?: today).toString())) else r
    }
    fun occ(): List<LocalDate> = ruleOut()?.let { Recur.occurrences(it, today, today.plusDays(430)) } ?: emptyList()

    // ---------- 이름 = 문장 (PC 의 readName) ----------
    // 이름 안에 적은 날짜 · 시각 · 반복("수요일 3시 매주")을 치는 대로 읽어 값에 채운다. 읽은 말은 이름 칸에서 옅게 칠하고,
    // 저장할 때 이름에서 뺀다. 칠 때마다 읽기 전의 값으로 돌아간 뒤 새로 읽는다 - 치는 도중의 반쪽 낱말이 남지 않게.
    // 값 · 도구를 손으로 만지면 그때의 값이 굳는다(fixName). "그대로 두기" 는 읽기 전으로 되돌리고, 그 말이 이름에 남아 있는 동안은
    // 다시 읽지 않는다. 고치기에서는 읽지 않는다 (이미 정리된 이름이고, 날짜는 값 칸에 있다).
    private data class Snap(val mode: String, val date: LocalDate?, val end: LocalDate?, val span: Boolean, val pending: Boolean, val time: String,
                            val rule: Map<String, Any?>?, val ruleText: String, val keep: Pair<String, Map<String, Any?>>?, val freq: Pair<String, Int>?, val pane: String)
    private fun snap() = Snap(mode, date, end, span, pending, time, rule, ruleText, keep, freq, pane)
    private fun restore(b: Snap) { mode = b.mode; date = b.date; end = b.end; span = b.span; pending = b.pending; time = b.time
        rule = b.rule; ruleText = b.ruleText; keep = b.keep; freq = b.freq; pane = b.pane }
    var tSpans by mutableStateOf<List<Pair<Int, Int>>>(emptyList()); private set
    private var tBase: Snap? = null
    private var tKeep: List<String>? = null
    private var editing = false
    private var bizOn = true

    fun typeTitle(v: String) { title = v; readName() }
    fun fixName() { tBase = null }
    fun keepName() { tKeep = tSpans.map { title.substring(it.first, it.second.coerceAtMost(title.length)) }; tBase?.let { restore(it) }; tBase = null; tSpans = emptyList() }
    private fun readName() {
        if (tKeep?.all { title.contains(it) } == false) tKeep = null
        tBase?.let { restore(it) }; tBase = null
        tSpans = emptyList()
        if (tKeep != null || editing || title.trim().length < 2) return
        val p = readWhen(title) ?: return
        if (p.spans.isEmpty() || (p.date == null && p.rule == null && !(p.time != null && has))) return
        tBase = snap()
        applyWhen(p)
        tSpans = p.spans
        toTime()
    }
    /** 이름에서 읽은 것 (PC 의 readWhen 결과) */
    class WhenRead(val date: LocalDate?, val end: LocalDate?, val time: String?, val rule: Map<String, Any?>?, val spans: List<Pair<Int, Int>>)
    private fun readWhen(t: String): WhenRead? {
        val biz: ((String) -> Boolean)? = if (bizOn) { k -> runCatching { Recur.isBusinessDay(LocalDate.parse(k)) }.getOrDefault(true) } else null
        val day = { k: String? -> k?.let { runCatching { LocalDate.parse(it) }.getOrNull() } }
        // 비슷한 말로 짐작한 것(오타 고침)은 이름에서는 읽지 않는다 - 이름 안의 낱말을 날짜로 오해하기 쉽다
        if (When.parse(t, today.toString(), biz)?.notes?.contains("비슷한 말로 읽음") == true) return null
        val rr = When.rule(t)
        var rest = t
        val spans = mutableListOf<Pair<Int, Int>>()
        if (rr != null && rr.span.size == 2 && rr.span[0] in 0..rr.span[1] && rr.span[1] <= t.length) {
            val (a, b) = rr.span[0] to rr.span[1]
            rest = t.substring(0, a) + " ".repeat(b - a) + t.substring(b); spans += a to b
        }
        val p = When.parse(rest, today.toString(), biz)
        p?.spans?.forEach { spans += it.start to it.end }
        val time = p?.time
        if (rr != null && spans.isNotEmpty()) {
            val base = day(p?.date) ?: date ?: today
            var r: Map<String, Any?> = rr.rule ?: if (rr.need == "day") mapOf("period" to "month", "basis" to "day", "n" to base.dayOfMonth) else return null
            if (r["period"] == "week" && rr.need == "wd") r = r + ("weekdays" to listOf(base.dayOfWeek.value - 1))
            if (r["period"] == "month") {
                val m0 = base.monthValue - 1
                if (rr.every == 2) r = r + ("months" to listOf(0, 2, 4, 6, 8, 10).map { (m0 + it) % 12 + 1 }.sorted())
                if (rr.year == true) r = r + ("months" to listOf(base.monthValue))
            }
            if (r["period"] != "day") r = linkedMapOf<String, Any?>("holiday_shift" to "prev") + r
            return WhenRead(base, null, time, r, spans)
        }
        if (p?.date != null) return WhenRead(day(p.start ?: p.date), if (p.start != null) day(p.date) else null, time, null, spans)
        return if (time != null) WhenRead(null, null, time, null, spans) else null
    }
    private fun applyWhen(p: WhenRead) {
        when {
            p.rule != null -> {
                mode = "rule"; rule = p.rule; ruleText = Recur.describe(p.rule); freq = RulePick.unitOf(p.rule); keep = null
                end = null; pending = false; span = false
                if (date == null) date = p.date
                if (p.rule["period"] == "day") date = Recur.occurrences(p.rule, today, today.plusDays(30)).firstOrNull() ?: date
            }
            p.end != null && p.date != null -> setRange(p.date, p.end)
            p.date != null -> { setOne(p.date); span = false }
            !has -> return              // 시각만 쳤는데 날짜가 없으면 시각도 둘 데가 없다
        }
        p.time?.let { time = it }
    }
    /** 저장할 이름: 읽은 말을 뺀 것 (다 빼서 비면 그대로) */
    fun cleanTitle(): String {
        var t = title
        for ((a, b) in tSpans.sortedByDescending { it.first }) if (b <= t.length) t = t.substring(0, a) + " " + t.substring(b)
        return t.replace(Regex("\\s+"), " ").trim().ifEmpty { title.trim() }
    }

    /** 저장할 필드 (저장된 모양 그대로). 모자라면 error 를 적고 null */
    fun fields(): Map<String, Any?>? {
        val t = cleanTitle()
        if (t.isEmpty()) { error = "이름을 입력하세요"; return null }
        val f = linkedMapOf<String, Any?>("title" to t.take(200), "note" to note.trim().take(2000), "kind" to kind, "pinned" to imp)
        when (kind) {
            "routine" -> {
                if (freq != null && rule == null) { error = "반복할 날을 달력에서 고르세요"; pane = "rule"; return null }
                val (clean, err) = RuleCheck.validate(ruleOut())
                if (err != null) { error = err; return null }
                f += mapOf("rule" to clean, "due_date" to null, "start_date" to null, "due_time" to time, "notify_min" to lead,
                    "muted" to !alarm, "early_days" to early.takeIf { it > 0 && !daily })
            }
            "deadline" -> {
                val d = date!!
                val e = end?.takeIf { mode == "range" }
                if (e != null && d.plusYears(1).isBefore(e)) { error = "기간은 1년까지 잡을 수 있습니다"; return null }
                f += mapOf("rule" to null, "due_date" to (e ?: d).toString(), "start_date" to e?.let { d.toString() }, "due_time" to time,
                    "notify_min" to lead, "muted" to !alarm, "early_days" to early.takeIf { it > 0 })
            }
            else -> f += mapOf("rule" to null, "due_date" to null, "start_date" to null, "due_time" to "", "notify_min" to null,
                "muted" to false, "early_days" to null)
        }
        return f
    }

    // ---------- 읽어 주는 말 ----------
    fun dateText(): String {
        val d = date ?: return ""
        return when (mode) {
            "rule" -> "처음 ${mdw(d)}"
            // 기간은 요일을 빼고 짧게 - 폭이 좁아 끝 날이 잘렸다 (며칠 · 영업일 수는 줄 끝에)
            "range" -> end?.let { e -> "${d.monthValue}월 ${d.dayOfMonth}일 – " + (if (e.month == d.month) "${e.dayOfMonth}일" else "${e.monthValue}월 ${e.dayOfMonth}일") } ?: (mdw(d) + " – ")
            "one" -> mdw(d)
            else -> ""
        }
    }
    fun dateTail(): String {
        val d = date ?: return ""
        val e = end
        return when {
            mode == "range" && e != null -> {
                val n = days(d, e) + 1
                val b = (0..days(d, e)).count { Recur.isBusinessDay(d.plusDays(it.toLong())) }
                "${n}일" + if (b != n) " · 영업일 $b" else ""
            }
            mode == "range" -> "끝 날을 누르세요"
            else -> relW(d, today)
        }
    }
    fun alertText(): String {
        if (!has) return ""
        if (!alarm) return "끔"
        val l = lead ?: defaultLead
        val p = mutableListOf(if (time.isNotEmpty()) (if (l == 0) "정각에" else "${leadLabel(l)} 전") else "아침 브리핑에서")
        if (early > 0 && !daily) p += (EARLY_W[early] ?: "${early}일") + " 전에도"
        return p.joinToString(" · ")
    }
    fun alertSay(brief: String): String {
        if (!alarm) return "이 항목은 알리지 않습니다."
        val l = lead ?: defaultLead
        val parts = mutableListOf(if (time.isNotEmpty()) (if (l == 0) "마감 시각에 알립니다" else "마감 ${leadLabel(l)} 전에 알립니다") else "시각이 없으면 아침 브리핑에서 알립니다")
        if (early > 0 && !daily) {
            val at = t12(time.ifEmpty { brief })
            val d = (end?.takeIf { mode == "range" } ?: date)
            parts += if (mode != "rule" && d != null) "${mdw(d.minusDays(early.toLong()))} ${at}에 미리 한 번 더"
                     else "회차마다 ${EARLY_W[early] ?: "${early}일"} 전 ${at}에 미리"
        }
        return parts.joinToString(" · ") + "."
    }
    fun receipt(): String {
        val tm = if (time.isNotEmpty()) " " + t12(time) else ""
        val d = date
        val w = when {
            mode == "none" || d == null -> "날짜 없이 메모로 둡니다"
            mode == "rule" -> rule?.let { "${ruleText}${tm} · 다음 " + occ().take(3).joinToString(", ") { md(it) } } ?: "반복할 날을 고르세요"
            mode == "range" && end != null -> "${mdw(d)}부터 ${mdw(end!!)}${tm}까지"
            else -> "${mdw(d)}${tm}까지 · ${relW(d, today)}"
        }
        val a = alertText()
        return w + (if (a.isNotEmpty()) " · 알림 $a" else "") + (if (imp) " · 중요" else "")
    }
}

// ---------------- 종이 ----------------

@Composable
fun Editor(
    e: Editing, draft: Draft, today: LocalDate, businessOnly: Boolean, others: List<Task>,
    onClose: () -> Unit, onSave: (Map<String, Any?>) -> Unit, onDelete: () -> Unit, onLater: () -> Unit, onSkip: () -> Unit,
    brief: String = "09:00",
) {
    val pal = LocalPal.current
    val d = draft
    val editing = e.task != null
    Column(Modifier.fillMaxSize().navigationBarsPadding().imePadding()) {
        // 머리: 무엇이 만들어지는지 · (고치기) 딸린 동작 · 닫기
        // 닫기는 상자(40)가 아니라 보이는 × (11) 의 끝이 오른쪽 여백 선에 선다
        Row(Modifier.padding(start = DOC, end = DOC - (40.dp - 11.dp) / 2, top = 16.dp), verticalAlignment = Alignment.CenterVertically) {
            Text(if (editing) "${d.kindWord} 고치기" else "새 ${d.kindWord}", style = T.label.copy(fontWeight = FontWeight.Medium), color = pal.teal)
            Spacer(Modifier.weight(1f))
            if (editing) {
                if (e.task?.kind == "deadline" && e.task?.done == false) TextBtn("내일로", pal.text2, onLater)
                if (e.task?.kind == "routine" && e.date != null) TextBtn("이번만 건너뛰기", pal.text2, onSkip)
                TextBtn("삭제", pal.danger, onDelete)
                Spacer(Modifier.width(8.dp))
            }
            CloseX(onClose)
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = DOC)) {
            NameField(d) { if (it.length <= 200) d.typeTitle(it) }
            ReadLine(d)
            Spacer(Modifier.height(12.dp))
            // 값: 날짜 · 시각 / 반복 · 알림. 고르는 중인 칸은 아래에 청록 밑줄 하나
            val open = { p: String -> d.pane = if (d.pane == p) "" else p }
            Hair()
            Row(Modifier.fillMaxWidth()) {
                Cell("날짜", d.dateText().ifEmpty { "없음" }, Modifier.weight(1.25f), empty = !d.has, on = d.pane == "date", tail = d.dateTail(),
                    onClear = if (d.has) ({ d.clearWhen() }) else null) { d.fixName(); open("date") }
                VLine()
                Cell("시각", if (d.time.isEmpty()) (if (d.has) "없음" else "날짜를 정하면") else t12(d.time), Modifier.weight(1f), empty = d.time.isEmpty(),
                    on = d.pane == "time", locked = !d.has, onClear = if (d.time.isNotEmpty()) ({ d.time = "" }) else null) { d.fixName(); open("time") }
            }
            Hair()
            Row(Modifier.fillMaxWidth()) {
                val fq = d.freq?.let { f -> FREQ.firstOrNull { it.first == f.first && it.second == f.second }?.third }
                Cell("반복", if (d.rule != null) d.ruleText else if (fq != null) "$fq · 날을 고르세요" else "안 함", Modifier.weight(1.25f), empty = d.freq == null,
                    on = d.pane == "rule", onClear = if (d.freq != null) ({ d.chooseFreq(null) }) else null) { d.fixName(); open("rule") }
                VLine()
                Cell("알림", if (d.has) d.alertText() else "날짜를 정하면", Modifier.weight(1f), empty = !d.has, on = d.pane == "alert", locked = !d.has) { open("alert") }
            }
            Hair()
            Row(Modifier.fillMaxWidth().height(44.dp), verticalAlignment = Alignment.CenterVertically) {
                ImpToggle(d.imp) { d.imp = !d.imp }
                Spacer(Modifier.weight(1f))
                if (!(d.noteOpen || d.note.isNotEmpty())) TextBtn("＋ 설명", pal.text2) { d.noteOpen = true }
            }
            if (d.noteOpen || d.note.isNotEmpty()) { Hair(); NoteField(d.note) { if (it.length <= 2000) d.note = it } }
            Hair()
            Holiday(d, businessOnly)
            // 도구: 지금 고르는 칸의 것 하나 (상자 없이)
            Column(Modifier.padding(top = 14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                when (d.pane) {
                    "date" -> DatePane(d, today, others.filter { it.id != e.task?.id })
                    "time" -> TimePane(d, others.filter { it.id != e.task?.id })
                    "rule" -> RulePane(d, today)
                    "alert" -> AlertPane(d, brief)
                }
            }
            d.error?.let { Text(it, Modifier.padding(top = 12.dp), style = T.body, color = pal.danger) }
            Spacer(Modifier.height(16.dp))
        }
        Hair()
        Row(Modifier.padding(horizontal = DOC).padding(top = 12.dp, bottom = 16.dp), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Ghost("취소", Modifier.weight(.35f), onClick = onClose)
            Primary(if (editing) "저장" else "${d.kindWord} 추가", Modifier.weight(.65f)) { d.fields()?.let(onSave) }
        }
    }
}

@Composable
private fun TextBtn(text: String, color: Color, onClick: () -> Unit) {
    Text(text, Modifier.clip(RoundedCornerShape(6.dp)).press(onClick = onClick).padding(horizontal = 10.dp, vertical = 6.dp),
        style = T.body, color = color)
}

/** 이름: 상자 없이 제목처럼. 밑줄 하나가 "여기에 쓴다" 를 말한다. 날짜로 읽은 말은 그 자리에 옅게 칠한다 */
@Composable
private fun NameField(d: Draft, onChange: (String) -> Unit) {
    val pal = LocalPal.current
    var focus by remember { mutableStateOf(false) }
    val style = T.title.copy(fontWeight = FontWeight.Medium, color = pal.text)
    val hi = pal.teal.copy(alpha = .16f)
    val spans = d.tSpans
    Box(Modifier.fillMaxWidth().padding(top = 14.dp).drawBehind {
        val w = (if (focus) 1.5.dp else 1.dp).toPx()
        drawLine(if (focus) pal.teal else pal.hair2, Offset(0f, size.height - w / 2), Offset(size.width, size.height - w / 2), w)
    }.padding(bottom = 12.dp)) {
        if (d.title.isEmpty()) Text("무엇을 할까요?  예: 교보 자료 금요일 3시", style = style.copy(fontWeight = FontWeight.Light), color = pal.faint, maxLines = 1)
        BasicTextField(d.title, onChange, Modifier.fillMaxWidth().onFocusChanged { focus = it.isFocused }, singleLine = true,
            textStyle = style, cursorBrush = SolidColor(pal.teal),
            visualTransformation = if (spans.isEmpty()) androidx.compose.ui.text.input.VisualTransformation.None else androidx.compose.ui.text.input.VisualTransformation { t ->
                val b = androidx.compose.ui.text.AnnotatedString.Builder(t)
                for ((a0, b0) in spans) if (a0 < b0 && b0 <= t.length) b.addStyle(androidx.compose.ui.text.SpanStyle(background = hi), a0, b0)
                androidx.compose.ui.text.input.TransformedText(b.toAnnotatedString(), androidx.compose.ui.text.input.OffsetMapping.Identity)
            })
    }
}

/** 이름에서 읽은 말 한 줄 · 그대로 두기 */
@Composable
private fun ReadLine(d: Draft) {
    val pal = LocalPal.current
    if (d.tSpans.isEmpty()) return
    Row(Modifier.padding(top = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Text("칠한 말은 값으로 옮기고 이름에서 뺍니다", Modifier.weight(1f), style = T.label, color = pal.text2, maxLines = 2, overflow = TextOverflow.Ellipsis)
        TextBtn("그대로 두기", pal.teal) { d.keepName() }
    }
}

@Composable
private fun NoteField(value: String, onChange: (String) -> Unit) {
    val pal = LocalPal.current
    Box(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(vertical = 12.dp)) {
        if (value.isEmpty()) Text("설명 · 링크 · 참고할 것", style = T.lead, color = pal.faint)
        BasicTextField(value, onChange, Modifier.fillMaxWidth(), textStyle = T.lead.copy(color = pal.text, lineHeight = 20.sp),
            cursorBrush = SolidColor(pal.teal))
    }
}

@Composable
private fun VLine() { Box(Modifier.width(1.dp).height(56.dp).background(LocalPal.current.hair)) }

/** 값 칸: 위에 이름, 아래에 값 (+ 상대 날짜 · 지우기). 고르는 중인 칸은 아래에 청록 밑줄 하나 */
@Composable
private fun Cell(label: String, value: String, modifier: Modifier, empty: Boolean, on: Boolean, tail: String = "", locked: Boolean = false,
                 onClear: (() -> Unit)? = null, onClick: () -> Unit) {
    val pal = LocalPal.current
    Row(
        modifier.height(56.dp)
            .then(if (locked) Modifier else Modifier.press(onClick = onClick))
            .drawBehind { if (on) drawRect(pal.teal, Offset(0f, size.height - 2.dp.toPx()), Size(size.width, 2.dp.toPx())) }
            .padding(start = 10.dp, end = 2.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(Modifier.weight(1f)) {
            Text(label, style = T.label, color = if (on) pal.teal else pal.text2)
            Spacer(Modifier.height(3.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(apText(value), Modifier.weight(1f, fill = false), style = T.lead, color = if (empty || locked) pal.faint else pal.text,
                    maxLines = 1, overflow = TextOverflow.Ellipsis)
                if (tail.isNotEmpty()) Text(" · $tail", style = T.label, color = pal.text2, maxLines = 1)
            }
        }
        if (onClear != null) Box(Modifier.size(28.dp).clip(RoundedCornerShape(6.dp)).press(onClick = onClear), contentAlignment = Alignment.Center) {
            Canvas(Modifier.size(8.dp)) {
                val w = 1.3.dp.toPx()
                drawLine(pal.faint, Offset.Zero, Offset(size.width, size.height), w, StrokeCap.Round)
                drawLine(pal.faint, Offset(size.width, 0f), Offset(0f, size.height), w, StrokeCap.Round)
            }
        }
    }
}

/** 중요: 누르면 바로 켜고 끈다 (펼치는 도구가 없다). 켜지면 목록에서 음영을 입는다 */
@Composable
private fun ImpToggle(on: Boolean, onClick: () -> Unit) {
    val pal = LocalPal.current
    val knob by animateFloatAsState(if (on) 1f else 0f, tween(160), label = "imp")
    Row(Modifier.clip(RoundedCornerShape(6.dp)).press(onClick = onClick).padding(horizontal = 10.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
        Canvas(Modifier.size(28.dp, 16.dp)) {
            val h = size.height
            drawRoundRect(if (on) pal.imp else pal.text.copy(alpha = .14f), cornerRadius = CornerRadius(h / 2))
            drawCircle(pal.field, h / 2 - 2.dp.toPx(), Offset(h / 2 + (size.width - h) * knob, h / 2))
        }
        Spacer(Modifier.width(8.dp))
        Text(if (on) "중요 · 목록에 음영" else "중요", style = T.body, color = if (on) pal.text else pal.text2)
    }
}

/** 쉬는 날을 골랐으면 앞뒤 영업일을 내민다. 그대로 둬도 된다 */
@Composable
private fun Holiday(d: Draft, businessOnly: Boolean) {
    val pal = LocalPal.current
    val day = d.date ?: return
    if (!businessOnly || d.mode != "one" || Recur.isBusinessDay(day)) return
    val a = Recur.nextBusinessDay(day, forward = false); val b = Recur.nextBusinessDay(day)
    Column {
        Row(Modifier.padding(start = 68.dp, top = 6.dp, bottom = 6.dp), verticalAlignment = Alignment.CenterVertically) {
            Text("${day.monthValue}월 ${day.dayOfMonth}일은 ${offName(day)}", Modifier.weight(1f, fill = false), style = T.body, color = pal.hol, maxLines = 1)
            if (!a.isBefore(d.today)) TextBtn("${dOnly(a)}로", pal.teal) { d.setOne(a) }
            TextBtn("${dOnly(b)}로", pal.teal) { d.setOne(b) }
        }
        Hair()
    }
}

/** 칸 묶음 (빈도 · 알림 · 요일): 한 틀 안의 칸, 고른 칸만 채운다 */
@Composable
private fun Opts(labels: List<String>, on: (Int) -> Boolean, enabled: Boolean = true, onPick: (Int) -> Unit) {
    val pal = LocalPal.current
    Row(Modifier.fillMaxWidth().height(36.dp).clip(RoundedCornerShape(6.dp)).border(1.dp, pal.hair2, RoundedCornerShape(6.dp)).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        labels.forEachIndexed { i, l ->
            val sel = on(i)
            Box(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(6.dp)).background(if (sel) pal.teal else Color.Transparent)
                .then(if (enabled) Modifier.press { onPick(i) } else Modifier), contentAlignment = Alignment.Center) {
                Text(l, style = if (sel) T.body.copy(fontWeight = FontWeight.Medium) else T.body,
                    color = if (sel) pal.onTeal else if (enabled) pal.text2 else pal.faint, maxLines = 1)
            }
        }
    }
}

@Composable
private fun Hint(text: String) = Text(text, style = T.label.copy(lineHeight = 17.sp), color = LocalPal.current.text2)

// ---------------- 날짜 ----------------

@Composable
private fun DatePane(d: Draft, today: LocalDate, others: List<Task>) {
    val pal = LocalPal.current
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text(if (d.mode == "rule") "처음 돌 날" else "언제까지?", style = T.body.copy(fontWeight = FontWeight.Medium), color = pal.text)
        Spacer(Modifier.weight(1f))
        if (d.mode == "rule") Text("밑줄 = 앞으로 돌 날", style = T.label, color = pal.text2)
        else Seg(listOf(false to "하루", true to "여러 날"), d.span, height = 30.dp, pad = 12.dp) { d.spanOn(it) }
    }
    // 빠른 날 다섯: 오늘 · 내일 · 모레 · 이번 주 금 · 다음 주 월 - 달력을 읽고 누르는 것보다 이름 하나가 빠르다
    if (d.mode != "rule" && !d.span) Row(Modifier.fillMaxWidth().horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for ((k, l, sub) in quickDays(today)) {
            val on = d.mode == "one" && d.date == k
            Row(Modifier.height(32.dp).clip(RoundedCornerShape(6.dp)).background(if (on) pal.teal else Color.Transparent)
                .border(1.dp, if (on) pal.teal else pal.hair2, RoundedCornerShape(6.dp))
                .press { d.setOne(k); d.span = false; d.toTime() }.padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
                Text(l, style = T.lead, color = if (on) pal.onTeal else pal.text)
                Spacer(Modifier.width(6.dp))
                Text(sub, style = T.label, color = if (on) pal.onTeal else pal.text2)
            }
        }
    }
    LineCal(d, today)
    if (d.mode != "rule") Hint("길게 눌러 끌면 여러 날 (기간)")
    val day = d.date
    if (d.mode == "one" && day != null) {
        val same = others.filter { it.kind == "deadline" && !it.done && it.dueDate == day.toString() }
        if (same.isNotEmpty()) Text("같은 날 마감 ${same.size}건 · " + same.take(3).joinToString(" · ") { it.title },
            style = T.body, color = pal.text2, maxLines = 2, overflow = TextOverflow.Ellipsis)
    }
}

/**
 * 달력 (줄노트). 세로선 · 바깥 테 없이 주 사이에 가로줄만. 표시하는 선은 칸 경계에서 떼어 숫자 바로 밑에
 * 숫자 폭(18dp)만큼 - 굵기로 뜻을 나눈다: 고른 날 3dp 청록 + 칸을 옅게 · 오늘 2dp 회색 ·
 * 반복으로 돌 날 2dp 옅은 청록 · 기간은 그 선이 끊김 없이 잇는다. 길게 눌러 끌면 기간.
 */
@Composable
private fun LineCal(d: Draft, today: LocalDate) {
    val pal = LocalPal.current
    val haptic = LocalHapticFeedback.current
    var month by remember(d.date == null) { mutableStateOf(YearMonth.from(d.date ?: today)) }
    var dragA by remember { mutableStateOf<LocalDate?>(null) }
    var dragB by remember { mutableStateOf<LocalDate?>(null) }
    val cellH = with(LocalDensity.current) { 40.dp.toPx() }
    val occ = remember(d.rule, d.date) { if (d.mode == "rule") d.occ().toSet() else emptySet() }
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("${month.year}년 ${month.monthValue}월", Modifier.weight(1f).padding(start = 4.dp), style = T.leadM, color = pal.text)
        for ((s, n) in listOf("‹" to -1L, "›" to 1L))
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(6.dp)).tap { month = month.plusMonths(n) }, contentAlignment = Alignment.Center) {
                Text(s, style = T.head, color = pal.text2)
            }
    }
    Row(Modifier.padding(top = 2.dp, bottom = 6.dp)) {
        WDS_SUN.forEachIndexed { k, w -> Text(w, Modifier.weight(1f), textAlign = TextAlign.Center, style = T.micro.copy(fontWeight = FontWeight.Normal), color = if (k == 0) pal.hol else pal.text2) }
    }
    val first = month.atDay(1)
    val grid0 = first.minusDays((first.dayOfWeek.value % 7).toLong())
    val shown: Pair<LocalDate, LocalDate>? = dragA?.let { a -> dragB?.let { b -> minOf(a, b) to maxOf(a, b) } }
        ?: if (d.mode == "range" && d.end != null) d.date!! to d.end!! else null
    fun at(o: Offset, w: Int): LocalDate =
        grid0.plusDays((((o.y / cellH).toInt().coerceIn(0, 5)) * 7 + ((o.x / (w / 7f)).toInt().coerceIn(0, 6))).toLong())
    Column(Modifier.drawBehind { drawLine(pal.hair, Offset(0f, size.height), Offset(size.width, size.height), 1.dp.toPx()) }
        .then(if (d.freq != null) Modifier else Modifier.pointerInput(month) {
            detectDragGesturesAfterLongPress(
                onDragStart = { o -> at(o, size.width).let { dragA = it; dragB = it }; haptic.performHapticFeedback(HapticFeedbackType.LongPress) },
                onDrag = { ch, _ -> val k = at(ch.position, size.width); if (k != dragB) { dragB = k; haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove) } },
                onDragEnd = { val a = dragA; val b = dragB; dragA = null; dragB = null; if (a != null && b != null) d.setRange(a, b) },
                onDragCancel = { dragA = null; dragB = null },
            )
        })) {
        var cur = grid0
        // 이 달이 걸친 주만 (5주인 달에 다음 달 한 주를 더 그리지 않는다)
        val weeks = (first.dayOfWeek.value % 7 + month.lengthOfMonth() + 6) / 7
        repeat(weeks) {
            Row {
                repeat(7) { col ->
                    val day = cur
                    val out = day.month != first.month
                    val (r0, r1) = shown ?: (null to null)
                    val inRange = r0 != null && r1 != null && !day.isBefore(r0) && !day.isAfter(r1)
                    val rs = inRange && day == r0; val re = inRange && day == r1
                    val on = if (shown != null) rs || re else when (d.mode) { "one", "rule" -> day == d.date; "range" -> day == d.date; else -> false }
                    val oc = !on && day in occ
                    val now = day == today
                    val sun = Recur.isHoliday(day) || day.dayOfWeek.value == 7
                    val color = when {
                        rs || re -> pal.onTeal           // 채운 동그라미 위 - 옆 달의 날이어도 흐리게 하지 않는다
                        out -> (if (sun) pal.hol else pal.text).copy(alpha = .3f)
                        inRange -> pal.text
                        on || oc -> pal.teal
                        sun -> pal.hol
                        else -> pal.text
                    }
                    Box(
                        Modifier.weight(1f).height(40.dp).drawBehind {
                            val w = size.width; val h = size.height; val cx = w / 2; val half = 9.dp.toPx()
                            drawLine(pal.hair, Offset(0f, 0f), Offset(w, 0f), 1.dp.toPx())
                            // 기간: 고른 날들을 한 덩어리 옅은 띠로 잇고 시작 · 끝 날은 채운 동그라미 (PC 와 같다).
                            // 띠 · 동그라미의 가운데는 숫자의 가운데(칸 위에서 18dp)에 맞춘다. 주가 바뀌는 줄 끝은 둥글게 닫는다
                            val my = 18.dp.toPx(); val bh = 13.dp.toPx(); val band = pal.teal.copy(alpha = .13f)
                            if (inRange) {
                                val x0 = if (rs) cx else if (col == 0) 4.dp.toPx() else 0f
                                val x1 = if (re) cx else if (col == 6) w - 4.dp.toPx() else w
                                if (x1 > x0) {
                                    val cr = CornerRadius(bh)
                                    val path = androidx.compose.ui.graphics.Path().apply {
                                        addRoundRect(androidx.compose.ui.geometry.RoundRect(x0, my - bh, x1, my + bh,
                                            topLeftCornerRadius = if (col == 0 && !rs) cr else CornerRadius.Zero, bottomLeftCornerRadius = if (col == 0 && !rs) cr else CornerRadius.Zero,
                                            topRightCornerRadius = if (col == 6 && !re) cr else CornerRadius.Zero, bottomRightCornerRadius = if (col == 6 && !re) cr else CornerRadius.Zero))
                                    }
                                    drawPath(path, band)
                                }
                                if (rs || re) drawCircle(pal.teal, 15.dp.toPx(), Offset(cx, my))
                            } else if (on) drawRect(pal.teal.copy(alpha = .07f), Offset(0f, 1.dp.toPx()))
                            fun bar(x0: Float, x1: Float, t: Float, c: Color) = drawRoundRect(c, Offset(x0, h - 6.dp.toPx() - t / 2), Size(x1 - x0, t), CornerRadius(t / 2))
                            val t3 = 3.dp.toPx(); val t2 = 2.dp.toPx()
                            when {
                                inRange -> {}
                                on -> bar(cx - half, cx + half, t3, pal.teal)
                                oc -> bar(cx - half, cx + half, t2, pal.teal.copy(alpha = .5f))
                                now -> bar(cx - half, cx + half, t2, pal.text.copy(alpha = .35f))
                            }
                        }.tap { if (out) month = YearMonth.from(day); d.pickDay(day) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("${day.dayOfMonth}", Modifier.padding(bottom = 4.dp),
                            style = T.head.copy(fontWeight = if (on || now || rs || re) FontWeight.Medium else FontWeight.Normal, fontFeatureSettings = "tnum"), color = color)
                    }
                    cur = cur.plusDays(1)
                }
            }
        }
    }
}

// ---------------- 시각 ----------------

/** 빠른 날 다섯 (PC 의 quickDays) */
private fun quickDays(today: LocalDate): List<Triple<LocalDate, String, String>> {
    val w = today.dayOfWeek.value - 1
    val fri = today.plusDays(((4 - w + 7) % 7).let { if (it == 0) 7 else it }.toLong())
    val mon = today.plusDays((7 - w).toLong())
    fun md2(k: LocalDate) = "${k.monthValue}/${k.dayOfMonth}"
    fun wd(k: LocalDate) = WDS[k.dayOfWeek.value - 1]
    return listOf(Triple(today, "오늘", wd(today)), Triple(today.plusDays(1), "내일", wd(today.plusDays(1))), Triple(today.plusDays(2), "모레", wd(today.plusDays(2))),
        Triple(fri, (if (days(today, fri) < 7) "이번 주" else "다음 주") + " 금", md2(fri)), Triple(mon, "다음 주 월", md2(mon)))
}

/** 그날 이미 시각이 정해진 일 (마감 · 루틴 회차) */
private fun dayList(day: LocalDate, others: List<Task>): List<Pair<String, String>> {
    val out = mutableListOf<Pair<String, String>>()
    for (t in others) {
        if (t.dueTime.isEmpty()) continue
        if (t.kind == "deadline" && !t.done && t.dueDate == day.toString()) out += t.dueTime to t.title
        else if (t.kind == "routine" && t.rule != null && day.toString() !in t.skipDates &&
            runCatching { Recur.occurrences(t.rule, day, day).isNotEmpty() }.getOrDefault(false)) out += t.dueTime to t.title
    }
    return out.sortedBy { it.first }
}

/** 자주 쓰는 시각: 지금까지 넣은 일들의 시각 가운데 많이 쓴 여덟 (시간순) */
private fun favTimes(others: List<Task>): List<String> {
    val c = HashMap<String, Int>()
    for (t in others) if (t.dueTime.isNotEmpty()) c[t.dueTime] = (c[t.dueTime] ?: 0) + (if (t.kind == "routine") 2 else 1)
    val top = c.entries.sortedWith(compareBy({ -it.value }, { it.key })).take(8).map { it.key }
    return (top.ifEmpty { listOf("09:00", "10:00", "11:00", "14:00", "15:00", "17:00") }).sorted()
}

/**
 * 시각 도구: 그날의 시간표(08 ~ 20 시)와 자주 쓰는 시각. 시간표는 그날 이미 있는 일을 점으로 놓고, 빈 곳을 누르면
 * 30분 단위로 그 시각이 된다 - "비어 있는 때" 가 보이는 채로 고른다. (예전의 시계판은 두 번 정확히 눌러야 했다)
 */
@Composable
private fun TimePane(d: Draft, others: List<Task>) {
    val pal = LocalPal.current
    val m = minsOf(d.time)
    val day = d.date
    Row(verticalAlignment = Alignment.CenterVertically) {
        Text("몇 시?", style = T.body.copy(fontWeight = FontWeight.Medium), color = pal.text)
        Spacer(Modifier.width(10.dp))
        Text(day?.let { mdw(it) + " 그날의 시간표" } ?: "", Modifier.weight(1f), style = T.label, color = pal.text2, maxLines = 1, overflow = TextOverflow.Ellipsis)
        Seg(listOf(0 to "오전", 1 to "오후"), if (m == null) -1 else if (m >= 720) 1 else 0, height = 30.dp, pad = 12.dp) { pm ->
            d.apLock = true
            val c = m ?: (9 * 60)
            d.time = hhmm((c % 720) + pm * 720)
        }
    }
    if (day == null) { Hint("날짜를 먼저 정하면 그날의 시간표가 보입니다."); return }
    val list = remember(day, others) { dayList(day, others) }
    var lo = 8 * 60; var hi = 20 * 60
    for ((t, _) in list + (if (m != null) listOf(d.time to "") else emptyList())) minsOf(t)?.let { lo = minOf(lo, it / 60 * 60); hi = maxOf(hi, (it + 60) / 60 * 60) }
    val tm = rememberTextMeasurer()
    Canvas(Modifier.fillMaxWidth().height(44.dp).pointerInput(lo, hi) {
        awaitEachGesture {
            val down = awaitFirstDown()
            val pad = 8.dp.toPx(); val w = size.width - pad * 2
            val mm = lo + ((down.position.x - pad) / w).coerceIn(0f, 1f) * (hi - lo)
            d.fixName(); d.time = hhmm(((mm / 30f).roundToInt() * 30) % 1440)
        }
    }) {
        val pad = 8.dp.toPx(); val w = size.width - pad * 2; val y = 16.dp.toPx()
        fun x(mm: Int) = pad + w * (mm - lo).toFloat() / (hi - lo)
        drawLine(pal.hair2, Offset(pad, y), Offset(size.width - pad, y), 1.dp.toPx())
        var k = lo
        while (k <= hi) {
            val big = (k / 60) % 3 == 0
            drawLine(pal.hair2, Offset(x(k), y), Offset(x(k), y + (if (big) 7 else 4).dp.toPx()), 1.dp.toPx())
            if (big) { val l = tm.measure("%02d".format(k / 60), T.label.copy(color = pal.text2)); drawText(l, topLeft = Offset(x(k) - l.size.width / 2f, y + 9.dp.toPx())) }
            k += 60
        }
        for ((t, _) in list) minsOf(t)?.let { drawCircle(pal.text2.copy(alpha = .45f), 5.5.dp.toPx(), Offset(x(it), y)) }
        if (m != null) { drawCircle(pal.teal.copy(alpha = .2f), 9.dp.toPx(), Offset(x(m), y)); drawCircle(pal.teal, 5.5.dp.toPx(), Offset(x(m), y)) }
    }
    Text(if (list.isEmpty()) "그날은 시각이 정해진 일이 없습니다" else "그날 이미 · " + list.take(3).joinToString(" · ") { t12(it.first) + " " + it.second } +
        (if (list.size > 3) " 외 ${list.size - 3}" else ""), style = T.body, color = pal.text2, maxLines = 2, overflow = TextOverflow.Ellipsis)
    Text("자주 쓰는 시각", style = T.label, color = pal.text2)
    val favs = remember(others) { favTimes(others) }
    for (row in favs.chunked(4)) Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        for (t in row) {
            val on = d.time == t
            Box(Modifier.weight(1f).height(32.dp).clip(RoundedCornerShape(6.dp)).background(if (on) pal.teal else Color.Transparent)
                .border(1.dp, if (on) pal.teal else pal.hair2, RoundedCornerShape(6.dp)).press { d.fixName(); d.time = t }, contentAlignment = Alignment.Center) {
                Text(apText(t12(t)), style = T.body.copy(fontFeatureSettings = "tnum"), color = if (on) pal.onTeal else pal.text, maxLines = 1)
            }
        }
        repeat(4 - row.size) { Spacer(Modifier.weight(1f)) }
    }
    Hint(if (m == null) "비워 두면 아침 브리핑에서 알립니다." else "")
}

// ---------------- 반복 ----------------

/**
 * 얼마나 자주 → (날이 있으면) 그 날에 도는 규칙들 (엔진이 만든다 - Recur.suggest).
 * 날이 아직 없을 때만 여기서도 달력을 띄운다. 처음 날을 바꾸려면 날짜 줄의 달력으로 (거기에 앞으로 돌 날이 찍힌다).
 */
@Composable
private fun RulePane(d: Draft, today: LocalDate) {
    val pal = LocalPal.current
    val f = d.freq
    Opts(FREQ.map { it.third }, on = { i -> f != null && FREQ[i].first == f.first && FREQ[i].second == f.second }) { i ->
        d.chooseFreq(FREQ[i].first to FREQ[i].second)
    }
    val day = d.date
    when {
        f == null -> Hint(if (day != null) "얼마나 자주 하는지 고르면 ${mdw(day)} 에 도는 규칙을 골라 드립니다." else "얼마나 자주 하는지 고르고, 이 일을 하는 날을 하나 누르세요.")
        f.first == "day" -> {
            val b = d.rule?.get("business_only") == true
            Opts(listOf("날마다", "영업일만"), on = { (it == 1) == b }) { i ->
                d.rule = mapOf("period" to "day", "business_only" to (i == 1)); d.ruleText = Recur.describe(d.rule)
            }
        }
        day == null -> Hint("이 일을 하는 날을 하나 누르세요. 그 날에 도는 규칙을 골라 드립니다.")
        f.first == "week" -> {
            @Suppress("UNCHECKED_CAST")
            val wds = (d.rule?.get("weekdays") as? List<Number>)?.map { it.toInt() }?.toSet() ?: emptySet()
            Opts(WDS, on = { it in wds }) { i ->
                val next = if (i in wds) (if (wds.size > 1) wds - i else wds) else wds + i
                d.rule = RulePick.weekRule(next, f.second, day, d.rule?.get("holiday_shift") as? String)
                d.ruleText = d.rule?.let { Recur.describe(it) } ?: ""
            }
        }
        else -> {
            val items = remember(day, f) { Recur.suggest(day, f.first, f.second) }
            val list = (d.keep?.takeIf { k -> items.none { it.first == k.first } }?.let { listOf(it) } ?: emptyList()) + items
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(6.dp)).border(1.dp, pal.hair2, RoundedCornerShape(6.dp))) {
                list.forEachIndexed { i, (label, r) ->
                    if (i > 0) Hair()
                    val on = label == d.ruleText
                    Row(Modifier.fillMaxWidth().height(42.dp).background(if (on) pal.teal.copy(alpha = .08f) else Color.Transparent)
                        .drawBehind { if (on) drawRect(pal.teal, size = Size(2.dp.toPx(), size.height)) }
                        .press { d.rule = r; d.ruleText = label; d.keep = null }.padding(horizontal = 14.dp),
                        verticalAlignment = Alignment.CenterVertically) {
                        Text(label, Modifier.weight(1f), style = if (on) T.leadM else T.lead, color = if (on) pal.teal else pal.text, maxLines = 1)
                        Text(previewDates(r, day, 3).drop(1).joinToString(" · "), style = T.label, color = pal.text2)
                    }
                }
            }
        }
    }
    if (f != null && f.first != "day" && day == null) LineCal(d, today)
    val r = d.rule
    if (r != null && r["period"] != "day" && !RulePick.countsBusinessDays(r)) {
        var open by remember { mutableStateOf(false) }
        val shift = r["holiday_shift"] as? String ?: "prev"
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("쉬는 날에 걸리면", style = T.body, color = pal.text2)
            Spacer(Modifier.width(8.dp))
            Box {
                Box(Modifier.height(30.dp).clip(RoundedCornerShape(6.dp)).border(1.dp, pal.hair2, RoundedCornerShape(6.dp)).tap { open = true }
                    .padding(horizontal = 12.dp), contentAlignment = Alignment.Center) {
                    Text((RulePick.SHIFTS.firstOrNull { it.first == shift }?.second ?: shift) + " ▾", style = T.body, color = pal.text)
                }
                DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = pal.surface) {
                    for ((v, label) in RulePick.SHIFTS) DropdownMenuItem(text = { Text(label, style = T.lead, color = pal.text) },
                        onClick = { open = false; d.rule = d.rule?.plus("holiday_shift" to v) })
                }
            }
        }
    }
    if (r != null) {
        val nexts = remember(r, day) { d.occ().take(4) }
        if (nexts.isNotEmpty()) Column {
            Hair()
            Row(Modifier.padding(top = 10.dp), verticalAlignment = Alignment.CenterVertically) {
                Text("다음", style = T.body, color = pal.text2)
                Spacer(Modifier.width(10.dp))
                Text(nexts.joinToString(" · ") { md(it) }, Modifier.weight(1f), style = T.body.copy(fontFeatureSettings = "tnum"), color = pal.teal, maxLines = 1)
                if (f?.first != "day") TextBtn("처음 날 바꾸기", pal.teal) { d.pane = "date" }
            }
        }
    }
}

// ---------------- 알림 ----------------

@Composable
private fun AlertPane(d: Draft, brief: String) {
    val pal = LocalPal.current
    val cur = d.lead ?: d.defaultLead
    val leads = (LEADS + if (cur in LEADS) emptyList() else listOf(cur)).sorted()
    Text(if (d.time.isNotEmpty()) "마감 ${t12(d.time)} 의 몇 분 전" else "마감 알림", style = T.label, color = pal.text2)
    if (d.time.isNotEmpty())
        Opts(listOf("끔") + leads.map { leadLabel(it) }, on = { i -> if (i == 0) !d.alarm else d.alarm && leads[i - 1] == cur }) { i ->
            if (i == 0) d.alarm = false else { d.alarm = true; d.lead = leads[i - 1] }
        }
    else Opts(listOf("끔", "아침 브리핑에서"), on = { i -> (i == 0) == !d.alarm }) { i -> d.alarm = i == 1 }
    if (!d.daily) {
        Text("며칠 앞서 한 번 더", style = T.label, color = pal.text2)
        Opts(EARLY.map { it.second }, on = { EARLY[it].first == d.early }, enabled = d.alarm) { d.early = EARLY[it].first }
    }
    Hint(d.alertSay(brief) + " 기본값은 설정에서 바꿉니다.")
}
