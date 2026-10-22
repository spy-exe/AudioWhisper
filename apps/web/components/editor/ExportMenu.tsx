"use client";

import { useState } from "react";

import { api, describeError } from "@/lib/api";
import type { ExportFormat } from "@/lib/types";

import { Button } from "@/components/ui/Button";

const FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "DOCX" },
  { value: "txt", label: "TXT" },
  { value: "markdown", label: "Markdown" },
  { value: "json", label: "JSON" },
  { value: "srt", label: "SRT" },
  { value: "vtt", label: "VTT" },
  { value: "csv", label: "CSV" },
];

function download(href: string) {
  const a = document.createElement("a");
  a.href = href;
  a.download = "";
  document.body.appendChild(a);
  a.click();
  a.remove();
}

export function ExportMenu({ jobId, hasSpeakers = false }: { jobId: string; hasSpeakers?: boolean }) {
  const [pending, setPending] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [includeTimestamps, setIncludeTimestamps] = useState(true);
  const [includeSpeakers, setIncludeSpeakers] = useState(true);

  const handleExport = async (format: ExportFormat) => {
    setPending(format);
    setError(null);
    try {
      const [exportFile] = await api.createExports(jobId, [format], includeTimestamps, includeSpeakers);
      if (exportFile) download(api.downloadExportUrl(exportFile.id));
    } catch (err) {
      setError(describeError(err, `Falha ao exportar ${format.toUpperCase()}. Tente novamente.`));
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2">
        {FORMATS.map((fmt) => (
          <Button
            key={fmt.value}
            variant="secondary"
            size="sm"
            onClick={() => handleExport(fmt.value)}
            disabled={pending !== null}
          >
            {pending === fmt.value ? "Gerando…" : fmt.label}
          </Button>
        ))}
        <Button
          variant="primary"
          size="sm"
          disabled={pending !== null}
          onClick={() => download(api.exportBundleUrl(jobId, { includeTimestamps, includeSpeakers }))}
        >
          Baixar todos (ZIP)
        </Button>
      </div>
      <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-text-secondary">
        <label className="flex min-h-10 items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-[var(--color-accent)]"
            checked={includeTimestamps}
            onChange={(e) => setIncludeTimestamps(e.target.checked)}
          />
          Horários no texto
        </label>
        {hasSpeakers && (
          <label className="flex min-h-10 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-[var(--color-accent)]"
              checked={includeSpeakers}
              onChange={(e) => setIncludeSpeakers(e.target.checked)}
            />
            Nomes dos falantes
          </label>
        )}
      </div>
      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
