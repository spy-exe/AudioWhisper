const targetError = "E2E requires E2E_BASE_URL=http://localhost:8090 and the isolated docker-compose.e2e.yml stack. Port 8080 is reserved for personal recordings.";

export function getE2ETarget(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error(targetError); }
  if (url.protocol !== "http:" || !["localhost", "127.0.0.1"].includes(url.hostname)
      || url.port !== "8090" || url.username || url.password
      || url.pathname !== "/" || url.search || url.hash) throw new Error(targetError);
  return url.origin;
}

// Run before launching browsers or creating fixtures. A different port alone does not prove isolation.
export async function assertE2ETarget(value, request = globalThis.fetch) {
  const target = getE2ETarget(value);
  try {
    const response = await request(target + "/api/health", {
      method: "GET", redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error();
    const health = await response.json();
    if (health?.environment !== "e2e" || health.service !== "api" || health.status !== "ok") throw new Error();
  } catch {
    throw new Error("E2E preflight failed: the target must be a healthy, isolated API with ENVIRONMENT=e2e. No fixtures were created.");
  }
  return target;
}
