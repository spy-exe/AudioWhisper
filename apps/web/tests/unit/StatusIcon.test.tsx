import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { StatusIcon } from "@/components/ui/StatusIcon";

describe("StatusIcon", () => {
  it("renders an svg glyph for every job status", () => {
    const statuses = [
      "queued",
      "preparing",
      "extracting_audio",
      "loading_model",
      "transcribing",
      "generating_exports",
      "completed",
      "failed",
      "cancelled",
    ] as const;

    for (const status of statuses) {
      const { container, unmount } = render(<StatusIcon status={status} />);
      expect(container.querySelector("svg")).toBeInTheDocument();
      unmount();
    }
  });

  it("is decorative (aria-hidden) so it never gets announced redundantly with the status badge", () => {
    const { container } = render(<StatusIcon status="completed" />);
    expect(container.querySelector("span[aria-hidden]")).toBeInTheDocument();
  });
});
