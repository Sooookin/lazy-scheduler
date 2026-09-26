package com.lazyscheduler.app.ui

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Typography
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithCache
import androidx.compose.ui.geometry.CornerRadius
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.Font
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
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
    val rule = Color(56, 46, 32, (0.085f * 255).toInt())
    val rule2 = Color(56, 46, 32, (0.17f * 255).toInt())
    val hover = Color(56, 46, 32, (0.085f * 255).toInt())
    val midShadow = Color(77, 117, 114, (0.30f * 255).toInt())
}

val Paperlogy = FontFamily(
    Font(R.font.paperlogy_light, FontWeight.Light),
    Font(R.font.paperlogy_regular, FontWeight.Normal),
    Font(R.font.paperlogy_medium, FontWeight.Medium),
)

/**
 * 글자 스케일 - tokens.py 의 TYPE 과 같은 일곱 단이다.
 *
 * 예전에는 22 · 16 · 15 · 14 · 13 · 12.5 · 12 · 11 여덟 가지가 어디서 온 값인지 없이
 * 흩어져 있었고, PC 와도 따로 놀았다. 자간은 크기에 딸린 값이라 여기서 짝으로 둔다:
 * sp 로 적으면 크기가 바뀔 때마다 또 어긋나므로 em 을 sp 로 환산해 둔다
 * (Compose 의 letterSpacing 은 .em 을 받는다).
 */
private object Size {
    val title = 20.sp       // 화면 제목
    val head = 15.sp        // 창 제목
    val lead = 13.sp        // 줄 제목 · 단추
    val body = 12.5.sp      // 본문
    val label = 11.sp       // 라벨 · 부제
}

private object Track {
    val title = (-0.02).em
    val head = (-0.01).em
    val lead = 0.em
    val body = 0.01.em
    val label = 0.02.em
}

private val type = Typography(
    headlineMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = Size.title, color = Ink.ink2,
        letterSpacing = Track.title),
    titleMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = Size.head, color = Ink.ink2,
        letterSpacing = Track.head),
    bodyLarge = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = Size.lead, color = Ink.body,
        letterSpacing = Track.lead),
    bodyMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Normal, fontSize = Size.body, color = Ink.faint,
        letterSpacing = Track.body),
    bodySmall = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Normal, fontSize = Size.label, color = Ink.faint,
        letterSpacing = Track.label),
    labelLarge = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = Size.lead, letterSpacing = Track.lead),
    labelMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = Size.body, letterSpacing = Track.body),
    labelSmall = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = Size.label, letterSpacing = Track.label),
)

@Composable
fun LazyTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = lightColorScheme(
            primary = Ink.mid, onPrimary = Ink.onMid,
            secondary = Ink.mint, onSecondary = Ink.deep,
            background = Ink.bg, onBackground = Ink.ink2,
            surface = Ink.card, onSurface = Ink.ink2,
            surfaceVariant = Ink.pale, onSurfaceVariant = Ink.muted,
            surfaceContainerLow = Ink.bg, surfaceContainer = Ink.bg, surfaceContainerHigh = Ink.card,
            outline = Ink.dark, outlineVariant = Ink.pale,
            error = Ink.danger,
        ),
        typography = type,
        content = content,
    )
}

// ---------------- the neumorphic surface, same as the PC ----------------
// Depth only on things that hold (sheets, buttons, the checkbox); things to read stay flat.

// drawBehind 가 아니라 drawWithCache 를 쓴다. drawBehind 의 본문은 한 프레임마다
// 그대로 다시 도므로, 그 안에서 Paint · Path 를 만들면 스크롤하는 내내 새 객체가 쌓이고
// 쓰레기 치우기가 화면을 끊기게 한다. drawWithCache 는 크기가 바뀔 때만 준비 부분을 다시
// 돌고, 프레임마다는 onDrawBehind 안의 그리기만 한다.

/** A raised surface: light from the top left, shadow to the bottom right. */
fun Modifier.raised(corner: Dp, depth: Dp = 3.dp, color: Color = Ink.card): Modifier = drawWithCache {
    val r = minOf(corner.toPx(), size.minDimension / 2)
    val d = depth.toPx()
    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply { this.color = color.toArgb() }
    onDrawBehind {
        drawIntoCanvas { c ->
            paint.setShadowLayer(d * 2.4f, d, d, Ink.dark.toArgb())
            c.nativeCanvas.drawRoundRect(0f, 0f, size.width, size.height, r, r, paint)
            paint.setShadowLayer(d * 2.4f, -d, -d, Ink.light.toArgb())
            c.nativeCanvas.drawRoundRect(0f, 0f, size.width, size.height, r, r, paint)
        }
    }
}

/** A pressed-in surface (inputs, the checkbox, the tab well). */
fun Modifier.inset(corner: Dp, depth: Dp = 2.dp, color: Color = Ink.card): Modifier = drawWithCache {
    val r = minOf(corner.toPx(), size.minDimension / 2)
    val d = depth.toPx()
    val path = android.graphics.Path().apply {
        addRoundRect(0f, 0f, size.width, size.height, r, r, android.graphics.Path.Direction.CW)
    }
    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        style = android.graphics.Paint.Style.STROKE
        strokeWidth = d * 2
        this.color = color.toArgb()
    }
    onDrawBehind {
        drawRoundRect(color, cornerRadius = CornerRadius(r, r))
        drawIntoCanvas { c ->
            val nc = c.nativeCanvas
            nc.save()
            nc.clipPath(path)
            paint.setShadowLayer(d * 2f, d, d, Ink.dark.toArgb())
            nc.drawPath(path, paint)
            paint.setShadowLayer(d * 2f, -d, -d, Ink.light.toArgb())
            nc.drawPath(path, paint)
            nc.restore()
        }
    }
}
