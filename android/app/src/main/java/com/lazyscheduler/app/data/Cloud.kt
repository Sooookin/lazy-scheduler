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
import com.google.firebase.firestore.Source
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
private const val SCHEMA = 2L

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
        val doc = linkedMapOf<String, Any?>(
            "id" to id, "title" to "", "note" to "", "tag" to "", "kind" to "deadline",
            "due_date" to null, "due_time" to "", "notify_min" to null, "muted" to false, "pinned" to false,
            "rule" to null, "created" to LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS).toString(),
            "done" to false, "done_at" to null,
            "done_dates" to emptyMap<String, Boolean>(), "skip_dates" to emptyMap<String, Boolean>(),
            "schema" to SCHEMA,
        )
        doc.putAll(fields)
        doc["updated"] = FieldValue.serverTimestamp()
        logged("add") { ref(uid, id).set(doc) }
    }
}
