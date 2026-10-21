import { fileURLToPath } from "node:url";

import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["tests/unit/**/*.test.{ts,tsx}"],
    setupFiles: ["./tests/unit/setup.ts"],
    coverage: {
      provider: "v8",
      include: ["app/**/*.{ts,tsx}", "components/**/*.{ts,tsx}", "hooks/**/*.ts", "contexts/**/*.tsx", "lib/**/*.ts"],
      reporter: ["text", "json-summary", "lcov", "html"],
      reportsDirectory: "coverage",
      thresholds: {
        statements: 46,
        branches: 46,
        functions: 38,
        lines: 48,
        "lib/live-audio.ts": { lines: 95, branches: 85 },
        "components/jobs/LibraryView.tsx": { lines: 90, branches: 65 },
        "components/workspace/DocumentView.tsx": { lines: 85, branches: 90 },
        "components/workspace/AIWorkspace.tsx": { lines: 85, branches: 75 },
        "components/ui/AuthGate.tsx": { lines: 95, branches: 90 },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
    },
  },
});
