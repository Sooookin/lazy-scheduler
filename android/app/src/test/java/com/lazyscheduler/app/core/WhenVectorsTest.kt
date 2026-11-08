package com.lazyscheduler.app.core

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/**
 * 글에서 날짜 · 시각 알아듣기: 휴대폰이 PC(web/when.js)와 같은 답을 낸다 (tests/vectors/when.json).
 * tests/test_when.py 와 같게 본다 - expect 에 적힌 키만 견주고, expect 가 null 이면 아무것도 알아듣지 않아야 한다.
 */
class WhenVectorsTest {

    /** 시스템 속성 "when" 이 있으면 그것, 없으면 위로 올라가며 tests/vectors/when.json 을 찾는다 */
    private fun vectors(): File {
        System.getProperty("when")?.let { return File(it) }
        var d: File? = File("").absoluteFile
        while (d != null) {
            val f = File(d, "tests/vectors/when.json")
            if (f.isFile) return f
            d = d.parentFile
        }
        error("tests/vectors/when.json 을 찾지 못했다")
    }

    /** JSON 수는 Double 로 온다. 양쪽을 같은 꼴로 맞춘다 */
    private fun canon(v: Any?): Any? = when (v) {
        is Number -> v.toDouble()
        is Map<*, *> -> v.entries.associate { (k, x) -> k.toString() to canon(x) }
        is List<*> -> v.map(::canon)
        else -> v
    }

    /** 영업일 = 월~금 (공휴일 없음) */
    private val isBiz: (String) -> Boolean = { k ->
        runCatching { LocalDate.parse(k).dayOfWeek.value in 1..5 }.getOrDefault(false)
    }

    private fun parsedMap(p: When.Parsed): Map<String, Any?> = mapOf(
        "date" to p.date, "start" to p.start, "time" to p.time, "rest" to p.rest,
        "spans" to p.spans.map { listOf(it.start, it.end, it.kind) }, "notes" to p.notes,
    )

    /** 자바스크립트 결과에 있는 키만 담는다 (없는 키는 test_when.py 의 g.get 처럼 null) */
    private fun ruleMap(r: When.RuleHit): Map<String, Any?> = buildMap {
        put("rule", r.rule)
        put("span", r.span)
        put("need", r.need)
        if (r.every != null) put("every", r.every)
        if (r.year != null) put("year", r.year)
        if (r.months != null) put("months", r.months)
    }

    @Suppress("UNCHECKED_CAST")
    private fun check(pairs: List<List<Any?>>, got: List<Map<String, Any?>?>): List<String> {
        val bad = ArrayList<String>()
        for ((pair, g) in pairs.zip(got)) {
            val text = pair[0] as String
            val want = pair[1] as Map<String, Any?>?
            if (want == null) {
                if (g != null) bad.add("$text: 아무것도 아니어야 한다 ← $g")
                continue
            }
            if (g == null) { bad.add("$text: $want ← null"); continue }
            val diff = want.filter { (k, v) -> canon(g[k]) != canon(v) }.map { (k, v) -> "$k: ${v} ≠ ${g[k]}" }
            if (diff.isNotEmpty()) bad.add("$text: $diff")
        }
        return bad
    }

    @Suppress("UNCHECKED_CAST")
    private fun load(): Map<String, Any?> {
        val type = object : TypeToken<Map<String, Any?>>() {}.type
        return Gson().fromJson(vectors().readText(Charsets.UTF_8), type)
    }

    @Test
    fun everySentenceIsReadAsWrittenDown() {
        val root = load()
        val today = root["today"] as String
        @Suppress("UNCHECKED_CAST")
        val cases = root["cases"] as List<List<Any?>>
        assertTrue(cases.isNotEmpty())
        val got = cases.map { c -> When.parse(c[0] as String, today, isBiz)?.let(::parsedMap) }
        val bad = check(cases, got)
        assertTrue("${bad.size} / ${cases.size} 틀림:\n" + bad.joinToString("\n"), bad.isEmpty())
    }

    @Test
    fun everyRepeatPhraseBecomesTheStoredRule() {
        val root = load()
        @Suppress("UNCHECKED_CAST")
        val rules = root["rules"] as List<List<Any?>>
        assertTrue(rules.isNotEmpty())
        val got = rules.map { c -> When.rule(c[0] as String)?.let(::ruleMap) }
        val bad = check(rules, got)
        assertTrue("${bad.size} / ${rules.size} 틀림:\n" + bad.joinToString("\n"), bad.isEmpty())
    }
}
