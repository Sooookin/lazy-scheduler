package com.lazyscheduler.app.ui

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.interaction.collectIsPressedAsState
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.RowScope
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
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.draw.scale
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.SolidColor
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import java.time.LocalDate
import java.time.LocalTime
import java.time.temporal.ChronoUnit

internal val WDS = listOf("월", "화", "수", "목", "금", "토", "일")
/** 달력은 일요일이 맨 왼쪽이다. 규칙(weekdays)은 예전대로 월요일이 0 이므로 둘을 섞지 않는다. */
internal val WDS_SUN = listOf("일", "월", "화", "수", "목", "금", "토")

/** 누를 수 있는 것. 누르는 동안 살짝 줄어든다 (PC 의 :active 와 같다). */
@OptIn(ExperimentalFoundationApi::class)
@Composable
internal fun Modifier.press(onLong: (() -> Unit)? = null, onClick: () -> Unit): Modifier {
    val src = remember { MutableInteractionSource() }
    val down by src.collectIsPressedAsState()
    val s by animateFloatAsState(if (down) .96f else 1f, tween(if (down) 90 else 160), label = "press")
    return this.scale(s).combinedClickable(interactionSource = src, indication = null, onLongClick = onLong, onClick = onClick)
}

@OptIn(ExperimentalFoundationApi::class)
internal fun Modifier.tap(onClick: () -> Unit): Modifier = this.combinedClickable(onClick = onClick)

internal fun dateLabel(d: LocalDate, today: LocalDate): String {
    val diff = ChronoUnit.DAYS.between(today, d)
    return when {
        diff == 0L -> "오늘"
        diff == 1L -> "내일"
        diff == 2L -> "모레"
        diff == -1L -> "어제"
        else -> "${d.monthValue}/${d.dayOfMonth}"
    }
}

internal fun dayName(d: LocalDate) = "${d.monthValue}월 ${d.dayOfMonth}일 ${WDS[d.dayOfWeek.value - 1]}요일"
internal fun shortDay(d: LocalDate) = "${d.monthValue}/${d.dayOfMonth} ${WDS[d.dayOfWeek.value - 1]}"

/** "오후 1:30" for a stored "13:30"; "" stays "". */
internal fun timeLabel(t: String): String {
    val v = runCatching { LocalTime.parse(t) }.getOrNull() ?: return t
    val h12 = if (v.hour % 12 == 0) 12 else v.hour % 12
    return (if (v.hour < 12) "오전 " else "오후 ") + h12 + ":" + "%02d".format(v.minute)
}

/** 빛이 오는 쪽으로 도드라진 면의 그림자 (돌출) - 번호 동그라미 · 고른 칩. */
internal fun Modifier.raised(shape: androidx.compose.ui.graphics.Shape, pal: Pal, depth: Dp = 2.dp): Modifier =
    if (pal.isNight) this else this.shadow(depth, shape, ambientColor = pal.shade.copy(alpha = .5f), spotColor = pal.shade.copy(alpha = .5f))

/**
 * 목록의 동그라미. 번호(아직) → 채운 청록에 체크(끝남). 지난 것은 벽돌빛 테.
 * 아직 안 한 것은 도드라지고, 끝낸 것은 눌려 들어간다 (그림자로만 말한다).
 */
@Composable
internal fun NumDot(n: Int?, done: Boolean, late: Boolean, size: Dp = 22.dp) {
    val pal = LocalPal.current
    val c = if (late && !done) pal.late else pal.teal
    val bg by animateColorAsState(if (done) c else if (pal.isNight) Color.Transparent else pal.field, tween(180), label = "dot")
    Box(
        Modifier.size(size).then(if (!done) Modifier.raised(CircleShape, pal, 1.5.dp) else Modifier)
            .clip(CircleShape).background(bg).border(1.5.dp, c, CircleShape),
        contentAlignment = Alignment.Center,
    ) {
        if (done) Check(if (pal.isNight) pal.surface else pal.onTeal, size * .5f)
        else if (n != null) Text("$n", style = T.micro, color = c)
    }
}

@Composable
internal fun Check(color: Color, size: Dp) {
    Canvas(Modifier.size(size)) {
        val p = Path().apply {
            moveTo(this@Canvas.size.width * .12f, this@Canvas.size.height * .55f)
            lineTo(this@Canvas.size.width * .40f, this@Canvas.size.height * .80f)
            lineTo(this@Canvas.size.width * .90f, this@Canvas.size.height * .22f)
        }
        drawPath(p, color, style = Stroke(1.8.dp.toPx(), cap = StrokeCap.Round, join = StrokeJoin.Round))
    }
}

/** 칩 (마감 날짜 · 알림 · 빠른 시각). 고르면 채운 청록. */
@Composable
internal fun Chip(label: String, on: Boolean, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val pal = LocalPal.current
    Box(
        modifier.height(36.dp).then(if (on) Modifier.raised(RoundedCornerShape(10.dp), pal) else Modifier)
            .clip(RoundedCornerShape(10.dp))
            .background(if (on) pal.teal else pal.field)
            .border(1.dp, if (on) pal.teal else pal.hair2, RoundedCornerShape(10.dp))
            .press(onClick = onClick).padding(horizontal = 16.dp),
        contentAlignment = Alignment.Center,
    ) { Text(label, style = T.lead, color = if (on) pal.onTeal else pal.text, maxLines = 1) }
}

/** 둥근 틀 안의 고르기 (할 일 · 루틴 · 메모 / 단위 / 간격 / 필터). */
@Composable
internal fun <V> Seg(options: List<Pair<V, String>>, selected: V, modifier: Modifier = Modifier, fill: Boolean = false, onPick: (V) -> Unit) {
    val pal = LocalPal.current
    Row(
        modifier.height(38.dp).clip(RoundedCornerShape(19.dp)).border(1.dp, pal.hair2, RoundedCornerShape(19.dp)).padding(3.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        for ((v, label) in options) {
            val on = v == selected
            Box(
                (if (fill) Modifier.weight(1f) else Modifier).fillMaxHeight()
                    .then(if (on) Modifier.raised(RoundedCornerShape(16.dp), pal, 1.5.dp) else Modifier)
                    .clip(RoundedCornerShape(16.dp)).background(if (on) pal.teal else Color.Transparent)
                    .tap { onPick(v) }.padding(horizontal = 14.dp),
                contentAlignment = Alignment.Center,
            ) { Text(label, style = T.body, color = if (on) pal.onTeal else pal.text2, maxLines = 1) }
        }
    }
}

/** 화면에 하나뿐인 채운 단추. */
@Composable
internal fun Primary(text: String, modifier: Modifier = Modifier, enabled: Boolean = true, onClick: () -> Unit) {
    val pal = LocalPal.current
    Box(
        modifier.height(48.dp).then(if (enabled) Modifier.raised(RoundedCornerShape(24.dp), pal, 3.dp) else Modifier)
            .clip(RoundedCornerShape(24.dp)).background(if (enabled) pal.teal else pal.hair2)
            .then(if (enabled) Modifier.press(onClick = onClick) else Modifier),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = T.leadM, color = if (enabled) pal.onTeal else pal.text2) }
}

/** 테두리만 있는 단추 (취소 · 내일로 · 삭제). */
@Composable
internal fun Ghost(text: String, modifier: Modifier = Modifier, color: Color? = null, onClick: () -> Unit) {
    val pal = LocalPal.current
    val c = color ?: pal.text2
    Box(
        modifier.height(48.dp).clip(RoundedCornerShape(24.dp))
            .border(1.dp, if (color != null) color.copy(alpha = .55f) else pal.hair2, RoundedCornerShape(24.dp))
            .press(onClick = onClick).padding(horizontal = 18.dp),
        contentAlignment = Alignment.Center,
    ) { Text(text, style = T.lead, color = c) }
}

/** 동그란 닫기 단추. */
@Composable
internal fun CloseX(onClick: () -> Unit) {
    val pal = LocalPal.current
    Box(Modifier.size(34.dp).clip(CircleShape).border(1.dp, pal.hair2, CircleShape).press(onClick = onClick), contentAlignment = Alignment.Center) {
        Canvas(Modifier.size(10.dp)) {
            val w = 1.4.dp.toPx()
            drawLine(pal.text2, Offset.Zero, Offset(size.width, size.height), w, StrokeCap.Round)
            drawLine(pal.text2, Offset(size.width, 0f), Offset(0f, size.height), w, StrokeCap.Round)
        }
    }
}

/** 입력칸. 늘 종이보다 한 겹 밝다 (여기가 쓰는 곳). 쓰는 중이면 청록 테. */
@Composable
internal fun Field(
    value: String, placeholder: String, modifier: Modifier = Modifier, singleLine: Boolean = true,
    focused: Boolean = false, onChange: (String) -> Unit,
) {
    val pal = LocalPal.current
    Box(
        modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(pal.field)
            .border(if (focused) 1.3.dp else 1.dp, if (focused) pal.teal else pal.hair2, RoundedCornerShape(12.dp))
            .padding(horizontal = 16.dp, vertical = 14.dp),
    ) {
        if (value.isEmpty()) Text(placeholder, style = T.lead, color = pal.text2.copy(alpha = .7f))
        BasicTextField(
            value = value, onValueChange = onChange, singleLine = singleLine,
            modifier = Modifier.fillMaxWidth().then(if (singleLine) Modifier else Modifier.fillMaxHeight()),
            textStyle = T.lead.copy(color = pal.text), cursorBrush = SolidColor(pal.teal),
        )
    }
}

/** 눌러서 여는 칸 (시각 · 날짜). 오른쪽에 작은 안내를 붙일 수 있다. */
@Composable
internal fun Slot(text: String, hint: String?, modifier: Modifier = Modifier, dim: Boolean = false, onClick: () -> Unit) {
    val pal = LocalPal.current
    Row(
        modifier.height(48.dp).clip(RoundedCornerShape(12.dp)).background(pal.field)
            .border(1.dp, pal.hair2, RoundedCornerShape(12.dp)).press(onClick = onClick).padding(horizontal = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Text(text, Modifier.weight(1f), style = T.lead, color = if (dim) pal.text2 else pal.text)
        if (hint != null) Text(hint, style = T.label, color = pal.teal)
    }
}

/** 켜고 끄기. */
@Composable
internal fun Toggle(on: Boolean, enabled: Boolean = true, onChange: (Boolean) -> Unit) {
    val pal = LocalPal.current
    val t by animateFloatAsState(if (on) 1f else 0f, tween(180), label = "toggle")
    Box(
        Modifier.size(44.dp, 26.dp).clip(RoundedCornerShape(13.dp))
            .background(androidx.compose.ui.graphics.lerp(pal.hair2, pal.teal, t).copy(alpha = if (enabled) 1f else .4f))
            .then(if (enabled) Modifier.tap { onChange(!on) } else Modifier),
    ) {
        Box(
            Modifier.padding(3.dp).size(20.dp).drawBehind {
                drawCircle(pal.onTeal, center = Offset(size.width / 2 + t * 18.dp.toPx(), size.height / 2))
            },
        )
    }
}

/** 네모 체크 (설정). */
@Composable
internal fun CheckRow(on: Boolean, label: String, note: String? = null, onChange: (Boolean) -> Unit) {
    val pal = LocalPal.current
    Row(Modifier.fillMaxWidth().tap { onChange(!on) }.padding(vertical = 10.dp), verticalAlignment = Alignment.CenterVertically) {
        Box(
            Modifier.size(20.dp).clip(RoundedCornerShape(5.dp)).background(if (on) pal.teal else pal.field)
                .border(1.dp, if (on) pal.teal else pal.hair2, RoundedCornerShape(5.dp)),
            contentAlignment = Alignment.Center,
        ) { if (on) Check(pal.onTeal, 11.dp) }
        Spacer(Modifier.width(12.dp))
        Text(label, style = T.lead, color = pal.text)
        if (note != null) { Spacer(Modifier.width(6.dp)); Text(note, style = T.label, color = pal.text2, maxLines = 1, overflow = TextOverflow.Ellipsis) }
    }
}

/** 칸 이름 (이름 · 마감 · 시각 · 알림 …). */
@Composable
internal fun Label(text: String, modifier: Modifier = Modifier) {
    Text(text, modifier.padding(top = 16.dp, bottom = 8.dp), style = T.label, color = LocalPal.current.text2)
}

/** 가는 선. */
@Composable
internal fun Hair(modifier: Modifier = Modifier, strong: Boolean = false) {
    val pal = LocalPal.current
    Box(modifier.fillMaxWidth().height(1.dp).background(if (strong) pal.hair2 else pal.hair))
}

/** 무리의 이름 (오전 · 오후 · 저녁 · 아무 때나 · 지난 일): 글자 뒤로 선이 이어진다. */
@Composable
internal fun Band(text: String, color: Color? = null) {
    val pal = LocalPal.current
    Row(Modifier.fillMaxWidth().padding(top = 14.dp, bottom = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        Text(text, style = T.label, color = color ?: pal.text2)
        Spacer(Modifier.width(10.dp))
        Hair(Modifier.weight(1f))
    }
}

@Composable
internal fun RowScope.Chevron() {
    Text("›", Modifier.padding(start = 8.dp), style = T.lead, color = LocalPal.current.text2.copy(alpha = .6f), textAlign = TextAlign.Center)
}

internal fun Modifier.roundedBg(color: Color, r: Dp) = this.drawBehind {
    drawRoundRect(color, cornerRadius = CornerRadius(r.toPx()))
}
