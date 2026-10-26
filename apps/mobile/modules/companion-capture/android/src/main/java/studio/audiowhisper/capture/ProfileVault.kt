package studio.audiowhisper.capture

import android.content.Context
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.security.KeyStore
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

class ProfileVault(context: Context) {
  private val file = File(context.noBackupFilesDir, "companion-connections.bin")
  private fun key(): SecretKey {
    val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
    val existing = keyStore.getKey("audiowhisper-connections", null) as? SecretKey
    return existing ?: KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore").run {
      init(KeyGenParameterSpec.Builder("audiowhisper-connections", KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
        .setBlockModes(KeyProperties.BLOCK_MODE_GCM).setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE).build())
      generateKey()
    }
  }
  @Synchronized private fun all(): JSONObject {
    if (!file.exists()) return JSONObject().put("profiles", JSONObject())
    val bytes = file.readBytes()
    require(bytes.size > 28) { "As conexões salvas estão indisponíveis. Seus áudios foram preservados." }
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, bytes.copyOfRange(0, 12)))
    return JSONObject(String(cipher.doFinal(bytes.copyOfRange(12, bytes.size)), Charsets.UTF_8))
  }
  @Synchronized fun get(id: String): JSONObject? = all().getJSONObject("profiles").optJSONObject(id)
  @Synchronized fun save(profile: JSONObject) {
    val state = all()
    state.getJSONObject("profiles").put(profile.getString("id"), profile)
    state.put("current", profile.getString("id"))
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, key())
    val temporary = File(file.parentFile, file.name + ".tmp")
    java.io.FileOutputStream(temporary).use { out ->
      out.write(cipher.iv); out.write(cipher.doFinal(state.toString().toByteArray(Charsets.UTF_8))); out.fd.sync()
    }
    java.nio.file.Files.move(temporary.toPath(), file.toPath(), java.nio.file.StandardCopyOption.REPLACE_EXISTING, java.nio.file.StandardCopyOption.ATOMIC_MOVE)
  }
  @Synchronized fun publicState(): String {
    val state = all()
    val profiles = state.getJSONObject("profiles")
    val result = JSONArray()
    for (id in profiles.keys()) {
      val item = JSONObject(profiles.getJSONObject(id).toString())
      item.remove("token"); result.put(item)
    }
    return JSONObject().put("current", state.optString("current")).put("profiles", result).toString()
  }
}
