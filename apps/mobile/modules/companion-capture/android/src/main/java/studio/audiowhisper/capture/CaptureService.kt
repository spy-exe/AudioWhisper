package studio.audiowhisper.capture

import android.app.*
import android.content.Intent
import android.content.pm.ServiceInfo
import android.media.*
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.*
import org.json.JSONObject
import java.nio.ByteBuffer
import java.nio.ByteOrder
import java.util.concurrent.atomic.AtomicBoolean
import kotlin.math.sqrt

class CaptureService : Service() {
  private val running = AtomicBoolean(false)
  private var mic: AudioRecord? = null
  private var playback: AudioRecord? = null
  private var projection: MediaProjection? = null
  private var wakeLock: PowerManager.WakeLock? = null
  private var stopNotice: String? = null
  override fun onBind(intent: Intent?) = null
  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    if (intent?.action == "stop") { stopCapture(); return START_NOT_STICKY }
    val id = intent?.getStringExtra("id") ?: return START_NOT_STICKY
    if (!running.compareAndSet(false, true)) return START_NOT_STICKY
    active = this; activeId = id
    val engine = CompanionEngine.get(this)
    val session = engine.store.read(id)
    val source = session.getString("source")
    val manager = getSystemService(NotificationManager::class.java)
    manager.createNotificationChannel(NotificationChannel("recording", "Gravação de áudio", NotificationManager.IMPORTANCE_LOW))
    val stop = PendingIntent.getService(this, 1, Intent(this, CaptureService::class.java).setAction("stop"), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    val launch = packageManager.getLaunchIntentForPackage(packageName)
    val notification = Notification.Builder(this, "recording").setSmallIcon(R.drawable.ic_aw_recording)
      .setContentTitle("AudioWhisper gravando").setContentText("Áudio protegido no aparelho. Toque para acompanhar a transcrição.")
      .setOngoing(true).setOnlyAlertOnce(true).setVisibility(Notification.VISIBILITY_PRIVATE)
      .setUsesChronometer(true).setWhen(System.currentTimeMillis())
      .addAction(Notification.Action.Builder(null, "Encerrar gravação", stop).build())
      .apply { if (launch != null) setContentIntent(PendingIntent.getActivity(this@CaptureService, 2, launch, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)) }.build()
    var type = if (source == "microphone") 0 else ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PROJECTION
    if (source != "system" && Build.VERSION.SDK_INT >= 30) type = type or ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE
    try {
      startForeground(4421, notification, type)
      wakeLock = (getSystemService(POWER_SERVICE) as PowerManager).newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "AudioWhisper:Capture").apply { acquire(24 * 60 * 60 * 1000L) }
      Thread({ capture(id, source, intent, engine) }, "AudioWhisper-capture").start()
    } catch (_: Exception) {
      running.set(false); active = null; activeId = null
      engine.store.update(id) { it.put("state", "stopped").put("capture_notice", "O sistema não autorizou a gravação em segundo plano. Confira as permissões e tente com o app aberto.") }
      wakeLock?.takeIf { it.isHeld }?.release()
      stopSelf()
    }
    return START_NOT_STICKY
  }
  private fun recorder(system: Boolean): AudioRecord {
    val minimum = AudioRecord.getMinBufferSize(SAMPLE_RATE, AudioFormat.CHANNEL_IN_MONO, AudioFormat.ENCODING_PCM_16BIT)
    require(minimum > 0) { "Este aparelho não oferece a entrada de áudio solicitada." }
    val builder = AudioRecord.Builder().setAudioFormat(AudioFormat.Builder().setSampleRate(SAMPLE_RATE)
      .setChannelMask(AudioFormat.CHANNEL_IN_MONO).setEncoding(AudioFormat.ENCODING_PCM_16BIT).build())
      .setBufferSizeInBytes(maxOf(minimum * 2, 16000))
    if (system) {
      val configuration = AudioPlaybackCaptureConfiguration.Builder(projection!!)
        .addMatchingUsage(AudioAttributes.USAGE_MEDIA).addMatchingUsage(AudioAttributes.USAGE_GAME)
        .addMatchingUsage(AudioAttributes.USAGE_UNKNOWN).build()
      builder.setAudioPlaybackCaptureConfig(configuration)
    } else builder.setAudioSource(MediaRecorder.AudioSource.VOICE_RECOGNITION)
    return builder.build().also { require(it.state == AudioRecord.STATE_INITIALIZED) { "Não foi possível abrir o áudio. Confira a permissão e outros gravadores." } }
  }
  @Suppress("DEPRECATION")
  private fun capture(id: String, source: String, intent: Intent, engine: CompanionEngine) {
    val writer = ChunkWriter(engine.store, id) { engine.sync() }
    var error: String? = null
    try {
      if (source != "microphone") {
        val consent: Intent = if (Build.VERSION.SDK_INT >= 33) intent.getParcelableExtra("consent", Intent::class.java)!! else intent.getParcelableExtra("consent")!!
        projection = getSystemService(MediaProjectionManager::class.java).getMediaProjection(Activity.RESULT_OK, consent)
        projection!!.registerCallback(object : MediaProjection.Callback() {
          override fun onStop() { if (running.get()) { stopNotice = "A captura de áudio dos aplicativos foi encerrada pelo sistema."; stopCapture() } }
        }, Handler(Looper.getMainLooper()))
        playback = recorder(true)
      }
      if (source != "system") mic = recorder(false)
      mic?.startRecording(); playback?.startRecording()
      val microphone = ShortArray(1600)
      val system = ShortArray(1600)
      while (running.get()) {
        val micCount = mic?.read(microphone, 0, microphone.size, AudioRecord.READ_BLOCKING) ?: 0
        val systemCount = playback?.read(system, 0, system.size, AudioRecord.READ_BLOCKING) ?: 0
        if (!running.get()) break
        require(micCount >= 0 && systemCount >= 0) { "A entrada de áudio foi interrompida. O áudio já capturado foi preservado." }
        val count = maxOf(micCount, systemCount)
        if (count == 0) { Thread.sleep(20); continue }
        val bytes = ByteBuffer.allocate(count * 2).order(ByteOrder.LITTLE_ENDIAN)
        var square = 0.0
        for (index in 0 until count) {
          val a = if (index < micCount) microphone[index].toInt() else 0
          val b = if (index < systemCount) system[index].toInt() else 0
          val value = (if (source == "mixed") (a + b) / 2 else a + b).coerceIn(-32768, 32767)
          bytes.putShort(value.toShort()); square += value.toDouble() * value
        }
        level = (sqrt(square / count) / 6000.0).coerceIn(0.0, 1.0)
        writer.write(bytes.array())
        if (writer.chunkCount >= 20000) { stopNotice = "Limite de duração desta captura atingido."; running.set(false) }
      }
    } catch (exception: Exception) {
      error = if (exception is IllegalArgumentException) exception.message else "A gravação foi interrompida. Os trechos já capturados continuam salvos."
    } finally {
      running.set(false)
      for (record in listOf(mic, playback)) { try { record?.stop() } catch (_: Exception) {}; record?.release() }
      try { writer.close() } catch (_: Exception) { error = "Não foi possível finalizar o último trecho. Os arquivos foram preservados para recuperação." }
      try { engine.store.update(id) { it.put("state", "stopped").put("capture_notice", error ?: stopNotice ?: JSONObject.NULL) } } catch (_: Exception) { }
      try { projection?.stop() } catch (_: Exception) { }
      activeId = null; active = null; level = 0.0
      try { wakeLock?.takeIf { it.isHeld }?.release() } catch (_: Exception) { }
      engine.sync()
      stopForeground(STOP_FOREGROUND_REMOVE); stopSelf()
    }
  }
  fun stopCapture() {
    running.set(false)
    try { mic?.stop() } catch (_: Exception) { }
    try { playback?.stop() } catch (_: Exception) { }
  }
  override fun onDestroy() { stopCapture(); super.onDestroy() }
  companion object {
    @Volatile var activeId: String? = null
    @Volatile var active: CaptureService? = null
    @Volatile var level: Double = 0.0
  }
}
