package com.lazyscheduler.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.layout.LastBaseline
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import java.time.LocalDate
import java.time.LocalTime

/*
 * 머리 - 시계 · 다음 할 일, 그 아랫변이 곧 오늘의 시간 자 (PC 의 .head · sky.js 의 drawDay · pebble.js).
 *
 * 2026-10 덜어냄: 하늘 디오라마(능선 셋 · 안개 · 빛살 · 종이 결 · 호 모양 궤도)와 하늘을 돌아다니던 돌(총총 · 구르기 ·
 * 한숨 · 낮잠 · 모자 …)을 걷었다. 궤도는 해 뜸 ~ 해 짐을 호 위에 펴서 시각 사이의 거리를 읽을 수 없었다 - 자는
 * 1분이 늘 같은 길이다. 돌은 작아져(18 × 13) 자 위 '지금' 자리에 선다: 따로 그리던 지금 막대를 돌이 맡는다.
 * 돌의 상태는 셋뿐이고 셋 다 무언가를 알린다 - 깨어 있음 · 잠(밤 · 자 밖의 시각 · 오늘 다 마침) · 폴짝(하나 끝냄).
 */

/** 자 위의 점 하나 (오늘 일). */
data class Bead(val min: Int, val done: Boolean, val late: Boolean, val next: Boolean)

/** 머리의 "다음" 한 줄: 무엇을 · 언제 (PC 의 paintNext). */
data class NextLine(val label: String, val title: String)

/** 다음에 무엇을 하나 - 시각 있는 다음 일 → 시각 없는 오늘 일 → 앞으로의 첫 마감 → 상태 한 마디.
 *  자리는 늘 있다: 지우면 머리가 시계 하나만 남아 기운다 (PC 의 paintNext 와 같다) */
fun nextLine(rows: List<HomeRow>, upcoming: List<com.lazyscheduler.app.core.Instance>, today: LocalDate, nowMin: Int): NextLine? {
    rows.firstOrNull { it.next }?.let { r ->
        val d = (minsOf(r.i.time) ?: nowMin) - nowMin
        return NextLine("다음 · ${t12(r.i.time)} · ${inText(d)}", r.i.task.title)
    }
    val loose = rows.filter { !it.i.done && it.i.time.isEmpty() && it.i.date?.isBefore(today) != true }
    if (loose.isNotEmpty()) return NextLine("오늘 · 시간 정하지 않은 일 ${loose.size}", loose.first().i.task.title)
    val up = upcoming.firstOrNull() ?: return NextLine("다음 · 7일 안에 없음", if (rows.isEmpty()) "오늘은 할 일이 없습니다" else "오늘 일을 모두 마쳤습니다")
    return NextLine("다음 마감 · ${dateLabel(up.date!!, today)}" + (if (up.time.isNotEmpty()) " ${t12(up.time)}" else ""), up.task.title)
}

/** 남은 시간을 말로. 한 시간이 넘으면 시간 단위로만 (곁눈으로 읽는 화면에서 분은 쓸모없는 정밀이다) */
internal fun inText(d: Int) = if (d < 1) "지금" else if (d < 60) "${d}분 뒤" else "${d / 60}시간 뒤"
internal fun agoText(d: Int) = if (d < 60) "${d}분 지남" else "${d / 60}시간 지남"

/** 편 머리 (상태 막대 아래) 120 = 위 24 + 글줄 64 + 시간 자 띠 32 (PC 와 같은 짜임) */
internal val HEAD_H = 120.dp
internal val FOLD_H = 52.dp        // 접힌 머리 (작은 시계 한 줄)
private val RULER_H = 32.dp

@Composable
fun Head(top: Dp, folded: Boolean, now: LocalTime, today: LocalDate, next: NextLine?, beads: List<Bead>, nowMin: Int,
         allDone: Boolean, walk: Boolean, calm: Boolean, doneTick: Int) {
    val pal = LocalPal.current
    val hm = t12(hhmm(now.hour * 60 + now.minute))
    Box(Modifier.fillMaxWidth().background(pal.outside).padding(top = top)) {
        if (folded) {
            Row(Modifier.fillMaxWidth().height(FOLD_H).padding(horizontal = DOC), verticalAlignment = Alignment.CenterVertically) {
                Text(apText(hm), style = T.title.copy(fontFeatureSettings = "tnum"), color = pal.text)
                Spacer(Modifier.width(8.dp))
                Text(dayName(today), style = T.label, color = pal.text2)
            }
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().height(1.dp).background(pal.hair2))
            return@Box
        }
        Column(Modifier.fillMaxWidth().height(HEAD_H)) {
            // 글은 두 기준선에 선다: 날짜는 위, 시계 숫자 · 다음 할 일의 마지막 줄은 같은 기준선 (alignBy LastBaseline).
            // 시계 | 16 | 선 | 16 | 다음. 이름은 폰 폭에서 두 줄까지 (PC 는 20 한 줄 - 여기서 20 이면 여덟 글자에서 잘린다)
            Row(Modifier.fillMaxWidth().weight(1f).padding(start = DOC, end = DOC, top = 24.dp)) {
                Column(Modifier.alignBy(LastBaseline)) {
                    Text(dayName(today), style = T.label, color = pal.text2)
                    Spacer(Modifier.height(8.dp))
                    val big = androidx.compose.ui.text.buildAnnotatedString {
                        append(hm.substringBefore(' '))
                        pushStyle(androidx.compose.ui.text.SpanStyle(fontSize = T.lead.fontSize, fontWeight = FontWeight.Normal)); append(" " + hm.substringAfter(' ')); pop()
                    }
                    Text(big, style = T.display.copy(lineHeight = T.display.fontSize), color = pal.text, maxLines = 1)
                }
                if (next != null) {
                    Spacer(Modifier.width(16.dp))
                    // 다음 할 일 - 시계 다음으로 가장 먼저 읽히는 글. 왼쪽 실선 하나로 시계와 가른다.
                    // 한글은 받침 획이 기준선 아래로 내려와 같은 기준선이면 2dp 처져 보인다 - 그만큼 올린다 (PC 와 같은 광학 보정)
                    Row(Modifier.weight(1f).alignBy(LastBaseline).height(IntrinsicSize.Min)) {
                        Box(Modifier.width(1.dp).fillMaxHeight().background(pal.hair2))
                        Spacer(Modifier.width(16.dp))
                        Column(Modifier.offset(y = (-2).dp)) {
                            Text(next.label, style = T.label, color = pal.teal, maxLines = 1, overflow = TextOverflow.Ellipsis)
                            Spacer(Modifier.height(4.dp))
                            Text(next.title, style = T.head, color = pal.text, maxLines = 2, overflow = TextOverflow.Ellipsis)
                        }
                    }
                }
            }
            DayRuler(beads, nowMin, allDone, walk, calm, doneTick)
        }
    }
}

/**
 * 오늘의 시간 자: 06 ~ 21 시 (그보다 이르거나 늦은 일이 있으면 그 시까지 늘인다). 매시 눈금 · 세 시간마다 숫자.
 * 점: 빨간 테 = 늦음 · 굵은 청록 테 = 다음 · 칠한 점 = 끝냄 (목록의 동그라미와 같은 말). 지나온 구간은 선이 짙다.
 * 선은 머리와 판의 경계를 겸한다.
 */
@Composable
private fun DayRuler(beads: List<Bead>, nowMin: Int, allDone: Boolean, walk: Boolean, calm: Boolean, doneTick: Int) {
    val pal = LocalPal.current
    val tm = rememberTextMeasurer()
    var lo = 360; var hi = 1260
    for (b in beads) { lo = minOf(lo, b.min / 60 * 60); hi = maxOf(hi, (b.min + 60) / 60 * 60) }
    val asleep = nowMin < lo || nowMin > hi || allDone
    // 폴짝 (하나 끝냈을 때) · 깜빡임 (8 ~ 15초마다) - 움직임을 끄면 둘 다 없다
    val hop = remember { Animatable(0f) }
    var blink by remember { mutableStateOf(false) }
    val still = !walk || calm
    LaunchedEffect(doneTick) {
        if (doneTick == 0 || still || asleep) return@LaunchedEffect
        hop.animateTo(1f, tween(170, easing = EaseMove)); hop.animateTo(0f, tween(250))
    }
    LaunchedEffect(still, asleep) {
        while (!still && !asleep) { delay(8_000L + (Math.random() * 7_000).toLong()); blink = true; delay(160); blink = false }
    }
    Canvas(Modifier.fillMaxWidth().height(RULER_H)) {
        val pad = DOC.toPx(); val w = size.width - pad * 2; val y = size.height - .5f
        fun x(m: Int) = pad + w * ((m - lo).toFloat() / (hi - lo)).coerceIn(0f, 1f)
        drawLine(pal.hair2, Offset(0f, y), Offset(size.width, y), 1.dp.toPx())
        drawLine(pal.text.copy(alpha = .55f), Offset(pad, y), Offset(x(nowMin), y), 1.dp.toPx())
        var m = lo
        while (m <= hi) {
            val big = (m / 60) % 3 == 0
            drawLine(pal.hair2, Offset(x(m), y), Offset(x(m), y - (if (big) 7 else 4).dp.toPx()), 1.dp.toPx())
            if (big) label(tm, "%02d".format(m / 60), x(m), y - 10.dp.toPx(), pal)
            m += 60
        }
        // 돌: 점보다 아래 층 - 돌이 일을 가리지 않는다. 끝의 시각 숫자와 겹치지 않게 양 끝에서 조금 안쪽
        val gx = x(nowMin).coerceIn(pad + 12.dp.toPx(), size.width - pad - 12.dp.toPx())
        pebble(gx, y - hop.value * 7.dp.toPx(), pal, asleep || blink, asleep)
        val r = 5.dp.toPx()
        for (b in beads) {
            val c = Offset(x(b.min), y)
            when {
                b.done -> drawCircle(pal.teal.copy(alpha = .55f), r, c)
                b.next -> { drawCircle(pal.board, r, c); drawCircle(pal.teal, r - 1.25.dp.toPx(), c, style = Stroke(2.5.dp.toPx())) }
                b.late -> { drawCircle(pal.board, r, c); drawCircle(pal.late, r - .75.dp.toPx(), c, style = Stroke(1.5.dp.toPx())) }
                else -> { drawCircle(pal.board, r, c); drawCircle(pal.text2, r - .75.dp.toPx(), c, style = Stroke(1.5.dp.toPx())) }
            }
        }
    }
}

private fun DrawScope.label(tm: TextMeasurer, s: String, cx: Float, bottom: Float, pal: Pal) {
    val l = tm.measure(s, T.label.copy(color = pal.text2, fontFeatureSettings = "tnum"))
    drawText(l, topLeft = Offset(cx - l.size.width / 2f, bottom - l.size.height))
}

/** 작은 돌 (18 × 13). 눈 둘뿐 - 감으면 가는 선 */
private fun DrawScope.pebble(cx: Float, base: Float, pal: Pal, closed: Boolean, asleep: Boolean) {
    val w = 18.dp.toPx(); val h = 13.dp.toPx(); val l = cx - w / 2; val t = base - h - 1.dp.toPx()
    val body = Path().apply {
        moveTo(l, t + h * .62f)
        cubicTo(l, t + h * .05f, l + w, t + h * .05f, l + w, t + h * .62f)
        cubicTo(l + w, t + h, l, t + h, l, t + h * .62f); close()
    }
    drawPath(body, pal.guy)
    val ey = t + h * .42f
    for (ex in listOf(l + w * .32f, l + w * .68f)) {
        if (closed) drawRoundRect(pal.eye, Offset(ex - 1.6.dp.toPx(), ey + .8.dp.toPx()), Size(3.2.dp.toPx(), 1.2.dp.toPx()), CornerRadius(1.dp.toPx()))
        else drawOval(pal.eye, Offset(ex - 1.5.dp.toPx(), ey - 1.75.dp.toPx()), Size(3.dp.toPx(), 3.5.dp.toPx()))
    }
}
