"use client";

import { useState } from "react";

import { api, ApiError } from "@/lib/api";
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
];

export function ExportMenu({ jobId }: { jobId: string }) {
  const [pending, setPending] = useState<ExportFormat | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleExport = async (format: ExportFormat) => {
    setPending(format);
    setError(null);
    try {
      const [exportFile] = await api.createExports(jobId, [format]);
      if (exportFile) {
        const a = document.createElement("a");
        a.href = api.downloadExportUrl(exportFile.id);
        a.download = "";
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : `Falha ao exportar ${format}`,
      );
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="flex flex-col gap-2">
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
      </div>
      {error && <p className="text-xs text-danger">{error}</p>}
    </div>
  );
}
