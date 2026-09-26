package com.lazyscheduler.app.ui

import android.app.Activity
import android.content.Intent
import android.net.Uri
import android.provider.Settings
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.google.firebase.auth.FirebaseUser
import com.lazyscheduler.app.BuildConfig
import com.lazyscheduler.app.core.ReminderPlan
import com.lazyscheduler.app.data.Cloud
import com.lazyscheduler.app.data.Repo
import com.lazyscheduler.app.reminders.Reminders
import kotlinx.coroutines.launch

/** 설정 (PC 4j 를 한 열로). 일정과 알림 · 하늘 · 동기화. */
@Composable
fun SettingsScreen(
    user: FirebaseUser?, settings: Map<String, Any?>, prefs: ViewPrefs, remindOn: Boolean, setRemind: (Boolean) -> Unit,
) {
    val pal = LocalPal.current
    val context = LocalContext.current
    val activity = context as? Activity
    val scope = rememberCoroutineScope()
    var hold by remember { mutableStateOf(Reminders.holdBusy(context)) }
    var canExact by remember { mutableStateOf(Reminders.canExact(context)) }
    LaunchedEffect(Unit) { canExact = Reminders.canExact(context) }
    var busy by remember { mutableStateOf(false) }
    var err by remember { mutableStateOf<String?>(null) }
    var askDelete by remember { mutableStateOf(false) }

    Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 14.dp, bottom = 28.dp)) {
        Text("설정", style = T.title, color = pal.text)

        Section("일정과 알림")
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            val lead = ReminderPlan.defaultLead(settings)
            Pick("기본 알림 (분 전)", "$lead", listOf(0, 5, 10, 15, 30, 60, 120, 180).map { "$it" to "${if (it == 0) "정각" else "${it}분 전"}" },
                Modifier.weight(1f)) { Repo.saveSettings(mapOf("notify_min" to it.toLong())) }
            val brief = settings["brief_time"] as? String ?: "08:30"
            Pick("아침 브리핑", brief.ifEmpty { "끔" }, listOf("" to "끄기") + listOf("07:00", "07:30", "08:00", "08:30", "09:00", "09:30", "10:00").map { it to it },
                Modifier.weight(1f)) { Repo.saveSettings(mapOf("brief_time" to it)) }
        }
        Spacer(Modifier.height(6.dp))
        CheckRow(settings["business_only"] != false, "영업일 기준으로만 쓰기", "주말 · 공휴일 자동 보정") { Repo.saveSettings(mapOf("business_only" to it)) }
        CheckRow(hold, "방해 금지 중에는 알림을 미룸") { hold = it; Reminders.setHoldBusy(context, it) }
        CheckRow(remindOn, "이 휴대폰에서 알림 받기", onChange = setRemind)
        if (remindOn && !canExact) {
            Text("정확한 시각에 알리려면 '알람 및 리마인더' 를 허용해 주세요 ›",
                Modifier.padding(top = 4.dp).clip(RoundedCornerShape(8.dp)).tap {
                    runCatching { context.startActivity(Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + context.packageName))) }
                }.padding(vertical = 6.dp), style = T.label, color = pal.teal)
        }

        Section("하늘")
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("밝기", Modifier.width(64.dp), style = T.lead, color = pal.text)
            Seg(listOf("auto" to "해를 따라", "light" to "밝게", "dark" to "어둡게"), prefs.theme, Modifier.weight(1f), fill = true) { prefs.theme(it) }
        }
        Spacer(Modifier.height(6.dp))
        CheckRow(prefs.walk, "돌멩이 움직임", "끄면 가운데에 앉아 눈만 굴립니다") { prefs.walk(it) }
        CheckRow(prefs.calm, "움직임 줄이기", "폴짝 · 굴림 → 즉시 전환") { prefs.calm(it) }

        Section("동기화 · PC")
        if (!Cloud.configured) {
            Text("이 빌드에는 동기화 설정이 없습니다.", style = T.body, color = pal.text2)
        } else if (user == null) {
            Text("로그인하면 PC와 휴대폰의 일정이 같아집니다. 이 휴대폰에 적어 둔 일정은 계정에 합쳐집니다.", style = T.body, color = pal.text)
            Spacer(Modifier.height(12.dp))
            Ghost(if (busy) "로그인하는 중…" else "Google 계정으로 로그인", Modifier.fillMaxWidth(), color = pal.text) {
                if (busy || activity == null) return@Ghost
                busy = true; err = null
                scope.launch { err = Repo.signIn(activity); busy = false }
            }
        } else {
            Text(user.email ?: "로그인됨", style = T.leadM, color = pal.text)
            Text("PC와 같은 계정의 일정을 보고 있습니다.", Modifier.padding(top = 2.dp), style = T.body, color = pal.text2)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Ghost("로그아웃", Modifier.weight(1f)) { scope.launch { Repo.signOut(context) } }
                Ghost("계정 · 데이터 삭제", Modifier.weight(1.3f), color = pal.late) { askDelete = true }
            }
        }
        err?.let { Text(it, Modifier.padding(top = 10.dp), style = T.body, color = pal.danger) }
        Spacer(Modifier.height(24.dp))
        Text("LazyScheduler ${BuildConfig.VERSION_NAME}", style = T.label, color = pal.text2.copy(alpha = .7f))
    }

    if (askDelete) DeleteAccount(onDismiss = { askDelete = false }) { keep ->
        scope.launch {
            val e = Repo.deleteAccount(keep)
            if (e == null) askDelete = false else err = e
        }
    }
}

@Composable
private fun Section(title: String) {
    Hair(Modifier.padding(top = 18.dp), strong = true)
    Text(title, Modifier.padding(top = 12.dp, bottom = 4.dp), style = T.label, color = LocalPal.current.text2)
}

@Composable
private fun Pick(label: String, value: String, options: List<Pair<String, String>>, modifier: Modifier, onPick: (String) -> Unit) {
    val pal = LocalPal.current
    var open by remember { mutableStateOf(false) }
    Column(modifier) {
        Text(label, Modifier.padding(top = 8.dp, bottom = 6.dp), style = T.label, color = pal.text2)
        Box {
            Slot(value, "▾", Modifier.fillMaxWidth()) { open = true }
            DropdownMenu(expanded = open, onDismissRequest = { open = false }, containerColor = pal.surface) {
                for ((v, l) in options) DropdownMenuItem(text = { Text(l, style = T.lead, color = pal.text) }, onClick = { open = false; onPick(v) })
            }
        }
    }
}

/** 계정 지우기. 되돌릴 수 없으니 무엇이 지워지는지 먼저 적는다. */
@Composable
private fun DeleteAccount(onDismiss: () -> Unit, onConfirm: (keep: Boolean) -> Unit) {
    val pal = LocalPal.current
    var keep by remember { mutableStateOf(true) }
    var busy by remember { mutableStateOf(false) }
    Dialog(onDismissRequest = { if (!busy) onDismiss() }) {
        Column(Modifier.clip(RoundedCornerShape(20.dp)).background(pal.surface).padding(22.dp)) {
            Text("계정과 데이터를 지울까요?", style = T.head, color = pal.text)
            Spacer(Modifier.height(10.dp))
            Text("계정에 올라간 일정이 모두 지워지고 로그인이 끊깁니다. PC 에서도 사라집니다. 되돌릴 수 없습니다.", style = T.body, color = pal.text)
            CheckRow(keep, "이 휴대폰에는 일정을 남기기") { keep = it }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Ghost("취소", Modifier.weight(1f)) { if (!busy) onDismiss() }
                Ghost(if (busy) "지우는 중…" else "삭제", Modifier.weight(1f), color = pal.late) {
                    if (!busy) { busy = true; onConfirm(keep) }
                }
            }
        }
    }
}
