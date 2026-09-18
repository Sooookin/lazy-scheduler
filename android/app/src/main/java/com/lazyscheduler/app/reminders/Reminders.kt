package com.lazyscheduler.app.reminders

import android.Manifest
import android.app.AlarmManager
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.util.Log
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.core.content.ContextCompat
import androidx.work.Constraints
import androidx.work.CoroutineWorker
import androidx.work.ExistingPeriodicWorkPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.PeriodicWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.WorkerParameters
import com.google.firebase.auth.FirebaseAuth
import com.lazyscheduler.app.MainActivity
import com.lazyscheduler.app.R
import com.lazyscheduler.app.core.Alarm
import com.lazyscheduler.app.core.ReminderPlan
import com.lazyscheduler.app.core.Task
import com.lazyscheduler.app.data.Cloud
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withTimeoutOrNull
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.util.concurrent.TimeUnit

private const val TAG = "Reminders"

/**
 * Phone reminders. The phone decides its own reminders from its own copy of the data,
 * like the PC does (docs/sync.md section 8), so they work when the PC is off.
 *
 *   reschedule()  alarms for the next 36 h, rebuilt whenever the list changes,
 *                 every 30 min in the background (SyncWorker) and after a reboot
 *   AlarmReceiver shows the card; its buttons complete (only that day) or snooze 10 min
 */
object Reminders {
    const val CHANNEL = "reminders"
    const val ACTION_FIRE = "com.lazyscheduler.app.FIRE"
    const val ACTION_DONE = "com.lazyscheduler.app.DONE"
    const val ACTION_SNOOZE = "com.lazyscheduler.app.SNOOZE"
    const val ACTION_BRIEF = "com.lazyscheduler.app.BRIEF"
    const val SNOOZE_MIN = 10L
    private const val FIRED_KEEP_DAYS = 3L

    private fun prefs(ctx: Context) = ctx.getSharedPreferences("reminders", Context.MODE_PRIVATE)

    /** "이 휴대폰에서 알림 받기" - kept on this device only. */
    fun enabled(ctx: Context) = prefs(ctx).getBoolean("enabled", true)

    fun setEnabled(ctx: Context, on: Boolean, tasks: List<Task>?, settings: Map<String, Any?>) {
        prefs(ctx).edit().putBoolean("enabled", on).apply()
        reschedule(ctx, tasks ?: emptyList(), settings)
    }

    fun canNotify(ctx: Context) = Build.VERSION.SDK_INT < 33 ||
        ContextCompat.checkSelfPermission(ctx, Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    fun canExact(ctx: Context): Boolean =
        Build.VERSION.SDK_INT < 31 || ctx.getSystemService(AlarmManager::class.java).canScheduleExactAlarms()

    fun ensureChannel(ctx: Context) {
        val nm = ctx.getSystemService(NotificationManager::class.java)
        if (nm.getNotificationChannel(CHANNEL) == null) {
            nm.createNotificationChannel(NotificationChannel(CHANNEL, "일정 알림", NotificationManager.IMPORTANCE_HIGH).apply {
                description = "마감 · 반복 업무 알림과 아침 브리핑"
            })
        }
    }

    // ---------- already shown (like state.json on the PC) ----------

    private fun fired(ctx: Context): MutableMap<String, String> {
        val cutoff = LocalDate.now().minusDays(FIRED_KEEP_DAYS).toString()
        return prefs(ctx).getStringSet("fired", emptySet()).orEmpty()
            .mapNotNull { e -> e.split("|", limit = 2).takeIf { it.size == 2 }?.let { it[1] to it[0] } }
            .filter { it.second >= cutoff }.toMap().toMutableMap()
    }

    fun wasFired(ctx: Context, key: String) = key in fired(ctx)

    fun markFired(ctx: Context, key: String) {
        val f = fired(ctx)
        f[key] = LocalDate.now().toString()
        prefs(ctx).edit().putStringSet("fired", f.map { "${it.value}|${it.key}" }.toSet()).apply()
    }

    // ---------- scheduling ----------

    private fun extras(a: Alarm) = Bundle().apply {
        putString("key", a.key); putString("task", a.taskId); putString("date", a.date)
        putString("title", a.title); putString("time", a.time); putString("kind", a.kind); putString("detail", a.detail)
    }

    private fun pending(ctx: Context, action: String, key: String, extras: Bundle? = null): PendingIntent {
        val intent = Intent(ctx, AlarmReceiver::class.java).setAction(action).putExtra("key", key)
        if (extras != null) intent.putExtras(extras)
        return PendingIntent.getBroadcast(ctx, key.hashCode(), intent,
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE)
    }

    private fun setAlarm(ctx: Context, at: LocalDateTime, pi: PendingIntent) {
        val am = ctx.getSystemService(AlarmManager::class.java)
        val ms = at.atZone(ZoneId.systemDefault()).toInstant().toEpochMilli()
        if (canExact(ctx)) am.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ms, pi)
        else am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, ms, pi)      // may come a few minutes late
    }

    fun reschedule(ctx: Context, tasks: List<Task>, settings: Map<String, Any?>) {
        val now = LocalDateTime.now()
        val p = prefs(ctx)
        val want = if (enabled(ctx)) ReminderPlan.plan(tasks, settings, now).filter { !wasFired(ctx, it.key) } else emptyList()
        val wantKeys = want.map { it.key }.toSet()
        val am = ctx.getSystemService(AlarmManager::class.java)
        for (old in p.getStringSet("scheduled", emptySet()).orEmpty()) {
            if (old !in wantKeys) am.cancel(pending(ctx, ACTION_FIRE, old))
        }
        for (a in want) setAlarm(ctx, a.at, pending(ctx, ACTION_FIRE, a.key, extras(a)))

        val briefPi = pending(ctx, ACTION_BRIEF, "brief")
        val brief = if (enabled(ctx)) ReminderPlan.nextBrief(settings, now) else null
        if (brief == null || wasFired(ctx, "brief:" + brief.toLocalDate())) am.cancel(briefPi)
        else setAlarm(ctx, if (brief.isBefore(now)) now else brief, briefPi)

        p.edit().putStringSet("scheduled", wantKeys).apply()
        Log.i(TAG, "scheduled ${want.size} reminder(s), brief=$brief")
    }

    fun snooze(ctx: Context, extras: Bundle) {
        val key = "snooze:" + (extras.getString("key") ?: "") + ":" + System.currentTimeMillis()
        val copy = Bundle(extras).apply { putString("key", key); putString("detail", "${SNOOZE_MIN}분 전에 미룬 알림") }
        setAlarm(ctx, LocalDateTime.now().plusMinutes(SNOOZE_MIN), pending(ctx, ACTION_FIRE, key, copy))
    }

    // ---------- cards ----------

    private fun openApp(ctx: Context): PendingIntent = PendingIntent.getActivity(ctx, 0,
        Intent(ctx, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP),
        PendingIntent.FLAG_IMMUTABLE)

    fun show(ctx: Context, extras: Bundle, late: Boolean) {
        if (!canNotify(ctx)) return
        ensureChannel(ctx)
        val key = extras.getString("key") ?: return
        val time = extras.getString("time").orEmpty()
        val line = (if (late) "마감 시간 지남" else "곧 마감") + (if (time.isNotEmpty()) " · $time" else "")
        val detail = extras.getString("detail").orEmpty()
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle(extras.getString("title"))
            .setContentText(if (detail.isNotEmpty()) "$line · $detail" else line)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_REMINDER)
            .setAutoCancel(true)
            // A late item stays until it is answered (완료 · 10분 뒤 · open), like the PC's late cards.
            .setOngoing(late)
            .setContentIntent(openApp(ctx))
            .addAction(0, "완료", pending(ctx, ACTION_DONE, key, extras))
            .addAction(0, "${SNOOZE_MIN}분 뒤", pending(ctx, ACTION_SNOOZE, key, extras))
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify(key.hashCode(), n) }
    }

    fun showBrief(ctx: Context, lines: List<String>) {
        if (!canNotify(ctx) || lines.isEmpty()) return
        ensureChannel(ctx)
        val d = LocalDate.now()
        val style = NotificationCompat.InboxStyle().setSummaryText("남은 일 ${lines.size}건")
        lines.take(6).forEach { style.addLine(it) }
        val n = NotificationCompat.Builder(ctx, CHANNEL)
            .setSmallIcon(R.drawable.ic_notify)
            .setContentTitle("아침 브리핑 · ${d.monthValue}월 ${d.dayOfMonth}일")
            .setContentText(lines.first() + if (lines.size > 1) " 외 ${lines.size - 1}건" else "")
            .setStyle(style)
            .setAutoCancel(true)
            .setContentIntent(openApp(ctx))
            .build()
        runCatching { NotificationManagerCompat.from(ctx).notify("brief".hashCode(), n) }
    }
}

/** Alarm fired / a button on the card was pressed. */
class AlarmReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val extras = intent.extras ?: return
        val key = extras.getString("key") ?: return
        val done = goAsync()
        CoroutineScope(Dispatchers.IO).launch {
            try {
                withTimeoutOrNull(8_000) { handle(ctx, intent.action, key, extras) }
            } catch (e: Exception) {
                Log.w(TAG, "receiver ${intent.action}", e)
            } finally {
                done.finish()
            }
        }
    }

    private suspend fun handle(ctx: Context, action: String?, key: String, extras: Bundle) {
        val uid = FirebaseAuth.getInstance().currentUser?.uid
        when (action) {
            Reminders.ACTION_FIRE -> {
                if (Reminders.wasFired(ctx, key)) return
                Reminders.markFired(ctx, key)
                // Completed or deleted on another device since it was scheduled? Then stay quiet.
                if (uid != null && Cloud.isClosed(uid, extras.getString("task").orEmpty(), extras.getString("date").orEmpty())) return
                val time = extras.getString("time").orEmpty()
                val late = runCatching {
                    LocalDateTime.now().isAfter(LocalDateTime.of(LocalDate.parse(extras.getString("date")), java.time.LocalTime.parse(time)))
                }.getOrDefault(false)
                Reminders.show(ctx, extras, late)
            }
            Reminders.ACTION_DONE -> {
                NotificationManagerCompat.from(ctx).cancel(key.hashCode())
                if (uid != null) Cloud.completeFromCard(uid, extras.getString("task").orEmpty(),
                    extras.getString("kind").orEmpty(), extras.getString("date").orEmpty())
            }
            Reminders.ACTION_SNOOZE -> {
                NotificationManagerCompat.from(ctx).cancel(key.hashCode())
                Reminders.snooze(ctx, extras)
            }
            Reminders.ACTION_BRIEF -> {
                val today = LocalDate.now()
                if (uid == null || Reminders.wasFired(ctx, "brief:$today")) return
                Reminders.markFired(ctx, "brief:$today")
                Reminders.showBrief(ctx, ReminderPlan.briefLines(Cloud.cachedTasks(uid), today))
                val settings = Cloud.cachedSettings(uid)
                Reminders.reschedule(ctx, Cloud.cachedTasks(uid), settings)     // tomorrow's briefing
            }
        }
    }
}

/** After a reboot or an app update the alarms are gone: rebuild them. */
class BootReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        SyncWorker.runOnce(ctx)
    }
}

/** Fetches the latest items (the PC may have changed them) and rebuilds the alarms. */
class SyncWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val uid = FirebaseAuth.getInstance().currentUser?.uid ?: return Result.success()
        val tasks = Cloud.fetchTasks(uid) ?: return Result.retry()
        Reminders.reschedule(applicationContext, tasks, Cloud.fetchSettings(uid))
        return Result.success()
    }

    companion object {
        private val online = Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build()

        fun schedule(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("reminders",
                ExistingPeriodicWorkPolicy.KEEP,
                PeriodicWorkRequestBuilder<SyncWorker>(30, TimeUnit.MINUTES).setConstraints(online).build())
        }

        fun runOnce(ctx: Context) {
            WorkManager.getInstance(ctx).enqueueUniqueWork("reminders-now", ExistingWorkPolicy.REPLACE,
                OneTimeWorkRequestBuilder<SyncWorker>().build())
        }
    }
}
