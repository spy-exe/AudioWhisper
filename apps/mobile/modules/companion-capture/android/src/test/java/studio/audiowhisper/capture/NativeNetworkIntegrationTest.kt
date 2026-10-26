package studio.audiowhisper.capture

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.net.URI

class NativeNetworkIntegrationTest {
  @get:Rule val temporary = TemporaryFolder()
  @Test fun nativeTransportReceivesLiveGpuTextBeforeTheRecordingEnds() {
    val origin = System.getProperty("aw.qa.url", "") ?: ""
    assumeTrue("Explicit isolated QA stack required", origin.isNotBlank())
    val uri = URI(origin)
    require(uri.scheme == "http" && uri.host in listOf("localhost", "127.0.0.1") && uri.port == 8090 && uri.path in listOf("", "/"))
    val transport = LocalHttp()
    val profile = JSONObject().put("url", origin).put("token", "")
    val health = transport.request(profile, "GET", "/api/health")
    require(health.optString("environment") == "e2e") { "Refusing a non-QA API before creating fixtures" }
    val server = transport.request(profile, "GET", "/api/companion")
    profile.put("id", server.getString("instance_id")).put("instance_id", server.getString("instance_id"))
      .put("defaults", server.getJSONObject("defaults").put("device", "cuda").put("compute_type", "float16"))
    val store = RecordingStore(temporary.newFolder())
    val session = store.create(JSONObject().put("title", "QA Mobile native transport").put("source", "microphone"), profile)
    val id = session.getString("id")
    val wav = File(requireNotNull(System.getProperty("aw.qa.wav"))).readBytes()
    require(String(wav.copyOfRange(0, 4)) == "RIFF")
    ChunkWriter(store, id).apply { write(wav.copyOfRange(44, wav.size)); close() }
    val delivery = LiveDelivery(store, transport) { profile }
    delivery.once()
    val after = store.read(id)
    assertTrue("Audio must be acknowledged while capture is still open", after.getInt("uploaded_chunks") > 0)
    val jobId = after.getString("job_id")
    val deadline = System.currentTimeMillis() + 180000
    var text = ""
    while (System.currentTimeMillis() < deadline) {
      val transcript = transport.request(profile, "GET", "/api/companion/captures/$jobId/transcript")
      val segments = transcript.getJSONArray("segments")
      if (segments.length() > 0) { text = segments.getJSONObject(0).getString("text"); break }
      Thread.sleep(1000)
    }
    assertTrue("Real GPU text must arrive before stop", text.isNotBlank())
    assertEquals("recording", store.read(id).getString("state"))
    store.update(id) { it.put("state", "stopped").put("retry_at", 0) }
    delivery.once()
    var completed = false
    while (System.currentTimeMillis() < deadline) {
      val job = transport.request(profile, "GET", "/api/jobs/$jobId")
      if (job.optString("status") == "completed") { assertEquals("cuda", job.getString("device")); completed = true; break }
      Thread.sleep(1000)
    }
    assertTrue("The same native capture must finalize in the GPU worker", completed)
    assertTrue("Local audio is never removed by acknowledgement", store.chunk(id, 0).isFile)
  }
}
