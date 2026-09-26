package com.lazyscheduler.app.data

import android.app.Activity
import android.content.Context
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.firestore.Source
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Task
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

/**
 * 화면 · 알림이 일정을 읽고 고치는 유일한 문.
 *
 * 로그인하지 않았으면 이 휴대폰의 파일(Local), 로그인했으면 계정(Cloud)이다. 둘 사이를
 * 오가는 때는 두 번뿐이다:
 *   로그인    휴대폰에 적어 둔 것을 계정에 합친다 (Cloud.mergeFrom). 다 올리면 휴대폰 쪽을 비운다.
 *   로그아웃  계정의 일정을 휴대폰에 내려 두고 나서 로그아웃한다 - 일정이 그대로 남는다.
 * 합치기가 인터넷이 없어 못 끝나면 휴대폰 쪽을 비우지 않고 남겨 두었다가 앱을 열 때 다시 한다.
 */
object Repo {
    private var prefs: android.content.SharedPreferences? = null

    fun init(ctx: Context) {
        Local.init(ctx)
        Cloud.init(ctx)
        prefs = ctx.getSharedPreferences("repo", Context.MODE_PRIVATE)
    }

    private fun uid(): String? = if (Cloud.configured) Cloud.user()?.uid else null

    fun user(): FirebaseUser? = if (Cloud.configured) Cloud.user() else null
    fun userFlow(): Flow<FirebaseUser?> = if (Cloud.configured) Cloud.userFlow() else flowOf(null)

    fun tasksFlow(user: FirebaseUser?): Flow<List<Task>> = if (user == null) Local.tasks else Cloud.tasksFlow(user.uid)
    fun settingsFlow(user: FirebaseUser?): Flow<Map<String, Any?>> =
        if (user == null) Local.settingsState else Cloud.settingsFlow(user.uid)

    // ---------- 고치기 ----------

    fun setDone(i: Instance, done: Boolean) { uid()?.let { Cloud.setDone(it, i, done) } ?: Local.setDone(i, done) }
    fun skip(i: Instance) { uid()?.let { Cloud.skip(it, i) } ?: Local.skip(i, true) }
    fun unskip(i: Instance) { uid()?.let { Cloud.unskip(it, i) } ?: Local.skip(i, false) }
    fun delete(t: Task) { uid()?.let { Cloud.delete(it, t) } ?: Local.delete(t) }
    fun save(existing: Task?, fields: Map<String, Any?>) {
        uid()?.let { Cloud.save(it, existing, fields) } ?: Local.save(existing, fields)
    }
    fun saveSettings(patch: Map<String, Any?>) {
        uid()?.let { Cloud.saveSettings(it, patch) } ?: Local.saveSettings(patch)
    }

    // ---------- 계정 ----------

    /** 로그인하고 휴대폰의 일정을 합친다. 실패하면 문장, 성공하면 null. */
    suspend fun signIn(activity: Activity): String? {
        Cloud.signIn(activity)?.let { return it }
        prefs?.edit()?.putBoolean("merge", true)?.apply()
        mergePending()
        return null
    }

    /** 로그인했는데 아직 못 합친 것이 있으면 합친다 (앱을 열 때마다 부른다). */
    suspend fun mergePending() {
        val u = uid() ?: return
        if (prefs?.getBoolean("merge", false) != true) return
        if (Local.isEmpty()) { prefs?.edit()?.putBoolean("merge", false)?.apply(); return }
        val (docs, settings) = Local.snapshot()
        if (Cloud.mergeFrom(u, docs, settings)) {
            Local.clearTasks()
            prefs?.edit()?.putBoolean("merge", false)?.apply()
        }
    }

    /** 계정의 일정을 휴대폰에 내려 둔다 (서버가 안 되면 이 휴대폰에 받아 둔 사본으로). */
    private suspend fun keepCopy(u: String) {
        val docs = Cloud.rawDocs(u, Source.DEFAULT) ?: Cloud.rawDocs(u, Source.CACHE) ?: return
        val settings = Cloud.fetchSettings(u).filterKeys { it in SHARED }
        Local.replace(docs, settings)
    }

    suspend fun signOut(ctx: Context) {
        uid()?.let { keepCopy(it) }
        prefs?.edit()?.putBoolean("merge", false)?.apply()
        Cloud.signOut(ctx)
    }

    /** 계정과 계정의 일정을 지운다. keep 이면 이 휴대폰에는 사본을 남긴다. */
    suspend fun deleteAccount(keep: Boolean): String? {
        val u = uid() ?: return "로그인되어 있지 않습니다"
        if (keep) keepCopy(u)
        val err = Cloud.deleteAccount()
        if (err != null && keep) Local.clearTasks()          // 못 지웠으면 계정 쪽이 그대로다
        if (err == null && !keep) Local.clearTasks()
        return err
    }

    // ---------- 알림 (화면 없이) ----------

    suspend fun fetchTasks(): List<Task>? = uid()?.let { Cloud.fetchTasks(it) } ?: Local.tasks.value
    suspend fun fetchSettings(): Map<String, Any?> = uid()?.let { Cloud.fetchSettings(it) } ?: Local.settingsState.value
    suspend fun cachedTasks(): List<Task> = uid()?.let { Cloud.cachedTasks(it) } ?: Local.tasks.value
    suspend fun cachedSettings(): Map<String, Any?> = uid()?.let { Cloud.cachedSettings(it) } ?: Local.settingsState.value

    suspend fun isClosed(taskId: String, date: String): Boolean {
        uid()?.let { return Cloud.isClosed(it, taskId, date) }
        val t = Local.tasks.value.firstOrNull { it.id == taskId } ?: return taskId.isNotEmpty()
        return if (t.kind == "routine") date in t.doneDates else t.done
    }

    fun completeFromCard(taskId: String, kind: String, date: String) {
        if (taskId.isEmpty()) return
        uid()?.let { Cloud.completeFromCard(it, taskId, kind, date); return }
        val t = Local.tasks.value.firstOrNull { it.id == taskId } ?: return
        Local.setDone(Instance(t, runCatching { java.time.LocalDate.parse(date) }.getOrNull(), false), true)
    }
}
