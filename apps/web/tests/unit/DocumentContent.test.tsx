import { render, screen } from "@testing-library/react";
import { expect, it } from "vitest";
import { DocumentContent } from "@/components/workspace/DocumentContent";

it("renders readable document headings and action lists", () => {
  render(<DocumentContent content={"# Ata da reunião\n\n- Revisar os backups\n- Preparar o relatório"} headingLevel={3} />);
  expect(screen.getByRole("heading", { name: "Ata da reunião", level: 3 })).toBeVisible();
  expect(screen.getAllByRole("listitem")).toHaveLength(2);
});

it("does not execute HTML, load remote images or expose script links", () => {
  const { container } = render(<DocumentContent content={'<script>alert(1)</script>\n\n![arquivo](https://example.test/tracker.png)\n\n[Inseguro](javascript:alert(1))\n\n[Referência](https://example.test/docs)'} />);
  expect(container.querySelector("script,img")).toBeNull();
  expect(screen.getByText("Inseguro").closest("a")).toBeNull();
  expect(screen.getByRole("link", { name: "Referência" })).toHaveAttribute("rel", "noopener noreferrer");
});
