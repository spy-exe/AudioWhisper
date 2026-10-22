"use client";

import { useCallback, useEffect, useState } from "react";

import { api, describeError } from "@/lib/api";
import { formatBytes, formatPercent } from "@/lib/format";
import type { StorageInfo } from "@/lib/types";
import { Button } from "@/components/ui/Button";
import { ConfirmDialog } from "@/components/ui/ConfirmDialog";
import { Panel } from "@/components/ui/Panel";

const LABELS: [keyof StorageInfo["directories"], string][] = [
  ["uploads", "Gravações originais"],
  ["models", "Modelos baixados"],
  ["exports", "Exportações salvas"],
  ["database", "Banco de dados"],
  ["tmp", "Áudio temporário"],
];

const CLEANUP = {
  tmp: {
    title: "Limpar áudio temporário?",
    description: "Remove arquivos intermediários de trabalhos já encerrados. Processamentos em andamento não são afetados.",
    label: "Limpar temporários",
  },
  exports: {
    title: "Remover exportações salvas?",
    description: "Os arquivos exportados são apagados do disco. Transcrições, documentos e gravações continuam; qualquer formato pode ser gerado de novo.",
    label: "Remover exportações",
  },
} as const;

export function StoragePanel() {
  const [info, setInfo] = useState<StorageInfo | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [confirm, setConfirm] = useState<keyof typeof CLEANUP | null>(null);

  const load = useCallback(() => {
    setError("");
    api
      .storage()
      .then(setInfo)
      .catch((failure) => setError(describeError(failure, "Não foi possível ler o armazenamento.")));
  }, []);
  useEffect(load, [load]);

  const used = info ? info.disk.used_bytes / Math.max(1, info.disk.total_bytes) : 0;
  return (
    <Panel raised className="flex flex-col gap-4 p-5">
      <h2 className="text-sm font-medium uppercase tracking-wide text-text-muted">Armazenamento</h2>
      {error && (
        <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-danger">
          {error}
          <Button size="sm" onClick={load}>
            Tentar novamente
          </Button>
        </div>
      )}
      {!info && !error && <div className="skeleton h-40" role="status" aria-label="Lendo armazenamento" />}
      {info && (
        <>
          <div>
            <div className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
              <span className="text-text-secondary">Disco do servidor</span>
              <span className="font-mono text-xs text-text-secondary">
                {formatBytes(info.disk.free_bytes)} livres de {formatBytes(info.disk.total_bytes)}
              </span>
            </div>
            <div
              className={`storage-meter ${used > 0.9 ? "is-critical" : used > 0.8 ? "is-warning" : ""}`}
              role="meter"
              aria-label="Uso do disco"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(used * 100)}
              aria-valuetext={`${formatPercent(used)} usado`}
            >
              <span style={{ width: `${Math.min(100, used * 100)}%` }} />
            </div>
            {used > 0.9 && (
              <p className="mt-2 text-xs text-warning">
                Pouco espaço livre: novos envios e modelos podem falhar.
              </p>
            )}
          </div>
          <dl className="grid grid-cols-1 gap-y-2 text-sm sm:grid-cols-2">
            {LABELS.map(([key, label]) => (
              <div key={key} className="flex justify-between gap-3 sm:contents">
                <dt className="text-text-muted">{label}</dt>
                <dd className="text-right font-mono text-xs text-text-primary sm:text-left">
                  {formatBytes(info.directories[key].bytes)}
                </dd>
              </div>
            ))}
          </dl>
          <p className="text-xs text-text-muted">
            {info.counts.jobs} gravações · {info.counts.segments} trechos · {info.counts.documents} documentos
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => setConfirm("tmp")}>
              {CLEANUP.tmp.label}
            </Button>
            <Button size="sm" onClick={() => setConfirm("exports")}>
              {CLEANUP.exports.label}
            </Button>
          </div>
          {notice && (
            <p role="status" className="text-xs text-success">
              {notice}
            </p>
          )}
        </>
      )}
      {confirm && (
        <ConfirmDialog
          open
          title={CLEANUP[confirm].title}
          description={CLEANUP[confirm].description}
          confirmLabel={CLEANUP[confirm].label}
          onConfirm={async () => {
            try {
              const result = await api.cleanup(confirm);
              setNotice(`${formatBytes(result.freed_bytes)} liberados (${result.removed} arquivos).`);
              load();
            } catch (failure) {
              throw new Error(describeError(failure, "Não foi possível limpar agora."));
            }
          }}
          onClose={() => setConfirm(null)}
        />
      )}
    </Panel>
  );
}
