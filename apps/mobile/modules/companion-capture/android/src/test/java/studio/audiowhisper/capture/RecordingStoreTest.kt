package studio.audiowhisper.capture

import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.UUID

class RecordingStoreTest {
  @get:Rule val temporary = TemporaryFolder()
  private fun profile() = JSONObject().put("id", "pc").put("instance_id", "server").put("defaults", JSONObject()).put("url", "http://localhost:8090")
  private fun session(store: RecordingStore) = store.create(JSONObject().put("title", "Reunião sintética").put("source", "microphone"), profile()).getString("id")
  @Test fun chunksContainEverySampleAndUseValidPcmHeaders() {
    val store = RecordingStore(temporary.newFolder())
    val id = session(store)
    val bytes = ByteArray(CHUNK_BYTES + 3200) { (it % 127).toByte() }
    val writer = ChunkWriter(store, id)
    writer.write(bytes); writer.close()
    assertEquals(2, store.read(id).getInt("chunks"))
    assertEquals(bytes.size / 2L, store.read(id).getLong("frames"))
    val first = store.chunk(id, 0).readBytes()
    val last = store.chunk(id, 1).readBytes()
    assertArrayEquals(bytes, first.copyOfRange(44, first.size) + last.copyOfRange(44, last.size))
    val header = ByteBuffer.wrap(first).order(ByteOrder.LITTLE_ENDIAN)
    assertEquals(16000, header.getInt(24)); assertEquals(1, header.getShort(22).toInt())
    assertEquals(CHUNK_BYTES, header.getInt(40))
  }
  @Test fun restartFinalizesAPartialWithoutDuplicatingAnAlreadyCommittedChunk() {
    val root = temporary.newFolder()
    val store = RecordingStore(root)
    val id = session(store)
    val writer = ChunkWriter(store, id)
    writer.write(ByteArray(CHUNK_BYTES))
    val partial = File(store.directory(id), "000001.wav.part")
    RandomAccessFile(partial, "rw").use { it.write(wavHeader(0)); it.write(ByteArray(6400)); it.fd.sync() }
    // Simulate death after the first WAV rename but before its manifest update.
    store.update(id) { it.put("chunks", 0).put("frames", 0) }
    val recovered = RecordingStore(root)
    recovered.recover(); recovered.recover()
    assertEquals(2, recovered.read(id).getInt("chunks"))
    assertEquals((CHUNK_BYTES + 6400) / 2L, recovered.read(id).getLong("frames"))
    assertTrue(recovered.read(id).getBoolean("interrupted"))
    assertEquals("stopped", recovered.read(id).getString("state"))
  }
  @Test fun activeCaptureIsNeverRecoveredOrStoppedByAUiReload() {
    val store = RecordingStore(temporary.newFolder()); val id = session(store)
    store.recover(id)
    assertEquals("recording", store.read(id).getString("state"))
  }
  @Test fun damagedManifestsNeverHideRecordedAudio() {
    val store = RecordingStore(temporary.newFolder()); val id = session(store)
    ChunkWriter(store, id).apply { write(ByteArray(3200)); close() }
    File(store.directory(id), "session.json").writeText("damaged")
    val recovered = store.list().single()
    assertEquals(id, recovered.getString("id"))
    assertTrue(recovered.getBoolean("recovery_required"))
    assertTrue(store.chunk(id, 0).isFile)
    val exported = store.export(id, File(temporary.newFolder(), "recovered.wav"))
    assertEquals(3244L, exported.length())
    assertTrue(store.chunk(id, 0).isFile)
  }
  @Test fun acknowledgementLossRetriesTheSameChunkAndPreservesLocalAudio() {
    val store = RecordingStore(temporary.newFolder()); val id = session(store)
    ChunkWriter(store, id).apply { write(ByteArray(3200)); close() }
    store.update(id) { it.put("state", "stopped") }
    val jobId = UUID.randomUUID().toString()
    val attempts = mutableListOf<String>()
    var lost = false
    val transport = object : Transport {
      override fun request(connection: JSONObject, method: String, path: String, body: ByteArray?, contentType: String): JSONObject {
        attempts.add(path)
        return when {
          path == "/api/companion" -> JSONObject().put("service", "audiowhisper").put("protocol_version", 1).put("instance_id", "server")
          path == "/api/live" -> JSONObject().put("id", jobId)
          path.contains("/chunks/") -> { if (!lost) { lost = true; throw java.io.IOException("lost acknowledgement") }; JSONObject().put("status", "queued") }
          else -> JSONObject().put("status", "stopping")
        }
      }
    }
    val delivery = LiveDelivery(store, transport) { profile() }
    delivery.once()
    assertEquals(0, store.read(id).getInt("uploaded_chunks"))
    store.update(id) { it.put("retry_at", 0) }
    delivery.once()
    assertEquals(1, store.read(id).getInt("uploaded_chunks"))
    assertTrue(store.read(id).getBoolean("stop_sent"))
    assertEquals(1, attempts.count { it == "/api/live" })
    assertEquals(2, attempts.count { it.contains("/chunks/0?start=0") })
    assertTrue(store.chunk(id, 0).isFile)
  }
  @Test fun aDifferentPcCannotReceiveQueuedAudio() {
    val store = RecordingStore(temporary.newFolder()); val id = session(store)
    ChunkWriter(store, id).apply { write(ByteArray(3200)); close() }
    var posts = 0
    val transport = object : Transport {
      override fun request(connection: JSONObject, method: String, path: String, body: ByteArray?, contentType: String): JSONObject {
        if (method == "POST") posts++
        return JSONObject().put("service", "audiowhisper").put("protocol_version", 1).put("instance_id", "other-server")
      }
    }
    LiveDelivery(store, transport) { profile() }.once()
    assertEquals(0, posts)
    assertEquals(0, store.read(id).getInt("uploaded_chunks"))
    assertTrue(store.chunk(id, 0).isFile)
  }
  @Test fun serverUrlNeverContainsCredentialsOrUnrelatedPaths() {
    assertEquals("http://192.168.1.20:8080", normalizeServer("http://192.168.1.20:8080/"))
    for (url in listOf("http://user:password@pc.local", "file:///private", "http://pc.local/library", "http://pc.local?token=secret")) {
      try { normalizeServer(url); fail("Unsafe URL accepted") } catch (_: IllegalArgumentException) { }
    }
  }
}
