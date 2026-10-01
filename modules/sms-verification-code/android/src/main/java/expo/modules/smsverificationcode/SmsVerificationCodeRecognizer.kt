package expo.modules.smsverificationcode

import java.text.Normalizer

/** Outcome of recognizing a one-time code in an SMS body. Never carries the body. */
sealed interface SmsCodeResult {
    data class Match(val code: String) : SmsCodeResult
    data object Ambiguous : SmsCodeResult
    data object None : SmsCodeResult
}

/**
 * Pure recognizer for a one-time code in an SMS body. It has no Android, clipboard,
 * network or logging dependency so the receive path and the developer test entry
 * share exactly one implementation.
 *
 * A code counts only when it sits near an OTP keyword. Amounts, dates, times, card
 * tails, validity durations and 7+ digit numbers are excluded; several distinct codes
 * tied for a keyword yield [SmsCodeResult.Ambiguous] rather than a guess.
 */
object SmsVerificationCodeRecognizer {
    private const val MAX_BODY_LENGTH = 4096
    private const val KEYWORD_WINDOW = 20

    private val keyword = Regex(
        "(?<![A-Za-z])(?:verification code|security code|authentication code|auth code|" +
            "one-time password|one-time code|passcode|otp|code)(?![A-Za-z])" +
            "|验证码|校验码|动态码|动态密码|授权码|确认码|安全码|登录码|验证代码",
        RegexOption.IGNORE_CASE,
    )

    // Order matters: spaced groups first, then plain digit runs, then letter+digit mixes.
    private val candidate = Regex(
        "(?<![A-Za-z0-9])(?:G-)?(?:" +
            "([0-9]{1,3}(?:[ \\-][0-9]{1,3})+)|" +
            "([0-9]+)|" +
            "((?=[A-Za-z0-9]*[0-9])(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{5,6})" +
            ")(?![A-Za-z0-9])",
    )

    private val trailingUnit = Regex(
        "^\\s*(?:分钟|分|秒|小时|天|元|块|%|min|minute|minutes|hour|hours|sec|seconds|yuan|rmb)",
        RegexOption.IGNORE_CASE,
    )
    private val precedingLabel = Regex(
        "(?:尾号|末四位|后四位|尾数|卡号|ending in|ending with|ending|card)\\s*[:：]?\\s*$",
        RegexOption.IGNORE_CASE,
    )
    private const val NUMBER_JOINERS = ".:/-"

    private data class Candidate(val start: Int, val end: Int, val code: String)

    fun recognize(body: String): SmsCodeResult {
        val text = Normalizer.normalize(body.take(MAX_BODY_LENGTH), Normalizer.Form.NFKC)
        if (text.isBlank()) return SmsCodeResult.None

        val keywords = keyword.findAll(text).toList()
        if (keywords.isEmpty()) return SmsCodeResult.None
        val candidates = candidate.findAll(text).mapNotNull { toCandidate(text, it) }.toList()
        if (candidates.isEmpty()) return SmsCodeResult.None

        val codes = linkedSetOf<String>()
        for (k in keywords) {
            val after = candidates.filter { it.start >= k.range.last + 1 && it.start - (k.range.last + 1) <= KEYWORD_WINDOW }
            val picked = after.ifEmpty {
                candidates.filter { it.end <= k.range.first && k.range.first - it.end <= KEYWORD_WINDOW }
            }
            picked.forEach { codes += it.code }
        }
        return when (codes.size) {
            0 -> SmsCodeResult.None
            1 -> SmsCodeResult.Match(codes.first())
            else -> SmsCodeResult.Ambiguous
        }
    }

    private fun toCandidate(text: String, match: MatchResult): Candidate? {
        val groups = match.groups
        val token = (groups[1] ?: groups[2] ?: groups[3])!!
        val code = token.value.replace(" ", "").replace("-", "")
        val isDigits = groups[3] == null
        if (isDigits && code.length !in 4..6) return null

        val start = token.range.first
        val end = token.range.last + 1
        if (isPartOfLongerNumber(text, start, end)) return null
        if (trailingUnit.containsMatchIn(text.substring(end, minOf(text.length, end + 12)))) return null
        if (start > 0 && text[start - 1] in "¥￥$") return null
        if (precedingLabel.containsMatchIn(text.substring(maxOf(0, start - 12), start))) return null
        return Candidate(match.range.first, end, code)
    }

    /** Decimals, dates, times, thousands separators: a digit run glued to another by `.:/-` or `,ddd`. */
    private fun isPartOfLongerNumber(text: String, start: Int, end: Int): Boolean {
        val next = text.getOrNull(end)
        if (next != null && next in NUMBER_JOINERS && text.getOrNull(end + 1)?.let { it in '0'..'9' } == true) return true
        val prev = text.getOrNull(start - 1)
        if (prev != null && prev in NUMBER_JOINERS && text.getOrNull(start - 2)?.let { it in '0'..'9' } == true) return true
        // Thousands separator (1,234). Normalized full-width commas between sentences are followed by a space.
        if (next == ',' && text.length >= end + 4 && text.substring(end + 1, end + 4).all { it in '0'..'9' }) return true
        return false
    }
}
