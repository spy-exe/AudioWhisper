import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, expect, it, vi } from "vitest";
import { DocumentView } from "@/components/workspace/DocumentView";
import { SharePanel } from "@/components/workspace/SharePanel";
import { api, ApiError } from "@/lib/api";
import type { AIDocument, TranscriptSegment } from "@/lib/types";

vi.mock("@/lib/api", async (original) => ({ ...(await original<typeof import("@/lib/api")>()), api: {
  shares: vi.fn(), createShare: vi.fn(), revokeShare: vi.fn(), emailDocument: vi.fn(), reviewDocument: vi.fn(), documentDownloadUrl: vi.fn(() => "/download"),
  deleteDocument: vi.fn(),
} }));
const document: AIDocument = {
  id: "document-1", job_id: "job-1", kind: "minutes", model: "local", status: "generated", stale: false,
  reviewed_at: null, error: null, created_at: "2026-10-21T12:00:00Z", markdown: "# Ata\n\n- Revisar backups",
  items: [{ kind: "action", text: "Revisar backups", assignee: null, due_date: null, evidence_quotes: ["Precisamos revisar"], source_segment_ids: ["segment-1"] }],
};
const segments: TranscriptSegment[] = [{ id: "segment-1", job_id: "job-1", segment_index: 0, start: 134, end: 145, text: "Precisamos revisar", confidence: 1, words: [], edited: false, updated_at: "2026-10-21T12:00:00Z" }];
const renderDocument = (changes: Partial<AIDocument> = {}) => {
  const onSource = vi.fn(); const onChange = vi.fn();
  const view = render(<DocumentView document={{ ...document, ...changes }} segments={segments} onSource={onSource} onChange={onChange} />);
  return { ...view, onSource, onChange };
};
beforeEach(() => { vi.clearAllMocks(); vi.mocked(api.shares).mockResolvedValue([]); vi.mocked(api.reviewDocument).mockResolvedValue(document); });

it("renders readable Markdown with verified timestamp sources and gates sharing behind review", () => {
  const { onSource } = renderDocument();
  expect(screen.getByRole("heading", { name: "Ata" })).toBeVisible();
  expect(screen.getByText("Responsável não identificado · Prazo não definido")).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Ouvir fonte em 02:14" }));
  expect(onSource).toHaveBeenCalledWith("segment-1");
  expect(screen.queryByText("Compartilhar documento revisado")).not.toBeInTheDocument();
});

it("preserves an edited draft on save failure and permits a deliberate retry", async () => {
  vi.mocked(api.reviewDocument).mockRejectedValueOnce(new Error("Conexão interrompida"));
  const { onChange } = renderDocument();
  fireEvent.click(screen.getByRole("button", { name: "Editar documento" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Revisar texto" }), { target: { value: "# Ata revisada" } });
  fireEvent.click(screen.getByRole("button", { name: "Confirmar revisão" }));
  expect(await screen.findByRole("alert")).toHaveTextContent("Conexão interrompida");
  expect(screen.getByRole("textbox")).toHaveValue("# Ata revisada");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("button", { name: "Confirmar revisão" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(api.reviewDocument).toHaveBeenLastCalledWith("document-1", "# Ata revisada", true);
});

it("disables stale sources, review and sharing after the transcript changes", () => {
  renderDocument({ status: "reviewed", reviewed_at: "2026-10-21T12:05:00Z", stale: true });
  expect(screen.getByRole("alert")).toHaveTextContent("A transcrição mudou");
  expect(screen.getByRole("button", { name: "Ouvir fonte em 02:14" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Confirmar revisão" })).toBeDisabled();
  expect(screen.queryByRole("button", { name: "Criar link privado" })).not.toBeInTheDocument();
});

it("hides sharing as soon as a reviewed document has unsaved edits", async () => {
  renderDocument({ status: "reviewed", reviewed_at: "2026-10-21T12:05:00Z" });
  expect(screen.getByRole("button", { name: "Criar link privado" })).toBeVisible();
  fireEvent.click(screen.getByRole("button", { name: "Editar documento" }));
  fireEvent.change(screen.getByRole("textbox", { name: "Revisar texto" }), { target: { value: "Atualização" } });
  expect(screen.queryByRole("button", { name: "Criar link privado" })).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Salvar rascunho" }));
  await waitFor(() => expect(api.reviewDocument).toHaveBeenCalledWith("document-1", "Atualização", false));
});

it("creates an expiring read-only link and can revoke it", async () => {
  const link = { id: "link-1", expires_at: "2026-10-28T12:00:00Z", revoked: false };
  vi.mocked(api.createShare).mockResolvedValue({ ...link, path: "/shared/test-token" });
  vi.mocked(api.shares).mockResolvedValueOnce([]).mockResolvedValueOnce([link]).mockResolvedValue([{ ...link, revoked: true }]);
  render(<SharePanel document={document} />);
  await waitFor(() => expect(api.shares).toHaveBeenCalledOnce());
  fireEvent.change(screen.getByRole("combobox"), { target: { value: "168" } });
  fireEvent.click(screen.getByRole("button", { name: "Criar link privado" }));
  expect(await screen.findByRole("textbox", { name: "Novo link privado" })).toHaveValue("http://localhost:3000/shared/test-token");
  expect(api.createShare).toHaveBeenCalledWith("document-1", 168);
  fireEvent.click(screen.getByRole("button", { name: "Revogar" }));
  expect(await screen.findByText("Revogado")).toBeVisible();
  expect(api.revokeShare).toHaveBeenCalledWith("link-1");
});

it("validates SMTP input and reuses the request id when delivery is uncertain", async () => {
  vi.mocked(api.emailDocument).mockResolvedValue({ status: "uncertain" });
  render(<SharePanel document={document} />);
  await waitFor(() => expect(api.shares).toHaveBeenCalled());
  fireEvent.click(screen.getByText("Enviar pelo SMTP configurado"));
  fireEvent.submit(screen.getByRole("button", { name: "Enviar e-mail revisado" }).closest("form")!);
  expect(await screen.findByRole("alert")).toHaveTextContent("Preencha destinatário e assunto");
  expect(api.emailDocument).not.toHaveBeenCalled();
  fireEvent.change(screen.getByRole("textbox", { name: "Destinatário" }), { target: { value: "qa@example.test" } });
  fireEvent.click(screen.getByRole("button", { name: "Enviar e-mail revisado" }));
  expect(await screen.findByRole("status")).toHaveTextContent("estado incerto");
  fireEvent.click(screen.getByRole("button", { name: "Enviar e-mail revisado" }));
  await waitFor(() => expect(api.emailDocument).toHaveBeenCalledTimes(2));
  expect(vi.mocked(api.emailDocument).mock.calls[0]![3]).toBe(vi.mocked(api.emailDocument).mock.calls[1]![3]);
});

it("deletes a document only after confirmation and keeps it when the server refuses", async () => {
  vi.mocked(api.deleteDocument)
    .mockRejectedValueOnce(new ApiError(409, { error: { code: "HTTP_409", message: "Aguarde a geração terminar antes de excluir o documento.", details: {}, request_id: null } }))
    .mockResolvedValue(undefined);
  const { onChange } = renderDocument();
  fireEvent.click(screen.getByRole("button", { name: "Excluir" }));
  const dialog = screen.getByRole("alertdialog", { name: "Excluir este documento?" });
  expect(dialog).toHaveTextContent("todos os links privados");
  fireEvent.click(within(dialog).getByRole("button", { name: "Excluir documento" }));
  expect(await within(dialog).findByRole("alert")).toHaveTextContent("Aguarde a geração terminar");
  expect(onChange).not.toHaveBeenCalled();
  fireEvent.click(within(dialog).getByRole("button", { name: "Excluir documento" }));
  await waitFor(() => expect(onChange).toHaveBeenCalledOnce());
  expect(api.deleteDocument).toHaveBeenCalledWith("document-1");
  expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
});
