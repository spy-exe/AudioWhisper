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
        statements: 72,
        branches: 70,
        functions: 70,
        lines: 75,
        "lib/live-audio.ts": { lines: 95, branches: 85 },
        "lib/api.ts": { lines: 95, branches: 90 },
        "lib/transcription-settings.ts": { lines: 100, branches: 100 },
        "lib/notifications.ts": { lines: 100, branches: 95 },
        "components/jobs/LibraryView.tsx": { lines: 92, branches: 80 },
        "components/search/SearchView.tsx": { lines: 90, branches: 90 },
        "components/editor/TranscriptEditor.tsx": { lines: 70, branches: 60 },
        "components/editor/InsightsPanel.tsx": { lines: 90, branches: 85 },
        "components/editor/BookmarksPanel.tsx": { lines: 95, branches: 85 },
        "components/ui/Dialog.tsx": { lines: 95, branches: 85 },
        "components/ui/ConfirmDialog.tsx": { lines: 95, branches: 85 },
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
