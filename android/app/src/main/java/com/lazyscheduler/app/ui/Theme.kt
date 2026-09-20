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
import androidx.compose.ui.unit.sp
import com.lazyscheduler.app.R

/** Colours from tokens.py (the PC app's single source of design values) - grain C. */
object Ink {
    val bg = Color(0xFFEEF1F0)
    val card = Color(0xFFEEF1F0)
    val dark = Color(0xFFC6CCCB)
    val light = Color(0xFFFFFFFF)
    val pale = Color(0xFFDDE2E1)
    val sheet2 = Color(0xFFE6EBEA)      // the sheets stacked behind, and the tabs at the back
    val sheet3 = Color(0xFFDEE4E3)
    val ink2 = Color(0xFF2B2620)
    val body = Color(0xFF3A332B)
    val muted = Color(0xFF453D33)
    val faint = Color(0xFF5C5346)
    val dim = Color(0xFF8B8175)
    val mint = Color(0xFF85BDB3)
    val mid = Color(0xFF4D7572)
    val midInk = Color(0xFF466A68)
    val deep = Color(0xFF08202B)
    val onMid = Color(0xFFEEF3F1)
    val danger = Color(0xFF9A3B2E)
    val hol = Color(0xFF9D4038)         // 달력의 공휴일 · 일요일 (tokens.py 의 hol)
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

// 자간. 한글은 자소가 네모 칸을 꽉 채워서 0 보다 아주 조금 벌려야 읽힌다.
// PC 의 --track (tokens.py 의 track) 과 같은 값이다. 큰 글자는 여기서 좁힌다.
private val TRACK = 0.1.sp
private val TRACK_BIG = (-0.2).sp

private val type = Typography(
    headlineMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 22.sp, color = Ink.ink2,
        letterSpacing = TRACK_BIG),
    titleMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 16.sp, color = Ink.ink2,
        letterSpacing = TRACK),
    bodyLarge = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 15.sp, color = Ink.body,
        letterSpacing = TRACK),
    bodyMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Normal, fontSize = 13.sp, color = Ink.faint,
        letterSpacing = TRACK),
    bodySmall = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Normal, fontSize = 12.sp, color = Ink.faint,
        letterSpacing = TRACK),
    labelLarge = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 14.sp, letterSpacing = TRACK),
    labelMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 12.5.sp, letterSpacing = TRACK),
    labelSmall = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 11.sp, letterSpacing = TRACK),
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
