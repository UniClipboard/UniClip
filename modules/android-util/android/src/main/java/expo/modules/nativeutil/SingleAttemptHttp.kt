package expo.modules.nativeutil

import android.content.Context
import android.net.Uri
import expo.modules.kotlin.exception.CodedException
import okhttp3.Call
import okhttp3.Callback
import okhttp3.ConnectionPool
import okhttp3.EventListener
import okhttp3.MediaType.Companion.toMediaTypeOrNull
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody
import okhttp3.RequestBody.Companion.asRequestBody
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import okio.BufferedSink
import okio.source
import java.io.File
import java.io.IOException
import java.security.SecureRandom
import java.security.cert.X509Certificate
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicBoolean
import javax.net.ssl.SSLContext
import javax.net.ssl.TrustManager
import javax.net.ssl.X509TrustManager

/** The request failed before any of it left the device: sending it again is safe. */
class RequestNotSentException(message: String?, cause: Throwable?) :
    CodedException("ERR_REQUEST_NOT_SENT", message, cause)

/** The request was sent but no complete reply arrived: the server may have applied it. */
class RequestOutcomeUnknownException(message: String?, cause: Throwable?) :
    CodedException("ERR_REQUEST_OUTCOME_UNKNOWN", message, cause)

/**
 * One HTTP request that is never sent twice. OkHttp normally resends a request on a new
 * connection when a reused connection fails, even after the request body went out; here that
 * retry is off, and every request opens its own connection so a stale pooled one cannot fail it.
 */
internal object SingleAttemptHttp {
    private val base: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .retryOnConnectionFailure(false)
            .connectionPool(ConnectionPool(0, 1, TimeUnit.MILLISECONDS))
            .followRedirects(false)
            .followSslRedirects(false)
            .build()
    }

    private val trustingTls: Pair<javax.net.ssl.SSLSocketFactory, X509TrustManager> by lazy {
        val trustAll = object : X509TrustManager {
            override fun checkClientTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun checkServerTrusted(chain: Array<X509Certificate>, authType: String) {}
            override fun getAcceptedIssuers(): Array<X509Certificate> = arrayOf()
        }
        val context = SSLContext.getInstance("TLS")
        context.init(null, arrayOf<TrustManager>(trustAll), SecureRandom())
        context.socketFactory to trustAll
    }

    fun send(
        context: Context,
        method: String,
        url: String,
        headers: Map<String, String>,
        text: String?,
        fileUri: String?,
        timeoutMs: Long,
        trustAllCertificates: Boolean,
        resolve: (status: Int, body: String) -> Unit,
        reject: (CodedException) -> Unit,
    ) {
        val sent = AtomicBoolean(false)
        val builder = base.newBuilder()
            .connectTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .readTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .writeTimeout(timeoutMs, TimeUnit.MILLISECONDS)
            .eventListener(object : EventListener() {
                override fun requestHeadersStart(call: Call) {
                    sent.set(true)
                }
            })
        if (trustAllCertificates) {
            val (factory, manager) = trustingTls
            builder.sslSocketFactory(factory, manager).hostnameVerifier { _, _ -> true }
        }
        val contentType = headers.entries
            .firstOrNull { it.key.equals("content-type", ignoreCase = true) }
            ?.value?.toMediaTypeOrNull()
        val body: RequestBody? = try {
            when {
                fileUri != null -> fileBody(context, fileUri, contentType)
                text != null -> text.toRequestBody(contentType)
                else -> null
            }
        } catch (error: Exception) {
            reject(RequestNotSentException(error.message, error))
            return
        }
        val request = try {
            Request.Builder().url(url).method(method, body).apply {
                headers.forEach { (key, value) -> header(key, value) }
            }.build()
        } catch (error: Exception) {
            reject(RequestNotSentException(error.message, error))
            return
        }
        builder.build().newCall(request).enqueue(object : Callback {
            override fun onFailure(call: Call, e: IOException) {
                reject(
                    if (sent.get()) RequestOutcomeUnknownException(e.message, e)
                    else RequestNotSentException(e.message, e)
                )
            }

            override fun onResponse(call: Call, response: Response) {
                response.use {
                    val text = try {
                        it.body?.string() ?: ""
                    } catch (error: IOException) {
                        // The status line arrived, so the server answered; only its body was cut.
                        ""
                    }
                    resolve(it.code, text)
                }
            }
        })
    }

    private fun fileBody(context: Context, fileUri: String, contentType: okhttp3.MediaType?): RequestBody {
        val uri = Uri.parse(fileUri)
        if (uri.scheme == null || uri.scheme.equals("file", ignoreCase = true)) {
            val file = File(uri.path ?: fileUri.removePrefix("file://"))
            if (!file.exists()) throw IOException("File not found")
            return file.asRequestBody(contentType)
        }
        val resolver = context.contentResolver
        val length = resolver.openAssetFileDescriptor(uri, "r")?.use { it.length } ?: -1L
        return object : RequestBody() {
            override fun contentType() = contentType
            override fun contentLength() = length
            override fun writeTo(sink: BufferedSink) {
                val input = resolver.openInputStream(uri) ?: throw IOException("Content not readable")
                input.source().use { sink.writeAll(it) }
            }
        }
    }
}
