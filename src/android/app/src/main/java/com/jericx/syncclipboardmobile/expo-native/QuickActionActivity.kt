package com.jericx.syncclipboardmobile.quickaction

import android.os.Bundle

import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultNewArchitectureEntryPoint.fabricEnabled
import com.facebook.react.defaults.DefaultReactActivityDelegate

import com.jericx.syncclipboardmobile.BuildConfig
import expo.modules.ReactActivityDelegateWrapper

/**
 * Transparent Activity for quick clipboard actions (download/upload).
 * Launched from Quick Settings tiles and foreground service notification.
 * Renders only a semi-transparent overlay without showing the main app UI.
 */
class QuickActionActivity : ReactActivity() {

    companion object {
        const val EXTRA_DIRECTION = "direction"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(null)
    }

    override fun getMainComponentName(): String = "quickAction"

    override fun createReactActivityDelegate(): ReactActivityDelegate {
        return ReactActivityDelegateWrapper(
            this,
            BuildConfig.IS_NEW_ARCHITECTURE_ENABLED,
            object : DefaultReactActivityDelegate(
                this,
                mainComponentName,
                fabricEnabled
            ) {
                override fun getLaunchOptions(): Bundle? {
                    return Bundle().apply {
                        val direction = intent?.getStringExtra(EXTRA_DIRECTION) ?: "download"
                        putString("direction", direction)
                    }
                }
            }
        )
    }
}
