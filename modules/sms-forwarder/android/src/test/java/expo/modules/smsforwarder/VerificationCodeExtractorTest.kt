package expo.modules.smsforwarder

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class VerificationCodeExtractorTest {
    @Test
    fun extractsChineseVerificationCode() {
        val body = "【UniClipboard】您的验证码是 482915，请勿泄露给他人。"

        assertEquals("482915", VerificationCodeExtractor.extract(body))
        assertTrue(VerificationCodeExtractor.contains(body))
    }

    @Test
    fun extractsEnglishAlphanumericCode() {
        val body = "Your verification code is A1B2C3. It expires in 10 minutes."

        assertEquals("A1B2C3", VerificationCodeExtractor.extract(body))
    }

    @Test
    fun removesSpacesFromNumericCode() {
        val body = "动态码：12 34 56，请在五分钟内使用。"

        assertEquals("123456", VerificationCodeExtractor.extract(body))
    }

    @Test
    fun ignoresUnrelatedNumbers() {
        val body = "您的订单 482915 已发货，预计 3 天后送达。"

        assertNull(VerificationCodeExtractor.extract(body))
        assertFalse(VerificationCodeExtractor.contains(body))
    }
}
