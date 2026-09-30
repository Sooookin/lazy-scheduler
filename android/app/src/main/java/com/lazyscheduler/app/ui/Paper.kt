package com.lazyscheduler.app.ui

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.BlurMaskFilter
import android.os.Build
import androidx.compose.runtime.Composable
import androidx.compose.runtime.Immutable
import androidx.compose.runtime.ReadOnlyComposable
import androidx.compose.runtime.remember
import androidx.compose.runtime.staticCompositionLocalOf
import androidx.compose.ui.Modifier
import androidx.compose.ui.composed
import androidx.compose.ui.draw.drawBehind
import androidx.compose.ui.graphics.BlendMode
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.ImageShader
import androidx.compose.ui.graphics.ShaderBrush
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.graphics.TileMode
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.drawscope.drawIntoCanvas
import androidx.compose.ui.graphics.nativeCanvas
import androidx.compose.ui.graphics.toArgb
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.unit.Dp
import com.lazyscheduler.app.R
import kotlin.math.roundToInt

/**
 * 종이 결. PC 의 web/paper.png(디오라마) · web/paper-fine.png(글자를 읽는 판)와 같은 그림이다
 * (tools/make_paper.py 가 만든다 - res/drawable-nodpi 에 그대로 복사). 가운데 회색 둘레로만
 * 오르내리므로 soft-light 로 섞으면 빛깔은 그대로이고 결만 드러난다.
 *
 * 한 칸 256 을 dp 로 맞춰 키운다 (PC 의 256 CSS px 와 같은 결의 크기). soft-light 는 안드로이드 10
 * (API 29) 부터라 그 아래에서는 결을 그리지 않는다 - 맨 면 그대로다.
 */
@Immutable
class PaperBrushes(val coarse: ShaderBrush?, val fine: ShaderBrush?)

val LocalPaper = staticCompositionLocalOf { PaperBrushes(null, null) }

@Composable
fun rememberPaper(): PaperBrushes {
    val res = LocalContext.current.resources
    val d = LocalDensity.current.density
    return remember(d) {
        if (Build.VERSION.SDK_INT < 29) PaperBrushes(null, null) else {
            fun load(id: Int): ShaderBrush {
                val src = BitmapFactory.decodeResource(res, id, BitmapFactory.Options().apply { inScaled = false })
                val n = (256 * d).roundToInt()
                val img = Bitmap.createScaledBitmap(src, n, n, true).asImageBitmap()
                return ShaderBrush(ImageShader(img, TileMode.Repeated, TileMode.Repeated))
            }
            PaperBrushes(load(R.drawable.paper), load(R.drawable.paper_fine))
        }
    }
}

/** 판 · 창의 고운 결. background(...) 바로 뒤에 둔다 (바탕색 위에, 글자 아래에 깔린다). */
fun Modifier.paper(): Modifier = composed {
    val b = LocalPaper.current.fine
    if (b == null) this else this.drawBehind { drawRect(b, blendMode = BlendMode.Softlight) }
}

/**
 * 칠한 것 둘레의 옅은 빛 (PC 의 style.css "빛"). 제 색이 radius 만큼 번진다 - 네온은 색감만.
 * 세기는 pal.glow (낮에 가장 옅고 밤이 깊을수록 조금 짙다). clip 보다 앞에 두어야 잘리지 않는다.
 */
fun Modifier.glow(color: Color, radius: Dp, corner: Dp, strength: Float): Modifier = drawBehind {
    if (strength <= .005f) return@drawBehind
    val paint = android.graphics.Paint(android.graphics.Paint.ANTI_ALIAS_FLAG).apply {
        this.color = color.copy(alpha = strength.coerceIn(0f, 1f)).toArgb()
        maskFilter = BlurMaskFilter(radius.toPx(), BlurMaskFilter.Blur.NORMAL)
    }
    val c = corner.toPx()
    drawIntoCanvas { it.nativeCanvas.drawRoundRect(0f, 0f, size.width, size.height, c, c, paint) }
}

/**
 * 밤에 읽는 글자(날짜 · 시각 · 칸 제목 · 시간대 머리)의 옅은 빛 (PC 의 body.night-ink 규칙).
 * 제 색으로 번진다 - 흰 빛으로 두면 색 글자(지난 일의 시각) 둘레에서 보이지 않았다.
 * 낮에는 그대로 (pal.glowW 가 0). big 은 칸 제목처럼 큰 글자 - 조금 넓게 번진다.
 */
@Composable
@ReadOnlyComposable
fun TextStyle.lit(color: Color, big: Boolean = false): TextStyle {
    val w = LocalPal.current.glowW
    if (w <= 0f) return this
    val d = LocalDensity.current.density
    return copy(shadow = Shadow(color.copy(alpha = (if (big) .7f else .6f) * w), blurRadius = (if (big) 12f else 7f) * d))
}
