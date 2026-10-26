package studio.audiowhisper.capture

import org.json.JSONArray
import org.json.JSONObject

/** Publish a complete refresh only after every page succeeds. Keep the old cache on failure. */
fun refreshTranscript(transport: Transport, connection: JSONObject, jobId: String, cached: JSONObject): JSONObject {
  var segments = if (cached.has("prefix_hash")) JSONArray(cached.getJSONArray("segments").toString()) else JSONArray()
  var hash = cached.optString("prefix_hash")
  repeat(100) {
    val after = if (segments.length() == 0) -1 else segments.getJSONObject(segments.length() - 1).getInt("segment_index")
    val checksum = if (hash.matches(Regex("[a-f0-9]{64}"))) "&known_hash=$hash" else ""
    val response = transport.request(connection, "GET", "/api/companion/captures/$jobId/transcript?after_index=$after&limit=500$checksum")
    if (response.optBoolean("reset")) segments = JSONArray()
    val fresh = response.getJSONArray("segments")
    for (index in 0 until fresh.length()) segments.put(fresh.getJSONObject(index))
    hash = response.getString("prefix_hash")
    require(hash.matches(Regex("[a-f0-9]{64}"))) { "Atualize o AudioWhisper no PC para sincronizar o texto." }
    if (!response.optBoolean("has_more")) return response.put("segments", segments).put("online", true)
  }
  throw IllegalStateException("A transcrição mudou durante a leitura. O texto anterior foi preservado.")
}
