package com.lazyscheduler.app.data

import android.app.Activity
import android.content.Context
import android.util.Log
import androidx.credentials.CredentialManager
import androidx.credentials.CustomCredential
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.credentials.exceptions.GetCredentialException
import androidx.credentials.exceptions.NoCredentialException
import com.google.android.libraries.identity.googleid.GetSignInWithGoogleOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.google.firebase.FirebaseApp
import com.google.firebase.FirebaseOptions
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FieldPath
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.Source
import com.google.firebase.Timestamp
import com.lazyscheduler.app.BuildConfig
import com.lazyscheduler.app.core.Instance
import com.lazyscheduler.app.core.Task
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import java.time.LocalDateTime
import java.time.temporal.ChronoUnit
import java.util.UUID

private const val TAG = "Cloud"

/**
 * Firebase for the phone: Google sign-in and the user's items in Firestore.
 *
 * The Firestore SDK keeps its own offline copy: reads come from it at once and writes
 * are queued while offline. Writes follow docs/sync.md section 4: only the changed fields
 * are sent, and "updated" is always the server time.
 */
object Cloud {
    val configured: Boolean
        get() = BuildConfig.FIREBASE_APP_ID.isNotBlank() && BuildConfig.FIREBASE_API_KEY.isNotBlank()

    fun init(context: Context) {
        if (!configured || FirebaseApp.getApps(context).isNotEmpty()) return
        FirebaseApp.initializeApp(
            context,
            FirebaseOptions.Builder()
                .setProjectId(BuildConfig.FIREBASE_PROJECT_ID)
                .setApiKey(BuildConfig.FIREBASE_API_KEY)
                .setApplicationId(BuildConfig.FIREBASE_APP_ID)
                .build(),
        )
    }

    // ---------- sign-in ----------

    fun user(): FirebaseUser? = if (configured) FirebaseAuth.getInstance().currentUser else null

    fun userFlow(): Flow<FirebaseUser?> = callbackFlow {
        val auth = FirebaseAuth.getInstance()
        val listener = FirebaseAuth.AuthStateListener { trySend(it.currentUser) }
        auth.addAuthStateListener(listener)
        awaitClose { auth.removeAuthStateListener(listener) }
    }

    /** Opens the Google account sheet and signs in to Firebase. Returns a message on failure. */
    suspend fun signIn(activity: Activity): String? {
        return try {
            val option = GetSignInWithGoogleOption.Builder(BuildConfig.GOOGLE_WEB_CLIENT_ID).build()
            val request = GetCredentialRequest.Builder().addCredentialOption(option).build()
            val credential = CredentialManager.create(activity).getCredential(activity, request).credential
            if (credential !is CustomCredential ||
                credential.type != GoogleIdTokenCredential.TYPE_GOOGLE_ID_TOKEN_CREDENTIAL
            ) return "Google 로그인 정보를 받지 못했습니다"
            val idToken = GoogleIdTokenCredential.createFrom(credential.data).idToken
            FirebaseAuth.getInstance().signInWithCredential(GoogleAuthProvider.getCredential(idToken, null)).await()
            null
        } catch (e: GetCredentialCancellationException) {
            // Google also reports a misconfigured app (SHA-1 not registered) as "cancelled".
            Log.w(TAG, "credential cancelled", e)
            "로그인이 취소되었습니다. 직접 취소하지 않았다면 Firebase 의 Android 앱 SHA-1 등록을 확인하세요."
        } catch (e: NoCredentialException) {
            "이 휴대폰에 Google 계정이 없습니다"
        } catch (e: GetCredentialException) {
            Log.w(TAG, "credential", e)
            "로그인하지 못했습니다 (${e.type})"
        } catch (e: Exception) {
            Log.w(TAG, "sign-in", e)
            "로그인하지 못했습니다 (${e.message})"
        }
    }

    fun signOut(context: Context) {
        FirebaseAuth.getInstance().signOut()
    }

    /**
     * Delete this account and everything it has in the cloud. There is no undo.
     *
     * The order matters: the documents go first. Deleting the account first kills the
     * token, and the rules only let the owner delete their own documents - what is left
     * would stay there for good. Returns null on success, or a sentence to show.
     */
    suspend fun deleteAccount(): String? {
        val user = user() ?: return "로그인되어 있지 않습니다"
        val uid = user.uid
        return try {
            // 하나의 batch 는 500 개까지. 남는 것이 없을 때까지 되풀이한다.
            for (col in listOf(tasks(uid), db().collection("users").document(uid).collection("meta"))) {
                while (true) {
                    val page = col.limit(400).get(Source.SERVER).await()
                    if (page.isEmpty) break
                    val batch = db().batch()
                    for (doc in page.documents) batch.delete(doc.reference)
                    batch.commit().await()
                }
            }
            user.delete().await()
            Log.i(TAG, "deleted account and cloud data")
            null
        } catch (e: Exception) {
            Log.w(TAG, "deleteAccount", e)
            // 오래 로그인해 둔 뒤에는 구글이 다시 로그인하기를 요구한다
            if (e is com.google.firebase.auth.FirebaseAuthRecentLoginRequiredException)
                "보안을 위해 다시 로그인한 뒤에 지울 수 있습니다. 로그아웃하고 다시 로그인해 주세요."
            else "지우지 못했습니다 (${e.message})"
        }
    }

    // ---------- data ----------

    private fun db() = FirebaseFirestore.getInstance()
    private fun tasks(uid: String) = db().collection("users").document(uid).collection("tasks")
    private fun settings(uid: String) = db().collection("users").document(uid).collection("meta").document("settings")

    /** Every item, live. Tombstones and malformed documents are left out. */
    fun tasksFlow(uid: String): Flow<List<Task>> = callbackFlow {
        val reg = tasks(uid).addSnapshotListener { snap, err ->
            if (err != null) {
                Log.w(TAG, "tasks listener", err)
                return@addSnapshotListener
            }
            val list = snap?.documents.orEmpty().mapNotNull { Task.from(it.id, it.data) }.filter { !it.deleted }
            trySend(list)
        }
        awaitClose { reg.remove() }
    }

    /** Shared settings (notify_min, brief_time, business_only, holidays). */
    fun settingsFlow(uid: String): Flow<Map<String, Any?>> = callbackFlow {
        val reg = settings(uid).addSnapshotListener { snap, err ->
            if (err == null) trySend(snap?.data ?: emptyMap())
        }
        awaitClose { reg.remove() }
    }

    private fun logged(what: String, block: () -> com.google.android.gms.tasks.Task<*>) {
        block().addOnFailureListener { Log.w(TAG, what, it) }       // queued offline; the listener shows it at once
    }

    private fun ref(uid: String, id: String): DocumentReference = tasks(uid).document(id)

    fun setDone(uid: String, i: Instance, done: Boolean) {
        val r = ref(uid, i.task.id)
        if (i.task.kind == "routine" && i.date != null) {
            // Only this day's field: another device completing another day is not touched.
            logged("done") {
                r.update(FieldPath.of("done_dates", i.date.toString()), if (done) true else FieldValue.delete(),
                    FieldPath.of("updated"), FieldValue.serverTimestamp())
            }
        } else {
            logged("done") {
                r.update(mapOf("done" to done,
                    "done_at" to if (done) LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS).toString() else null,
                    "updated" to FieldValue.serverTimestamp()))
            }
        }
    }

    fun skip(uid: String, i: Instance) {
        val day = i.date ?: return
        logged("skip") {
            ref(uid, i.task.id).update(FieldPath.of("skip_dates", day.toString()), true,
                FieldPath.of("updated"), FieldValue.serverTimestamp())
        }
    }

    /** Undo of [skip]: only that day's field is removed. */
    fun unskip(uid: String, i: Instance) {
        val day = i.date ?: return
        logged("unskip") {
            ref(uid, i.task.id).update(FieldPath.of("skip_dates", day.toString()), FieldValue.delete(),
                FieldPath.of("updated"), FieldValue.serverTimestamp())
        }
    }

    /** Replaces the item with a bare tombstone, as store.remove does on the PC. */
    fun delete(uid: String, task: Task) {
        logged("delete") {
            ref(uid, task.id).set(mapOf("id" to task.id, "deleted" to true, "schema" to SCHEMA,
                "updated" to FieldValue.serverTimestamp()))
        }
    }

    // ---------- for reminders (no screen open) ----------

    private suspend fun readTasks(uid: String, source: Source): List<Task>? = runCatching {
        tasks(uid).get(source).await().documents.mapNotNull { Task.from(it.id, it.data) }.filter { !it.deleted }
    }.getOrNull()

    private suspend fun readSettings(uid: String, source: Source): Map<String, Any?>? = runCatching {
        settings(uid).get(source).await().data ?: emptyMap()
    }.getOrNull()

    /** Latest from the server, or this phone's copy when offline. Null if neither is available. */
    suspend fun fetchTasks(uid: String): List<Task>? = readTasks(uid, Source.DEFAULT) ?: readTasks(uid, Source.CACHE)
    suspend fun fetchSettings(uid: String): Map<String, Any?> =
        readSettings(uid, Source.DEFAULT) ?: readSettings(uid, Source.CACHE) ?: emptyMap()

    suspend fun cachedTasks(uid: String): List<Task> = readTasks(uid, Source.CACHE) ?: emptyList()
    suspend fun cachedSettings(uid: String): Map<String, Any?> = readSettings(uid, Source.CACHE) ?: emptyMap()

    /** Completed or deleted since the reminder was scheduled (as far as this phone knows)? */
    suspend fun isClosed(uid: String, taskId: String, date: String): Boolean {
        if (taskId.isEmpty()) return false
        val snap = runCatching { tasks(uid).document(taskId).get(Source.CACHE).await() }.getOrNull() ?: return false
        val t = Task.from(taskId, snap.data) ?: return !snap.exists()
        return t.deleted || (if (t.kind == "routine") date in t.doneDates else t.done)
    }

    /** [완료] on a reminder card. Queued on the phone if offline, sent when back online. */
    fun completeFromCard(uid: String, taskId: String, kind: String, date: String) {
        if (taskId.isEmpty()) return
        val task = Task(id = taskId, title = "", kind = kind)
        setDone(uid, Instance(task, runCatching { java.time.LocalDate.parse(date) }.getOrNull(), false), true)
    }

    /** The fields the editor can change, as stored. */
    private fun editable(t: Task): Map<String, Any?> = mapOf(
        "title" to t.title, "note" to t.note, "kind" to t.kind, "due_date" to t.dueDate,
        "due_time" to t.dueTime, "notify_min" to t.notifyMin, "muted" to t.muted, "rule" to t.rule,
    )

    /** Int and Long are the same number here (the form makes Int, Firestore gives back Long). */
    private fun canon(v: Any?): Any? = when (v) {
        is Int -> v.toLong()
        is Map<*, *> -> v.entries.associate { (k, x) -> k.toString() to canon(x) }
        is List<*> -> v.map(::canon)
        else -> v
    }

    /**
     * Add a new item, or save an edit. An edit sends only the fields that changed
     * (docs/sync.md section 4), so an edit here and a completion on the PC both survive.
     */
    fun save(uid: String, existing: Task?, fields: Map<String, Any?>) {
        if (existing != null) {
            val before = editable(existing)
            val changed = fields.filter { (k, v) -> canon(before[k]) != canon(v) }
            if (changed.isEmpty()) return
            logged("edit") { ref(uid, existing.id).update(changed + ("updated" to FieldValue.serverTimestamp())) }
            return
        }
        val id = UUID.randomUUID().toString().replace("-", "")
        val doc = newDoc(id, fields)
        doc["updated"] = FieldValue.serverTimestamp()
        logged("add") { ref(uid, id).set(doc) }
    }

    /** 함께 쓰는 설정(알림 · 브리핑 · 영업일)만. 다른 키는 건드리지 않는다. */
    fun saveSettings(uid: String, patch: Map<String, Any?>) {
        logged("settings") { settings(uid).set(patch, SetOptions.merge()) }
    }

    // ---------- 로그인 · 로그아웃할 때 휴대폰의 일정과 합치기 ----------

    /** 계정의 문서 전부 (흔적 포함). updated 는 밀리초로 바꿔 둔다 - 휴대폰 파일에 그대로 쓴다. */
    suspend fun rawDocs(uid: String, source: Source): Map<String, Map<String, Any?>>? = runCatching {
        tasks(uid).get(source).await().documents.associate { doc ->
            doc.id to (doc.data.orEmpty().mapValues { (_, v) -> if (v is Timestamp) v.toDate().time else v })
        }
    }.getOrNull()

    suspend fun rawSettings(uid: String): Map<String, Any?>? = readSettings(uid, Source.SERVER)

    /**
     * 로그인하기 전에 이 휴대폰에 적어 둔 것을 계정에 합친다. 어느 쪽도 지우지 않는다 (PC 와 같다).
     *   계정에 없는 항목      그대로 올린다
     *   둘 다 있는 항목       나중에 고친 쪽의 내용 · 완료 날짜는 양쪽을 합친다
     *   휴대폰에서 지운 항목  휴대폰에서 지운 것이 나중이면 계정에서도 지운다
     * 계정을 서버에서 읽지 못하면 (인터넷이 없으면) 아무것도 하지 않고 false - 다음에 다시 한다.
     */
    suspend fun mergeFrom(uid: String, local: Map<String, Map<String, Any?>>, localSettings: Map<String, Any?>): Boolean {
        val cloud = rawDocs(uid, Source.SERVER) ?: return false
        for ((id, d) in local) {
            val c = cloud[id]
            val lu = (d["updated"] as? Number)?.toLong() ?: 0L
            val cu = (c?.get("updated") as? Number)?.toLong() ?: 0L
            val r = ref(uid, id)
            when {
                c == null -> if (d["deleted"] != true) logged("merge add") {
                    r.set(LinkedHashMap(d).apply { put("schema", SCHEMA); put("updated", FieldValue.serverTimestamp()) })
                }
                c["deleted"] == true -> Unit
                d["deleted"] == true -> if (lu > cu) delete(uid, Task(id = id, title = ""))
                else -> {
                    val paths = ArrayList<Pair<FieldPath, Any?>>()
                    if (lu > cu) {
                        for (k in listOf("title", "note", "kind", "due_date", "due_time", "notify_min", "muted", "rule", "done", "done_at"))
                            if (canon(d[k]) != canon(c[k])) paths += FieldPath.of(k) to d[k]
                    }
                    for (k in listOf("done_dates", "skip_dates")) {
                        val mine = (d[k] as? Map<*, *>).orEmpty().filterValues { it == true }.keys
                        val theirs = (c[k] as? Map<*, *>).orEmpty().keys
                        for (day in mine - theirs) paths += FieldPath.of(k, day.toString()) to true
                    }
                    if (paths.isNotEmpty()) {
                        paths += FieldPath.of("updated") to FieldValue.serverTimestamp()
                        val rest = paths.drop(1).flatMap { listOf(it.first, it.second) }.toTypedArray()
                        logged("merge edit") { r.update(paths[0].first, paths[0].second, *rest) }
                    }
                }
            }
        }
        // 계정에 아직 없는 함께 쓰는 설정만 올린다 - PC 에서 정해 둔 값을 휴대폰이 덮지 않게
        val have = rawSettings(uid).orEmpty()
        val up = localSettings.filterKeys { it in SHARED && it !in have }
        if (up.isNotEmpty()) saveSettings(uid, up)
        return true
    }
}

/** syncdoc.SHARED_SETTINGS 와 같다. */
internal val SHARED = setOf("notify_min", "brief_time", "business_only")
