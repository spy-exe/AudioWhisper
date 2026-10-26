package studio.audiowhisper.capture

import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.RandomAccessFile
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.nio.file.Files
import java.nio.file.StandardCopyOption
import java.util.UUID

const val SAMPLE_RATE = 16000
const val CHUNK_BYTES = SAMPLE_RATE * 2 * 4

fun atomicJson(file: File, value: JSONObject) {
  file.parentFile!!.mkdirs()
  val temporary = File(file.parentFile, file.name + ".tmp")
  RandomAccessFile(temporary, "rw").use { out ->
    out.setLength(0)
    out.write(value.toString().toByteArray(Charsets.UTF_8))
    out.fd.sync()
  }
  Files.move(temporary.toPath(), file.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
}

fun wavHeader(bytes: Int): ByteArray = ByteBuffer.allocate(44).order(ByteOrder.LITTLE_ENDIAN).apply {
  put("RIFF".toByteArray()); putInt(bytes + 36); put("WAVEfmt ".toByteArray())
  putInt(16); putShort(1); putShort(1); putInt(SAMPLE_RATE); putInt(SAMPLE_RATE * 2)
  putShort(2); putShort(16); put("data".toByteArray()); putInt(bytes)
}.array()

class RecordingStore(val root: File) {
  init { root.mkdirs() }
  fun directory(id: String): File {
    require(UUID.fromString(id).toString() == id) { "Identificador de gravação inválido" }
    return File(root, id)
  }
  fun chunk(id: String, index: Int) = File(directory(id), "%06d.wav".format(index))
  @Synchronized fun read(id: String): JSONObject = JSONObject(File(directory(id), "session.json").readText())
  @Synchronized fun update(id: String, change: (JSONObject) -> Unit): JSONObject {
    val session = read(id)
    change(session)
    atomicJson(File(directory(id), "session.json"), session)
    return session
  }
  @Synchronized fun create(options: JSONObject, connection: JSONObject): JSONObject {
    val id = UUID.randomUUID().toString()
    val session = JSONObject().put("id", id).put("title", options.getString("title").take(500))
      .put("source", options.getString("source")).put("created_at", System.currentTimeMillis())
      .put("connection_id", connection.getString("id")).put("instance_id", connection.getString("instance_id"))
      .put("settings", connection.getJSONObject("defaults")).put("state", "recording")
      .put("frames", 0).put("chunks", 0).put("uploaded_chunks", 0).put("stop_sent", false)
      .put("job_id", JSONObject.NULL).put("error", JSONObject.NULL).put("interrupted", false)
    atomicJson(File(directory(id), "session.json"), session)
    return session
  }
  @Synchronized fun list(): List<JSONObject> = root.listFiles()?.filter { it.isDirectory && runCatching { UUID.fromString(it.name).toString() == it.name }.getOrDefault(false) }
    ?.map { folder -> try { read(folder.name) } catch (_: Exception) {
      val audio = folder.listFiles()?.filter { it.name.matches(Regex("[0-9]{6}\\.wav(\\.part)?")) } ?: emptyList()
      JSONObject().put("id", folder.name).put("title", "Gravação para recuperar").put("source", "unknown")
        .put("connection_id", "").put("instance_id", "").put("created_at", folder.lastModified())
        .put("state", "stopped").put("frames", audio.sumOf { (it.length() - 44).coerceAtLeast(0) / 2 })
        .put("chunks", audio.size).put("uploaded_chunks", 0).put("stop_sent", false).put("job_id", JSONObject.NULL)
        .put("interrupted", true).put("recovery_required", true)
        .put("error", "O controle local desta gravação está danificado. Compartilhe o áudio para recuperá-lo no Studio.")
    } }
    ?.sortedByDescending { it.optLong("created_at") } ?: emptyList()

  @Synchronized fun recover(except: String? = null) {
    for (session in list()) {
      val id = session.getString("id")
      if (session.optString("state") != "recording" || id == except) continue
      for (partial in directory(id).listFiles()?.filter { it.name.endsWith(".wav.part") } ?: emptyList()) {
        if (partial.length() >= 46) sealPartial(partial)
        else if (partial.length() == 44L) partial.delete()
      }
      reconcile(id)
      update(id) { it.put("state", "stopped").put("interrupted", true) }
    }
  }
  @Synchronized fun reconcile(id: String) {
    val chunks = directory(id).listFiles()?.filter { it.name.matches(Regex("[0-9]{6}\\.wav")) }?.sortedBy { it.name } ?: emptyList()
    var frames = 0L
    for ((index, file) in chunks.withIndex()) {
      require(file.name == "%06d.wav".format(index) && file.length() >= 46 && (file.length() - 44) % 2 == 0L) { "Trecho local incompleto. O arquivo foi preservado." }
      frames += (file.length() - 44) / 2
    }
    update(id) { it.put("frames", frames).put("chunks", chunks.size) }
  }
  fun snapshot(active: String?): String {
    val sessions = JSONArray()
    for (item in list()) {
      val id = item.getString("id")
      val part = File(directory(id), "%06d.wav.part".format(item.optInt("chunks")))
      item.put("duration", (item.optLong("frames") + ((part.length() - 44).coerceAtLeast(0) / 2)) / SAMPLE_RATE.toDouble())
      sessions.put(item)
    }
    return JSONObject().put("active_id", active ?: JSONObject.NULL).put("sessions", sessions).toString()
  }
  @Synchronized fun export(id: String, destination: File): File {
    val files = directory(id).listFiles()?.filter { it.name.matches(Regex("[0-9]{6}\\.wav(\\.part)?")) && it.length() > 44 }?.sortedBy { it.name } ?: emptyList()
    val total = files.sumOf { ((it.length() - 44) / 2) * 2 }
    require(total > 0) { "Não há áudio disponível nesta gravação." }
    destination.parentFile!!.mkdirs()
    require(destination.parentFile!!.usableSpace > total + 1024 * 1024) { "Libere espaço no aparelho para preparar a cópia do áudio." }
    val temporary = File(destination.parentFile, destination.name + ".tmp")
    RandomAccessFile(temporary, "rw").use { target ->
      target.setLength(0); target.write(wavHeader(total.toInt()))
      val buffer = ByteArray(65536)
      for (file in files) RandomAccessFile(file, "r").use { source ->
        source.seek(44)
        var remaining = ((source.length() - 44) / 2) * 2
        while (remaining > 0) { val count = source.read(buffer, 0, minOf(buffer.size.toLong(), remaining).toInt()); require(count > 0); target.write(buffer, 0, count); remaining -= count }
      }
      target.fd.sync()
    }
    Files.move(temporary.toPath(), destination.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE)
    return destination
  }
}

fun sealPartial(file: File) {
  val bytes = (file.length() - 44).toInt()
  require(bytes > 0 && bytes % 2 == 0) { "Trecho de áudio incompleto" }
  RandomAccessFile(file, "rw").use { out -> out.seek(0); out.write(wavHeader(bytes)); out.fd.sync() }
  Files.move(file.toPath(), File(file.parentFile, file.name.removeSuffix(".part")).toPath(), StandardCopyOption.ATOMIC_MOVE)
}

class ChunkWriter(private val store: RecordingStore, private val id: String, private val onChunk: () -> Unit = {}) {
  private var index = store.read(id).optInt("chunks")
  private var output: RandomAccessFile? = null
  private var size = 0
  private var sinceSync = 0
  val chunkCount get() = index
  private fun part() = File(store.directory(id), "%06d.wav.part".format(index))
  fun write(bytes: ByteArray, length: Int = bytes.size) {
    require(length in 0..bytes.size && length % 2 == 0)
    var offset = 0
    while (offset < length) {
      if (output == null) {
        output = RandomAccessFile(part(), "rw").also { it.setLength(0); it.write(wavHeader(0)); it.fd.sync() }
        size = 0
      }
      val count = minOf(CHUNK_BYTES - size, length - offset)
      output!!.write(bytes, offset, count)
      offset += count; size += count; sinceSync += count
      if (sinceSync >= SAMPLE_RATE * 2) { output!!.fd.sync(); sinceSync = 0 }
      if (size == CHUNK_BYTES) seal()
    }
  }
  private fun seal() {
    output?.let { it.fd.sync(); it.close() }; output = null
    if (size > 0) {
      sealPartial(part())
      val frames = size / 2
      store.update(id) { it.put("chunks", index + 1).put("frames", it.optLong("frames") + frames) }
      index++; size = 0; sinceSync = 0
      onChunk()
    }
  }
  fun close() { if (output != null) seal() }
}
