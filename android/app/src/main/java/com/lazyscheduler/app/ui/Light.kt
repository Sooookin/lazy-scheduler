package com.lazyscheduler.app.ui

import androidx.compose.runtime.Immutable
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.lerp
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
) {
    val isNight get() = day < .5f
}

private fun mix(a: Color, b: Color, t: Double) = lerp(a, b, t.toFloat().coerceIn(0f, 1f))

fun palette(litMin: Double): Pal {
    val L = LitTokens
    val sl = skyLight(litMin)
    val day = 1 - sl.night
    val warm = sl.dusk
    val surface = mix(mix(L.panel, L.warm, warm * .85), L.night, (1 - day) * .80)
    val ink = mix(L.ink, Color(0xFFE8ECE9), smooth(1 - day, .3, .7))
    fun layer(d: Color, dusk: Color, n: Color) = mix(mix(d, dusk, sl.dusk), n, sl.night)
    return Pal(
        light = sl, day = day.toFloat(),
        bg = mix(mix(L.base, L.warm, warm * .70), L.night, (1 - day) * .88),
        surface = surface,
        text = mix(L.ink, L.pale, 1 - day),
        text2 = mix(L.ink2, L.pale2, 1 - day),
        teal = mix(L.teal, L.tealLit, 1 - day),
        hol = mix(L.hol, L.holLit, 1 - day),
        late = mix(L.late, L.lateLit, 1 - day),
        danger = mix(L.danger, L.dangerLit, 1 - day),
        ribPast = mix(L.ribPast, L.ribPastN, 1 - day),
        ribDot = ink.copy(alpha = (.16 + .08 * (1 - day)).toFloat()),
        hair = ink.copy(alpha = .12f),
        hair2 = ink.copy(alpha = .20f),
        onTeal = mix(L.pale, Color(0xFFEDF3EF), 1 - day),
        tealInv = mix(L.teal, L.tealLit, day * .85),
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
    )
}

/** 지금 화면의 색. App 이 시각 · 밝기 설정 · 하루 끝을 보고 넣어 준다. */
val LocalPal = staticCompositionLocalOf { palette(12 * 60.0) }

/** 분 → "13:30". */
internal fun hhmm(m: Int): String = "%02d:%02d".format(((m / 60) % 24 + 24) % 24, ((m % 60) + 60) % 60)
internal fun minsOf(t: String): Int? = runCatching { t.substring(0, 2).toInt() * 60 + t.substring(3, 5).toInt() }.getOrNull()
internal fun floorMod(a: Double, b: Double) = a - b * floor(a / b)
