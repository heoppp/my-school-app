plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.schoolregister"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.schoolregister"
        minSdk = 24
        targetSdk = 35
        versionCode = 1
        versionName = "1.0"
    }

    // The app's screens live in ../web and are bundled into the APK.
    sourceSets["main"].assets.srcDirs("../web")

    buildTypes {
        release {
            isMinifyEnabled = false
            // Signed with the debug key so the APK installs without extra setup.
            signingConfig = signingConfigs.getByName("debug")
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
