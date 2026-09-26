package com.lazyscheduler.app.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.lazyscheduler.app.core.Task
import java.time.LocalDate

/** 전체 항목 (PC 4i) - 필터 하나와 목록 하나. 루틴은 여기가 집이다. 누르면 고치기. */
@Composable
fun AllScreen(tasks: List<Task>, today: LocalDate, onOpen: (Task) -> Unit) {
    val pal = LocalPal.current
    var filter by rememberSaveable { mutableStateOf("all") }
    val sorted = remember(tasks) {
        tasks.filter { !it.deleted }.sortedWith(compareBy(
            { when (it.kind) { "routine" -> 0; "deadline" -> 1; else -> 2 } },
            { it.dueDate ?: "9999" }, { it.dueTime.ifEmpty { "99:99" } }, { it.title }))
    }
    val shown = when (filter) {
        "deadline", "routine", "floating" -> sorted.filter { it.kind == filter && !(it.kind != "routine" && it.done) }
        "done" -> sorted.filter { it.kind != "routine" && it.done }
        else -> sorted.filter { !(it.kind != "routine" && it.done) }
    }
    LazyColumn(Modifier.fillMaxSize(), contentPadding = PaddingValues(start = 20.dp, end = 20.dp, top = 14.dp, bottom = 24.dp)) {
        item {
            Row(verticalAlignment = Alignment.Bottom) {
                Text("전체 항목", style = T.title, color = pal.text)
                Spacer(Modifier.weight(1f))
                Text("${shown.size}건", style = T.body, color = pal.text2)
            }
            Spacer(Modifier.height(12.dp))
            Seg(listOf("all" to "전체", "deadline" to "할 일", "routine" to "루틴", "floating" to "메모", "done" to "완료"), filter,
                Modifier.fillMaxWidth(), fill = true) { filter = it }
            Spacer(Modifier.height(6.dp))
            Hair(strong = true)
        }
        if (shown.isEmpty()) item { Empty(if (filter == "done") "끝낸 항목이 없습니다" else "항목이 없습니다", "") }
        items(shown, key = { it.id }) { t ->
            Column {
                Row(Modifier.fillMaxWidth().press { onOpen(t) }.height(48.dp).padding(horizontal = 2.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text(KIND_NAME[t.kind] ?: "", Modifier.width(56.dp), style = T.label, color = pal.text2)
                    Text(t.title, Modifier.weight(1f), style = T.lead, color = if (t.done) pal.text2 else pal.text,
                        textDecoration = if (t.done) T.strike else null, maxLines = 1, overflow = TextOverflow.Ellipsis)
                    val (w, late) = whenText(t, today)
                    Text(w, Modifier.padding(start = 10.dp), style = T.time, color = if (late) pal.late else pal.text2, maxLines = 1)
                    Chevron()
                }
                Hair()
            }
        }
    }
}

internal val KIND_NAME = mapOf("deadline" to "할 일", "routine" to "루틴", "floating" to "메모")

/** 줄 오른쪽: 루틴은 규칙을 짧게, 할 일은 언제, 메모는 "기한 없음". */
private fun whenText(t: Task, today: LocalDate): Pair<String, Boolean> = when (t.kind) {
    "routine" -> shortRule(t.ruleText) to false
    "floating" -> "기한 없음" to false
    else -> {
        val d = t.dueDate?.let { runCatching { LocalDate.parse(it) }.getOrNull() }
        if (d == null) "기한 없음" to false
        else (dateLabel(d, today) + if (t.dueTime.isNotEmpty()) " " + t.dueTime else "") to (!t.done && d.isBefore(today))
    }
}

/** "매월 마지막 목요일" → "매월 마지막 목" (좁은 자리). */
private fun shortRule(s: String) = s.replace("영업일만", "영업일").replace(Regex("([월화수목금토일])요일"), "$1")
