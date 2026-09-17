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
import androidx.compose.ui.unit.sp
import com.lazyscheduler.app.R

/** Colours from tokens.py (the PC app's single source of design values). */
object Ink {
    val bg = Color(0xFFE7EBEA)
    val card = Color(0xFFE7EBEA)
    val dark = Color(0xFFBBC2C1)
    val light = Color(0xFFFBFDFD)
    val pale = Color(0xFFD6DCDB)
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
    val rule = Color(56, 46, 32, (0.085f * 255).toInt())
    val rule2 = Color(56, 46, 32, (0.17f * 255).toInt())
    val hover = Color(56, 46, 32, (0.085f * 255).toInt())
}

val Paperlogy = FontFamily(
    Font(R.font.paperlogy_light, FontWeight.Light),
    Font(R.font.paperlogy_regular, FontWeight.Normal),
    Font(R.font.paperlogy_medium, FontWeight.Medium),
)

private val type = Typography(
    headlineMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Light, fontSize = 30.sp, color = Ink.ink2),
    titleMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 16.sp, color = Ink.ink2),
    bodyLarge = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 15.sp, color = Ink.body),
    bodyMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Normal, fontSize = 13.sp, color = Ink.faint),
    labelLarge = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 14.sp),
    labelMedium = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 12.sp),
    labelSmall = TextStyle(fontFamily = Paperlogy, fontWeight = FontWeight.Medium, fontSize = 11.sp),
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
            surfaceContainerLow = Ink.bg, surfaceContainer = Ink.bg, surfaceContainerHigh = Ink.light,
            outline = Ink.dark, outlineVariant = Ink.pale,
            error = Color(0xFF9A3B2E),
        ),
        typography = type,
        content = content,
    )
}
