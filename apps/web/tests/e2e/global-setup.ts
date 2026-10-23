import type { FullConfig } from "@playwright/test";

import { assertE2ETarget } from "../../scripts/e2e-target.mjs";

export default async function globalSetup(config: FullConfig) {
  const target = await assertE2ETarget(process.env.E2E_BASE_URL);
  for (const project of config.projects) {
    if (project.use.baseURL !== target) throw new Error("E2E projects must use the verified isolated target.");
  }
}
