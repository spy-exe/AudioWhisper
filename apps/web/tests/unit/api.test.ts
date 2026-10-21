import { afterEach, describe, expect, it, vi } from "vitest";

import { api, ApiError } from "@/lib/api";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("api client", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("parses a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(jsonResponse(200, { status: "ok", service: "api", database: true, redis: true, time: 1 }))
    );
    const health = await api.health();
    expect(health.status).toBe("ok");
  });

  it("throws ApiError with the backend's structured error envelope", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(404, {
          error: { code: "NOT_FOUND", message: "Job não encontrado", details: {}, request_id: "abc" },
        })
      )
    );

    await expect(api.getJob("missing")).rejects.toMatchObject({
      code: "NOT_FOUND",
      message: "Job não encontrado",
      status: 404,
    });
  });

  it("ApiError is an instance of Error", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        jsonResponse(500, { error: { code: "INTERNAL_ERROR", message: "boom", details: {}, request_id: null } })
      )
    );
    try {
      await api.getJob("x");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(ApiError);
      expect(err).toBeInstanceOf(Error);
    }
  });
});
