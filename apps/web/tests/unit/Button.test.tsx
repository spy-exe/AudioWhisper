import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { Button } from "@/components/ui/Button";

describe("Button", () => {
  it("renders children and responds to click", () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Transcrever</Button>);
    fireEvent.click(screen.getByText("Transcrever"));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("does not fire onClick when disabled", () => {
    const onClick = vi.fn();
    render(
      <Button onClick={onClick} disabled>
        Transcrever
      </Button>
    );
    fireEvent.click(screen.getByText("Transcrever"));
    expect(onClick).not.toHaveBeenCalled();
  });
});
