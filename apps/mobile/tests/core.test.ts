import { test } from "node:test";
import assert from "node:assert/strict";
import { duration, connectionUrl, sessionStatus, mergeSegments, pendingCount } from "../src/core/presentation.ts";
import type { Recording, Segment } from "../src/core/types.ts";

const recording = (values: Partial<Recording> = {}): Recording => ({
  id: "capture", title: "Reunião", source: "microphone", connection_id: "pc", instance_id: "pc",
  created_at: 0, state: "recording", frames: 0, chunks: 2, uploaded_chunks: 2,
  duration: 8, stop_sent: false, interrupted: false, job_id: "job", error: null, ...values,
});

test("recording time does not wrap after an hour", () => {
  assert.equal(duration(0), "00:00"); assert.equal(duration(65), "01:05");
  assert.equal(duration(3661), "1:01:01"); assert.equal(duration(-5), "00:00");
});
test("LAN, VPN and IPv6 addresses stay explicit", () => {
  for (const address of ["http://192.168.1.20:8080", "http://100.80.1.2:8080", "http://pc.local:8080", "https://[fd00::1]:8080"]) {
    assert.equal(connectionUrl(address + "/"), address);
  }
});
test("credentials, query strings and unrelated paths never enter the server URL", () => {
  for (const address of ["", "file:///local", "http://user:secret@pc.local", "http://pc.local/library", "http://pc.local?token=secret", "http://pc.local#token"]) {
    assert.throws(() => connectionUrl(address));
  }
});
test("recording status follows durable acknowledgements", () => {
  assert.equal(sessionStatus(recording()).label, "Ao vivo no PC");
  assert.equal(sessionStatus(recording({ chunks: 0, uploaded_chunks: 0 })).label, "Preparando áudio");
  assert.equal(sessionStatus(recording({ uploaded_chunks: 0 })).label, "Áudio salvo no celular");
  assert.equal(sessionStatus(recording({ error: "Sem conexão" })).tone, "warning");
  assert.equal(sessionStatus(recording({ state: "stopped", stop_sent: true })).label, "Concluindo no PC");
  assert.equal(sessionStatus(recording({ state: "stopped", remote_status: "completed" })).label, "Transcrição concluída");
  assert.equal(sessionStatus(recording({ state: "stopped", remote_status: "failed" })).tone, "danger");
  assert.equal(sessionStatus(recording({ state: "stopped", chunks: 0 })).label, "Sem áudio capturado");
  assert.equal(sessionStatus(recording({ recovery_required: true })).label, "Recuperação local");
});
test("pending counts do not mistake received audio for a missing upload", () => {
  assert.equal(pendingCount([recording(), recording({ uploaded_chunks: 0 }), recording({ state: "stopped", stop_sent: true })]), 1);
});
test("segment retries preserve order and replace by identity without duplication", () => {
  const segment = (id: string, index: number, text = id): Segment => ({ id, segment_index: index, text, start: index, end: index + 1, speaker_id: null });
  const result = mergeSegments([segment("a", 0), segment("b", 1000)], [segment("b", 1000, "confirmed"), segment("c", 2000)]);
  assert.deepEqual(result.map(s => s.id), ["a", "b", "c"]);
  assert.equal(result[1]?.text, "confirmed");
});
