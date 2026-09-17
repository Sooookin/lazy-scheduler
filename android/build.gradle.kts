plugins {
    id("com.android.application") version "9.4.0" apply false
    // AGP 9 compiles Kotlin itself; declaring KGP here only pins the Kotlin version it uses,
    // so the Compose compiler plugin below matches it.
    id("org.jetbrains.kotlin.android") version "2.4.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.20" apply false
}
