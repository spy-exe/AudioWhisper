import ExpoModulesCore
import AVFoundation
import Security
import UIKit

private typealias Object = [String: Any]
private let rate = 16000
private let chunkBytes = rate * 2 * 4

private func failure(_ message: String) -> NSError {
  NSError(domain: "AudioWhisper", code: 1, userInfo: [NSLocalizedDescriptionKey: message])
}
private func json(_ object: Any) throws -> String { String(data: try JSONSerialization.data(withJSONObject: object), encoding: .utf8)! }
private func object(_ raw: String) throws -> Object {
  guard let result = try JSONSerialization.jsonObject(with: Data(raw.utf8)) as? Object else { throw failure("Dados de gravação inválidos.") }
  return result
}
private func waveHeader(_ bytes: Int) -> Data {
  var result = Data("RIFF".utf8)
  func u32(_ value: Int) { var word = UInt32(truncatingIfNeeded: value).littleEndian; withUnsafeBytes(of: &word) { result.append(contentsOf: $0) } }
  func u16(_ value: UInt16) { var word = value.littleEndian; withUnsafeBytes(of: &word) { result.append(contentsOf: $0) } }
  u32(bytes + 36); result.append(Data("WAVEfmt ".utf8)); u32(16); u16(1); u16(1)
  u32(rate); u32(rate * 2); u16(2); u16(16); result.append(Data("data".utf8)); u32(bytes)
  return result
}

private final class Journal {
  let root: URL
  private let lock = NSRecursiveLock()
  init() throws {
    root = FileManager.default.urls(for: .documentDirectory, in: .userDomainMask)[0].appendingPathComponent("AudioWhisper", isDirectory: true)
    try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true, attributes: [.protectionKey: FileProtectionType.completeUntilFirstUserAuthentication])
    var url = root; var values = URLResourceValues(); values.isExcludedFromBackup = true; try url.setResourceValues(values)
  }
  func folder(_ id: String) throws -> URL {
    guard UUID(uuidString: id) != nil else { throw failure("Identificador de gravação inválido.") }
    return root.appendingPathComponent(id, isDirectory: true)
  }
  func read(_ id: String) throws -> Object {
    lock.lock(); defer { lock.unlock() }
    return try object(String(contentsOf: folder(id).appendingPathComponent("session.json"), encoding: .utf8))
  }
  func write(_ id: String, _ value: Object) throws {
    lock.lock(); defer { lock.unlock() }
    let directory = try folder(id)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    try Data(json(value).utf8).write(to: directory.appendingPathComponent("session.json"), options: .atomic)
  }
  @discardableResult func update(_ id: String, _ change: (inout Object) -> Void) throws -> Object {
    lock.lock(); defer { lock.unlock() }
    var value = try read(id); change(&value); try write(id, value); return value
  }
  func list() -> [Object] {
    lock.lock(); defer { lock.unlock() }
    return ((try? FileManager.default.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)) ?? [])
      .compactMap { folder -> Object? in
        let id = folder.lastPathComponent
        guard UUID(uuidString: id) != nil else { return nil }
        if let value = try? read(id) { return value }
        let files = ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []).filter { $0.lastPathComponent.range(of: "^[0-9]{6}\\.wav(\\.part)?$", options: .regularExpression) != nil }
        let frames = files.reduce(0) { sum, file in
          let size = ((try? FileManager.default.attributesOfItem(atPath: file.path)[.size]) as? NSNumber)?.intValue ?? 0
          return sum + max(0, size - 44) / 2
        }
        return ["id": id, "title": "Gravação para recuperar", "source": "unknown", "created_at": 0,
          "connection_id": "", "instance_id": "", "state": "stopped", "frames": frames, "chunks": files.count,
          "uploaded_chunks": 0, "stop_sent": false, "job_id": NSNull(), "interrupted": true, "recovery_required": true,
          "error": "O controle local desta gravação está danificado. Compartilhe o áudio para recuperá-lo no Studio."]
      }.sorted { ($0["created_at"] as? Double ?? 0) > ($1["created_at"] as? Double ?? 0) }
  }
  func create(_ options: Object, _ profile: Object) throws -> Object {
    let id = UUID().uuidString.lowercased()
    let value: Object = ["id": id, "title": options["title"]!, "source": "microphone", "created_at": Date().timeIntervalSince1970 * 1000,
      "connection_id": profile["id"]!, "instance_id": profile["instance_id"]!, "settings": profile["defaults"]!,
      "state": "recording", "frames": 0, "chunks": 0, "uploaded_chunks": 0, "stop_sent": false, "job_id": NSNull(), "error": NSNull(), "interrupted": false]
    try write(id, value); return value
  }
  func chunk(_ id: String, _ index: Int) throws -> URL { try folder(id).appendingPathComponent(String(format: "%06d.wav", index)) }
  func seal(_ partial: URL) throws {
    let length = ((try FileManager.default.attributesOfItem(atPath: partial.path)[.size]) as? NSNumber)?.intValue ?? 0
    guard length > 44 && (length - 44) % 2 == 0 else { throw failure("O último trecho ficou incompleto e foi preservado.") }
    let out = try FileHandle(forUpdating: partial); try out.seek(toOffset: 0); try out.write(contentsOf: waveHeader(length - 44)); try out.synchronize(); try out.close()
    try FileManager.default.moveItem(at: partial, to: partial.deletingPathExtension())
  }
  func recover() throws {
    for value in list() where value["state"] as? String == "recording" {
      let id = value["id"] as! String
      let directory = try folder(id)
      for file in try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil) where file.lastPathComponent.hasSuffix(".wav.part") {
        let size = ((try FileManager.default.attributesOfItem(atPath: file.path)[.size]) as? NSNumber)?.intValue ?? 0
        if size > 44 { try seal(file) } else if size == 44 { try FileManager.default.removeItem(at: file) }
      }
      let files = try FileManager.default.contentsOfDirectory(at: directory, includingPropertiesForKeys: nil).filter { $0.pathExtension == "wav" }.sorted { $0.lastPathComponent < $1.lastPathComponent }
      var frames = 0
      for (index, file) in files.enumerated() {
        guard file.lastPathComponent == String(format: "%06d.wav", index) else { throw failure("A sequência local precisa de recuperação. Os arquivos foram preservados.") }
        let size = ((try FileManager.default.attributesOfItem(atPath: file.path)[.size]) as? NSNumber)?.intValue ?? 0
        frames += max(0, size - 44) / 2
      }
      try update(id) { $0["chunks"] = files.count; $0["frames"] = frames; $0["state"] = "stopped"; $0["interrupted"] = true }
    }
  }
  func exportAudio(_ id: String) throws -> String {
    lock.lock(); defer { lock.unlock() }
    let files = try FileManager.default.contentsOfDirectory(at: folder(id), includingPropertiesForKeys: nil)
      .filter { $0.lastPathComponent.range(of: "^[0-9]{6}\\.wav(\\.part)?$", options: .regularExpression) != nil }
      .sorted { $0.lastPathComponent < $1.lastPathComponent }
    let sizes = try files.map { file -> Int in
      let bytes = ((try FileManager.default.attributesOfItem(atPath: file.path)[.size]) as? NSNumber)?.intValue ?? 0
      return max(0, bytes - 44) / 2 * 2
    }
    let total = sizes.reduce(0, +)
    guard total > 0 else { throw failure("Não há áudio disponível nesta gravação.") }
    let target = FileManager.default.temporaryDirectory.appendingPathComponent(id + ".wav")
    let temporary = target.appendingPathExtension("tmp")
    try Data().write(to: temporary)
    let output = try FileHandle(forWritingTo: temporary)
    defer { try? output.close() }
    try output.write(contentsOf: waveHeader(total))
    for (file, count) in zip(files, sizes) where count > 0 {
      let input = try FileHandle(forReadingFrom: file)
      defer { try? input.close() }
      try input.seek(toOffset: 44)
      var remaining = count
      while remaining > 0 {
        guard let bytes = try input.read(upToCount: min(65536, remaining)), !bytes.isEmpty else { throw failure("Um trecho não pôde ser lido. Os arquivos originais foram preservados.") }
        try output.write(contentsOf: bytes); remaining -= bytes.count
      }
    }
    try output.synchronize(); try output.close()
    if FileManager.default.fileExists(atPath: target.path) { _ = try FileManager.default.replaceItemAt(target, withItemAt: temporary) }
    else { try FileManager.default.moveItem(at: temporary, to: target) }
    return target.absoluteString
  }
}

private final class KeychainProfiles {
  private let lock = NSRecursiveLock()
  private var query: Object { [kSecClass as String: kSecClassGenericPassword, kSecAttrService as String: "studio.audiowhisper.connections", kSecAttrAccount as String: "profiles"] }
  func all() throws -> Object {
    lock.lock(); defer { lock.unlock() }
    var request = query; request[kSecReturnData as String] = true
    var result: CFTypeRef?
    let status = SecItemCopyMatching(request as CFDictionary, &result)
    if status == errSecItemNotFound { return ["profiles": Object()] }
    guard status == errSecSuccess, let data = result as? Data else { throw failure("Desbloqueie o aparelho para acessar a conexão salva.") }
    return try object(String(data: data, encoding: .utf8)!)
  }
  func get(_ id: String) throws -> Object? { try (all()["profiles"] as? Object)?[id] as? Object }
  func save(_ profile: Object) throws {
    lock.lock(); defer { lock.unlock() }
    var state = try all(); var profiles = state["profiles"] as? Object ?? [:]
    let id = profile["id"] as! String; profiles[id] = profile; state["profiles"] = profiles; state["current"] = id
    let data = try JSONSerialization.data(withJSONObject: state)
    let status = SecItemUpdate(query as CFDictionary, [kSecValueData as String: data] as CFDictionary)
    if status == errSecItemNotFound {
      var item = query; item[kSecValueData as String] = data; item[kSecAttrAccessible as String] = kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly
      guard SecItemAdd(item as CFDictionary, nil) == errSecSuccess else { throw failure("Não foi possível guardar a conexão com segurança.") }
    } else if status != errSecSuccess { throw failure("Não foi possível atualizar a conexão salva.") }
  }
  func publicState() throws -> String {
    let state = try all()
    let profiles = (state["profiles"] as? Object ?? [:]).values.compactMap { item -> Object? in
      guard var value = item as? Object else { return nil }; value.removeValue(forKey: "token"); return value
    }
    return try json(["current": state["current"] ?? "", "profiles": profiles])
  }
}

private final class NoRedirects: NSObject, URLSessionTaskDelegate {
  func urlSession(_ session: URLSession, task: URLSessionTask, willPerformHTTPRedirection response: HTTPURLResponse,
                  newRequest request: URLRequest, completionHandler: @escaping (URLRequest?) -> Void) { completionHandler(nil) }
}
private final class LocalTransport {
  private let session = URLSession(configuration: .ephemeral, delegate: NoRedirects(), delegateQueue: nil)
  func normalize(_ value: String) throws -> String {
    guard let url = URLComponents(string: value.trimmingCharacters(in: .whitespacesAndNewlines)),
      ["http", "https"].contains(url.scheme ?? ""), !(url.host ?? "").isEmpty,
      url.user == nil, url.password == nil, url.query == nil, url.fragment == nil, ["", "/"].contains(url.path) else {
      throw failure("Use somente o endereço HTTP ou HTTPS do PC, sem caminho ou senha.")
    }
    return url.string!.hasSuffix("/") ? String(url.string!.dropLast()) : url.string!
  }
  func request(_ profile: Object, _ method: String, _ path: String, _ body: Data? = nil, _ contentType: String = "application/json") throws -> Object {
    let origin = try normalize(profile["url"] as! String)
    guard let url = URL(string: origin + path) else { throw failure("Endereço do PC inválido.") }
    var request = URLRequest(url: url); request.httpMethod = method; request.timeoutInterval = 20
    request.httpBody = body; request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    if let token = profile["token"] as? String, !token.isEmpty { request.setValue(token, forHTTPHeaderField: "X-Access-Token") }
    let semaphore = DispatchSemaphore(value: 0)
    var result: Result<Object, Error> = .failure(failure("Sem conexão com o PC. O áudio continua salvo no celular."))
    let task = session.dataTask(with: request) { data, response, error in
      defer { semaphore.signal() }
      guard error == nil, let http = response as? HTTPURLResponse, let data = data else { return }
      guard (200..<300).contains(http.statusCode) else {
        result = .failure(failure(http.statusCode == 401 ? "O token do PC foi recusado. Confira a conexão." : "O PC não confirmou o envio. O áudio continua salvo.")); return
      }
      do {
        guard let value = try JSONSerialization.jsonObject(with: data) as? Object else { throw failure("Resposta do PC inválida.") }
        result = .success(value)
      } catch { result = .failure(error) }
    }
    task.resume()
    if semaphore.wait(timeout: .now() + 25) == .timedOut { task.cancel(); throw failure("Sem conexão com o PC. O áudio continua salvo no celular.") }
    return try result.get()
  }
}

private final class PcmWriter {
  private let journal: Journal
  private let id: String
  private var index = 0
  private var size = 0
  private var sinceSync = 0
  private var handle: FileHandle?
  private var partial: URL?
  init(_ journal: Journal, _ id: String) { self.journal = journal; self.id = id }
  func append(_ data: Data) throws {
    var cursor = 0
    while cursor < data.count {
      if handle == nil {
        let file = try journal.folder(id).appendingPathComponent(String(format: "%06d.wav.part", index))
        try waveHeader(0).write(to: file, options: .atomic); partial = file; handle = try FileHandle(forWritingTo: file)
        try handle!.seekToEnd(); size = 0
      }
      let count = min(chunkBytes - size, data.count - cursor)
      try handle!.write(contentsOf: data.subdata(in: cursor..<(cursor + count)))
      cursor += count; size += count; sinceSync += count
      if sinceSync >= rate * 2 { try handle!.synchronize(); sinceSync = 0 }
      if size == chunkBytes { try close() }
    }
  }
  func close() throws {
    guard let file = partial, let output = handle else { return }
    try output.synchronize(); try output.close(); handle = nil; partial = nil
    try journal.seal(file)
    try journal.update(id) { $0["chunks"] = index + 1; $0["frames"] = ($0["frames"] as? Int ?? 0) + size / 2 }
    index += 1; size = 0; sinceSync = 0
  }
}

private final class Companion {
  static let shared = Result { try Companion() }
  let journal: Journal
  let profiles = KeychainProfiles()
  let transport = LocalTransport()
  private let upload = DispatchQueue(label: "studio.audiowhisper.delivery")
  private let captureIO = DispatchQueue(label: "studio.audiowhisper.audio")
  private let control = NSRecursiveLock()
  private var observers: [NSObjectProtocol] = []
  private var timer: DispatchSourceTimer?
  private var audio: AVAudioEngine?
  private var writer: PcmWriter?
  private(set) var active: String?
  private(set) var level: Double = 0
  private init() throws {
    journal = try Journal(); try journal.recover()
    let timer = DispatchSource.makeTimerSource(queue: upload)
    timer.schedule(deadline: .now() + 1, repeating: 2)
    timer.setEventHandler { [weak self] in self?.deliver() }
    self.timer = timer; timer.resume()
    observers.append(NotificationCenter.default.addObserver(forName: AVAudioSession.interruptionNotification, object: nil, queue: nil) { [weak self] notification in
      if notification.userInfo?[AVAudioSessionInterruptionTypeKey] as? UInt == AVAudioSession.InterruptionType.began.rawValue {
        try? self?.stop("O sistema interrompeu o microfone. Os trechos já capturados foram preservados.")
      }
    })
  }
  func connect(_ raw: String) throws -> String {
    let value = try object(raw)
    var profile: Object = ["url": try transport.normalize(value["url"] as? String ?? ""), "token": value["token"] as? String ?? ""]
    let info = try transport.request(profile, "GET", "/api/companion")
    guard info["service"] as? String == "audiowhisper", info["protocol_version"] as? Int == 1,
      let id = info["instance_id"] as? String, UUID(uuidString: id) != nil, info["defaults"] is Object else { throw failure("Este endereço não oferece o protocolo do AudioWhisper Mobile.") }
    profile["id"] = id; profile["instance_id"] = id; profile["defaults"] = info["defaults"]
    profile["name"] = (value["name"] as? String).flatMap { $0.isEmpty ? nil : $0 } ?? "Meu PC"
    try profiles.save(profile); sync(); return try profiles.publicState()
  }
  func sync() {
    for value in journal.list() { try? journal.update(value["id"] as! String) { $0["retry_at"] = 0 } }
    upload.async { [weak self] in self?.deliver() }
  }
  private func deliver() {
    for value in journal.list().reversed() {
      guard value["recovery_required"] as? Bool != true, let id = value["id"] as? String, (value["chunks"] as? Int ?? 0) > 0,
        !["completed", "cancelled"].contains(value["remote_status"] as? String ?? ""), (value["retry_at"] as? Double ?? 0) <= Date().timeIntervalSince1970 else { continue }
      do {
        guard let profile = try profiles.get(value["connection_id"] as! String) else { continue }
        let identity = try transport.request(profile, "GET", "/api/companion")
        guard identity["instance_id"] as? String == value["instance_id"] as? String else { throw failure("Este endereço pertence a outro PC. A gravação continua neste aparelho.") }
        var state = try journal.read(id)
        if !(state["job_id"] is String) {
          let payload: Object = ["capture_id": id, "title": state["title"]!, "source": "microphone", "settings": state["settings"]!]
          let job = try transport.request(profile, "POST", "/api/live", Data(json(payload).utf8))
          guard let jobId = job["id"] as? String, UUID(uuidString: jobId) != nil else { throw failure("Resposta de captura inválida.") }
          state = try journal.update(id) { $0["job_id"] = jobId }
        }
        let jobId = state["job_id"] as! String
        var cursor = state["uploaded_chunks"] as? Int ?? 0
        for _ in 0..<3 {
          state = try journal.read(id)
          if cursor >= (state["chunks"] as? Int ?? 0) { break }
          let boundary = "aw-\(id)-\(cursor)"
          var body = Data("--\(boundary)\r\nContent-Disposition: form-data; name=\"file\"; filename=\"chunk.wav\"\r\nContent-Type: audio/wav\r\n\r\n".utf8)
          body.append(try Data(contentsOf: journal.chunk(id, cursor))); body.append(Data("\r\n--\(boundary)--\r\n".utf8))
          _ = try transport.request(profile, "POST", "/api/live/\(jobId)/chunks/\(cursor)?start=\(cursor * 4)&revision=0&final=true", body, "multipart/form-data; boundary=\(boundary)")
          cursor += 1
          try journal.update(id) { $0["uploaded_chunks"] = cursor; $0["error"] = NSNull(); $0["retry_at"] = 0; $0["attempts"] = 0 }
        }
        state = try journal.read(id)
        if state["state"] as? String == "stopped", cursor == (state["chunks"] as? Int ?? 0), state["stop_sent"] as? Bool != true {
          let payload: Object = ["expected_chunks": cursor, "duration": Double(state["frames"] as? Int ?? 0) / Double(rate)]
          _ = try transport.request(profile, "POST", "/api/live/\(jobId)/stop", Data(json(payload).utf8))
          try journal.update(id) { $0["stop_sent"] = true }
        }
        if state["stop_sent"] as? Bool == true {
          let job = try transport.request(profile, "GET", "/api/jobs/\(jobId)")
          try journal.update(id) { $0["remote_status"] = job["status"]; $0["remote_error"] = job["error_message"] }
        }
      } catch {
        try? journal.update(id) {
          let attempts = min(6, ($0["attempts"] as? Int ?? 0) + 1)
          $0["error"] = error.localizedDescription; $0["attempts"] = attempts
          $0["retry_at"] = Date().timeIntervalSince1970 + min(60, pow(2, Double(attempts)))
        }
      }
    }
  }
  func start(_ raw: String) throws -> String {
    control.lock(); defer { control.unlock() }
    guard active == nil else { throw failure("Já existe uma gravação em andamento.") }
    let options = try object(raw)
    guard options["source"] as? String == "microphone" else { throw failure("O áudio de outros aplicativos no iPhone requer uma extensão ReplayKit.") }
    guard let title = options["title"] as? String, !title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
      let connection = options["connection_id"] as? String, let profile = try profiles.get(connection) else { throw failure("Conecte o PC e informe o título antes de gravar.") }
    let session = AVAudioSession.sharedInstance()
    try session.setCategory(.playAndRecord, mode: .measurement, options: [.mixWithOthers, .defaultToSpeaker, .allowBluetooth])
    try session.setActive(true)
    let engine = AVAudioEngine()
    let input = engine.inputNode
    let format = input.outputFormat(forBus: 0)
    guard format.sampleRate > 0, let outputFormat = AVAudioFormat(commonFormat: .pcmFormatInt16, sampleRate: Double(rate), channels: 1, interleaved: true),
      let converter = AVAudioConverter(from: format, to: outputFormat) else { throw failure("Não foi possível abrir a entrada de áudio.") }
    let value = try journal.create(options, profile)
    let id = value["id"] as! String
    let writer = PcmWriter(journal, id); self.writer = writer; active = id
    input.installTap(onBus: 0, bufferSize: 4096, format: format) { [weak self] buffer, _ in
      guard let self = self else { return }
      let capacity = AVAudioFrameCount(Double(buffer.frameLength) * Double(rate) / format.sampleRate + 32)
      guard let output = AVAudioPCMBuffer(pcmFormat: outputFormat, frameCapacity: capacity) else { return }
      var supplied = false; var conversionError: NSError?
      _ = converter.convert(to: output, error: &conversionError) { _, status in
        if supplied { status.pointee = .noDataNow; return nil }
        supplied = true; status.pointee = .haveData; return buffer
      }
      guard conversionError == nil, output.frameLength > 0, let samples = output.int16ChannelData?[0] else { return }
      let count = Int(output.frameLength)
      let data = Data(bytes: samples, count: count * 2)
      var square = 0.0
      for index in 0..<count { let sample = Double(samples[index]); square += sample * sample }
      self.level = min(1, sqrt(square / Double(count)) / 6000)
      self.captureIO.async {
        do { try writer.append(data) }
        catch { DispatchQueue.global().async { try? self.stop("Não foi possível salvar o próximo trecho. Os arquivos anteriores foram preservados.") } }
      }
    }
    do { engine.prepare(); try engine.start(); audio = engine }
    catch { input.removeTap(onBus: 0); try? journal.update(id) { $0["state"] = "stopped" }; active = nil; throw error }
    return try json(value)
  }
  func stop(_ notice: String? = nil) throws {
    control.lock(); defer { control.unlock() }
    guard let id = active else { return }
    audio?.stop(); audio?.inputNode.removeTap(onBus: 0); audio = nil
    var writeError: Error?
    captureIO.sync { do { try writer?.close() } catch { writeError = error } }
    writer = nil; active = nil; level = 0
    try journal.update(id) { $0["state"] = "stopped"; $0["capture_notice"] = (notice ?? writeError?.localizedDescription) as Any? ?? NSNull() }
    try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    sync()
  }
  func snapshot() throws -> String {
    let sessions = journal.list().map { value -> Object in
      var value = value
      let id = value["id"] as! String; let index = value["chunks"] as? Int ?? 0
      let partial = try? journal.folder(id).appendingPathComponent(String(format: "%06d.wav.part", index))
      let size = partial.flatMap { try? FileManager.default.attributesOfItem(atPath: $0.path)[.size] as? NSNumber }?.intValue ?? 0
      value["duration"] = Double((value["frames"] as? Int ?? 0) + max(0, size - 44) / 2) / Double(rate)
      return value
    }
    return try json(["active_id": active as Any? ?? NSNull(), "sessions": sessions, "level": level])
  }
  func cachedTranscript(_ id: String) throws -> Object {
    let file = try journal.folder(id).appendingPathComponent("transcript.json")
    var cached = (try? object(String(contentsOf: file, encoding: .utf8))) ?? ["segments": [Object](), "status": "local"]
    cached["online"] = false
    return cached
  }
  func transcript(_ id: String) throws -> String {
    let state = try journal.read(id)
    let file = try journal.folder(id).appendingPathComponent("transcript.json")
    var cached = try cachedTranscript(id)
    do {
      guard let profile = try profiles.get(state["connection_id"] as! String), let job = state["job_id"] as? String else { throw failure("Aguardando envio ao PC.") }
      var segments = cached["prefix_hash"] is String ? cached["segments"] as? [Object] ?? [] : []
      var hash = cached["prefix_hash"] as? String ?? ""
      for _ in 0..<100 {
        let after = segments.last?["segment_index"] as? Int ?? -1
        let checksum = hash.count == 64 ? "&known_hash=\(hash)" : ""
        var response = try transport.request(profile, "GET", "/api/companion/captures/\(job)/transcript?after_index=\(after)&limit=500\(checksum)")
        if response["reset"] as? Bool == true { segments = [] }
        segments.append(contentsOf: response["segments"] as? [Object] ?? [])
        guard let nextHash = response["prefix_hash"] as? String, nextHash.count == 64 else { throw failure("Atualize o AudioWhisper no PC para sincronizar o texto.") }
        hash = nextHash
        if response["has_more"] as? Bool != true {
          response["segments"] = segments; response["online"] = true
          try Data(json(response).utf8).write(to: file, options: .atomic)
          try journal.update(id) { $0["remote_status"] = response["status"] }
          return try json(response)
        }
      }
      throw failure("A transcrição mudou durante a leitura. O texto anterior foi preservado.")
    } catch { cached["online"] = false; return try json(cached) }
  }
}

public final class CompanionCaptureModule: Module {
  private let io = DispatchQueue(label: "studio.audiowhisper.module.io")
  public func definition() -> ModuleDefinition {
    Name("CompanionCapture")
    AsyncFunction("connections") { () throws -> String in try Companion.shared.get().profiles.publicState() }
    AsyncFunction("connect") { (raw: String, promise: Promise) in
      self.io.async {
        do { promise.resolve(try Companion.shared.get().connect(raw)) }
        catch { promise.reject("CONNECTION_FAILED", error.localizedDescription) }
      }
    }
    AsyncFunction("snapshot") { () throws -> String in try Companion.shared.get().snapshot() }
    AsyncFunction("cachedTranscript") { (id: String) throws -> String in try json(Companion.shared.get().cachedTranscript(id)) }
    AsyncFunction("transcript") { (id: String, promise: Promise) in
      self.io.async {
        do { promise.resolve(try Companion.shared.get().transcript(id)) }
        catch { promise.reject("TRANSCRIPT_READ", error.localizedDescription) }
      }
    }
    AsyncFunction("sync") { () throws in try Companion.shared.get().sync() }
    AsyncFunction("stop") { () throws in try Companion.shared.get().stop() }
    AsyncFunction("exportAudio") { (id: String, promise: Promise) in
      self.io.async {
        do {
          let companion = try Companion.shared.get()
          guard companion.active != id else { throw failure("Encerre a gravação antes de preparar uma cópia.") }
          promise.resolve(try companion.journal.exportAudio(id))
        } catch { promise.reject("EXPORT_AUDIO", error.localizedDescription) }
      }
    }
    AsyncFunction("start") { (raw: String, promise: Promise) in
      AVAudioSession.sharedInstance().requestRecordPermission { allowed in
        guard allowed else { promise.reject("MICROPHONE_PERMISSION", "Autorize o microfone nas configurações do iPhone."); return }
        do { promise.resolve(try Companion.shared.get().start(raw)) }
        catch { promise.reject("CAPTURE_START", error.localizedDescription) }
      }
    }
  }
}
