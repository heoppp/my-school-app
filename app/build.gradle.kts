plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Each GitHub build gets a higher version number, so phones can tell an update is newer.
val runNumber = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
val repo = System.getenv("GITHUB_REPOSITORY") ?: ""
// The release signing key (from the SIGNING_KEY secret). With the same key every time,
// new versions install over the old one without uninstalling.
val keystorePath = System.getenv("SIGNING_KEYSTORE")
val hasReleaseKey = keystorePath != null && file(keystorePath).exists()

android {
    namespace = "com.schoolregister"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.schoolregister"
        minSdk = 24
        targetSdk = 35
        versionCode = runNumber
        versionName = "1.$runNumber"
        val updateUrl = if (repo.isNotEmpty()) "https://github.com/$repo/releases/download/latest/version.json" else ""
        buildConfigField("String", "UPDATE_URL", "\"$updateUrl\"")
    }

    buildFeatures { buildConfig = true }

    // The app's screens live in ../web and are bundled into the APK.
    sourceSets["main"].assets.srcDirs("../web")

    signingConfigs {
        if (hasReleaseKey) {
            create("release") {
                storeFile = file(keystorePath!!)
                storePassword = System.getenv("SIGNING_PASSWORD")
                keyAlias = "schoolapp"
                keyPassword = System.getenv("SIGNING_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            signingConfig = if (hasReleaseKey) signingConfigs.getByName("release") else signingConfigs.getByName("debug")
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}

dependencies {
    implementation("androidx.webkit:webkit:1.12.1")
}
