package studio.audiowhisper.capture

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.ExistingWorkPolicy
import androidx.work.OneTimeWorkRequestBuilder
import androidx.work.WorkManager
import androidx.work.Worker
import androidx.work.WorkerParameters
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class CompanionEngine private constructor(private val context: Context) {
  val store = RecordingStore(File(context.filesDir, "audiowhisper/recordings"))
  val vault = ProfileVault(context)
  private val transport = LocalHttp()
  private val delivery = LiveDelivery(store, transport) { vault.get(it) }
  private val executor = Executors.newSingleThreadScheduledExecutor()
  init {
    store.recover(CaptureService.activeId)
    executor.scheduleWithFixedDelay({ try { delivery.once() } catch (_: Exception) { /* Durable files remain available. */ } }, 1, 2, TimeUnit.SECONDS)
  }
  fun sync() {
    for (item in store.list().filter { !it.optBoolean("recovery_required") }) store.update(item.getString("id")) { it.put("retry_at", 0) }
    executor.execute { delivery.once() }
    scheduleBackground()
  }
  fun scheduleBackground() {
    val request = OneTimeWorkRequestBuilder<UploadWorker>().setBackoffCriteria(BackoffPolicy.EXPONENTIAL, 10, TimeUnit.SECONDS).build()
    WorkManager.getInstance(context).enqueueUniqueWork("audiowhisper-delivery", ExistingWorkPolicy.KEEP, request)
  }
  fun deliver(): Boolean {
    delivery.once()
    return store.list().any { it.optInt("chunks") > 0 && (it.optInt("uploaded_chunks") < it.optInt("chunks") || (it.optString("state") == "stopped" && !it.optBoolean("stop_sent"))) }
  }
  fun connect(raw: String): String {
    val options = JSONObject(raw)
    val connection = JSONObject().put("url", normalizeServer(options.getString("url"))).put("token", options.optString("token"))
    val response = transport.request(connection, "GET", "/api/companion")
    require(response.optString("service") == "audiowhisper" && response.optInt("protocol_version") == 1) { "Este endereço não oferece o protocolo do AudioWhisper Mobile." }
    val id = java.util.UUID.fromString(response.getString("instance_id")).toString()
    connection.put("id", id).put("instance_id", id).put("name", options.optString("name").ifBlank { "Meu PC" })
      .put("defaults", response.getJSONObject("defaults"))
    vault.save(connection)
    sync()
    return vault.publicState()
  }
  fun cachedTranscript(id: String): JSONObject {
    val file = File(store.directory(id), "transcript.json")
    return try { JSONObject(file.readText()) } catch (_: Exception) { JSONObject().put("segments", JSONArray()).put("status", "local") }
  }
  @Synchronized fun transcript(id: String): String {
    val session = store.read(id)
    val cache = File(store.directory(id), "transcript.json")
    val previous = cachedTranscript(id)
    try {
      val connection = vault.get(session.getString("connection_id")) ?: throw IllegalStateException()
      val jobId = session.optString("job_id")
      if (jobId.isEmpty() || jobId == "null") return previous.put("online", false).toString()
      val response = refreshTranscript(transport, connection, jobId, previous)
      atomicJson(cache, response)
      store.update(id) { it.put("remote_status", response.getString("status")) }
      return response.toString()
    } catch (_: Exception) { return previous.put("online", false).toString() }
  }
  companion object {
    @Volatile private var singleton: CompanionEngine? = null
    fun get(context: Context): CompanionEngine = singleton ?: synchronized(this) {
      singleton ?: CompanionEngine(context.applicationContext).also { singleton = it }
    }
  }
}

class UploadWorker(context: Context, params: WorkerParameters) : Worker(context, params) {
  override fun doWork(): Result = try {
    if (CompanionEngine.get(applicationContext).deliver()) Result.retry() else Result.success()
  } catch (_: Exception) { Result.retry() }
}
