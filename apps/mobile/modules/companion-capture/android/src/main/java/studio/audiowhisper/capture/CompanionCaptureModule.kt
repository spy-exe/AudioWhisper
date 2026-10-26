package studio.audiowhisper.capture

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import expo.modules.kotlin.Promise
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject

class CompanionCaptureModule : Module() {
  private val io = java.util.concurrent.Executors.newFixedThreadPool(2)
  private val context get() = appContext.reactContext ?: throw IllegalStateException("Aplicativo indisponível")
  private val engine get() = CompanionEngine.get(context)
  private var pending: Pair<JSONObject, Promise>? = null
  override fun definition() = ModuleDefinition {
    Name("CompanionCapture")
    OnCreate { CompanionEngine.get(context) }
    AsyncFunction("connections") { engine.vault.publicState() }
    AsyncFunction("connect") { options: String, promise: Promise ->
      io.execute {
        try { promise.resolve(engine.connect(options)) }
        catch (error: Exception) { promise.reject("CONNECTION_FAILED", if (error is IllegalArgumentException || error.message?.startsWith("O token") == true) error.message else "Não foi possível alcançar o PC. Confira o endereço, a rede local ou VPN e o firewall.", null) }
      }
    }
    AsyncFunction("snapshot") {
      JSONObject(engine.store.snapshot(CaptureService.activeId)).put("level", CaptureService.level).toString()
    }
    AsyncFunction("cachedTranscript") { id: String -> engine.cachedTranscript(id).put("online", false).toString() }
    AsyncFunction("transcript") { id: String, promise: Promise ->
      io.execute { try { promise.resolve(engine.transcript(id)) } catch (error: Exception) { promise.reject("TRANSCRIPT_READ", error.message, null) } }
    }
    AsyncFunction("sync") { engine.sync() }
    AsyncFunction("exportAudio") { id: String, promise: Promise ->
      io.execute {
        try {
          require(id != CaptureService.activeId) { "Encerre a gravação antes de preparar uma cópia." }
          promise.resolve(android.net.Uri.fromFile(engine.store.export(id, java.io.File(context.cacheDir, "exports/$id.wav"))).toString())
        } catch (error: Exception) { promise.reject("EXPORT_AUDIO", error.message, null) }
      }
    }
    AsyncFunction("start") { raw: String, promise: Promise ->
      try {
        require(CaptureService.activeId == null && pending == null) { "Já existe uma gravação em andamento." }
        val options = JSONObject(raw)
        require(options.getString("source") in listOf("microphone", "system", "mixed")) { "Fonte de áudio inválida" }
        require(options.getString("title").isNotBlank()) { "Informe um título para a gravação." }
        require(engine.vault.get(options.getString("connection_id")) != null) { "Conecte o PC antes de gravar." }
        val activity = appContext.currentActivity ?: throw IllegalStateException("Abra o aplicativo para iniciar a gravação.")
        if (options.getString("source") == "microphone") begin(options, promise, null)
        else {
          pending = Pair(options, promise)
          val manager = activity.getSystemService(MediaProjectionManager::class.java)
          @Suppress("DEPRECATION")
          activity.startActivityForResult(manager.createScreenCaptureIntent(), 4422)
        }
      } catch (error: Exception) { pending = null; promise.reject("CAPTURE_START", error.message, null) }
    }.runOnQueue(Queues.MAIN)
    OnActivityResult { _, result ->
      if (result.requestCode == 4422) {
        val request = pending
        pending = null
        if (request != null) {
          if (result.resultCode == Activity.RESULT_OK && result.data != null) begin(request.first, request.second, result.data)
          else request.second.reject("CAPTURE_CANCELLED", "A captura de áudio dos aplicativos não foi autorizada.", null)
        }
      }
    }
    AsyncFunction("stop") {
      if (CaptureService.active != null) CaptureService.active?.stopCapture()
      else if (CaptureService.activeId != null) context.startService(Intent(context, CaptureService::class.java).setAction("stop"))
      Unit
    }
    OnDestroy { pending?.second?.reject("CAPTURE_CANCELLED", "A solicitação foi encerrada.", null); pending = null; io.shutdown() }
  }
  private fun begin(options: JSONObject, promise: Promise, consent: Intent?) {
    try {
      val connection = engine.vault.get(options.getString("connection_id"))!!
      val session = engine.store.create(options, connection)
      val intent = Intent(context, CaptureService::class.java).putExtra("id", session.getString("id"))
      if (consent != null) intent.putExtra("consent", consent)
      CaptureService.activeId = session.getString("id")
      context.startForegroundService(intent)
      promise.resolve(session.toString())
    } catch (error: Exception) { CaptureService.activeId = null; engine.store.recover(); promise.reject("CAPTURE_START", "Não foi possível iniciar a gravação. Confira as permissões de áudio.", null) }
  }
}
