package com.km_test.app

import android.content.Intent
import android.os.Bundle
import android.webkit.JavascriptInterface
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge

/**
 * Bridges an incoming "Open with" (ACTION_VIEW) file Intent to the webview.
 * Exposed as `window.AndroidIntentBridge` — the Angular side reads it once at
 * startup (AndroidOpenFileService) to pick up a file the OS launched us with.
 */
class IntentBridge(private val activity: MainActivity) {
  @JavascriptInterface
  fun getPendingOpenUri(): String = activity.consumePendingOpenUri() ?: ""
}

class MainActivity : TauriActivity() {
  // The intent can arrive before the WebView exists (cold start) or after
  // (singleTask onNewIntent while already running), so it's stashed here
  // until JS asks for it via the bridge.
  private var pendingOpenUri: String? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
    captureOpenFileIntent(intent)
  }

  override fun onNewIntent(intent: Intent) {
    super.onNewIntent(intent)
    captureOpenFileIntent(intent)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    webView.addJavascriptInterface(IntentBridge(this), "AndroidIntentBridge")
  }

  private fun captureOpenFileIntent(intent: Intent?) {
    if (intent?.action == Intent.ACTION_VIEW) {
      intent.data?.toString()?.let { pendingOpenUri = it }
    }
  }

  @Synchronized
  fun consumePendingOpenUri(): String? {
    val uri = pendingOpenUri
    pendingOpenUri = null
    return uri
  }
}
