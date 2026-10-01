package com.lazyscheduler.app.ui

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
import androidx.compose.ui.graphics.luminance
import java.time.LocalDate
import kotlin.math.PI
import kotlin.math.abs
import kotlin.math.asin
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.pow
import kotlin.math.sin

/**
 * 하루의 빛 - web/sky.js 의 sunAlt · skyLight · applyLight 를 옮긴 것.
 *
 * 궤도는 서울에서 오늘 해가 실제로 지나는 길이고, 화면의 모든 색(하늘 · 능선 · 종이 · 글자)은
 * 그 시각의 빛으로 tokens.LIGHT 의 재료를 섞어 만든다. 분 단위의 연속 함수라 어디서도
 * 한 번에 넘어가지 않는다.
 */
object Sun {
    private const val LAT = 37.57
    private const val LON = 126.98
    private const val TZM = 135.0
    private const val RAD = PI / 180

    private class Day(val key: LocalDate, val eot: Double, val ss: Double, val cc: Double)
    private var day: Day? = null
    private var times: Pair<LocalDate, IntArray>? = null

    private fun day(d: LocalDate): Day {
        day?.let { if (it.key == d) return it }
        val n = d.dayOfYear
        val dc = 23.44 * sin(RAD * (360.0 / 365) * (284 + n))
        val b = RAD * (360.0 / 365) * (n - 81)
        val eot = 9.87 * sin(2 * b) - 7.53 * cos(b) - 1.5 * sin(b)
        val p = RAD * LAT; val dl = RAD * dc
        return Day(d, eot, sin(p) * sin(dl), cos(p) * cos(dl)).also { day = it }
    }

    /** 해 높이(도). */
    fun alt(min: Double, d: LocalDate = LocalDate.now()): Double {
        val k = day(d)
        val h = RAD * (15 * ((min + 4 * (LON - TZM) + k.eot) / 60 - 12))
        return asin(k.ss + k.cc * cos(h)) / RAD
    }

    /** 해 뜸 · 해 짐 (분). */
    fun riseSet(d: LocalDate = LocalDate.now()): IntArray {
        times?.let { if (it.first == d) return it.second }
        var rise = 380; var set = 1100
        for (m in 0 until 1440) if (alt(m.toDouble(), d) > -0.83) { rise = m; break }
        for (m in 1439 downTo 1) if (alt(m.toDouble(), d) > -0.83) { set = m; break }
        return intArrayOf(rise, set).also { times = d to it }
    }
}

internal fun smooth(v: Double, a: Double, b: Double): Double {
    val t = ((v - a) / (b - a)).coerceIn(0.0, 1.0)
    return t * t * (3 - 2 * t)
}

private fun cdist(a: Double, b: Double): Double { val d = abs(a - b) % 1440; return min(d, 1440 - d) }

/** 빛의 모양. dusk 노을(0~1) · night 밤(0~1) · dir 광원 쪽(+1 왼쪽 … -1 오른쪽) · 두 광원의 자리. */
@Immutable
data class SkyLight(val dusk: Double, val night: Double, val dir: Double, val tL: Double, val tR: Double, val wR: Double)

fun skyLight(m: Double): SkyLight {
    val (rise, set) = Sun.riseSet().let { it[0].toDouble() to it[1].toDouble() }
    val inDay = m > rise && m < set
    val dTo = min(cdist(m, rise), cdist(m, set))
    val dusk = exp(-(dTo / 55).pow(2))
    val night = if (inDay) 0.0 else smooth(dTo, 15.0, 80.0)
    var tL = .06; var tR = .94
    val dir: Double
    if (inDay) {
        val u = (m - rise) / (set - rise); val tp = .06 + u * .88
        dir = (.5 - u) * 2; tL = min(tp, .5); tR = maxOf(tp, .5)
    } else {
        val len = 1440 - (set - rise)
        dir = -1 + 2 * (((m - set) % 1440 + 1440) % 1440) / len
    }
    return SkyLight(dusk, night, dir, tL, tR, smooth(dir, .2, -.2))
}

/**
 * 밝기 설정과 "하루 끝" 을 빛의 시각으로 바꾼다 (sky.js 의 litAt).
 *   light  한낮(남중)의 빛 · dark 자정의 빛 · auto 실제 시각
 *   nightT 0 지금 빛 ~ 1 자정 빛. 오늘 일을 다 마치면 1 로 흘러간다 (해가 지기 전이라도 밤이 된다).
 */
fun litMinute(min: Double, theme: String, nightT: Double): Double {
    val (rise, set) = Sun.riseSet().let { it[0].toDouble() to it[1].toDouble() }
    if (theme == "light") return (rise + set) / 2
    if (theme == "dark") return 0.0
    if (nightT > 0 && min > rise && min < set + 60) {
        val e = nightT * nightT * (3 - 2 * nightT)
        return (min + (1440 - min) * e) % 1440
    }
    return min
}

/** 한 순간의 화면 색 전부. 시각이 바뀌면 통째로 새로 만든다 (몇 분에 한 번). */
@Immutable
data class Pal(
    val light: SkyLight, val day: Float,
    val bg: Color, val surface: Color, val text: Color, val text2: Color, val teal: Color,
    val hol: Color, val late: Color, val danger: Color, val ribPast: Color, val ribDot: Color,
    val hair: Color, val hair2: Color, val onTeal: Color, val tealInv: Color, val field: Color,
    val skyHi: Color, val skyLo: Color, val hill1: Color, val hill2: Color, val hill3: Color,
    val ribbon: Color, val ribHi: Color, val bead: Color, val guy: Color, val eye: Color, val pupil: Color,
    val skyEdge: Color, val shade: Color,
    /** 빛 (PC 의 --glow · --glow-w): 칠한 것 둘레의 옅은 번짐 세기와, 밤에만 켜지는 흰 글자 번짐 세기 */
    val glow: Float = 0f, val glowW: Float = 0f,
) {
    val isNight get() = day < .5f
    /** 흐린 글자 (PC 의 --faint): 투명도로 흐리면 밤에 면이 비쳐 탁해진다 - 면 쪽으로 섞은 색 */
    val faint: Color get() = lerp(text2, surface, .32f)
    /** 일정 판 쪽의 빛 (PC 의 --glow-l · --glow-wl): 하늘의 반쯤. 읽는 곳에서는 네온 느낌이 강했다 */
    val glowL: Float get() = glow * .45f
    val glowWL: Float get() = glowW * .45f
}

private fun mix(a: Color, b: Color, t: Double) = lerp(a, b, t.toFloat().coerceIn(0f, 1f))

fun palette(litMin: Double): Pal {
    val L = LitTokens
    val sl = skyLight(litMin)
    val day = 1 - sl.night
    val warm = sl.dusk
    // 어두워지는 곡선은 가운데서 가파르다 (PC 의 applyLight 와 같다): 면이 중간 회색을 지나는 동안에는
    // 먹빛도 흰빛도 4.5:1 을 넘지 못하므로 그 구간을 몇 분으로 줄인다.
    val dk = smooth(1 - day, .30, .70)
    val surface = mix(mix(L.panel, L.warm, warm * .85), L.night, dk * .836)
    val ink = mix(L.ink, Color(0xFFE8ECE9), smooth(1 - day, .3, .7))
    // 글자는 섞지 않고 한 번에 뒤집는다 - 섞으면 회색 글자가 생겨 19:10 무렵 본문이 1.2:1 로 사라졌다.
    // 뒤집는 곳은 대비가 같아지는 휘도(.215)보다 조금 밝은 .30 (회색 면 위에서는 밝은 글자가 더 또렷하다).
    val ls = surface.luminance().toDouble()
    val flip = ls < .30
    val textC = if (flip) L.pale else L.ink
    // 면이 중간 회색에 가까운 몇 분: 색 글자를 본문 글자 쪽으로 당긴다 (빛깔은 남긴다)
    val mid = 1 - smooth(abs(ls - .215), 0.0, .14)
    fun pull(c: Color) = mix(c, textC, mid * (if (flip) .6 else .8))
    fun layer(d: Color, dusk: Color, n: Color) = mix(mix(d, dusk, sl.dusk), n, sl.night)
    return Pal(
        light = sl, day = day.toFloat(),
        bg = mix(mix(L.base, L.warm, warm * .70), L.night, dk * .904),
        surface = surface,
        text = textC,
        text2 = pull(if (flip) L.pale2 else L.ink2),
        teal = pull(if (flip) L.tealLit else L.teal),
        hol = pull(if (flip) L.holLit else L.hol),
        late = pull(if (flip) L.lateLit else L.late),
        danger = pull(if (flip) L.dangerLit else L.danger),
        ribPast = mix(L.ribPast, L.ribPastN, 1 - day),
        ribDot = ink.copy(alpha = (.16 + .08 * (1 - day)).toFloat()),
        hair = ink.copy(alpha = (.12 + .03 * dk).toFloat()),
        hair2 = ink.copy(alpha = (.20 + .05 * dk).toFloat()),
        // 채운 청록 위의 글자: 밤에는 청록이 네온 민트로 밝아지므로 먹빛
        onTeal = if (flip) L.ink else L.pale,
        tealInv = if (flip) L.teal else L.tealLit,
        field = mix(mix(surface, Color.White, day * .55), L.pale, (1 - day) * .10),
        skyHi = layer(L.skyHi, L.skyHiD, L.skyHiN),
        skyLo = layer(L.skyLo, L.skyLoD, L.skyLoN),
        hill1 = layer(L.hill1, L.hill1D, L.hill1N),
        hill2 = layer(L.hill2, L.hill2D, L.hill2N),
        hill3 = layer(L.hill3, L.hill3D, L.hill3N),
        ribbon = layer(L.ribbon, L.ribbonD, L.ribbonN),
        ribHi = layer(L.ribHi, L.ribHiD, L.ribHiN),
        bead = layer(L.ribHi, L.beadD, L.ribbonN),
        guy = mix(L.guy, L.guyN, 1 - day),
        eye = mix(L.eye, L.eyeN, 1 - day),
        pupil = mix(L.pupil, L.pupilN, 1 - day),
        skyEdge = Color.White.copy(alpha = (.32 + .58 * day).toFloat()),
        shade = L.ink,
        glow = (if (flip) .12 + .12 * smooth(1 - day, .5, 1.0) else .13).toFloat(),
        glowW = (if (flip) .75 + .25 * smooth(1 - day, .5, 1.0) else 0.0).toFloat(),
    )
}

/** 지금 화면의 색. App 이 시각 · 밝기 설정 · 하루 끝을 보고 넣어 준다. */
val LocalPal = staticCompositionLocalOf { palette(12 * 60.0) }

/** 분 → "13:30". */
/**
 * 보여 주는 시각은 12시간: "13:00" → "01:00 PM" (PC 의 tmText). 저장 · 비교 · 고르기는 24시간 그대로다.
 * apText 는 그 글자에서 AM · PM 만 작게 줄인다 (숫자 오른쪽에 작게 - PC 의 tmHTML).
 */
internal fun t12(t: String): String {
    val m = minsOf(t) ?: return t
    val h = m / 60
    return "%02d:%02d %s".format(if (h % 12 == 0) 12 else h % 12, m % 60, if (h < 12) "AM" else "PM")
}
private val AP = Regex("""(\d{2}:\d{2}) (AM|PM)""")
internal fun apText(s: String): androidx.compose.ui.text.AnnotatedString = androidx.compose.ui.text.buildAnnotatedString {
    var last = 0
    for (m in AP.findAll(s)) {
        append(s.substring(last, m.range.first)); append(m.groupValues[1])
        pushStyle(androidx.compose.ui.text.SpanStyle(fontSize = androidx.compose.ui.unit.TextUnit(.74f, androidx.compose.ui.unit.TextUnitType.Em),
            fontWeight = androidx.compose.ui.text.font.FontWeight.Normal))
        append(" " + m.groupValues[2]); pop()
        last = m.range.last + 1
    }
    append(s.substring(last))
}

internal fun hhmm(m: Int): String = "%02d:%02d".format(((m / 60) % 24 + 24) % 24, ((m % 60) + 60) % 60)
internal fun minsOf(t: String): Int? = runCatching { t.substring(0, 2).toInt() * 60 + t.substring(3, 5).toInt() }.getOrNull()
internal fun floorMod(a: Double, b: Double) = a - b * floor(a / b)
