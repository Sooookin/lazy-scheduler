package com.lazyscheduler.app.core

import com.google.gson.Gson
import com.google.gson.reflect.TypeToken
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.time.LocalDate

/** "날짜 하나로 시작": the phone suggests exactly what the PC does (tests/vectors/suggest.json). */
class SuggestVectorsTest {

    /** JSON numbers arrive as Double; the rules hold Int. */
    private fun canon(v: Any?): Any? = when (v) {
        is Number -> v.toLong()
        is Map<*, *> -> v.entries.associate { (k, x) -> k.toString() to canon(x) }
        is List<*> -> v.map(::canon)
        else -> v
    }

    @Test
    fun suggestionsMatchThePc() {
        val path = System.getProperty("suggest") ?: error("system property 'suggest' is not set")
        val type = object : TypeToken<Map<String, Any?>>() {}.type
        val root: Map<String, Any?> = Gson().fromJson(File(path).readText(Charsets.UTF_8), type)
        @Suppress("UNCHECKED_CAST")
        val cases = root["cases"] as List<Map<String, Any?>>
        assertTrue(cases.isNotEmpty())
        Recur.setHolidays(null)
        for (c in cases) {
            val day = LocalDate.parse(c["date"] as String)
            val got = Recur.suggest(day)
            assertEquals(c["date"] as String, c["expect"], got.map { it.first })
            assertEquals(c["date"] as String, canon(c["rules"]), canon(got.map { it.second }))
            for ((text, rule) in got) assertTrue("$day $text", day in Recur.occurrences(rule, day, day))
        }
    }
}
