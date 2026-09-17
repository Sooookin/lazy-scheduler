package com.lazyscheduler.app

import android.app.Application
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.lazyscheduler.app.data.Cloud
import com.lazyscheduler.app.reminders.Reminders
import com.lazyscheduler.app.reminders.SyncWorker
import com.lazyscheduler.app.ui.App
import com.lazyscheduler.app.ui.LazyTheme

class LazyApp : Application() {
    override fun onCreate() {
        super.onCreate()
        Cloud.init(this)
        if (Cloud.configured) {
            Reminders.ensureChannel(this)
            SyncWorker.schedule(this)          // every 30 min: pick up changes made on the PC
        }
    }
}

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent { LazyTheme { App() } }
    }
}
