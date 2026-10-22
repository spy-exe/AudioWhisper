import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { InsightsPanel } from "@/components/editor/InsightsPanel";
import { api, ApiError } from "@/lib/api";
import type { TranscriptStats } from "@/lib/types";

vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), api: { stats: vi.fn() } }));

const stats: TranscriptStats = {
  segment_count: 4, word_count: 1840, duration_seconds: 600, speech_seconds: 450, silence_seconds: 150, words_per_minute: 245.3,
  speaker_turns: 12,
  speakers: [
    { speaker_id: "S1", name: "Ana", segments: 3, words: 1200, speech_seconds: 300, share: 0.6667, longest_turn_seconds: 90, words_per_minute: 240 },
    { speaker_id: null, name: "Não identificado", segments: 1, words: 640, speech_seconds: 150, share: 0.3333, longest_turn_seconds: 150, words_per_minute: 256 },
  ],
  longest_turn: { speaker_id: null, name: "Não identificado", start: 120, end: 270, seconds: 150 },
  questions: 3,
  low_confidence: { threshold: 0.6, segments: 2, segment_ids: ["s2", "s4"], words: 15, words_total: 1800 },
  keywords: [{ term: "orçamento", count: 9 }, { term: "API", count: 4 }],
  activity: [1, 0.5, 0, 0.25],
  activity_bucket_seconds: 150,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(api.stats).mockResolvedValue(stats);
});

function open(props: Partial<Parameters<typeof InsightsPanel>[0]> = {}) {
  const handlers = { onSeek: vi.fn(), onKeyword: vi.fn(), onReviewUncertain: vi.fn() };
  const view = render(<InsightsPanel jobId="j1" version="1" threshold={0.6} {...handlers} {...props} />);
  return { ...handlers, view };
}

it("summarizes the conversation with real figures and a table view", async () => {
  open();
  expect(await screen.findByText("Insights da conversa")).toBeVisible();
  expect(screen.getByText("10 min")).toBeVisible();
  expect(screen.getByText("1.840")).toBeVisible();
  expect(screen.getByText("245")).toBeVisible();
  expect(screen.getByText("75%")).toBeVisible();
  expect(screen.getAllByText("Ana").length).toBeGreaterThan(0);
  expect(screen.getByText("67% · 5 min")).toBeVisible();
  expect(screen.getByRole("table", { name: "Participação por falante" })).toBeInTheDocument();
  expect(api.stats).toHaveBeenCalledWith("j1", 0.6);
});

it("turns the activity timeline, longest turn and keywords into navigation", async () => {
  const { onSeek, onKeyword, onReviewUncertain } = open();
  const column = await screen.findByRole("button", { name: "02:30–05:00: 50% com fala" });
  fireEvent.mouseEnter(column);
  expect(screen.getByText("50% com fala", { selector: ".chart-tooltip" , exact: false })).toBeInTheDocument();
  fireEvent.click(column);
  expect(onSeek).toHaveBeenCalledWith(150);
  fireEvent.mouseLeave(column);
  expect(document.querySelector(".chart-tooltip")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: /Fala contínua mais longa/ }));
  expect(onSeek).toHaveBeenLastCalledWith(120);
  fireEvent.click(screen.getByRole("button", { name: "Buscar orçamento na transcrição (9 vezes)" }));
  expect(onKeyword).toHaveBeenCalledWith("orçamento");
  fireEvent.click(screen.getByRole("button", { name: "Revisar trechos incertos" }));
  expect(onReviewUncertain).toHaveBeenCalledWith(["s2", "s4"]);
});

it("reports a clean transcript and refetches when the transcript changes", async () => {
  vi.mocked(api.stats).mockResolvedValue({ ...stats, low_confidence: { ...stats.low_confidence, segments: 0, segment_ids: [] } });
  const { view, onSeek, onKeyword, onReviewUncertain } = open();
  expect(await screen.findByText(/Nenhum trecho abaixo de 60%/)).toBeVisible();
  view.rerender(<InsightsPanel jobId="j1" version="2" threshold={0.6} onSeek={onSeek} onKeyword={onKeyword} onReviewUncertain={onReviewUncertain} />);
  await waitFor(() => expect(api.stats).toHaveBeenCalledTimes(2));
});

it("explains failures and retries", async () => {
  vi.mocked(api.stats).mockRejectedValueOnce(new ApiError(500, { error: { code: "INTERNAL_ERROR", message: "Erro interno inesperado.", details: {}, request_id: "r" } }));
  open();
  expect(await screen.findByRole("alert")).toHaveTextContent("Erro interno inesperado.");
  fireEvent.click(screen.getByRole("button", { name: "Tentar novamente" }));
  expect(await screen.findByText("Insights da conversa")).toBeVisible();
});

it("handles transcripts without speakers, timeline or rhythm", async () => {
  vi.mocked(api.stats).mockResolvedValue({ ...stats, speakers: [], activity: [], words_per_minute: null, keywords: [], longest_turn: null, duration_seconds: 0 });
  open();
  expect(await screen.findByText("—")).toBeVisible();
  expect(screen.queryByText("Participação por falante")).not.toBeInTheDocument();
  expect(screen.queryByText("Linha do tempo da fala")).not.toBeInTheDocument();
});
