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
import kotlin.math.floor
import kotlin.math.min
import kotlin.math.sin

/**
 * 하루의 빛 - web/sky.js 의 sunAlt · applyLight 를 옮긴 것.
 *
 * 2026-10 덜어냄: 하늘 디오라마(능선 · 궤도 · 빛살 · 노을)를 걷었다. 남은 빛의 일은 하나 - 해가 지면(또는 오늘 일을
 * 다 마치면) 눈이 편한 밤 화면으로 건너간다. 화면의 색은 tokens.LIGHT 의 재료를 낮 · 밤 사이로 섞어 만든다.
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

/** 밤의 깊이: 낮에는 0, 해가 지고 15분부터 80분 사이에 1 로 간다 (새벽은 거꾸로). PC 의 nightOf */
fun nightOf(m: Double): Double {
    val (rise, set) = Sun.riseSet().let { it[0].toDouble() to it[1].toDouble() }
    if (m > rise && m < set) return 0.0
    return smooth(min(cdist(m, rise), cdist(m, set)), 15.0, 80.0)
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
    val day: Float,
    val bg: Color, val surface: Color, val text: Color, val text2: Color, val teal: Color,
    val hol: Color, val late: Color, val danger: Color,
    val hair: Color, val hair2: Color, val onTeal: Color, val tealInv: Color, val field: Color,
    val guy: Color, val eye: Color,
    /** 중요한 일의 음영 빛깔 (PC 의 --imp). 면으로만 옅게 깐다 */
    val imp: Color = LitTokens.imp,
) {
    val isNight get() = day < .5f
    /** 흐린 글자 (PC 의 --faint): 투명도로 흐리면 밤에 면이 비쳐 탁해진다 - 면 쪽으로 섞은 색 */
    val faint: Color get() = lerp(text2, surface, .32f)
    /** 판(일정 · 달력 · 편집)과 바깥(머리) - PC 의 --board · --outside. 낮에는 판이 흰빛을 한 단 더 받아 밝고
     *  머리는 푸른 기를 걷은 오프화이트, 밤에는 판을 밝히면 청자 글자의 대비가 4.5:1 아래로 떨어지므로 판은 그대로
     *  두고 머리를 바탕 색으로 가라앉힌다 */
    val board: Color get() = if (isNight) surface else lerp(surface, Color.White, .45f)
    val outside: Color get() = if (isNight) bg else lerp(lerp(surface, bg, .55f), late, .04f)
}

private fun mix(a: Color, b: Color, t: Double) = lerp(a, b, t.toFloat().coerceIn(0f, 1f))

fun palette(litMin: Double): Pal {
    val L = LitTokens
    val day = 1 - nightOf(litMin)
    // 어두워지는 곡선은 가운데서 가파르다 (PC 의 applyLight 와 같다): 면이 중간 회색을 지나는 동안에는
    // 먹빛도 흰빛도 4.5:1 을 넘지 못하므로 그 구간을 몇 분으로 줄인다.
    val dk = smooth(1 - day, .30, .70)
    val surface = mix(L.panel, L.night, dk * .80)
    val ink = mix(L.ink, Color(0xFFE8ECE9), smooth(1 - day, .3, .7))
    // 글자는 섞지 않고 한 번에 뒤집는다 - 섞으면 그 사이에 회색 글자가 생긴다.
    val ls = surface.luminance().toDouble()
    val flip = ls < .30
    val textC = if (flip) L.pale else L.ink
    // 면이 중간 회색에 가까운 몇 분: 색 글자를 본문 글자 쪽으로 당긴다 (빛깔은 남긴다)
    val mid = 1 - smooth(abs(ls - .215), 0.0, .14)
    fun pull(c: Color) = mix(c, textC, mid * (if (flip) .6 else .8))
    return Pal(
        day = day.toFloat(),
        bg = mix(L.base, L.night, dk * .88),
        surface = surface,
        text = textC,
        text2 = pull(if (flip) L.pale2 else L.ink2),
        teal = pull(if (flip) L.tealLit else L.teal),
        hol = pull(if (flip) L.holLit else L.hol),
        late = pull(if (flip) L.lateLit else L.late),
        danger = pull(if (flip) L.dangerLit else L.danger),
        hair = ink.copy(alpha = (.12 + .03 * dk).toFloat()),
        hair2 = ink.copy(alpha = (.20 + .05 * dk).toFloat()),
        // 채운 청록 위의 글자: 밤에는 청록이 밝아지므로 먹빛
        onTeal = if (flip) L.ink else L.pale,
        tealInv = if (flip) L.teal else L.tealLit,
        field = mix(mix(surface, Color.White, day * .55), L.pale, (1 - day) * .10),
        guy = mix(L.guy, L.guyN, 1 - day),
        eye = mix(L.eye, L.eyeN, 1 - day),
        imp = if (flip) L.impLit else L.imp,
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
