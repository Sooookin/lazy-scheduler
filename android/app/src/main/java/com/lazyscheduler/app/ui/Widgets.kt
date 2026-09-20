package com.lazyscheduler.app.ui

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import java.time.LocalDate
import java.time.LocalTime

internal val WDS = listOf("월", "화", "수", "목", "금", "토", "일")
/** 달력은 일요일이 맨 왼쪽이다. 규칙(weekdays)은 예전대로 월요일이 0 이므로 둘을 섞지 않는다. */
internal val WDS_SUN = listOf("일", "월", "화", "수", "목", "금", "토")

@OptIn(ExperimentalFoundationApi::class)
internal fun Modifier.tap(onClick: () -> Unit): Modifier = this.combinedClickable(onClick = onClick)

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

/** "오전 9:30" for a stored "09:30"; "" stays "". */
internal fun timeLabel(t: String): String {
    val v = runCatching { LocalTime.parse(t) }.getOrNull() ?: return t
    val h12 = if (v.hour % 12 == 0) 12 else v.hour % 12
    return (if (v.hour < 12) "오전 " else "오후 ") + h12 + ":" + "%02d".format(v.minute)
}

/** A pressed-in well with raised choices, like the PC's segmented controls. */
@Composable
internal fun <T> Seg(options: List<Pair<T, String>>, selected: T, enabled: Boolean = true, onPick: (T) -> Unit) {
    FlowRow(
        Modifier.inset(12.dp).padding(3.dp).alpha(if (enabled) 1f else 0.45f),
        horizontalArrangement = Arrangement.spacedBy(3.dp), verticalArrangement = Arrangement.spacedBy(3.dp),
    ) {
        for ((v, label) in options) {
            val on = v == selected
            Box(
                (if (on) Modifier.raised(9.dp, 2.dp) else Modifier).clip(RoundedCornerShape(9.dp))
                    .then(if (enabled) Modifier.tap { onPick(v) } else Modifier)
                    .padding(horizontal = 12.dp, vertical = 8.dp),
            ) {
                Text(label, style = MaterialTheme.typography.labelMedium, color = if (on) Ink.ink2 else Ink.faint)
            }
        }
    }
}

/** A raised chip; chosen = filled teal. */
@Composable
internal fun Chip(label: String, on: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.then(if (on) Modifier else Modifier.raised(14.dp, 2.dp)).clip(RoundedCornerShape(14.dp))
            .background(if (on) Ink.mid else Color.Transparent)
            .tap(onClick).padding(horizontal = 13.dp, vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, style = MaterialTheme.typography.labelMedium, color = if (on) Ink.onMid else Ink.muted) }
}

/** The one filled button on a screen. */
@Composable
internal fun Primary(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    Box(
        modifier.clip(RoundedCornerShape(24.dp)).background(if (enabled) Ink.mid else Ink.pale)
            .then(if (enabled) Modifier.tap(onClick) else Modifier).padding(horizontal = 22.dp, vertical = 13.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = MaterialTheme.typography.labelLarge, color = if (enabled) Ink.onMid else Ink.faint) }
}

/** A raised text button (secondary actions). */
@Composable
internal fun Ghost(text: String, color: Color = Ink.muted, modifier: Modifier = Modifier, onClick: () -> Unit) {
    Box(
        modifier.raised(20.dp, 2.5.dp).clip(RoundedCornerShape(20.dp)).tap(onClick)
            .padding(horizontal = 16.dp, vertical = 11.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = MaterialTheme.typography.labelMedium, color = color) }
}

/**
 * The checkbox: a pressed-in circle with a teal rim (it is the thing to press) →
 * filled teal with a white tick when done. Only this completes; the row opens.
 */
@Composable
internal fun CheckDot(done: Boolean, onClick: () -> Unit) {
    Box(Modifier.size(44.dp).clip(CircleShape).tap(onClick), contentAlignment = Alignment.Center) {
        Box(
            Modifier.size(24.dp).then(
                if (done) Modifier.clip(CircleShape).background(Ink.mid)
                else Modifier.inset(12.dp, 1.5.dp).border(1.2.dp, Ink.mid.copy(alpha = .55f), CircleShape)
            ),
            contentAlignment = Alignment.Center,
        ) {
            // 줄마다 하나씩 있다 - 길과 붓은 한 번만 만들고 그리기만 되풀이한다
            if (done) Box(Modifier.size(12.dp).drawWithCache {
                val p = Path().apply {
                    moveTo(size.width * .12f, size.height * .55f)
                    lineTo(size.width * .40f, size.height * .80f)
                    lineTo(size.width * .90f, size.height * .22f)
                }
                val stroke = Stroke(width = 2.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round)
                onDrawBehind { drawPath(p, Ink.onMid, style = stroke) }
            })
        }
    }
}

/** A pressed-in single-line text field with a placeholder. */
@Composable
internal fun InField(
    value: String,
    placeholder: String,
    modifier: Modifier = Modifier,
    singleLine: Boolean = true,
    onChange: (String) -> Unit,
) {
    Box(modifier.fillMaxWidth().inset(12.dp).padding(horizontal = 14.dp, vertical = 13.dp)) {
        if (value.isEmpty()) Text(placeholder, style = MaterialTheme.typography.bodyLarge, color = Ink.dim)
        BasicTextField(
            value = value, onValueChange = onChange, singleLine = singleLine,
            modifier = Modifier.fillMaxWidth().then(if (singleLine) Modifier else Modifier.fillMaxHeight()),
            textStyle = MaterialTheme.typography.bodyLarge.copy(color = Ink.ink2), cursorBrush = SolidColor(Ink.mid),
        )
    }
}

/** The completion ring: teal arc on a pale track, "N 남음" inside. */
@Composable
internal fun Ring(left: Int, done: Int, total: Int, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val pct = if (total > 0) done.toFloat() / total else if (left > 0) 0f else 1f
    Box(modifier.size(74.dp).raised(37.dp, 3.dp).clip(CircleShape).tap(onClick), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(60.dp)) {
            val w = 5.dp.toPx()
            val inset = w / 2
            val s = androidx.compose.ui.geometry.Size(size.width - w, size.height - w)
            drawArc(Ink.pale, 0f, 360f, false, Offset(inset, inset), s, style = Stroke(w))
            drawArc(if (left > 0) Ink.mid else Ink.mint, -90f, 360f * pct, false, Offset(inset, inset), s,
                style = Stroke(w, cap = StrokeCap.Round))
        }
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Text("$left", style = MaterialTheme.typography.titleMedium, color = Ink.ink2)
            Text("남음", style = MaterialTheme.typography.labelSmall, color = Ink.faint)
        }
    }
}

/**
 * Time: no presets. A tap shows the hour grid (새벽 · 오전 · 오후 · 저녁), an hour shows the
 * minute grid (5-minute steps), a minute closes it. Any time is exactly two taps.
 */
@Composable
internal fun TimeDialog(current: String, allowNone: Boolean = true, onDismiss: () -> Unit, onPick: (String) -> Unit) {
    val cur = runCatching { LocalTime.parse(current) }.getOrNull()
    var hour by remember { mutableStateOf<Int?>(null) }
    val nowH = LocalTime.now().hour
    Dialog(onDismissRequest = onDismiss) {
        Column(Modifier.clip(RoundedCornerShape(22.dp)).background(Ink.card).padding(18.dp)) {
            val h = hour
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    if (h == null) (if (cur != null) timeLabel(current) else "시") else timeLabel("%02d:00".format(h)).substringBefore(":") + "시",
                    style = MaterialTheme.typography.headlineMedium,
                )
                Text(if (h == null) "  › 분" else "  : 분", style = MaterialTheme.typography.bodyMedium)
                Spacer(Modifier.weight(1f))
                if (h != null) Text("‹ 시 다시", Modifier.clip(RoundedCornerShape(12.dp)).tap { hour = null }.padding(8.dp),
                    style = MaterialTheme.typography.labelMedium, color = Ink.muted)
                else if (allowNone) Text("시각 없음", Modifier.clip(RoundedCornerShape(12.dp)).tap { onPick("") }.padding(8.dp),
                    style = MaterialTheme.typography.labelMedium, color = Ink.muted)
            }
            Spacer(Modifier.height(12.dp))
            if (h == null) {
                for ((label, from) in listOf("새벽" to 0, "오전" to 6, "오후" to 12, "저녁" to 18)) {
                    Row(verticalAlignment = Alignment.CenterVertically, modifier = Modifier.padding(vertical = 3.dp)) {
                        Text(label, Modifier.width(34.dp), style = MaterialTheme.typography.bodySmall)
                        for (k in 0..5) {
                            val v = from + k
                            GridCell(if (v % 12 == 0) "12" else "${v % 12}", on = cur?.hour == v, now = v == nowH,
                                dim = from == 0, modifier = Modifier.weight(1f)) { hour = v }
                        }
                    }
                }
                Text("민트 테두리 = 지금 시각", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall)
            } else {
                for (row in 0..1) Row(Modifier.padding(vertical = 3.dp)) {
                    for (k in 0..5) {
                        val m = (row * 6 + k) * 5
                        GridCell("%02d".format(m), on = cur?.hour == h && cur.minute == m, now = false, dim = false,
                            modifier = Modifier.weight(1f)) { onPick("%02d:%02d".format(h, m)) }
                    }
                }
                Text("5분 단위", Modifier.padding(top = 8.dp), style = MaterialTheme.typography.bodySmall)
            }
        }
    }
}

@Composable
private fun GridCell(label: String, on: Boolean, now: Boolean, dim: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Box(
        modifier.padding(3.dp).height(46.dp)
            .then(if (on) Modifier.clip(RoundedCornerShape(12.dp)).background(Ink.mid) else Modifier.raised(12.dp, 2.dp))
            .then(if (now && !on) Modifier.border(1.5.dp, Ink.mint, RoundedCornerShape(12.dp)) else Modifier)
            .clip(RoundedCornerShape(12.dp)).tap(onClick),
        contentAlignment = Alignment.Center,
    ) {
        Text(label, style = MaterialTheme.typography.labelLarge, textAlign = TextAlign.Center,
            color = if (on) Ink.onMid else if (dim) Ink.dim else Ink.body)
    }
}
