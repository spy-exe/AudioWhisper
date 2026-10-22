import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ExportMenu } from "@/components/editor/ExportMenu";
import { JobErrorView } from "@/components/jobs/JobErrorView";
import { api, ApiError } from "@/lib/api";
import type { TranscriptionJob } from "@/lib/types";

let clicked: string[] = [];
beforeEach(() => {
  clicked = [];
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push(this.getAttribute("href") ?? "");
  });
});
afterEach(() => vi.restoreAllMocks());

it("exports CSV with the chosen options and downloads every format as a ZIP", async () => {
  const create = vi.spyOn(api, "createExports").mockResolvedValue([{ id: "e1", job_id: "j1", format: "csv", size_bytes: 10, created_at: "" }]);
  render(<ExportMenu jobId="j1" hasSpeakers />);
  fireEvent.click(screen.getByRole("checkbox", { name: "Horários no texto" }));
  fireEvent.click(screen.getByRole("checkbox", { name: "Nomes dos falantes" }));
  fireEvent.click(screen.getByRole("button", { name: "CSV" }));
  await waitFor(() => expect(clicked).toEqual(["/api/exports/e1/download"]));
  expect(create).toHaveBeenCalledWith("j1", ["csv"], false, false);
  fireEvent.click(screen.getByRole("button", { name: "Baixar todos (ZIP)" }));
  expect(clicked[1]).toBe("/api/jobs/j1/exports/bundle?include_timestamps=false&include_speakers=false");
});

it("hides the speaker option without speakers and explains export failures", async () => {
  vi.spyOn(api, "createExports").mockRejectedValue(new ApiError(0, { error: { code: "NETWORK_ERROR", message: "Sem conexão com o AudioWhisper.", details: {}, request_id: null } }));
  render(<ExportMenu jobId="j1" />);
  expect(screen.queryByRole("checkbox", { name: "Nomes dos falantes" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "PDF" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Sem conexão com o AudioWhisper.");
  expect(screen.getByRole("button", { name: "PDF" })).toBeEnabled();
});

const failed = { id: "j1", status: "failed", error_message: "Falha ao extrair áudio do arquivo de mídia" } as TranscriptionJob;

it("hands the requeued job back to the page instead of staying on the error view", async () => {
  const requeued = { ...failed, status: "queued", error_message: null } as TranscriptionJob;
  vi.spyOn(api, "retryJob").mockResolvedValue(requeued);
  const onRetried = vi.fn();
  render(<JobErrorView job={failed} onRetried={onRetried} />);
  expect(screen.getByText("Falha ao extrair áudio do arquivo de mídia")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  await waitFor(() => expect(onRetried).toHaveBeenCalledWith(requeued));
  expect(screen.getByRole("link", { name: "Voltar à biblioteca" })).toHaveAttribute("href", "/library");
});

it("shows why a retry was refused and lets the user try again", async () => {
  vi.spyOn(api, "retryJob").mockRejectedValueOnce(new ApiError(503, { error: { code: "QUEUE_UNAVAILABLE", message: "A fila de processamento está indisponível.", details: {}, request_id: null } }));
  render(<JobErrorView job={failed} onRetried={vi.fn()} />);
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("A fila de processamento está indisponível.");
  expect(screen.getByRole("button", { name: "Tentar novamente" })).toBeEnabled();
});
