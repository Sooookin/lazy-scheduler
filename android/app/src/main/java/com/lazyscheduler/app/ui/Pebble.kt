package com.lazyscheduler.app.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.VectorConverter
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.runtime.setValue
import androidx.compose.ui.FrameRateCategory
import androidx.compose.ui.Modifier
import androidx.compose.ui.preferredFrameRate
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.TransformOrigin
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.unit.dp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.roundToInt
import kotlin.math.sin
import kotlin.random.Random

/**
 * 하늘의 돌멩이 (규칙서: design/references/LS 돌멩이 행동.dc.html, PC 는 web/pebble.js).
 * 휴대폰에서는 그 가운데 눈에 띄는 것만 옮겼다:
 *   가만히    몇 초마다 눈을 깜빡이고, 시선이 이리저리 (빛 쪽을 자주 본다)
 *   움직임    4 ~ 9초마다 한 가지: 자리 조금 옮기기 · 폴짝폴짝 돌아다니기 · 두리번거리기
 *   밤        (해가 졌거나 오늘 일을 다 마치면) 고깔을 쓰고 자리에서 잔다. z 가 오른다
 *             일을 적거나 고치는 동안은 깨어 고깔을 쓴 채 같이 움직이다, 손을 놓으면 다시 잔다
 *   완료      폴짝 뛰고 눈이 웃는다
 *   손        누르면 웃고, 끌면 따라온다 (놓은 자리에 남는다)
 *   고르는 중 새 시각을 고르는 동안에는 점선 구슬 쪽을 본다
 * walk 가 꺼져 있으면 가운데에 앉아 눈만 굴린다. calm 이면 (움직임 줄이기) 뛰지도 걷지도 않는다.
 *
 * 움직이는 값은 모두 그리기 단계(graphicsLayer · Canvas)에서만 읽는다 - 돌멩이가 움직여도
 * 하늘은 다시 그리지 않는다.
 */
/** 화면 갈무리 중에는 돌멩이를 멈춘다 (끝없는 움직임이 있으면 "다 그렸다" 를 기다리다 멈춘다). */
internal var pebbleStill = false

@Composable
fun Pebble(
    width: Float, groundY: Float, night: Boolean, walk: Boolean, calm: Boolean,
    doneTick: Int, lookX: Float?, awake: Boolean = false,
) {
    // 밤이어도 곁에서 일을 하는 동안(awake)은 깨어 고깔을 쓴 채 같이 움직인다
    val asleep = night && !awake
    val pal = LocalPal.current
    val d = LocalDensity.current.density
    val bw = 40 * d; val bh = 32 * d
    val scope = rememberCoroutineScope()
    val x = remember { Animatable(width * .5f) }
    val hop = remember { Animatable(0f) }            // 뜬 높이 (px, 위로 +)
    val sqX = remember { Animatable(1f) }
    val sqY = remember { Animatable(1f) }
    val blink = remember { Animatable(1f) }          // 눈의 세로 (1 뜸 · 0 감음)
    val gaze = remember { Animatable(Offset.Zero, Offset.VectorConverter) }
    var eyes by remember { mutableStateOf("round") }
    var dragging by remember { mutableStateOf(false) }
    val zPhase = remember { Animatable(0f) }
    val look = rememberUpdatedState(lookX)
    val sunX = lightX(width, pal.light)

    suspend fun hopOnce(h: Float = 12f, ms: Int = 300) {
        if (calm) return
        sqY.animateTo(.86f, tween(70)); sqX.animateTo(1.1f, tween(70))
        scope.launch { sqX.animateTo(.94f, tween(ms / 2)); sqX.animateTo(1f, tween(ms / 2)) }
        scope.launch { sqY.animateTo(1.08f, tween(ms / 2)); sqY.animateTo(1f, tween(ms / 2)) }
        hop.animateTo(h * d, tween(ms / 2, easing = FastOutSlowInEasing))
        hop.animateTo(0f, tween(ms / 2, easing = LinearEasing))
        sqY.animateTo(.9f, tween(60)); sqY.animateTo(1f, spring(Spring.DampingRatioMediumBouncy))
    }

    // 자리: 폭이 바뀌면 (처음 · 회전) 안쪽으로
    LaunchedEffect(width) { if (width > 0 && (x.value < bw || x.value > width - bw)) x.snapTo(width * .5f) }

    // 눈 깜빡임
    LaunchedEffect(asleep) {
        if (asleep || pebbleStill) { blink.snapTo(1f); return@LaunchedEffect }
        while (true) {
            delay(Random.nextLong(2500, 6000))
            blink.animateTo(.08f, tween(90)); blink.animateTo(1f, tween(110))
        }
    }
    // 시선
    LaunchedEffect(asleep) {
        while (!asleep && !pebbleStill) {
            val lx = look.value
            val target = when {
                lx != null -> Offset(((lx - x.value) / (width * .3f)).coerceIn(-1f, 1f), -.6f)
                Random.nextFloat() < .45f -> Offset(((sunX - x.value) / (width * .4f)).coerceIn(-1f, 1f), -.7f)
                else -> Offset(Random.nextFloat() * 2 - 1, Random.nextFloat() * 1.2f - .6f)
            }
            gaze.animateTo(target, tween(260))
            delay(if (lx != null) 400 else Random.nextLong(2500, 6000))
        }
        gaze.snapTo(Offset.Zero)
    }
    // 걷기 · 쉬기
    LaunchedEffect(asleep, walk, calm) {
        if (!walk) { x.animateTo(width * .5f, tween(900, easing = FastOutSlowInEasing)); return@LaunchedEffect }
        if (asleep || calm || pebbleStill) return@LaunchedEffect
        var last = ""
        while (true) {
            delay(Random.nextLong(4000, 9000))
            if (dragging) continue
            val acts = listOf("shift", "shift", "wander", "wander", "look", "stretch").filter { it != last }
            val act = acts[Random.nextInt(acts.size)]
            last = act
            when (act) {
                "shift" -> {
                    val to = (x.value + (if (Random.nextBoolean()) 1 else -1) * Random.nextInt(14, 30) * d).coerceIn(bw, width - bw)
                    x.animateTo(to, tween(520, easing = FastOutSlowInEasing))
                }
                "wander" -> {
                    val to = (width * (.12f + Random.nextFloat() * .76f))
                    val steps = (abs(to - x.value) / (38 * d)).roundToInt().coerceIn(2, 6)
                    val from = x.value
                    for (k in 1..steps) {
                        scope.launch { x.animateTo(from + (to - from) * k / steps, tween(300, easing = LinearEasing)) }
                        hopOnce(7f, 300)
                    }
                }
                "look" -> repeat(3) {
                    gaze.animateTo(Offset(Random.nextFloat() * 2 - 1, -.3f), tween(220)); delay(500)
                }
                "stretch" -> {
                    sqY.animateTo(1.14f, tween(380)); sqX.animateTo(.92f, tween(1))
                    delay(300); sqY.animateTo(1f, tween(320)); sqX.animateTo(1f, tween(320))
                }
            }
        }
    }
    // 완료 - 폴짝
    LaunchedEffect(doneTick) {
        if (doneTick == 0 || asleep) return@LaunchedEffect
        eyes = "happy"
        hopOnce(16f, 360)
        delay(900); eyes = "round"
    }
    // 밤 - z 세 개가 번갈아 떠오른다 (한 바퀴를 셋이 1/3 씩 어긋나 나눠 쓴다)
    LaunchedEffect(asleep) {
        eyes = if (asleep) "closed" else "round"
        if (!asleep && night && !pebbleStill) { delay(120); hopOnce(9f, 280) }    // 밤에 깨면 폴짝 한 번
        if (pebbleStill) { zPhase.snapTo(.35f); return@LaunchedEffect }
        if (asleep) { zPhase.snapTo(0f); zPhase.animateTo(1f, infiniteRepeatable(tween(4200, easing = LinearEasing))) }
    }

    Box(
        Modifier
            // 자리는 정수 픽셀로 반올림하지 않고 그리기 층에서 옮긴다 - 느린 움직임이 1px 씩 뚝뚝 끊기지 않는다
            // 기기가 60Hz 로 내려가 있어도 돌멩이가 움직이는 동안은 높은 주사율을 청한다 (움직이지 않으면 그리지 않으므로 청하지도 않는다)
            .preferredFrameRate(FrameRateCategory.High)
            .graphicsLayer {
                translationX = x.value - bw / 2
                translationY = groundY - bh - 4 * d - hop.value
            }
            .size(40.dp, 36.dp)
            .pointerInput(asleep) {
                detectTapGestures {
                    scope.launch {
                        if (asleep) { eyes = "peek"; delay(900); eyes = "closed"; return@launch }
                        eyes = "happy"; hopOnce(8f, 260); delay(700); eyes = "round"
                    }
                }
            }
            .pointerInput(Unit) {
                detectDragGestures(
                    onDragStart = { dragging = true; scope.launch { hop.animateTo(10 * d, tween(120)) } },
                    onDragEnd = { dragging = false; scope.launch { hop.animateTo(0f, tween(220)); sqY.animateTo(.88f, tween(60)); sqY.animateTo(1f, spring(Spring.DampingRatioMediumBouncy)) } },
                    onDragCancel = { dragging = false; scope.launch { hop.animateTo(0f, tween(220)) } },
                ) { ch, drag -> ch.consume(); scope.launch { x.snapTo((x.value + drag.x).coerceIn(bw / 2, width - bw / 2)) } }
            },
    ) {
        Canvas(Modifier.size(40.dp, 36.dp)) {
            // 그림자: 빛의 반대쪽으로, 해가 낮을수록 길게. 뜨면 작고 옅어진다
            val lift = (hop.value / (16 * d)).coerceIn(0f, 1f)
            val dir = pal.light.dir.toFloat()
            val sw = (46 + abs(dir) * 30) * d * (1 - lift * .4f)
            drawOval(Brush.radialGradient(listOf(pal.shade.copy(alpha = .24f * (1 - lift * .6f)), pal.shade.copy(alpha = 0f)),
                center = Offset(size.width / 2 + dir * 16 * d, size.height - 2 * d + hop.value), radius = sw / 2),
                topLeft = Offset(size.width / 2 - sw / 2 + dir * 16 * d, size.height - 6 * d + hop.value), size = Size(sw, 9 * d))
        }
        Canvas(
            Modifier.size(40.dp, 36.dp).graphicsLayer {
                scaleX = sqX.value; scaleY = sqY.value
                transformOrigin = TransformOrigin(.5f, 1f)
                rotationZ = if (asleep) -6f else 0f
            },
        ) {
            val top = 4 * d
            // 몸: 위가 둥글고 아래가 납작한 조약돌
            val body = Path().apply {
                val w = size.width; val b = size.height
                moveTo(w * .5f, top)
                cubicTo(w * .88f, top, w, top + bh * .42f, w * .98f, top + bh * .7f)
                cubicTo(w * .96f, b - 1 * d, w * .75f, b, w * .5f, b)
                cubicTo(w * .25f, b, w * .04f, b - 1 * d, w * .02f, top + bh * .7f)
                cubicTo(0f, top + bh * .42f, w * .12f, top, w * .5f, top)
                close()
            }
            drawPath(body, pal.guy, alpha = .92f)
            drawPath(body, androidx.compose.ui.graphics.Color.White.copy(alpha = .14f), style = Stroke(1 * d))
            // 눈
            val ey = top + 12 * d
            val gap = 7 * d
            val g = gaze.value
            for (s in listOf(-1, 1)) {
                val cx = size.width / 2 + s * (gap / 2 + 3.2f * d)
                when (eyes) {
                    "closed" -> drawLine(pal.eye, Offset(cx - 3.5f * d, ey + 3 * d), Offset(cx + 3.5f * d, ey + 3 * d), 1.6f * d, StrokeCap.Round)
                    "peek" -> if (s < 0) drawLine(pal.eye, Offset(cx - 3.5f * d, ey + 3 * d), Offset(cx + 3.5f * d, ey + 3 * d), 1.6f * d, StrokeCap.Round)
                        else { drawOval(pal.eye, Offset(cx - 3.2f * d, ey - 1 * d), Size(6.5f * d, 7.5f * d)) }
                    "happy" -> drawArc(pal.eye, 200f, 140f, false, Offset(cx - 4.5f * d, ey), Size(9 * d, 7 * d), style = Stroke(1.8f * d, cap = StrokeCap.Round))
                    else -> {
                        val eh = 7.5f * d * blink.value
                        drawOval(pal.eye, Offset(cx - 3.25f * d, ey + (7.5f * d - eh) / 2), Size(6.5f * d, eh))
                        if (blink.value > .4f) drawOval(pal.pupil, Offset(cx - 1.7f * d + g.x * 1.7f * d, ey + 1.9f * d + g.y * 1.7f * d), Size(3.4f * d, 3.8f * d * blink.value))
                    }
                }
            }
            // 밤: 고깔
            if (night) {
                val cap = Path().apply {
                    moveTo(size.width * .5f - 2 * d, top - 13 * d); lineTo(size.width * .5f + 11 * d, top + 5 * d); lineTo(size.width * .5f - 13 * d, top + 5 * d); close()
                }
                drawPath(cap, pal.teal)
                drawRoundRect(pal.teal, Offset(size.width * .5f - 15 * d, top + 3 * d), Size(28 * d, 4 * d), CornerRadius(2 * d))
                drawCircle(pal.onTeal, 2.4f * d, Offset(size.width * .5f - 2 * d, top - 13 * d))
            }
        }
        // z 는 글자가 아니라 선으로 그린다: 글자는 픽셀 격자에 붙어 천천히 오를 때 계단처럼 걸린다
        if (asleep) Canvas(Modifier.size(40.dp, 36.dp)) {
            val stroke = Stroke(1.4f * d, cap = StrokeCap.Round, join = StrokeJoin.Round)
            for (i in 0..2) {
                val ph = (zPhase.value + i / 3f) % 1f
                val zs = (4.5f + ph * 3f) * d
                val zx = size.width - 6 * d + ph * 14 * d + sin(ph * 2 * PI.toFloat()) * 2 * d
                val zy = 6 * d - ph * 34 * d
                val a = sin(ph * PI.toFloat()).let { it * it } * .85f
                val z = Path().apply {
                    moveTo(zx, zy); lineTo(zx + zs, zy); lineTo(zx, zy + zs); lineTo(zx + zs, zy + zs)
                }
                drawPath(z, pal.text, alpha = a, style = stroke)
            }
        }
    }
}
