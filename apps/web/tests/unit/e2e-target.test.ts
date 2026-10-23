import { describe, expect, it, vi } from "vitest";

import { assertE2ETarget, getE2ETarget } from "../../scripts/e2e-target.mjs";

const isolated = "http://localhost:8090";
const health = { status: "ok", service: "api", environment: "e2e" };
const respond = (body: unknown = health, ok = true) => vi.fn().mockResolvedValue({ ok, json: async () => body });

describe("E2E data isolation", () => {
  it.each([
    undefined, "", "not a URL", "http://localhost:8080", "http://127.0.0.1:8080",
    "http://[::1]:8080", "http://localhost", "http://localhost:3000",
    "http://example.com:8090", "https://localhost:8090", "http://user:secret@localhost:8090",
    "http://localhost:8090/library", "http://localhost:8090?test=true", "http://localhost:8090#qa",
  ])("refuses unsafe or implicit targets before sending any request: %s", async (url) => {
    const request = respond();
    await expect(assertE2ETarget(url, request)).rejects.toThrow(/E2E/);
    expect(request).not.toHaveBeenCalled();
  });

  it.each(["http://localhost:8090", "http://127.0.0.1:8090/"])("accepts an explicit isolated loopback origin: %s", (url) => {
    expect(getE2ETarget(url)).toBe(url.replace(/\/$/, ""));
  });

  it.each([{}, null, { ...health, environment: "production" }, { ...health, environment: "test" },
    { ...health, status: "degraded" }, { ...health, service: "other" }])("requires the API to identify itself as a healthy E2E instance", async (body) => {
    await expect(assertE2ETarget(isolated, respond(body))).rejects.toThrow(/E2E/);
  });

  it("uses only a read request and refuses redirects before allowing tests", async () => {
    const request = respond();
    await expect(assertE2ETarget(isolated + "/", request)).resolves.toBe(isolated);
    expect(request).toHaveBeenCalledWith(isolated + "/api/health", expect.objectContaining({ method: "GET", redirect: "error", signal: expect.any(AbortSignal) }));
  });

  it("refuses unsuccessful health responses", async () => {
    await expect(assertE2ETarget(isolated, respond(health, false))).rejects.toThrow(/E2E/);
  });

  it("refuses an unavailable API without exposing request details", async () => {
    const request = vi.fn().mockRejectedValue(new Error("private details"));
    await expect(assertE2ETarget(isolated, request)).rejects.toThrow("E2E preflight failed");
  });

  it("refuses invalid health JSON", async () => {
    const request = vi.fn().mockResolvedValue({ ok: true, json: async () => { throw new Error("invalid JSON"); } });
    await expect(assertE2ETarget(isolated, request)).rejects.toThrow(/E2E/);
  });
});
