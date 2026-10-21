"use client";
import { useCallback, useEffect, useState } from "react";
import { api } from "@/lib/api";
import type {
  AIDocument,
  IntelligenceStatus,
  TranscriptSegment,
} from "@/lib/types";
import { useSettings } from "@/contexts/SettingsContext";
import { Button } from "@/components/ui/Button";
import { Icon } from "@/components/ui/Icon";
import { DocumentView } from "./DocumentView";

const templates = [
  ["minutes", "Ata técnica"],
  ["briefing", "Briefing executivo"],
  ["summary", "Resumo"],
  ["decisions", "Decisões"],
  ["actions", "Tarefas"],
  ["risks", "Riscos"],
  ["questions", "Perguntas"],
  ["email", "E-mail"],
  ["custom", "Análise personalizada"],
];
export function AIWorkspace({
  jobId,
  segments,
  onSource,
  beforeGenerate,
}: {
  jobId: string;
  segments: TranscriptSegment[];
  onSource: (id: string) => void;
  beforeGenerate: () => Promise<boolean>;
}) {
  const { settings } = useSettings();
  const [provider, setProvider] = useState<IntelligenceStatus | null>(null);
  const [documents, setDocuments] = useState<AIDocument[]>([]);
  const [selected, setSelected] = useState("");
  const [kind, setKind] = useState("minutes");
  const [model, setModel] = useState("");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    let active = true;
    api
      .intelligence()
      .then((p) => {
        if (active) {
          setProvider(p);
          setModel(
            (previous) =>
              previous ||
              (p.models.includes(String(settings?.ai_model))
                ? String(settings?.ai_model)
                : (p.models[0] ?? "")),
          );
        }
      })
      .catch(() => {
        if (active) setError("Não foi possível verificar o Ollama.");
      });
    return () => {
      active = false;
    };
  }, [refresh, settings?.ai_model]);
  const load = useCallback(async () => {
    const result = await api.documents(jobId);
    setDocuments(result);
    setLoading(false);
  }, [jobId]);
  useEffect(() => {
    let active = true;
    const poll = async () => {
      try {
        const result = await api.documents(jobId);
        if (active) {
          setDocuments(result);
          setLoading(false);
        }
      } catch {
        if (active) {
          setError("Não foi possível carregar os documentos. Tente novamente.");
          setLoading(false);
        }
      }
    };
    void poll();
    const timer = setInterval(poll, 3000);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [jobId, refresh]);
  const document = documents.find((d) => d.id === selected) ?? documents[0];
  const generating = documents.some((d) =>
    ["queued", "generating"].includes(d.status),
  );
  return (
    <aside
      className="min-w-0 rounded-xl border border-border bg-surface"
      aria-label="Assistente de IA"
    >
      <div className="flex items-center gap-3 border-b border-border p-5">
        <span className="flex size-10 items-center justify-center rounded-xl bg-accent/10 text-accent">
          <Icon name="sparkle" className="size-4" />
        </span>
        <div>
          <h2 className="text-lg font-semibold">Assistente de IA</h2>
          <p className="mt-0.5 text-xs text-text-muted">
            Contexto que vira ação · Ollama local
          </p>
        </div>
      </div>
      <div className="space-y-4 p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs text-text-secondary">
            Documento
            <select
              className="field mt-1"
              value={kind}
              onChange={(e) => setKind(e.target.value)}
            >
              {templates.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-text-secondary">
            Modelo local
            <select
              className="field mt-1"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={!provider?.models.length}
            >
              <option value="">Selecione</option>
              {provider?.models.map((name) => (
                <option key={name}>{name}</option>
              ))}
            </select>
          </label>
        </div>
        {kind === "custom" && (
          <label className="block text-xs text-text-secondary">
            O que você quer analisar?
            <textarea
              className="field mt-1 min-h-24 resize-none"
              maxLength={4000}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="Ex.: identifique dúvidas sobre a estratégia de backup."
            />
          </label>
        )}
        {provider && (!provider.available || !provider.models.length) && (
          <div className="rounded-lg border border-warning/30 p-3 text-xs leading-relaxed text-warning">
            <p>
              {provider.error ||
                "Nenhum modelo local instalado. Instale um modelo no Ollama e verifique a conexão."}
            </p>
            <Button
              size="sm"
              className="mt-3"
              onClick={() => setRefresh((n) => n + 1)}
            >
              Verificar conexão
            </Button>
          </div>
        )}
        <Button
          variant="primary"
          className="w-full"
          disabled={
            busy ||
            generating ||
            !model ||
            !provider?.available ||
            !segments.length
          }
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              if (!(await beforeGenerate()))
                throw new Error(
                  "Salve as alterações da transcrição antes de gerar.",
                );
              const next = await api.generateDocument(
                jobId,
                kind,
                model,
                instruction,
              );
              setSelected(next.id);
              await load();
            } catch (e) {
              setError(
                e instanceof Error ? e.message : "Falha ao gerar documento.",
              );
            } finally {
              setBusy(false);
            }
          }}
        >
          {busy || generating ? "Gerando documento local…" : "Gerar documento"}
        </Button>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        {loading ? (
          <div
            className="skeleton h-48"
            role="status"
            aria-label="Carregando documentos"
          />
        ) : !document ? (
          <div className="space-y-3 border-t border-border py-6 text-center">
            <Icon name="file" className="mx-auto size-7 text-text-muted" />
            <h3 className="text-sm">A informação já está na conversa.</h3>
            <p className="text-xs leading-relaxed text-text-muted">
              Escolha um documento para organizar o conteúdo. Cada conclusão
              terá um caminho de volta à fonte.
            </p>
          </div>
        ) : (
          <div className="space-y-4 border-t border-border pt-4">
            <label className="block text-xs text-text-secondary">
              Histórico de documentos
              <select
                className="field mt-1"
                value={document.id}
                onChange={(e) => setSelected(e.target.value)}
              >
                {documents.map((d) => (
                  <option key={d.id} value={d.id}>
                    {templates.find(([key]) => key === d.kind)?.[1] ?? d.kind} ·{" "}
                    {new Date(
                      d.created_at + (d.created_at.endsWith("Z") ? "" : "Z"),
                    ).toLocaleTimeString("pt-BR", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </option>
                ))}
              </select>
            </label>
            {document.status === "failed" ? (
              <p role="alert" className="text-xs text-danger">
                {document.error}
              </p>
            ) : ["queued", "generating"].includes(document.status) ? (
              <div role="status" className="space-y-3">
                <p className="text-xs text-text-muted">
                  {document.status === "queued"
                    ? "Aguardando o motor local. O áudio e a IA compartilham a fila de processamento."
                    : "Analisando a transcrição e verificando as fontes…"}
                </p>
                <div className="skeleton h-40" />
              </div>
            ) : (
              <DocumentView
                key={document.id}
                document={document}
                segments={segments}
                onSource={onSource}
                onChange={() =>
                  void load().catch(() =>
                    setError("Não foi possível atualizar o documento."),
                  )
                }
              />
            )}
          </div>
        )}
      </div>
    </aside>
  );
}
