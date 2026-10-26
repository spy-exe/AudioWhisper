package studio.audiowhisper.capture

import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import java.io.IOException

class TranscriptSyncTest {
  private fun page(hash: Char, more: Boolean, reset: Boolean = false, vararg indices: Int) = JSONObject()
    .put("prefix_hash", hash.toString().repeat(64)).put("has_more", more).put("reset", reset).put("status", "transcribing")
    .put("segments", JSONArray(indices.map { JSONObject().put("segment_index", it).put("text", "Fala $it") }))

  @Test fun lateSegmentsReplaceTheCacheOnlyAfterAllPagesArrive() {
    val cached = page('a', false, false, 0, 2)
    var requests = 0
    val transport = object : Transport {
      override fun request(connection: JSONObject, method: String, path: String, body: ByteArray?, contentType: String): JSONObject {
        requests++
        if (requests == 1) { assertTrue(path.contains("after_index=2")); return page('b', true, true, 0, 1) }
        assertTrue(path.contains("after_index=1")); assertTrue(path.contains("known_hash=" + "b".repeat(64)))
        return page('c', false, false, 2)
      }
    }
    val result = refreshTranscript(transport, JSONObject(), "job", cached)
    assertEquals(listOf(0, 1, 2), (0 until result.getJSONArray("segments").length()).map { result.getJSONArray("segments").getJSONObject(it).getInt("segment_index") })
    assertEquals(2, cached.getJSONArray("segments").length())
    assertEquals("a".repeat(64), cached.getString("prefix_hash"))
  }

  @Test fun aFailedSecondPageNeverMutatesPreviouslyConfirmedText() {
    val cached = page('a', false, false, 0, 2)
    val before = cached.toString()
    var requests = 0
    val transport = object : Transport {
      override fun request(connection: JSONObject, method: String, path: String, body: ByteArray?, contentType: String): JSONObject {
        if (++requests == 1) return page('b', true, true, 0, 1)
        throw IOException("network lost")
      }
    }
    try { refreshTranscript(transport, JSONObject(), "job", cached); fail("Partial refresh was published") } catch (_: IOException) { }
    assertEquals(before, cached.toString())
  }
}
