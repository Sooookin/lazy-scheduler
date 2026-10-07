package com.lazyscheduler.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.expandVertically
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.shrinkVertically
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
import com.lazyscheduler.app.core.previewDates
import java.time.LocalDate
import java.time.YearMonth
import kotlin.math.PI
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.roundToInt
import kotlin.math.sin

/*
 * 새 항목 · 고치기 (PC 와 같은 틀).
 *
 * 정할 것은 셋이다: 무엇 (이름) · 언제 (날짜 · 시각 · 반복) · 알림. 줄은 고른 값만 보여 주고, 누른 줄 바로 아래에
 * 그 줄의 도구 하나가 펼쳐진다 (PC 는 오른쪽 판 - 폭이 좁은 휴대폰은 줄 아래로):
 *   날짜 → 달력 (하루 / 여러 날 · 길게 눌러 끌면 기간)   시각 → 시계판   반복 → 빈도와 규칙   알림 → 알림 고르기
 * 종류(할 일 · 루틴 · 메모)는 고르지 않는다 - 언제를 정한 모양에서 따라 나온다:
 *   날짜 없음 → 메모   하루 → 할 일   이어진 날 → 기간 업무   반복 → 루틴
 * 그래서 미리 넣어 두는 날짜도, 오늘 · 내일 같은 추천도 없다. 맨 아래 한 줄이 무엇이 만들어질지 풀어 쓴다.
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
        time = t?.dueTime ?: ""; lead = t?.notifyMin; early = t?.earlyDays ?: 0; alarm = !(t?.muted ?: false)
        defaultLead = ReminderPlan.defaultLead(settings)
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
    }
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

    fun ghostMinute(): Int? = if (!has) null else minsOf(time)
    fun pickFromSky(m: Int) { if (has) time = hhmm(((m + 2) / 5 * 5).coerceIn(0, 1435)) }

    /** 저장할 필드 (저장된 모양 그대로). 모자라면 error 를 적고 null */
    fun fields(): Map<String, Any?>? {
        val t = title.trim()
        if (t.isEmpty()) { error = "이름을 입력하세요"; return null }
        val f = linkedMapOf<String, Any?>("title" to t.take(200), "note" to note.trim().take(2000), "kind" to kind)
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
        return w + if (a.isNotEmpty()) " · 알림 $a" else ""
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
        Row(Modifier.padding(start = 20.dp, end = 16.dp, top = 14.dp), verticalAlignment = Alignment.CenterVertically) {
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
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp)) {
            NameField(d.title) { if (it.length <= 200) d.title = it }
            Spacer(Modifier.height(16.dp))
            Hair()
            val open = { p: String -> d.pane = if (d.pane == p) "" else p }
            Prop("날짜", d.dateText().ifEmpty { "없음" }, empty = !d.has, on = d.pane == "date", tail = d.dateTail(),
                onClear = if (d.has) ({ d.clearWhen() }) else null) { open("date") }
            Holiday(d, businessOnly)
            Pane(d.pane == "date") { DatePane(d, today, others.filter { it.id != e.task?.id }) }
            Prop("시각", if (d.time.isEmpty()) (if (d.has) "없음" else "날짜를 정하면") else t12(d.time), empty = d.time.isEmpty(),
                on = d.pane == "time", locked = !d.has, onClear = if (d.time.isNotEmpty()) ({ d.time = "" }) else null) { open("time") }
            Pane(d.pane == "time") { TimePane(d) }
            val fq = d.freq?.let { f -> FREQ.firstOrNull { it.first == f.first && it.second == f.second }?.third }
            Prop("반복", if (d.rule != null) d.ruleText else if (fq != null) "$fq · 날을 고르세요" else "안 함", empty = d.freq == null,
                on = d.pane == "rule", onClear = if (d.freq != null) ({ d.chooseFreq(null) }) else null) { open("rule") }
            Pane(d.pane == "rule") { RulePane(d, today) }
            Prop("알림", if (d.has) d.alertText() else "날짜를 정하면", empty = !d.has, on = d.pane == "alert", locked = !d.has) { open("alert") }
            Pane(d.pane == "alert") { AlertPane(d, brief) }
            if (d.noteOpen || d.note.isNotEmpty()) NoteField(d.note) { if (it.length <= 2000) d.note = it }
            else Prop("설명", "덧붙이기", empty = true, on = false) { d.noteOpen = true }
            d.error?.let { Text(it, Modifier.padding(top = 12.dp), style = T.body, color = pal.danger) }
            Spacer(Modifier.height(16.dp))
        }
        // 아래 띠: 무엇이 만들어질지 한 문장 · 취소 · 저장
        Hair()
        Column(Modifier.padding(horizontal = 20.dp).padding(top = 10.dp, bottom = 14.dp)) {
            Text(d.receipt(), style = T.body, color = pal.text2, maxLines = 2, overflow = TextOverflow.Ellipsis)
            Spacer(Modifier.height(10.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Ghost("취소", Modifier.weight(.35f), onClick = onClose)
                Primary(if (editing) "저장" else "${d.kindWord} 추가", Modifier.weight(.65f)) { d.fields()?.let(onSave) }
            }
        }
    }
}

@Composable
private fun TextBtn(text: String, color: Color, onClick: () -> Unit) {
    Text(text, Modifier.clip(RoundedCornerShape(8.dp)).press(onClick = onClick).padding(horizontal = 10.dp, vertical = 6.dp),
        style = T.body, color = color)
}

/** 이름: 상자 없이 제목처럼. 밑줄 하나가 "여기에 쓴다" 를 말한다 */
@Composable
private fun NameField(value: String, onChange: (String) -> Unit) {
    val pal = LocalPal.current
    var focus by remember { mutableStateOf(false) }
    val style = T.title.copy(fontWeight = FontWeight.Medium, color = pal.text)
    Box(Modifier.fillMaxWidth().padding(top = 14.dp).drawBehind {
        val w = (if (focus) 1.5.dp else 1.dp).toPx()
        drawLine(if (focus) pal.teal else pal.hair2, Offset(0f, size.height - w / 2), Offset(size.width, size.height - w / 2), w)
    }.padding(bottom = 12.dp)) {
        if (value.isEmpty()) Text("무엇을 할까요?", style = style.copy(fontWeight = FontWeight.Light), color = pal.faint)
        BasicTextField(value, onChange, Modifier.fillMaxWidth().onFocusChanged { focus = it.isFocused }, singleLine = true,
            textStyle = style, cursorBrush = SolidColor(pal.teal))
    }
}

@Composable
private fun NoteField(value: String, onChange: (String) -> Unit) {
    val pal = LocalPal.current
    Column {
        Box(Modifier.fillMaxWidth().heightIn(min = 64.dp).padding(vertical = 12.dp)) {
            if (value.isEmpty()) Text("설명 · 링크 · 참고할 것", style = T.lead, color = pal.faint)
            BasicTextField(value, onChange, Modifier.fillMaxWidth(), textStyle = T.lead.copy(color = pal.text, lineHeight = 20.sp),
                cursorBrush = SolidColor(pal.teal))
        }
        Hair()
    }
}

/** 값의 줄: 이름(56) · 값 · 끝(상대 날짜 · 지우기). 펼친 줄만 옅게 칠하고 왼쪽에 가는 청록 막대 */
@Composable
private fun Prop(label: String, value: String, empty: Boolean, on: Boolean, tail: String = "", locked: Boolean = false,
                 onClear: (() -> Unit)? = null, onClick: () -> Unit) {
    val pal = LocalPal.current
    val fill = pal.text.copy(alpha = .045f)
    Column {
        Row(
            Modifier.fillMaxWidth().height(48.dp).background(if (on) fill else Color.Transparent)
                .then(if (locked) Modifier else Modifier.press(onClick = onClick))
                .drawBehind { if (on) drawRoundRect(pal.teal, Offset(0f, 12.dp.toPx()), Size(2.dp.toPx(), size.height - 24.dp.toPx()), CornerRadius(1.dp.toPx())) }
                .padding(start = 12.dp, end = 4.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Text(label, Modifier.width(56.dp), style = T.label, color = if (on) pal.teal else pal.text2)
            Text(value, Modifier.weight(1f), style = T.head.copy(fontWeight = FontWeight.Normal),
                color = if (empty || locked) pal.faint else pal.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
            if (tail.isNotEmpty()) Text(tail, Modifier.padding(start = 8.dp), style = T.body, color = pal.text2)
            if (onClear != null) Box(Modifier.size(32.dp).clip(RoundedCornerShape(8.dp)).press(onClick = onClear), contentAlignment = Alignment.Center) {
                Canvas(Modifier.size(8.dp)) {
                    val w = 1.3.dp.toPx()
                    drawLine(pal.faint, Offset.Zero, Offset(size.width, size.height), w, StrokeCap.Round)
                    drawLine(pal.faint, Offset(size.width, 0f), Offset(0f, size.height), w, StrokeCap.Round)
                }
            } else Spacer(Modifier.width(8.dp))
        }
        Hair()
    }
}

/** 줄 아래에 펼쳐지는 도구 (PC 의 오른쪽 판) */
@Composable
private fun Pane(visible: Boolean, body: @Composable ColumnScope.() -> Unit) {
    val pal = LocalPal.current
    AnimatedVisibility(visible, enter = expandVertically(tween(280, easing = EaseMove)) + fadeIn(tween(200, 60)),
        exit = shrinkVertically(tween(200, easing = EaseExit)) + fadeOut(tween(120))) {
        Column(Modifier.padding(vertical = 12.dp).fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(pal.text.copy(alpha = .03f))
            .border(1.dp, pal.hair, RoundedCornerShape(16.dp)).padding(14.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { body() }
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
    Row(Modifier.fillMaxWidth().height(36.dp).clip(RoundedCornerShape(12.dp)).border(1.dp, pal.hair2, RoundedCornerShape(12.dp)).padding(3.dp),
        horizontalArrangement = Arrangement.spacedBy(2.dp)) {
        labels.forEachIndexed { i, l ->
            val sel = on(i)
            Box(Modifier.weight(1f).fillMaxHeight().clip(RoundedCornerShape(9.dp)).background(if (sel) pal.teal else Color.Transparent)
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
        Text(if (d.mode == "rule") "처음 돌 날" else "날짜", style = T.body.copy(fontWeight = FontWeight.Medium), color = pal.text)
        Spacer(Modifier.weight(1f))
        if (d.mode == "rule") Text("밑줄 = 앞으로 돌 날", style = T.label, color = pal.text2)
        else Seg(listOf(false to "하루", true to "여러 날"), d.span, height = 30.dp, pad = 12.dp) { d.spanOn(it) }
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
            Box(Modifier.size(36.dp).clip(RoundedCornerShape(10.dp)).tap { month = month.plusMonths(n) }, contentAlignment = Alignment.Center) {
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
        repeat(6) {
            Row {
                repeat(7) {
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
                        out -> (if (sun) pal.hol else pal.text).copy(alpha = .3f)
                        on || inRange || oc -> pal.teal
                        sun -> pal.hol
                        else -> pal.text
                    }
                    Box(
                        Modifier.weight(1f).height(40.dp).drawBehind {
                            val w = size.width; val h = size.height; val cx = w / 2; val half = 9.dp.toPx()
                            drawLine(pal.hair, Offset(0f, 0f), Offset(w, 0f), 1.dp.toPx())
                            if (on) drawRect(pal.teal.copy(alpha = .07f), Offset(0f, 1.dp.toPx()))
                            else if (inRange) drawRect(pal.teal.copy(alpha = .04f), Offset(0f, 1.dp.toPx()))
                            fun bar(x0: Float, x1: Float, t: Float, c: Color) = drawRoundRect(c, Offset(x0, h - 6.dp.toPx() - t / 2), Size(x1 - x0, t), CornerRadius(t / 2))
                            val t3 = 3.dp.toPx(); val t2 = 2.dp.toPx()
                            when {
                                rs && !re -> bar(cx - half, w, t3, pal.teal)
                                re && !rs -> bar(0f, cx + half, t3, pal.teal)
                                inRange -> bar(0f, w, t2, pal.teal.copy(alpha = .5f))
                                on -> bar(cx - half, cx + half, t3, pal.teal)
                                oc -> bar(cx - half, cx + half, t2, pal.teal.copy(alpha = .5f))
                                now -> bar(cx - half, cx + half, t2, pal.text.copy(alpha = .35f))
                            }
                        }.tap { if (out) month = YearMonth.from(day); d.pickDay(day) },
                        contentAlignment = Alignment.Center,
                    ) {
                        Text("${day.dayOfMonth}", Modifier.padding(bottom = 4.dp),
                            style = T.head.copy(fontWeight = if (on || now) FontWeight.Medium else FontWeight.Normal, fontFeatureSettings = "tnum"), color = color)
                    }
                    cur = cur.plusDays(1)
                }
            }
        }
    }
}

// ---------------- 시각 ----------------

@Composable
private fun ColumnScope.TimePane(d: Draft) {
    val pal = LocalPal.current
    val m = minsOf(d.time)
    Row(verticalAlignment = Alignment.CenterVertically) {
        if (m != null) Text(apText(t12(d.time)), style = T.title.copy(fontWeight = FontWeight.Normal, fontFeatureSettings = "tnum"), color = pal.text)
        else Text("시각 없음", style = T.head.copy(fontWeight = FontWeight.Normal), color = pal.faint)
        Spacer(Modifier.weight(1f))
        Seg(listOf(0 to "오전", 1 to "오후"), if (m == null) -1 else if (m >= 720) 1 else 0, height = 30.dp, pad = 14.dp) { pm ->
            d.apLock = true
            val c = m ?: (9 * 60)
            d.time = hhmm((c % 720) + pm * 720)
        }
    }
    Dial(m, d.apLock, Modifier.align(Alignment.CenterHorizontally).fillMaxWidth(.8f)) { d.time = hhmm(it) }
    Hint("바깥 고리는 시 · 안쪽 고리는 분 · 누른 채 돌려도 됩니다 · 하늘의 점선 구슬을 끌어도 됩니다")
}

/**
 * 시계판 (바깥 고리 시, 안쪽 고리 분 5분 단위). 누르거나 누른 채 돌린다.
 * 시를 처음 고를 때는 업무 시간으로 읽는다 (1~7시는 오후) - 오전 · 오후를 직접 누르기 전까지.
 */
@Composable
private fun Dial(min: Int?, apLock: Boolean, modifier: Modifier, onChange: (Int) -> Unit) {
    val pal = LocalPal.current
    val haptic = LocalHapticFeedback.current
    val measurer = rememberTextMeasurer()
    val cur by rememberUpdatedState(min)
    val lock by rememberUpdatedState(apLock)
    val change by rememberUpdatedState(onChange)
    val hourStyle = T.lead.copy(fontFeatureSettings = "tnum")
    val minStyle = T.label.copy(fontFeatureSettings = "tnum")
    Canvas(modifier.aspectRatio(1f).pointerInput(Unit) {
        awaitEachGesture {
            val down = awaitFirstDown()
            val c = Offset(size.width / 2f, size.height / 2f)
            val r = size.width / 2f
            val outer = (down.position - c).getDistance() > r * .66f
            fun pick(o: Offset) {
                val v = o - c
                var a = atan2(v.x, -v.y) / (2 * PI).toFloat()
                if (a < 0) a += 1f
                val k = (a * 12).roundToInt() % 12
                val now = cur
                val next = if (outer) {
                    val h = if (now != null && lock) (now / 720) * 12 + k else workHour(k)
                    h * 60 + (now ?: 0) % 60
                } else ((now ?: (9 * 60)) / 60) * 60 + k * 5
                if (next != now) { change(next); haptic.performHapticFeedback(HapticFeedbackType.TextHandleMove) }
            }
            pick(down.position)
            down.consume()
            while (true) {
                val ev = awaitPointerEvent()
                val ch = ev.changes.firstOrNull { it.id == down.id } ?: break
                if (!ch.pressed) break
                pick(ch.position); ch.consume()
            }
        }
    }) {
        val c = Offset(size.width / 2f, size.height / 2f)
        val r = size.width / 2f
        val rh = r * .8f
        val rm = r * .5f
        drawCircle(pal.field, r)
        drawCircle(pal.hair, r, style = Stroke(1.dp.toPx()))
        drawCircle(pal.text.copy(alpha = .035f), r * .64f)
        fun at(rr: Float, k: Int) = Offset(c.x + rr * sin(PI * k / 6).toFloat(), c.y - rr * cos(PI * k / 6).toFloat())
        val h = min?.let { (it / 60) % 12 }
        val mi = min?.let { (it % 60) / 5 }
        if (h != null && mi != null) {
            drawLine(pal.teal, c, at(rh, h), 1.5.dp.toPx(), StrokeCap.Round)
            drawLine(pal.teal.copy(alpha = .6f), c, at(rm, mi), 1.5.dp.toPx(), StrokeCap.Round)
            drawCircle(pal.teal, r * .13f, at(rh, h))
            drawCircle(pal.teal, r * .1f, at(rm, mi))
        }
        drawCircle(pal.teal, 3.dp.toPx(), c)
        for (k in 0 until 12) {
            val hl = measurer.measure(if (k == 0) "12" else "$k", hourStyle.copy(color = if (k == h) pal.onTeal else pal.text))
            drawText(hl, topLeft = at(rh, k) - Offset(hl.size.width / 2f, hl.size.height / 2f))
            val ml = measurer.measure("%02d".format(k * 5), minStyle.copy(color = if (k == mi) pal.onTeal else pal.text2))
            drawText(ml, topLeft = at(rm, k) - Offset(ml.size.width / 2f, ml.size.height / 2f))
        }
    }
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
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).border(1.dp, pal.hair2, RoundedCornerShape(12.dp))) {
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
                Box(Modifier.height(30.dp).clip(RoundedCornerShape(8.dp)).border(1.dp, pal.hair2, RoundedCornerShape(8.dp)).tap { open = true }
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
