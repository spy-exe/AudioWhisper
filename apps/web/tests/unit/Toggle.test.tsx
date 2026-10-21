import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Toggle } from "@/components/ui/Toggle";

describe("Toggle", () => {
  it("reflects checked state via aria-checked", () => {
    render(<Toggle label="VAD" checked={true} onChange={() => {}} />);
    expect(screen.getByRole("switch")).toHaveAttribute("aria-checked", "true");
  });

  it("calls onChange with the inverted value on click", () => {
    const onChange = vi.fn();
    render(<Toggle label="VAD" checked={false} onChange={onChange} />);
    fireEvent.click(screen.getByRole("switch"));
    expect(onChange).toHaveBeenCalledWith(true);
  });

  it("renders the label text", () => {
    render(<Toggle label="Efeitos visuais" checked={false} onChange={() => {}} />);
    expect(screen.getByText("Efeitos visuais")).toBeInTheDocument();
  });
});
