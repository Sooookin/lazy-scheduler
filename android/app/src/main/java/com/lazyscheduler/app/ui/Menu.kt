package com.lazyscheduler.app.ui

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Instance
import java.time.LocalDate

/**
 * 줄 메뉴 (›, 또는 길게 누르기) - 아래에서 올라오는 종이. PC 의 오른쪽 단추 차림표와 같은 것들:
 * 완료 · 고치기 · 내일로(할 일) · 이번만 건너뛰기(루틴) · 삭제. 밀어서 하는 손짓 대신 이것 하나다.
 */
@Composable
fun RowMenu(
    i: Instance?, today: LocalDate, onDismiss: () -> Unit,
    onDone: () -> Unit, onEdit: () -> Unit, onLater: () -> Unit, onSkip: () -> Unit, onDelete: () -> Unit,
) {
    val pal = LocalPal.current
    var shown by remember { mutableStateOf<Instance?>(null) }
    if (i != null) shown = i
    AnimatedVisibility(i != null, enter = fadeIn(tween(160)), exit = fadeOut(tween(160))) {
        Box(Modifier.fillMaxSize().background(LitTokens.ink.copy(alpha = .32f)).pointerInput(Unit) { detectTapGestures { onDismiss() } })
    }
    Box(Modifier.fillMaxSize(), contentAlignment = Alignment.BottomCenter) {
        AnimatedVisibility(i != null,
            enter = slideInVertically(tween(320, easing = EaseMove)) { it } + fadeIn(tween(120)),
            exit = slideOutVertically(tween(200)) { it } + fadeOut(tween(160))) {
            val it0 = shown ?: return@AnimatedVisibility
            Column(
                Modifier.fillMaxWidth().clip(RoundedCornerShape(topStart = 22.dp, topEnd = 22.dp)).background(pal.surface)
                    .pointerInput(Unit) { detectTapGestures { } }.navigationBarsPadding().padding(horizontal = 12.dp).padding(bottom = 10.dp),
            ) {
                Box(Modifier.fillMaxWidth().padding(vertical = 10.dp), contentAlignment = Alignment.Center) {
                    Box(Modifier.size(36.dp, 4.dp).clip(RoundedCornerShape(2.dp)).background(pal.hair2))
                }
                Row(Modifier.padding(horizontal = 12.dp).height(44.dp), verticalAlignment = Alignment.CenterVertically) {
                    NumDot(null, it0.done, false)
                    Spacer(Modifier.width(12.dp))
                    Text(it0.task.title, Modifier.weight(1f), style = T.leadM, color = pal.text, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val w = listOfNotNull(it0.date?.takeIf { it != today }?.let { dateLabel(it, today) }, it0.time.ifEmpty { null }).joinToString(" ")
                    Text(w, style = T.time, color = pal.text2)
                }
                Spacer(Modifier.height(6.dp))
                MenuLine(if (it0.done) "완료 취소" else "완료", strong = true, icon = { c -> Check(c, 12.dp) }, onClick = onDone)
                MenuLine("고치기", icon = { c -> Glyph("pen", c) }, onClick = onEdit)
                if (it0.kind == "deadline" && !it0.done && it0.date != null)
                    MenuLine(if (it0.date.isAfter(today)) "하루 뒤로" else "내일로", icon = { c -> Glyph("arrow", c) }, onClick = onLater)
                if (it0.kind == "routine" && !it0.done && it0.date != null)
                    MenuLine("이번만 건너뛰기", tag = "루틴", icon = { c -> Glyph("skip", c) }, onClick = onSkip)
                Hair(Modifier.padding(horizontal = 12.dp, vertical = 6.dp))
                MenuLine("삭제", color = pal.late, icon = { c -> Glyph("x", c) }, onClick = onDelete)
            }
        }
    }
}

@Composable
private fun MenuLine(text: String, strong: Boolean = false, color: Color? = null, tag: String? = null,
                     icon: @Composable (Color) -> Unit, onClick: () -> Unit) {
    val pal = LocalPal.current
    val c = color ?: pal.text
    Row(
        Modifier.fillMaxWidth().padding(vertical = 2.dp).clip(RoundedCornerShape(12.dp))
            .background(if (strong) pal.teal.copy(alpha = .10f) else Color.Transparent)
            .press(onClick = onClick).height(50.dp).padding(horizontal = 14.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Box(Modifier.size(22.dp), contentAlignment = Alignment.Center) { icon(if (strong) pal.teal else c) }
        Spacer(Modifier.width(14.dp))
        Text(text, Modifier.weight(1f), style = if (strong) T.leadM else T.lead, color = c)
        if (tag != null) Text(tag, style = T.label, color = pal.text2)
    }
}

@Composable
private fun Glyph(kind: String, c: Color) {
    Canvas(Modifier.size(14.dp)) {
        val s = size.width; val w = 1.4.dp.toPx()
        when (kind) {
            "pen" -> { drawLine(c, Offset(s * .2f, s * .8f), Offset(s * .8f, s * .2f), w * 1.3f, StrokeCap.Round) }
            "arrow" -> {
                drawLine(c, Offset(s * .1f, s * .5f), Offset(s * .9f, s * .5f), w, StrokeCap.Round)
                drawLine(c, Offset(s * .6f, s * .22f), Offset(s * .9f, s * .5f), w, StrokeCap.Round)
                drawLine(c, Offset(s * .6f, s * .78f), Offset(s * .9f, s * .5f), w, StrokeCap.Round)
            }
            "skip" -> {
                drawArc(c, 180f, 200f, false, Offset(s * .1f, s * .2f), androidx.compose.ui.geometry.Size(s * .8f, s * .8f),
                    style = androidx.compose.ui.graphics.drawscope.Stroke(w, cap = StrokeCap.Round))
            }
            "x" -> {
                drawLine(c, Offset(s * .2f, s * .2f), Offset(s * .8f, s * .8f), w, StrokeCap.Round)
                drawLine(c, Offset(s * .8f, s * .2f), Offset(s * .2f, s * .8f), w, StrokeCap.Round)
            }
        }
    }
}
