package studio.audiowhisper.capture

import org.json.JSONObject
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URI

fun normalizeServer(value: String): String {
  val uri = URI(value.trim())
  require(uri.scheme in listOf("http", "https") && !uri.host.isNullOrBlank() && uri.userInfo == null
    && uri.query == null && uri.fragment == null && uri.path in listOf("", "/")) { "Use somente o endereço HTTP ou HTTPS do PC, sem caminho ou senha." }
  return uri.toString().trimEnd('/')
}

interface Transport {
  fun request(connection: JSONObject, method: String, path: String, body: ByteArray? = null, contentType: String = "application/json"): JSONObject
}

class LocalHttp : Transport {
  override fun request(connection: JSONObject, method: String, path: String, body: ByteArray?, contentType: String): JSONObject {
    val endpoint = URI(normalizeServer(connection.getString("url")) + path).toURL().openConnection() as HttpURLConnection
    try {
      endpoint.instanceFollowRedirects = false
      endpoint.connectTimeout = 8000; endpoint.readTimeout = 20000; endpoint.requestMethod = method
      val token = connection.optString("token")
      if (token.isNotEmpty()) endpoint.setRequestProperty("X-Access-Token", token)
      endpoint.setRequestProperty("Accept", "application/json")
      if (body != null) {
        endpoint.doOutput = true
        endpoint.setRequestProperty("Content-Type", contentType)
        endpoint.setFixedLengthStreamingMode(body.size)
        endpoint.outputStream.use { it.write(body) }
      }
      val status = endpoint.responseCode
      if (status !in 200..299) throw IOException(when (status) {
        401 -> "O token do PC foi recusado. Confira a conexão."
        409 -> "A captura no PC diverge desta gravação. Os arquivos locais foram preservados."
        300, 301, 302, 303, 307, 308 -> "O PC redirecionou a conexão. Use o endereço final nas configurações."
        else -> "O PC não confirmou o envio (HTTP $status). O áudio continua salvo."
      })
      return JSONObject(endpoint.inputStream.bufferedReader().use { it.readText() })
    } finally { endpoint.disconnect() }
  }
}

class LiveDelivery(private val store: RecordingStore, private val transport: Transport, private val connectionFor: (String) -> JSONObject?) {
  @Synchronized fun once() {
    for (entry in store.list().reversed()) {
      if (entry.optBoolean("recovery_required")) continue
      if (entry.optInt("chunks") == 0) continue
      if (entry.optString("remote_status") in listOf("completed", "cancelled") || entry.optLong("retry_at") > System.currentTimeMillis()) continue
      val id = entry.getString("id")
      try {
        val connection = connectionFor(entry.getString("connection_id")) ?: continue
        val identity = transport.request(connection, "GET", "/api/companion")
        require(identity.optString("service") == "audiowhisper" && identity.optInt("protocol_version") == 1
          && identity.optString("instance_id") == entry.getString("instance_id")) { "Este endereço pertence a outro PC. Reconecte a gravação antes de enviar." }
        var session = store.read(id)
        if (session.isNull("job_id")) {
          val body = JSONObject().put("capture_id", id).put("title", session.getString("title"))
            .put("source", session.getString("source")).put("settings", session.getJSONObject("settings"))
          val job = transport.request(connection, "POST", "/api/live", body.toString().toByteArray())
          val jobId = java.util.UUID.fromString(job.getString("id")).toString()
          session = store.update(id) { it.put("job_id", jobId) }
        }
        val jobId = session.getString("job_id")
        var cursor = session.optInt("uploaded_chunks")
        // Bound each turn so an old backlog cannot starve a new live capture.
        repeat(3) {
          session = store.read(id)
          if (cursor < session.optInt("chunks")) {
            val file = store.chunk(id, cursor)
            require(file.isFile) { "Um trecho local está indisponível. A gravação foi preservada." }
            val boundary = "aw-${id}-$cursor"
            val body = ByteArrayOutputStream().apply {
              write(("--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"chunk.wav\"\r\nContent-Type: audio/wav\r\n\r\n").toByteArray())
              write(file.readBytes()); write("\r\n--$boundary--\r\n".toByteArray())
            }.toByteArray()
            transport.request(connection, "POST", "/api/live/$jobId/chunks/$cursor?start=${cursor * 4}&revision=0&final=true", body, "multipart/form-data; boundary=$boundary")
            cursor++
            store.update(id) { it.put("uploaded_chunks", cursor).put("error", JSONObject.NULL).put("retry_at", 0).put("attempts", 0) }
          }
        }
        session = store.read(id)
        if (session.optString("state") == "stopped" && cursor == session.optInt("chunks") && !session.optBoolean("stop_sent")) {
          val stop = JSONObject().put("expected_chunks", cursor).put("duration", session.optLong("frames") / SAMPLE_RATE.toDouble())
          transport.request(connection, "POST", "/api/live/$jobId/stop", stop.toString().toByteArray())
          store.update(id) { it.put("stop_sent", true) }
        }
        if (session.optBoolean("stop_sent")) {
          val remote = transport.request(connection, "GET", "/api/jobs/$jobId")
          store.update(id) { it.put("remote_status", remote.getString("status")).put("remote_error", remote.optString("error_message")) }
        }
      } catch (error: Exception) {
        store.update(id) {
          val attempts = (it.optInt("attempts") + 1).coerceAtMost(6)
          it.put("error", if (error is IllegalArgumentException) error.message else if (error is IOException && error.message?.startsWith("O ") == true) error.message else "Sem conexão com o PC. O áudio continua salvo no celular.")
            .put("attempts", attempts).put("retry_at", System.currentTimeMillis() + minOf(60000L, 1000L shl attempts))
        }
      }
    }
  }
}
