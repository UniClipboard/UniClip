package expo.modules.smsverificationcode

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class SmsVerificationCodeModule : Module() {
    private val context get() = requireNotNull(appContext.reactContext)

    override fun definition() = ModuleDefinition {
        Name("SmsVerificationCode")

        Function("recognize") { body: String ->
            when (val result = SmsVerificationCodeRecognizer.recognize(body)) {
                is SmsCodeResult.Match -> mapOf("status" to "match", "code" to result.code)
                SmsCodeResult.Ambiguous -> mapOf("status" to "ambiguous")
                SmsCodeResult.None -> mapOf("status" to "none")
            }
        }

        Function("isAutoCopyEnabled") { SmsCodeAutoCopy.isActive(context) }

        // Called by the headless task once the code is verifiably on the clipboard.
        Function("markCodeCopied") { code: String -> SmsCodeNotifier.showCode(context, code, CopyState.COPIED) }

        // Returns false when the SMS permission is missing; the feature then stays off.
        Function("setAutoCopyEnabled") { enabled: Boolean -> SmsCodeAutoCopy.setEnabled(context, enabled) }
    }
}
