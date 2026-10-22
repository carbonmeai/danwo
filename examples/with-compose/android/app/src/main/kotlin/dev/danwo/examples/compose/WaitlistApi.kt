package dev.danwo.examples.compose

import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import org.json.JSONObject

/**
 * The waitlist API, at its production address. Nothing here changes for tests: danwo points the
 * emulator's proxy at its own, and the proxy routes this host to the test API.
 */
object WaitlistApi {
    private const val BASE = "https://api.lumen.example"
    private const val UNAVAILABLE = "We couldn't add you just now. Please try again in a minute."

    /** What joining answers: a new seat or one the email already had, and how many are waiting. */
    data class Joined(val status: String, val count: Int)

    /** An answer the API refused, with the message it gave. */
    class Refused(message: String) : Exception(message)

    /** The API's own trouble (a 5xx) or a lost connection: worth another try. */
    private class Unavailable : Exception()

    /**
     * The pauses before each retry. Joining is safe to repeat: the API keeps one row and sends one
     * email per address however many times it is asked.
     */
    private val retryDelaysMs = listOf(300L, 1_000L, 2_000L)

    /** Puts `email` on the waitlist, trying again when the API is briefly unavailable. */
    suspend fun join(email: String): Joined {
        for (pause in retryDelaysMs) {
            try {
                return attempt(email)
            } catch (_: Unavailable) {
                delay(pause)
            } catch (_: IOException) {
                delay(pause)
            }
        }

        return try {
            attempt(email)
        } catch (_: Unavailable) {
            throw Refused(UNAVAILABLE)
        } catch (_: IOException) {
            throw Refused(UNAVAILABLE)
        }
    }

    private suspend fun attempt(email: String): Joined = withContext(Dispatchers.IO) {
        val connection = URL("$BASE/join").openConnection() as HttpURLConnection

        try {
            connection.requestMethod = "POST"
            connection.connectTimeout = 20_000
            connection.readTimeout = 20_000
            connection.doOutput = true
            connection.setRequestProperty("Content-Type", "application/json")
            connection.outputStream.use {
                it.write(JSONObject().put("email", email).toString().toByteArray())
            }

            val status = connection.responseCode
            val body = (if (status < 400) connection.inputStream else connection.errorStream)
                ?.bufferedReader()?.use { it.readText() }
                .orEmpty()

            if (status >= 500) throw Unavailable()
            if (status !in 200..299) {
                val message = runCatching { JSONObject(body).getString("error") }.getOrNull()

                throw Refused(message ?: UNAVAILABLE)
            }

            val json = JSONObject(body)

            Joined(status = json.getString("status"), count = json.getInt("count"))
        } finally {
            connection.disconnect()
        }
    }
}
