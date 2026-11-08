package com.lazyscheduler.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.LocalDate

/** 이름 = 문장: 이름 칸에 적은 날짜 · 시각 · 반복을 읽어 값에 채우고, 저장할 때 이름에서 뺀다 (PC 의 readName 과 같은 규칙) */
class DraftNameTest {
    private val today = LocalDate.parse("2026-10-26")     // 월요일
    private fun draft() = Draft().apply { load(Editing(null, null), today, true, emptyMap()) }

    @Test fun readsDateAndTime() {
        val d = draft()
        d.typeTitle("월간 보고서 금요일 3시")
        assertEquals("one", d.mode)
        assertEquals(LocalDate.parse("2026-10-30"), d.date)
        assertEquals("15:00", d.time)
        assertEquals("월간 보고서", d.cleanTitle())
    }

    @Test fun keepRevertsUntilPhraseLeaves() {
        val d = draft()
        d.typeTitle("월간 보고서 금요일 3시")
        d.keepName()
        assertEquals("none", d.mode); assertEquals("", d.time)
        assertEquals("월간 보고서 금요일 3시", d.cleanTitle())
        d.typeTitle("월간 보고서 금요일 3시 ")              // 그 말이 남아 있는 동안은 다시 읽지 않는다
        assertEquals("none", d.mode)
        d.typeTitle("보고서 내일")                          // 이름을 바꾸면 다시 읽는다
        assertEquals(today.plusDays(1), d.date)
    }

    @Test fun wordsAreNotDates() {
        for (t in listOf("수익률 점검", "월간 운용보고서 작성")) {
            val d = draft(); d.typeTitle(t)
            assertEquals(t, "none", d.mode)
            assertEquals(t, t, d.cleanTitle())
        }
    }

    @Test fun readsWeeklyRule() {
        val d = draft()
        d.typeTitle("교보 자료 수요일 3시 매주")
        assertEquals("rule", d.mode)
        assertEquals("week", d.rule?.get("period"))
        assertEquals(listOf(2), (d.rule?.get("weekdays") as List<*>).map { (it as Number).toInt() })
        assertEquals("15:00", d.time)
        assertEquals("교보 자료", d.cleanTitle())
        assertTrue(d.ruleText.isNotEmpty())
    }

    @Test fun handTouchedValueSurvivesRetype() {
        val d = draft()
        d.typeTitle("보고서 내일")
        d.fixName(); d.time = "09:00"
        d.typeTitle("보고서 모레")
        assertEquals(today.plusDays(2), d.date)
        assertEquals("09:00", d.time)
        assertEquals("보고서", d.cleanTitle())
    }

    @Test fun editingDoesNotRead() {
        val t = com.lazyscheduler.app.core.Task(id = "x", title = "보고서", kind = "floating")
        val d = Draft().apply { load(Editing(t, null), today, true, emptyMap()) }
        d.typeTitle("보고서 내일")
        assertEquals("none", d.mode)
        assertEquals("보고서 내일", d.cleanTitle())
    }
}
