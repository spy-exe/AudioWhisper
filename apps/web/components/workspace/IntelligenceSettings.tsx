"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { IntelligenceStatus } from "@/lib/types";
import { useSettings } from "@/contexts/SettingsContext";
import { Panel } from "@/components/ui/Panel";
import { Button } from "@/components/ui/Button";

export function IntelligenceSettings() {
  const { settings, update } = useSettings();
  const [provider, setProvider] = useState<IntelligenceStatus | null>(null);
  const [error, setError] = useState("");
  const [refresh, setRefresh] = useState(0);
  const [integrations, setIntegrations] = useState<{
    smtp_available: boolean;
    diarization_configured: boolean;
  } | null>(null);
  useEffect(() => {
    let active = true;
    api
      .intelligence()
      .then((result) => {
        if (active) setProvider(result);
      })
      .catch(() => {
        if (active) setError("Não foi possível verificar o serviço local.");
      });
    fetch("/api/integrations")
      .then((r) => r.json())
      .then((r) => {
        if (active) setIntegrations(r);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [refresh]);
  return (
    <>
      <Panel raised className="space-y-4 p-5">
        <h2 className="text-sm font-semibold">Geração de documentos</h2>
        <p className="text-xs leading-relaxed text-text-muted">
          Ollama é o motor inicial. Os modelos precisam estar instalados no
          serviço local configurado.
        </p>
        <label className="block text-sm text-text-secondary">
          Modelo padrão
          <select
            className="field mt-2"
            value={String(settings?.ai_model ?? "")}
            onChange={(e) =>
              void update({ ai_model: e.target.value }).catch(() =>
                setError("Não foi possível salvar o modelo."),
              )
            }
          >
            <option value="">Escolher ao gerar</option>
            {provider?.models.map((model) => (
              <option key={model}>{model}</option>
            ))}
          </select>
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`text-xs ${provider?.available ? "text-success" : "text-warning"}`}
          >
            {provider
              ? provider.available
                ? `${provider.models.length} modelos locais disponíveis`
                : provider.error
              : "Verificando Ollama…"}
          </span>
          <Button size="sm" onClick={() => setRefresh((n) => n + 1)}>
            Verificar conexão
          </Button>
        </div>
        {error && (
          <p role="alert" className="text-xs text-danger">
            {error}
          </p>
        )}
        <details>
          <summary className="text-xs text-text-secondary">
            Configurar motores e integrações
          </summary>
          <div className="mt-3 space-y-3 text-xs leading-relaxed text-text-muted">
            <p>
              No arquivo .env desta instalação, configure OLLAMA_URL para o
              endereço do Ollama local. Modelos remotos são recusados. Use
              OLLAMA_NO_CLOUD=1 no serviço Ollama para desabilitar recursos de
              nuvem.
            </p>
            <p>
              Falantes: aceite o acesso ao Community-1 na sua conta Hugging Face
              e configure HF_TOKEN, ou informe em DIARIZATION_MODEL o caminho de
              um modelo já baixado. A identificação roda localmente e os nomes
              são revisados no editor.
            </p>
            <p>
              E-mail: configure SMTP_HOST, SMTP_PORT, SMTP_FROM e as credenciais
              SMTP_USERNAME/SMTP_PASSWORD quando exigidas. STARTTLS permanece
              habilitado por padrão.
            </p>
            <p>
              Reinicie os serviços após alterar o ambiente. As credenciais não
              são exibidas nem armazenadas na biblioteca.
            </p>
          </div>
        </details>
      </Panel>
      <Panel raised className="space-y-3 p-5">
        <h2 className="text-sm font-semibold">Integrações e acesso</h2>
        <p className="text-xs text-text-secondary">
          SMTP:{" "}
          {integrations?.smtp_available ? "configurado" : "não configurado"} ·
          Falantes:{" "}
          {integrations?.diarization_configured
            ? "modelo configurado"
            : "requer configuração"}
        </p>
        <p className="text-xs leading-relaxed text-text-muted">
          O WhatsApp abre o texto para compartilhamento manual. Links privados
          têm expiração e revogação. Para exigir login nesta instalação,
          configure ACCESS_TOKEN no .env.
        </p>
        <Button
          size="sm"
          onClick={async () => {
            await fetch("/api/session", { method: "DELETE" });
            window.location.reload();
          }}
        >
          Sair da sessão local
        </Button>
      </Panel>
    </>
  );
}
