package expo.modules.smsverificationcode

import org.junit.Assert.assertEquals
import org.junit.Test

class SmsVerificationCodeRecognizerTest {
    private fun match(code: String) = SmsCodeResult.Match(code)
    private fun r(body: String) = SmsVerificationCodeRecognizer.recognize(body)

    @Test fun f1_bracketAloneAndCardTailIsNotACode() = assertEquals(SmsCodeResult.None, r("【示例银行】尾号1234消费100元"))
    @Test fun f2_plainEnglishWordIsNotACode() = assertEquals(SmsCodeResult.None, r("Your code below is ready"))
    @Test fun f3_validityMinutesExcluded() = assertEquals(match("482915"), r("验证码：482915，5分钟内有效"))
    @Test fun f4_spacedDigits() = assertEquals(match("123456"), r("验证码 12 34 56"))
    @Test fun f5_eightSpacedDigitsRejected() = assertEquals(SmsCodeResult.None, r("验证码 12 34 56 78"))
    @Test fun f6_sevenDigitsRejected() = assertEquals(SmsCodeResult.None, r("验证码是 1234567"))
    @Test fun f7_threeDigitsRejected() = assertEquals(SmsCodeResult.None, r("验证码 123"))
    @Test fun f8_twoDistinctCodesAmbiguous() = assertEquals(SmsCodeResult.Ambiguous, r("验证码 482915 或 731064"))
    @Test fun f9_sameCodeTwiceIsOneCode() = assertEquals(match("482915"), r("验证码 482915，请勿泄露。验证码 482915"))
    @Test fun f10_emptyAndBlank() {
        assertEquals(SmsCodeResult.None, r(""))
        assertEquals(SmsCodeResult.None, r("   "))
        assertEquals(SmsCodeResult.None, r("\n"))
    }
    @Test fun f11_fullWidthDigits() = assertEquals(match("482915"), r("验证码：４８２９１５"))
    @Test fun f12_unicodeSpaces() {
        assertEquals(match("482915"), r("验证码 482915"))
        assertEquals(match("482915"), r("验证码　482915"))
    }
    @Test fun f13_arabicIndicDigitsRejected() = assertEquals(SmsCodeResult.None, r("验证码：٤٨٢٩١٥"))
    @Test fun f14_googlePrefix() = assertEquals(match("482915"), r("G-482915 is your Google verification code"))
    @Test fun f15_appHashTail() = assertEquals(match("482915"), r("<#> 您的验证码是 482915 abc123XYZ"))
    @Test fun f16_alphanumeric() = assertEquals(match("A1B2C3"), r("Your verification code is A1B2C3"))
    @Test fun f17_fiveDigits() = assertEquals(match("48291"), r("Your code is 48291"))
    @Test fun f18_fourDigits() = assertEquals(match("4829"), r("验证码 4829"))
    @Test fun f19_amountExcluded() = assertEquals(match("1234"), r("订单金额 482915.00 元，验证码 1234"))
    @Test fun f20_dateAndTimeExcluded() = assertEquals(SmsCodeResult.None, r("验证码 2026-09-30 或 10:30"))
    @Test fun f21_phoneNumberExcluded() = assertEquals(SmsCodeResult.None, r("您的验证码为13800138000"))
    @Test fun f22_codeBeforeKeyword() = assertEquals(match("482915"), r("482915 is your verification code"))
    @Test fun f23_cardTailExcluded() = assertEquals(match("482915"), r("尾号6789账户验证码 482915"))
    @Test fun f24_useAsOtp() = assertEquals(match("482915"), r("Use 482915 as your OTP"))
    @Test fun f25_keywordFarFromNumber() =
        assertEquals(SmsCodeResult.None, r("验证码" + "。".repeat(40) + "482915"))
    @Test fun f26_longBodyIsBounded() {
        val start = System.nanoTime()
        r("验证码 " + "1 ".repeat(50_000))
        r("a".repeat(100_000))
        assertEquals(true, (System.nanoTime() - start) < 2_000_000_000L)
    }
    @Test fun f27_keywordWithoutNumber() = assertEquals(SmsCodeResult.None, r("验证码"))
    @Test fun f28_mixedLanguage() = assertEquals(match("731064"), r("【Example】Code: 731064. Do not share."))
}
