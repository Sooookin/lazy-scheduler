package com.lazyscheduler.app.data

import androidx.test.core.app.ApplicationProvider
import com.lazyscheduler.app.core.Instance
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.io.File
import java.time.LocalDate

/** 로그인하지 않은 동안의 저장소: 고친 것이 파일에 남고, 지운 것은 흔적으로 남는다. */
@RunWith(RobolectricTestRunner::class)
@Config(sdk = [35], application = android.app.Application::class)
class LocalTest {
    private fun fresh(): File {
        val ctx = ApplicationProvider.getApplicationContext<android.content.Context>()
        val f = File(ctx.filesDir, "local.json").apply { delete() }
        Local.reset(ctx)
        return f
    }

    @Test fun addDoneSkipDeleteSurviveARestart() {
        val f = fresh()
        val day = LocalDate.of(2026, 9, 24)
        Local.save(null, mapOf("title" to "매일 점검", "kind" to "routine", "due_time" to "09:00",
            "rule" to mapOf("period" to "day", "business_only" to false)))
        Local.save(null, mapOf("title" to "보고서", "kind" to "deadline", "due_date" to "2026-09-30"))
        val (r, d) = Local.tasks.value.partition { it.kind == "routine" }.let { it.first[0] to it.second[0] }
        Local.setDone(Instance(r, day, false), true)
        Local.skip(Instance(r, day.plusDays(1), false), true)
        Local.setDone(Instance(d, null, false), true)
        assertTrue(f.exists())

        Local.reset(ApplicationProvider.getApplicationContext())           // 앱을 다시 연 셈
        val r2 = Local.tasks.value.first { it.id == r.id }
        assertEquals(setOf("2026-09-24"), r2.doneDates)
        assertEquals(setOf("2026-09-25"), r2.skipDates)
        assertTrue(Local.tasks.value.first { it.id == d.id }.done)

        Local.delete(r2)
        assertFalse(Local.tasks.value.any { it.id == r.id })               // 목록에서는 빠지고
        val (docs, _) = Local.snapshot()
        assertEquals(true, docs[r.id]?.get("deleted"))                     // 흔적은 남는다 (로그인할 때 계정에서도 지운다)
    }

    @Test fun signOutCopyReplacesTheList() {
        fresh()
        Local.save(null, mapOf("title" to "휴대폰에서 적은 것"))
        Local.replace(mapOf("x1" to mapOf("id" to "x1", "title" to "계정의 것", "kind" to "floating", "updated" to 5L)),
            mapOf("notify_min" to 10L))
        assertEquals(listOf("계정의 것"), Local.tasks.value.map { it.title })
        assertEquals(10L, Local.settingsState.value["notify_min"])
    }
}
