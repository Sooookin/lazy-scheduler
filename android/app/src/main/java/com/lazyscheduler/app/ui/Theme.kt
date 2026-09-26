package com.lazyscheduler.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import com.lazyscheduler.app.R

/** Colours from tokens.py (the PC app's single source of design values) - grain C. */
object Ink {
    val bg = Color(0xFFE4E9E3)
    val card = Color(0xFFEEF2EC)
    val dark = Color(0xFFC8D0CB)
    val light = Color(0xFFFFFFFF)
    val pale = Color(0xFFDBE3DD)
    val sheet2 = Color(0xFFDFE4DE)
    val sheet3 = Color(0xFFD6DCD6)
    val ink2 = Color(0xFF1F2A28)
    val body = Color(0xFF2F3B38)
    val muted = Color(0xFF46514E)
    val faint = Color(0xFF5D6A67)
    val dim = Color(0xFF8A9491)
    val mint = Color(0xFF8FC2B9)
    val mid = Color(0xFF3F6F69)
    val midInk = Color(0xFF35605A)
    val deep = Color(0xFF16211F)
    val onMid = Color(0xFFF2F6F3)
    val danger = Color(0xFFB0573F)
    val hol = Color(0xFFB0573F)             // 공휴일 · 일요일 · 지난 것 (tokens.py 의 hol)
    val warm = Color(0xFFA9682F)            // 임박 (알림 카드에서만)
}

/**
 * 하루의 빛을 섞는 재료 - tokens.py 의 LIGHT 를 그대로 옮긴 것 (tests/test_theme_kt.py 가 지킨다).
 * 화면의 색은 이것을 시각에 따라 섞어 만든다 (Light.kt 의 palette). 이름은 붙임표를 낙타등으로.
 */
object LitTokens {
    val base = Color(0xFFE4E9E3)
    val panel = Color(0xFFEEF2EC)
    val ink = Color(0xFF1F2A28)
    val ink2 = Color(0xFF5D6A67)
    val teal = Color(0xFF3F6F69)
    val warm = Color(0xFFF4DCD4)
    val night = Color(0xFF1A2128)
    val pale = Color(0xFFFFFFFF)
    val pale2 = Color(0xFFE2E7E4)
    val hol = Color(0xFFB0573F)
    val holLit = Color(0xFFF2AB97)
    val late = Color(0xFFB1782F)
    val lateLit = Color(0xFFE2B36F)
    val danger = Color(0xFFD4451A)
    val dangerLit = Color(0xFFFF8A5C)
    val ribPast = Color(0xFF7AA9A1)
    val ribPastN = Color(0xFF467571)
    val tealLit = Color(0xFF6FA199)
    val skyHi = Color(0xFFB7D3E6)
    val skyLo = Color(0xFFE2ECF0)
    val hill1 = Color(0xFFDDE9F0)
    val hill2 = Color(0xFFA8C4D2)
    val hill3 = Color(0xFF7094A8)
    val ribbon = Color(0xFFE6ECE8)
    val ribHi = Color(0xFFF7F9F6)
    val skyHiN = Color(0xFF141B24)
    val skyLoN = Color(0xFF26313C)
    val hill1N = Color(0xFF303E4C)
    val hill2N = Color(0xFF1E2934)
    val hill3N = Color(0xFF111820)
    val ribbonN = Color(0xFF3A4753)
    val ribHiN = Color(0xFF4A5866)
    val skyHiD = Color(0xFFF2B98F)
    val skyLoD = Color(0xFFF9D9D2)
    val hill1D = Color(0xFFEFB8B1)
    val hill2D = Color(0xFFD3868F)
    val hill3D = Color(0xFF94526A)
    val ribbonD = Color(0xFFF6D6CC)
    val ribHiD = Color(0xFFFDEAE4)
    val beadD = Color(0xFFFDEFE9)
    val rayHot = Color(0xFFFFFCF0)
    val rayHotD = Color(0xFFFFE2D2)
    val rayPale = Color(0xFFFFF6DE)
    val rayPaleD = Color(0xFFFCCDBE)
    val rayWarm = Color(0xFFF6C676)
    val rayWarmD = Color(0xFFF08C82)
    val rayShade = Color(0xFF783C50)
    val moon = Color(0xFFE2ECF8)
    val moonCool = Color(0xFFC4D6EC)
    val guy = Color(0xFF1F2A28)
    val guyN = Color(0xFFC9CECC)
    val eye = Color(0xFFE4E9E3)
    val eyeN = Color(0xFF8E9695)
    val pupil = Color(0xFF1F2A28)
    val pupilN = Color(0xFF2B3134)
}

val Paperlogy = FontFamily(
    Font(R.font.paperlogy_light, FontWeight.Light),
    Font(R.font.paperlogy_regular, FontWeight.Normal),
    Font(R.font.paperlogy_medium, FontWeight.Medium),
)

/**
 * 글자 스케일 - tokens.py 의 TYPE 과 같은 일곱 단이다. 자간은 크기에 딸린 값이라 짝으로 둔다.
 * 색은 여기서 정하지 않는다 - 밤낮으로 바뀌므로 그리는 자리에서 팔레트(LocalPal)의 색을 쓴다.
 */
private object Size {
    val display = 44.sp     // 큰 시각
    val title = 20.sp       // 화면 제목
    val head = 15.sp        // 머리줄 (오늘 8)
    val lead = 13.sp        // 줄 제목 · 단추
    val body = 12.5.sp      // 본문
    val label = 11.sp       // 라벨 · 부제
    val micro = 10.5.sp     // 구슬 번호 · 탭 이름
}

private object Track {
    val display = (-0.02).em
    val title = (-0.01).em
    val head = 0.em
    val lead = 0.01.em
    val body = 0.015.em
    val label = 0.03.em
    val micro = 0.04.em
}

/** 화면에서 쓰는 글자꼴. 굵기는 셋뿐이다: 가늘게(숫자 · 제목) · 보통 · 중간(누를 것). */
object T {
    val display = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Light, fontSize = Size.display,
        letterSpacing = Track.display, fontFeatureSettings = "tnum")
    val title = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Light, fontSize = Size.title, letterSpacing = Track.title)
    val head = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = Size.head, letterSpacing = Track.head)
    val lead = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Normal, fontSize = Size.lead, letterSpacing = Track.lead)
    val leadM = lead.copy(fontWeight = FontWeight.Medium)
    val body = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Normal, fontSize = Size.body, letterSpacing = Track.body)
    val time = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Light, fontSize = Size.body, letterSpacing = Track.body,
        fontFeatureSettings = "tnum")
    val label = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Normal, fontSize = Size.label, letterSpacing = Track.label)
    val micro = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = Size.micro, letterSpacing = Track.micro,
        fontFeatureSettings = "tnum")
    val strike = TextDecoration.LineThrough
}

// T 와 같은 파일의 맨 위 값이라 by lazy - 바로 만들면 T 를 초기화하는 도중에 T 를 읽는 순환이 생긴다
private val type by lazy { Typography(
    headlineMedium = T.title,
    titleMedium = T.head,
    bodyLarge = T.lead,
    bodyMedium = T.body,
    bodySmall = T.label,
    labelLarge = T.leadM,
    labelMedium = T.body.copy(fontWeight = FontWeight.Medium),
    labelSmall = T.micro,
) }

@Composable
fun LazyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Ink.mid, onPrimary = Ink.onMid,
            secondary = Ink.mint, onSecondary = Ink.deep,
            background = Ink.bg, onBackground = Ink.ink2,
            surface = Ink.card, onSurface = Ink.ink2,
            surfaceVariant = Ink.pale, onSurfaceVariant = Ink.muted,
            outline = Ink.dark, outlineVariant = Ink.pale,
            error = Ink.danger,
        ),
        typography = type,
        content = content,
    )
}
