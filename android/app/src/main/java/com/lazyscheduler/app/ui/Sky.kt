package com.lazyscheduler.app.ui

import android.graphics.BlurMaskFilter
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.gestures.detectDragGestures
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberUpdatedState
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clipToBounds
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.PathEffect
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.StrokeJoin
import androidx.compose.ui.graphics.asAndroidPath
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.drawscope.rotate
import androidx.compose.ui.graphics.drawscope.translate
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import kotlin.math.abs
import kotlin.math.atan2
import kotlin.math.cos
import kotlin.math.hypot
import kotlin.math.max
import kotlin.math.roundToInt
import kotlin.math.sin

/** 궤도 위의 구슬 하나 = 오늘의 일 하나. n 은 아래 목록의 번호와 같다. */
@Immutable
data class Bead(val n: Int, val min: Int, val done: Boolean, val late: Boolean, val next: Boolean)

/**
 * 하늘의 자. PC 의 참고 도안(900 × 206)을 그대로 쓰고, 가로는 화면 폭으로 늘린다. 세로는
 * 바닥(땅)에 붙여 둔다 - 하늘이 접히면(편집 · 달력 · 전체 · 설정) 위쪽이 잘려 나가고 능선과
 * 땅만 남는다.
 */
class SkyGeo(val w: Float, val h: Float, val tallH: Float, val top: Float, dp: Float) {
    private val ky = tallH / 206f
    fun x(v: Float) = v / 900f * w
    fun y(v: Float) = h - (206f - v) * ky
    val hz = y(180f)                                   // 지평선
    private val pk = top + 26 * dp - (tallH - h)       // 궤도 꼭대기 (접히면 같이 올라가 잘린다)
    private val rs = Sun.riseSet()
    val t0 = rs[0].toDouble(); val t1 = rs[1].toDouble()
    private val x0 = .11f * w; private val x1 = .89f * w
    private val altMax = run { var a = 1.0; var m = t0; while (m <= t1) { a = max(a, Sun.alt(m)); m += 10 }; a }

    fun at(m: Double): Offset = Offset(
        (x0 + (m - t0) / (t1 - t0) * (x1 - x0)).toFloat(),
        (hz - Sun.alt(m) / altMax * (hz - pk)).toFloat(),
    )

    /** 지평선에 붙은 구슬은 땅에 잠긴다 - 궤도를 따라 안쪽으로 밀어 올린다. */
    fun onArc(m0: Double, dp: Float): Pair<Offset, Double> {
        val minY = hz - 20 * dp
        val mid = (t0 + t1) / 2
        var m = m0.coerceIn(t0 + 20, t1 - 20)
        var q = at(m); var n = 0
        while (q.y > minY && n++ < 400) { m += if (m0 < mid) 2 else -2; q = at(m) }
        return q to m
    }

    /** 궤도를 따라 d 픽셀 옆 (한 묶음의 구슬은 띠를 타고 늘어선다). */
    fun along(m0: Double, c: Offset, d: Float): Offset {
        if (d == 0f) return c
        var m = m0; var q = c; var n = 0
        while (hypot(q.x - c.x, q.y - c.y) < abs(d) && n++ < 600) { m += if (d > 0) .5 else -.5; q = at(m) }
        return q
    }

    /** 가로 자리 → 시각 (점선 구슬 끌기). 5분 단위. */
    fun minuteAt(px: Float): Int {
        val m = t0 + (px - x0) / (x1 - x0) * (t1 - t0)
        return ((m.coerceIn(t0 + 5, t1 - 5) / 5).roundToInt() * 5)
    }

    fun arc(a: Double, b: Double): Path = smoothPath((0..40).map { at(a + (b - a) * it / 40) })

    /** 도안의 곡선 문자열("M x y C … S …")을 이 자로 옮긴다. */
    fun path(d: String, close: Boolean): Path {
        val p = Path()
        val nums = Regex("[MCS]|-?[\\d.]+").findAll(d).map { it.value }.toList()
        var i = 0; var lastC2: Offset? = null; var cur = Offset.Zero
        fun pt(): Offset { val o = Offset(x(nums[i].toFloat()), y(nums[i + 1].toFloat())); i += 2; return o }
        var cmd = "M"
        while (i < nums.size) {
            if (nums[i] in setOf("M", "C", "S")) { cmd = nums[i]; i++; continue }
            when (cmd) {
                "M" -> { cur = pt(); p.moveTo(cur.x, cur.y); lastC2 = null }
                "C" -> { val a = pt(); val b = pt(); val e = pt(); p.cubicTo(a.x, a.y, b.x, b.y, e.x, e.y); lastC2 = b; cur = e }
                "S" -> {
                    val a = lastC2?.let { Offset(2 * cur.x - it.x, 2 * cur.y - it.y) } ?: cur
                    val b = pt(); val e = pt(); p.cubicTo(a.x, a.y, b.x, b.y, e.x, e.y); lastC2 = b; cur = e
                }
            }
        }
        if (close) { p.lineTo(x(906f), y(232f)); p.lineTo(x(-6f), y(232f)); p.close() }
        return p
    }
}

/** 점들을 지나는 부드러운 선 (sky.js 의 bez). */
private fun smoothPath(p: List<Offset>): Path {
    val out = Path()
    if (p.size < 2) return out
    out.moveTo(p[0].x, p[0].y)
    for (i in 0 until p.size - 1) {
        val a = p.getOrElse(i - 1) { p[i] }; val b = p[i]; val c = p[i + 1]; val e = p.getOrElse(i + 2) { p[i + 1] }
        out.cubicTo(b.x + (c.x - a.x) / 6, b.y + (c.y - a.y) / 6, c.x - (e.x - b.x) / 6, c.y - (e.y - b.y) / 6, c.x, c.y)
    }
    return out
}

private val HILLS = listOf(
    Triple("M-6 144C40 132 82 120 132 124S202 146 252 140S332 114 392 118S472 144 532 136S622 106 692 112S782 142 842 134S892 122 906 124", 2f to .14f, .7f),
    Triple("M-6 170C60 160 112 150 172 156S262 178 332 170S432 148 502 154S602 178 672 168S782 146 852 156S900 170 906 168", 4.5f to .24f, .6f),
    Triple("M-6 192C70 184 140 178 210 184S320 198 400 192S520 176 600 182S740 198 820 190S890 180 906 184", 7f to .32f, .45f),
)
private const val GROUND = "M-6 206C130 202 290 209 450 205S740 201 906 206"

/**
 * 하늘 한 장. 뒤에서 앞으로: 하늘 → 빛 → 먼 능선 셋(겹 사이 안개) → 궤도 띠 → 구슬 → 땅.
 * 해도 달도 동그라미로 그리지 않는다 - 빛이 어디서 오는지는 그림자가 말한다 (아침엔 오른쪽,
 * 한낮엔 발밑, 저녁엔 왼쪽으로 진다). 돌멩이는 이 위에 따로 얹는다 (Pebble).
 *
 * @param ribbon 궤도 · 구슬이 보이는 정도 (하늘이 접히면 0)
 * @param ghost  고르는 중인 시각 - 점선 구슬. onGhost 가 있으면 하늘을 끌어 바꿀 수 있다.
 */
@Composable
fun Sky(
    height: Dp, tallHeight: Dp, top: Dp, ribbon: Float,
    beads: List<Bead>, nowMin: Int, ghost: Int?, onGhost: ((Int) -> Unit)?,
    modifier: Modifier = Modifier, overlay: @Composable () -> Unit = {},
) {
    val pal = LocalPal.current
    val tm = rememberTextMeasurer()
    val ghostCb = rememberUpdatedState(onGhost)
    Box(modifier.fillMaxWidth().height(height)) {
        Canvas(
            // 그림자가 캔버스 밖(아래 종이)으로 번지지 않게 자른다
            Modifier.fillMaxWidth().height(height).clipToBounds().then(
                if (onGhost == null) Modifier else Modifier
                    .pointerInput(Unit) {
                        detectTapGestures { o -> ghostCb.value?.let { cb -> cb(geoFor(size.width.toFloat(), size.height.toFloat(), tallHeight.toPx(), top.toPx(), density).minuteAt(o.x)) } }
                    }
                    .pointerInput(Unit) {
                        detectDragGestures { ch, _ ->
                            ghostCb.value?.let { cb -> cb(geoFor(size.width.toFloat(), size.height.toFloat(), tallHeight.toPx(), top.toPx(), density).minuteAt(ch.position.x)) }
                        }
                    }
            ),
        ) {
            val g = geoFor(size.width, size.height, tallHeight.toPx(), top.toPx(), density)
            drawSky(g, pal, tm, ribbon, beads, nowMin, ghost)
        }
        overlay()
    }
}

private var geoCache: SkyGeo? = null
private var geoKey: List<Any>? = null
private fun geoFor(w: Float, h: Float, tall: Float, top: Float, dp: Float): SkyGeo {
    val key = listOf(w, h, tall, top, dp, Sun.riseSet()[0])
    if (key != geoKey) { geoCache = SkyGeo(w, h, tall, top, dp); geoKey = key }
    return geoCache!!
}

/** 그림자는 같은 모양을 빛의 반대쪽으로 흐리게 한 번 더 그린 것이다. */
private fun DrawScope.cast(path: Path, dir: Double, len: Float, blur: Float, op: Float, color: Color) {
    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color.copy(alpha = op).toArgb()
        maskFilter = BlurMaskFilter(max(blur, .5f) * density, BlurMaskFilter.Blur.NORMAL)
    }
    drawIntoCanvas { c ->
        c.nativeCanvas.save()
        c.nativeCanvas.translate((dir * len).toFloat() * density, len * .85f * density)
        c.nativeCanvas.drawPath(path.asAndroidPath(), paint)
        c.nativeCanvas.restore()
    }
}

private fun DrawScope.drawSky(g: SkyGeo, p: Pal, tm: TextMeasurer, ribbon: Float, beads: List<Bead>, nowMin: Int, ghost: Int?) {
    val dp = density
    val sl = p.light
    val dir = sl.dir
    // ── 하늘 ──
    drawRect(Brush.verticalGradient(listOf(p.skyHi, p.skyLo), startY = g.y(0f), endY = g.hz))
    drawLight(g, p)

    // ── 능선 셋. 뒤일수록 높고 옅으며, 겹 사이마다 지평선 쪽 하늘빛 안개를 한 장씩 ──
    val fills = listOf(p.hill1, p.hill2, p.hill3)
    val mists = listOf(122f to 172f, 148f to 194f, null)
    HILLS.forEachIndexed { k, (d, sh, edge) ->
        val fill = g.path(d, true)
        cast(fill, dir, sh.first, sh.first * .8f, sh.second, p.shade)
        drawPath(fill, fills[k])
        drawPath(g.path(d, false), p.skyEdge, alpha = edge, style = Stroke(1 * dp))
        mists[k]?.let { (a, b) ->
            drawRect(Brush.verticalGradient(listOf(p.skyLo.copy(alpha = 0f), p.skyLo.copy(alpha = .42f)), startY = g.y(a), endY = g.y(b)),
                topLeft = Offset(0f, g.y(a)), size = Size(size.width, g.y(b) - g.y(a)))
        }
    }

    // ── 궤도 · 구슬 (접히면 사라진다) ──
    if (ribbon > .01f) {
        val a0 = g.t0 - 40; val a1 = g.t1 + 40
        val orbit = g.arc(a0, a1)
        val rib = 12 * dp
        val stroke = Stroke(rib, cap = StrokeCap.Round, join = StrokeJoin.Round)
        val shPaint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
            style = android.graphics.Paint.Style.STROKE; strokeWidth = rib; strokeCap = android.graphics.Paint.Cap.ROUND
            color = p.shade.copy(alpha = .36f * ribbon).toArgb()
            maskFilter = BlurMaskFilter(6 * dp, BlurMaskFilter.Blur.NORMAL)
        }
        drawIntoCanvas { c ->
            c.nativeCanvas.save(); c.nativeCanvas.translate((dir * 10).toFloat() * dp, 9 * dp)
            c.nativeCanvas.drawPath(orbit.asAndroidPath(), shPaint); c.nativeCanvas.restore()
        }
        drawPath(orbit, p.ribbon, alpha = ribbon, style = stroke)
        val nowM = nowMin.toDouble()
        val yday = if (nowM < a0) 1 - smooth(nowM, a0 - 120, a0) else 0.0
        if (yday > .003) drawPath(orbit, p.ribPast, alpha = (yday * ribbon).toFloat(), style = stroke)
        if (nowM > a0) drawPath(g.arc(a0, minOf(nowM, a1)), p.ribPast, alpha = ribbon, style = stroke)
        drawPath(orbit, p.ribDot, alpha = ribbon, style = Stroke(1.3f * dp, cap = StrokeCap.Round,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(.1f, 5 * dp))))
        translate(0f, -5.5f * dp) { drawPath(orbit, p.skyEdge, alpha = .8f * ribbon, style = Stroke(1.2f * dp)) }
        translate(0f, 5.5f * dp) { drawPath(orbit, p.shade, alpha = .16f * ribbon, style = Stroke(1 * dp)) }
        drawBeads(g, p, tm, ribbon, beads, nowMin, ghost)
    }

    // ── 땅. 맨 앞 종이이자 아래 목록의 판 ──
    val ground = g.path(GROUND, true)
    cast(ground, dir, 9f, 5f, .42f, p.shade)
    drawPath(ground, p.surface)
    drawPath(g.path(GROUND, false), p.skyEdge, alpha = .9f, style = Stroke(1 * dp))
}

private fun DrawScope.drawBeads(g: SkyGeo, p: Pal, tm: TextMeasurer, a: Float, beads: List<Bead>, nowMin: Int, ghost: Int?) {
    val dp = density
    val r = 9.5f * dp
    // 가까운 것은 한 덩어리 (알약)로 묶는다 - 겹쳐서 얼룩이 되지 않게
    val placed = beads.map { it to g.onArc(it.min.toDouble(), dp).first.x }.sortedBy { it.second }
    val groups = ArrayList<MutableList<Bead>>()
    var lastX = -1e9f
    for ((b, x) in placed) {
        if (groups.isNotEmpty() && x - lastX < 22 * dp) groups.last().add(b) else groups.add(mutableListOf(b))
        lastX = x
    }
    val beadShadow = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        color = p.shade.copy(alpha = .35f * a).toArgb()
        maskFilter = BlurMaskFilter(4 * dp, BlurMaskFilter.Blur.NORMAL)
    }
    for (grp in groups) {
        val n = grp.size
        val (c0, m0) = g.onArc(grp.sumOf { it.min }.toDouble() / n, dp)
        val open = grp.filter { !it.done }
        if (open.isNotEmpty()) drawLine(if (open.any { it.late }) p.late else p.teal, Offset(c0.x, c0.y + r + 2 * dp),
            Offset(c0.x, g.hz), strokeWidth = 1.4f * dp, alpha = .7f * a)
        if (n > 1) {
            val q1 = g.at(m0 - 1); val q2 = g.at(m0 + 1)
            val ang = Math.toDegrees(atan2((q2.y - q1.y).toDouble(), (q2.x - q1.x).toDouble())).toFloat()
            val pw = n * 20 * dp + 6 * dp
            rotate(ang, c0) {
                drawRoundRect(p.bead, Offset(c0.x - pw / 2, c0.y - 12 * dp), Size(pw, 24 * dp), CornerRadius(12 * dp), alpha = a)
                drawRoundRect(p.teal, Offset(c0.x - pw / 2, c0.y - 12 * dp), Size(pw, 24 * dp), CornerRadius(12 * dp), alpha = a, style = Stroke(1 * dp))
            }
        }
        grp.forEachIndexed { j, b ->
            val c = g.along(m0, c0, (j - (n - 1) / 2f) * 20 * dp)
            val ring = if (b.late) p.late else p.teal
            val fill = b.done || b.next
            val op = (if (b.done) .55f else 1f) * a
            drawIntoCanvas { cv -> cv.nativeCanvas.drawCircle(c.x + (p.light.dir * 5 * dp).toFloat(), c.y + 5 * dp, r, beadShadow) }
            drawCircle(if (fill) p.teal else p.bead, r, c, alpha = op)
            drawCircle(ring, r, c, alpha = op, style = Stroke(1.6f * dp))
            if (b.next && !b.done) drawCircle(p.onTeal, r - 3 * dp, c, alpha = .6f * a, style = Stroke(1 * dp))
            val lay = tm.measure(b.n.toString(), T.micro.copy(color = if (fill) p.onTeal else ring))
            drawText(lay, topLeft = Offset(c.x - lay.size.width / 2f, c.y - lay.size.height / 2f), alpha = op)
        }
    }
    // 고르는 중인 시각: 점선 구슬과 점선 줄기 (저장하면 실선이 된다)
    if (ghost != null) {
        val (q, _) = g.onArc(ghost.toDouble(), dp)
        val dash = PathEffect.dashPathEffect(floatArrayOf(2.4f * dp, 2 * dp))
        drawLine(p.teal, Offset(q.x, q.y + r), Offset(q.x, g.hz), 1.2f * dp, alpha = .8f * a,
            pathEffect = PathEffect.dashPathEffect(floatArrayOf(2 * dp, 3 * dp)))
        drawCircle(p.bead, r, q, alpha = a)
        drawCircle(p.teal, r, q, alpha = a, style = Stroke(1.4f * dp, pathEffect = dash))
    }
    // 지금 - 작은 구슬 하나가 "해가 여기까지 왔다" 를 말한다
    val (cq, _) = g.onArc(nowMin.toDouble(), dp)
    drawCircle(p.bead, 6 * dp, cq, alpha = a)
    drawCircle(p.teal, 6 * dp, cq, alpha = a, style = Stroke(1.4f * dp))
}

/**
 * 빛 (sky.js 의 liteSet 을 줄인 것). 낮: 구석의 번짐 하나에서 비스듬한 빛살 몇 줄, 반대쪽엔 그늘.
 * 밤: 빛살 없이 서늘한 번짐만. 왼쪽 · 오른쪽 광원을 몫(wR)대로 겹친다.
 */
private fun DrawScope.drawLight(g: SkyGeo, p: Pal) {
    val L = LitTokens
    val sl = p.light
    val dp = density
    val k = g.w / 900f
    for ((left, w, t) in listOf(Triple(true, 1 - sl.wR, sl.tL), Triple(false, sl.wR, sl.tR))) {
        if (w < .003) continue
        val ox = if (left) ((-20 + t * 240) * k).toFloat() else (g.w + (20 - (1 - t) * 240) * k).toFloat()
        val oy = g.y((-60 + abs(.5 - t) * 80 + sl.dusk * 70).toFloat())
        val o = Offset(ox, oy)
        val dayW = (w * (1 - sl.night)).toFloat()
        val nightW = (w * sl.night).toFloat()
        if (dayW > .003f) {
            val d = sl.dusk.toFloat()
            val warm = androidx.compose.ui.graphics.lerp(L.rayWarm, L.rayWarmD, d)
            val pale = androidx.compose.ui.graphics.lerp(L.rayPale, L.rayPaleD, d)
            val hot = androidx.compose.ui.graphics.lerp(L.rayHot, L.rayHotD, d)
            drawRect(Brush.linearGradient(listOf(pale.copy(alpha = .55f * dayW), pale.copy(alpha = 0f), L.rayShade.copy(alpha = ((.2 + sl.dusk * .18) * dayW).toFloat())),
                start = if (left) Offset.Zero else Offset(size.width, 0f), end = if (left) Offset(size.width, size.height) else Offset(0f, size.height)))
            for ((off, wid, op) in listOf(Triple(-26f, 40f, .22f), Triple(-12f, 70f, .3f), Triple(2f, 30f, .28f), Triple(12f, 90f, .26f),
                Triple(26f, 36f, .22f), Triple(-9f, 5f, .45f), Triple(5f, 3f, .42f), Triple(20f, 4f, .4f))) {
                val ang = Math.toRadians(((if (left) 58 else 122) + off).toDouble())
                val nx = (-sin(ang) * wid * dp / 2).toFloat(); val ny = (cos(ang) * wid * dp / 2).toFloat()
                val len = 900 * dp
                val fx = (cos(ang) * len).toFloat(); val fy = (sin(ang) * len).toFloat()
                val flare = 1.6f
                val path = Path().apply {
                    moveTo(o.x + nx, o.y + ny); lineTo(o.x - nx, o.y - ny)
                    lineTo(o.x - nx * flare + fx, o.y - ny * flare + fy); lineTo(o.x + nx * flare + fx, o.y + ny * flare + fy); close()
                }
                drawPath(path, Brush.linearGradient(listOf(hot.copy(alpha = op * 1.2f * dayW), pale.copy(alpha = op * dayW),
                    warm.copy(alpha = op * .3f * dayW), warm.copy(alpha = 0f)), start = o, end = Offset(o.x + fx * .35f, o.y + fy * .35f)))
            }
            drawCircle(Brush.radialGradient(listOf(hot.copy(alpha = .95f * dayW), pale.copy(alpha = .45f * dayW), warm.copy(alpha = .12f * dayW), warm.copy(alpha = 0f)),
                center = o, radius = 170 * dp), 170 * dp, o)
        }
        if (nightW > .003f) {
            drawRect(Brush.linearGradient(listOf(L.moon.copy(alpha = .22f * nightW), L.moonCool.copy(alpha = .08f * nightW), Color(0xFF04080E).copy(alpha = .35f * nightW)),
                start = if (left) Offset.Zero else Offset(size.width, 0f), end = if (left) Offset(size.width, size.height) else Offset(0f, size.height)))
            drawCircle(Brush.radialGradient(listOf(L.moon.copy(alpha = .55f * nightW), L.moonCool.copy(alpha = .22f * nightW), L.moonCool.copy(alpha = .06f * nightW), L.moonCool.copy(alpha = 0f)),
                center = o, radius = 240 * dp), 240 * dp, o)
        }
    }
}

/** 광원이 있는 가로 자리 (돌멩이의 눈이 그쪽을 본다). */
fun lightX(w: Float, sl: SkyLight): Float {
    val k = w / 900f
    val l = (-20 + sl.tL * 240) * k
    val r = w + (20 - (1 - sl.tR) * 240) * k
    return ((1 - sl.wR) * l + sl.wR * r).toFloat()
}
