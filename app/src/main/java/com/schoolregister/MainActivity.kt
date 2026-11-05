package com.schoolregister

import android.annotation.SuppressLint
import android.app.Activity
import android.content.ClipData
import android.content.ClipboardManager
import android.content.ContentValues
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.Environment
import android.print.PrintAttributes
import android.print.PrintManager
import android.provider.MediaStore
import android.webkit.JavascriptInterface
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import android.widget.Toast
import androidx.webkit.WebViewAssetLoader
import org.json.JSONObject
import java.io.File
import java.net.HttpURLConnection
import java.net.URL

/**
 * The whole app is the web screens in /web, bundled inside the APK and shown full-screen.
 * They are served from https://appassets.androidplatform.net so saved logins work normally.
 */
class MainActivity : Activity() {

    private lateinit var web: WebView
    private var lastUpdateCheck = 0L
    private var pendingUpdate: String? = null

    @SuppressLint("SetJavaScriptEnabled")
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val loader = WebViewAssetLoader.Builder()
            .addPathHandler("/assets/", WebViewAssetLoader.AssetsPathHandler(this))
            .build()

        web = WebView(this)
        web.settings.javaScriptEnabled = true
        web.settings.domStorageEnabled = true
        web.settings.allowFileAccess = false
        web.addJavascriptInterface(Bridge(), "AndroidBridge")
        web.webViewClient = object : WebViewClient() {
            override fun shouldInterceptRequest(view: WebView, request: WebResourceRequest): WebResourceResponse? =
                loader.shouldInterceptRequest(request.url)

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val url = request.url
                if (url.host == "appassets.androidplatform.net") return false
                // Open any other link (WhatsApp, SMS, a password-reset page) outside the app.
                openOutside(url)
                return true
            }

            override fun onPageFinished(view: WebView, url: String) {
                pendingUpdate?.let { showUpdate(it) }
            }
        }
        setContentView(web)

        if (savedInstanceState != null) web.restoreState(savedInstanceState)
        else web.loadUrl("https://appassets.androidplatform.net/assets/index.html")
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        web.saveState(outState)
    }

    override fun onResume() {
        super.onResume()
        // Fetch the latest attendance and marks when the app comes back to the front.
        web.evaluateJavascript("window.SR_onResume && window.SR_onResume()", null)
        checkForUpdate()
    }

    /**
     * The phone's back button moves to the parent screen inside the app.
     * On a first screen (My classes, a student's record, welcome) it closes the app,
     * so it never goes back to the log-in page.
     */
    @Deprecated("Deprecated in Java")
    override fun onBackPressed() {
        web.evaluateJavascript("window.SR_back ? String(window.SR_back()) : 'false'") { result ->
            if (result == null || !result.contains("true")) finish()
        }
    }

    private fun openOutside(uri: Uri) {
        runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
            .onFailure { Toast.makeText(this, "No app on this phone can open that.", Toast.LENGTH_LONG).show() }
    }

    /** Once every 30 minutes, ask GitHub whether a newer version of the app has been built. */
    private fun checkForUpdate() {
        val url = BuildConfig.UPDATE_URL
        if (url.isEmpty()) return
        val now = System.currentTimeMillis()
        if (now - lastUpdateCheck < 30 * 60 * 1000) return
        lastUpdateCheck = now
        Thread {
            runCatching {
                val c = (URL(url).openConnection() as HttpURLConnection).apply {
                    connectTimeout = 8000; readTimeout = 8000; instanceFollowRedirects = true
                    setRequestProperty("Cache-Control", "no-cache")
                }
                val j = JSONObject(c.inputStream.bufferedReader().use { it.readText() })
                if (j.optInt("versionCode") > BuildConfig.VERSION_CODE && j.optString("apk").isNotEmpty()) {
                    val info = JSONObject().put("versionName", j.optString("versionName")).put("apk", j.optString("apk")).toString()
                    runOnUiThread { pendingUpdate = info; showUpdate(info) }
                }
            }
        }.start()
    }

    private fun showUpdate(info: String) {
        web.evaluateJavascript("window.SR_updateAvailable && window.SR_updateAvailable($info)", null)
    }

    /** What the screens can ask the phone to do. */
    inner class Bridge {
        @JavascriptInterface
        fun share(text: String) {
            runOnUiThread {
                val send = Intent(Intent.ACTION_SEND).setType("text/plain").putExtra(Intent.EXTRA_TEXT, text)
                startActivity(Intent.createChooser(send, "Share"))
            }
        }

        @JavascriptInterface
        fun copy(text: String) {
            runOnUiThread {
                val cm = getSystemService(ClipboardManager::class.java)
                cm.setPrimaryClip(ClipData.newPlainText("code", text))
            }
        }

        /** Opens WhatsApp, SMS or a download link. */
        @JavascriptInterface
        fun openUrl(url: String) {
            runOnUiThread { openOutside(Uri.parse(url)) }
        }

        @JavascriptInterface
        fun version(): String = BuildConfig.VERSION_NAME

        /** Saves a file (e.g. the monthly report as Excel/CSV) to the phone's Downloads folder. */
        @JavascriptInterface
        fun saveFile(name: String, mime: String, text: String) {
            runOnUiThread {
                runCatching {
                    val bytes = text.toByteArray(Charsets.UTF_8)
                    if (Build.VERSION.SDK_INT >= 29) {
                        val values = ContentValues().apply {
                            put(MediaStore.Downloads.DISPLAY_NAME, name)
                            put(MediaStore.Downloads.MIME_TYPE, mime)
                            put(MediaStore.Downloads.RELATIVE_PATH, Environment.DIRECTORY_DOWNLOADS)
                        }
                        val uri = contentResolver.insert(MediaStore.Downloads.EXTERNAL_CONTENT_URI, values)!!
                        contentResolver.openOutputStream(uri)!!.use { it.write(bytes) }
                        Toast.makeText(this@MainActivity, "Saved to Downloads: $name", Toast.LENGTH_LONG).show()
                        runCatching {
                            startActivity(Intent(Intent.ACTION_VIEW).setDataAndType(uri, mime).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION))
                        }
                    } else {
                        val dir = getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS)!!
                        val f = File(dir, name); f.writeBytes(bytes)
                        Toast.makeText(this@MainActivity, "Saved: ${f.absolutePath}", Toast.LENGTH_LONG).show()
                    }
                }.onFailure {
                    Toast.makeText(this@MainActivity, "Couldn't save the file: ${it.message}", Toast.LENGTH_LONG).show()
                }
            }
        }

        /** Opens Android's print screen, where "Save as PDF" is one of the printers. */
        @JavascriptInterface
        fun print(title: String) {
            runOnUiThread {
                val pm = getSystemService(PrintManager::class.java)
                val attrs = PrintAttributes.Builder().setMediaSize(PrintAttributes.MediaSize.ISO_A4.asLandscape()).build()
                pm.print(title, web.createPrintDocumentAdapter(title), attrs)
            }
        }
    }
}
