import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.plugin.compose")
}

// Firebase values live outside git (android/firebase.local.properties).
val cloud = Properties().apply {
    val f = rootProject.file("firebase.local.properties")
    if (f.exists()) f.inputStream().use { load(it) }
}
fun cloudString(key: String) = "\"" + (cloud.getProperty(key) ?: "").trim() + "\""

android {
    namespace = "com.lazyscheduler.app"
    // The current AndroidX libraries need to be compiled against Android 17 (API 37.2).
    // targetSdk (runtime behaviour) stays at 36 until the app is tested on 37.
    compileSdk {
        version = release(37) { minorApiLevel = 2 }
    }

    defaultConfig {
        applicationId = "com.lazyscheduler.app"
        minSdk = 26                      // java.time without desugaring
        targetSdk = 36
        versionCode = 1
        versionName = "0.1.0"
        buildConfigField("String", "FIREBASE_PROJECT_ID", cloudString("project_id"))
        buildConfigField("String", "FIREBASE_API_KEY", cloudString("api_key"))
        buildConfigField("String", "FIREBASE_APP_ID", cloudString("app_id"))
        buildConfigField("String", "GOOGLE_WEB_CLIENT_ID", cloudString("web_client_id"))
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
        // 실기기에서 진짜 속도를 보려면 이것을 깐다: ./gradlew installPerf
        //
        // debug 빌드는 Compose 를 느리게 만든다 - debuggable 이 켜져 있어 ART 가 최적화를
        // 미루고, ui-tooling 이 조합 하나하나를 들여다볼 수 있게 갈고리를 걸어 둔다.
        // 화면이 끈적이는 느낌의 상당 부분이 여기서 온다. release 는 스토어용 키로만
        // 서명해야 하므로 건드리지 않고, 같은 설정에 디버그 키만 붙인 것을 따로 둔다.
        create("perf") {
            initWith(getByName("release"))
            signingConfig = signingConfigs.getByName("debug")
            matchingFallbacks += listOf("release")
        }
    }

    buildFeatures {
        compose = true
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    testOptions {
        unitTests.all {
            // The recurrence spec shared with the PC app (tests/vectors/recurrence.json)
            it.systemProperty("vectors", rootProject.file("../tests/vectors/recurrence.json").absolutePath)
            it.systemProperty("suggest", rootProject.file("../tests/vectors/suggest.json").absolutePath)
        }
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2026.09.00")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.compose.ui:ui-tooling-preview")
    debugImplementation("androidx.compose.ui:ui-tooling")
    implementation("androidx.activity:activity-compose:1.13.0")
    implementation("androidx.lifecycle:lifecycle-runtime-compose:2.11.0")
    implementation("androidx.lifecycle:lifecycle-viewmodel-compose:2.11.0")
    implementation("androidx.core:core-ktx:1.19.0")

    implementation(platform("com.google.firebase:firebase-bom:34.19.0"))
    implementation("com.google.firebase:firebase-auth")
    implementation("com.google.firebase:firebase-firestore")
    implementation("androidx.credentials:credentials:1.6.0")
    implementation("androidx.credentials:credentials-play-services-auth:1.6.0")
    implementation("com.google.android.libraries.identity.googleid:googleid:1.2.1")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.11.0")
    implementation("androidx.work:work-runtime:2.11.2")

    testImplementation("junit:junit:4.13.2")
    testImplementation("com.google.code.gson:gson:2.14.0")
}
