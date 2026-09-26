package com.lazyscheduler.app.data

import android.content.Context
import android.util.Log
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Task
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit
import java.util.UUID

private const val TAG = "Local"

/**
 * 로그인하지 않은 동안의 일정. 이 휴대폰 안의 파일 하나(files/local.json)에 둔다.
 *
 * 문서 모양은 Firestore 와 똑같다 (done_dates · skip_dates 는 {날짜: true}) - 로그인할 때
 * 그대로 올리면 되고, 로그아웃할 때 받은 것을 그대로 내려 두면 된다. 다른 점은 하나뿐이다:
 * updated 는 서버 시각이 아니라 이 휴대폰의 밀리초다. 합칠 때 어느 쪽이 나중인지만 본다.
 *
 * 지운 것은 흔적(tombstone)으로 남긴다. 로그아웃한 채로 지운 항목이 다시 로그인할 때
 * 계정에서 되살아나지 않게 하려면, 지웠다는 사실 자체가 남아 있어야 한다.
 */
object Local {
    private var file: File? = null
    private val docs = LinkedHashMap<String, MutableMap<String, Any?>>()
    private val settings = LinkedHashMap<String, Any?>()
    private val _tasks = MutableStateFlow<List<Task>>(emptyList())
    private val _settings = MutableStateFlow<Map<String, Any?>>(emptyMap())
    val tasks: StateFlow<List<Task>> = _tasks
    val settingsState: StateFlow<Map<String, Any?>> = _settings

    fun init(ctx: Context) {
        if (file != null) return
        file = File(ctx.filesDir, "local.json")
        load()
    }

    /** 테스트용: 파일을 다시 읽는다 (앱을 새로 연 것과 같다). */
    internal fun reset(ctx: Context) { file = null; init(ctx) }

    @Synchronized
    private fun load() {
        val f = file ?: return
        docs.clear(); settings.clear()
        if (f.exists()) runCatching {
            val o = JSONObject(f.readText())
            o.optJSONObject("tasks")?.let { t -> for (id in t.keys()) docs[id] = toMap(t.getJSONObject(id)) }
            o.optJSONObject("settings")?.let { settings.putAll(toMap(it)) }
        }.onFailure { Log.w(TAG, "load", it) }
        emit()
    }

    /** 새 파일에 쓰고 바꿔 끼운다 - 쓰는 도중에 꺼져도 예전 파일은 멀쩡하다. */
    @Synchronized
    private fun save() {
        val f = file ?: return
        val o = JSONObject()
        o.put("tasks", JSONObject().apply { for ((id, d) in docs) put(id, toJson(d)) })
        o.put("settings", toJson(settings))
        val tmp = File(f.parentFile, f.name + ".tmp")
        runCatching {
            tmp.writeText(o.toString())
            if (!tmp.renameTo(f)) { f.delete(); tmp.renameTo(f) }
        }.onFailure { Log.w(TAG, "save", it) }
        emit()
    }

    private fun emit() {
        _tasks.value = docs.mapNotNull { (id, d) -> Task.from(id, d) }.filter { !it.deleted }
        _settings.value = LinkedHashMap(settings)
    }

    private fun now() = System.currentTimeMillis()

    // ---------- 고치기 (Cloud 와 같은 뜻, 같은 필드) ----------

    @Synchronized
    fun setDone(i: Instance, done: Boolean) {
        val d = docs[i.task.id] ?: return
        if (i.task.kind == "routine" && i.date != null) {
            @Suppress("UNCHECKED_CAST")
            val m = LinkedHashMap((d["done_dates"] as? Map<String, Any?>).orEmpty())
            if (done) m[i.date.toString()] = true else m.remove(i.date.toString())
            d["done_dates"] = m
        } else {
            d["done"] = done
            d["done_at"] = if (done) LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS).toString() else null
        }
        d["updated"] = now()
        save()
    }

    @Synchronized
    fun skip(i: Instance, on: Boolean) {
        val day = i.date ?: return
        val d = docs[i.task.id] ?: return
        @Suppress("UNCHECKED_CAST")
        val m = LinkedHashMap((d["skip_dates"] as? Map<String, Any?>).orEmpty())
        if (on) m[day.toString()] = true else m.remove(day.toString())
        d["skip_dates"] = m
        d["updated"] = now()
        save()
    }

    @Synchronized
    fun delete(t: Task) {
        docs[t.id] = linkedMapOf("id" to t.id, "deleted" to true, "schema" to SCHEMA, "updated" to now())
        save()
    }

    @Synchronized
    fun save(existing: Task?, fields: Map<String, Any?>) {
        if (existing != null) {
            val d = docs[existing.id] ?: return
            d.putAll(fields)
            d["updated"] = now()
            save()
            return
        }
        val id = UUID.randomUUID().toString().replace("-", "")
        docs[id] = newDoc(id, fields).apply { put("updated", now()) }
        save()
    }

    @Synchronized
    fun saveSettings(patch: Map<String, Any?>) {
        settings.putAll(patch)
        save()
    }

    // ---------- 로그인 · 로그아웃 ----------

    /** 올릴 것 (흔적 포함). */
    @Synchronized
    fun snapshot(): Pair<Map<String, Map<String, Any?>>, Map<String, Any?>> =
        docs.mapValues { LinkedHashMap(it.value) } to LinkedHashMap(settings)

    @Synchronized
    fun isEmpty() = docs.isEmpty()

    /** 계정에 다 올렸으면 비운다. 설정은 남긴다 (로그아웃하면 다시 쓴다). */
    @Synchronized
    fun clearTasks() {
        docs.clear()
        save()
    }

    /** 로그아웃: 계정의 일정을 이 휴대폰에 내려 둔다 - 로그아웃했다고 일정이 사라지면 안 된다. */
    @Synchronized
    fun replace(tasks: Map<String, Map<String, Any?>>, shared: Map<String, Any?>) {
        docs.clear()
        for ((id, d) in tasks) docs[id] = LinkedHashMap(d)
        settings.putAll(shared)
        save()
    }

    // ---------- JSON ----------

    private fun toMap(o: JSONObject): MutableMap<String, Any?> {
        val m = LinkedHashMap<String, Any?>()
        for (k in o.keys()) m[k] = fromJson(o.opt(k))
        return m
    }

    private fun fromJson(v: Any?): Any? = when (v) {
        null, JSONObject.NULL -> null
        is JSONObject -> toMap(v)
        is JSONArray -> (0 until v.length()).map { fromJson(v.opt(it)) }
        is Int -> v.toLong()
        else -> v
    }

    private fun toJson(v: Any?): Any = when (v) {
        null -> JSONObject.NULL
        is Map<*, *> -> JSONObject().apply { for ((k, x) in v) put(k.toString(), toJson(x)) }
        is Collection<*> -> JSONArray().apply { v.forEach { put(toJson(it)) } }
        is Boolean, is Number, is String -> v
        else -> v.toString()
    }
}

internal const val SCHEMA = 2L

/** 새 항목의 모든 필드 (PC 의 store.add 와 같은 모양). */
internal fun newDoc(id: String, fields: Map<String, Any?>): LinkedHashMap<String, Any?> {
    val doc = linkedMapOf<String, Any?>(
        "id" to id, "title" to "", "note" to "", "tag" to "", "kind" to "deadline",
        "due_date" to null, "due_time" to "", "notify_min" to null, "muted" to false, "pinned" to false,
        "rule" to null, "created" to LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS).toString(),
        "done" to false, "done_at" to null,
        "done_dates" to emptyMap<String, Boolean>(), "skip_dates" to emptyMap<String, Boolean>(),
        "schema" to SCHEMA,
    )
    doc.putAll(fields)
    return doc
}
