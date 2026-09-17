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
            "로그인을 취소했습니다"
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

    fun add(uid: String, title: String, kind: String, dueDate: String?, dueTime: String) {
        val id = UUID.randomUUID().toString().replace("-", "")
        logged("add") {
            ref(uid, id).set(mapOf(
                "id" to id, "title" to title.trim().take(200), "note" to "", "tag" to "",
                "kind" to kind,
                "due_date" to if (kind == "deadline") dueDate else null,
                "due_time" to if (kind == "deadline") dueTime else "",
                "notify_min" to null, "muted" to false, "pinned" to false, "rule" to null,
                "created" to LocalDateTime.now().truncatedTo(ChronoUnit.SECONDS).toString(),
                "done" to false, "done_at" to null,
                "done_dates" to emptyMap<String, Boolean>(), "skip_dates" to emptyMap<String, Boolean>(),
                "schema" to SCHEMA, "updated" to FieldValue.serverTimestamp(),
            ))
        }
    }
}
