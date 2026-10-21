import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ProgressBar } from "@/components/ui/ProgressBar";

describe("ProgressBar", () => {
  it("clamps aria-valuenow between 0 and 100", () => {
    render(<ProgressBar value={1.5} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "100");
  });

  it("reflects a mid-range value", () => {
    render(<ProgressBar value={0.42} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "42");
    expect(screen.getByRole("progressbar")).toHaveAccessibleName("Progresso do processamento");
  });

  it("clamps negative values to 0", () => {
    render(<ProgressBar value={-0.2} />);
    expect(screen.getByRole("progressbar")).toHaveAttribute("aria-valuenow", "0");
  });
});
