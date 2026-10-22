"use client";

import { AnimatePresence, motion } from "motion/react";
import { useCallback, useRef, useState } from "react";

import { api, ApiError } from "@/lib/api";
import { ACCEPTED_ACCEPT_ATTR, ACCEPTED_EXTENSIONS } from "@/lib/constants";
import { useSettings } from "@/contexts/SettingsContext";

import { Icon } from "@/components/ui/Icon";
import { UploadQueueItem, type UploadItemState } from "./UploadQueueItem";

const abortControllers = new Map<string, AbortController>();

function isAcceptedFile(file: File): boolean {
  const ext = file.name.split(".").pop()?.toLowerCase();
  return !!ext && (ACCEPTED_EXTENSIONS as readonly string[]).includes(ext);
}

export function UploadDropzone() {
  const { settings } = useSettings();
  const [items, setItems] = useState<UploadItemState[]>([]);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const updateItem = useCallback(
    (clientId: string, patch: Partial<UploadItemState>) => {
      setItems((prev) =>
        prev.map((it) => (it.clientId === clientId ? { ...it, ...patch } : it)),
      );
    },
    [],
  );

  const uploadFile = useCallback(
    (file: File) => {
      const clientId = crypto.randomUUID();
      const controller = new AbortController();
      abortControllers.set(clientId, controller);

      setItems((prev) => [
        ...prev,
        { clientId, file, progress: 0, status: "uploading" as const },
      ]);

      api
        .uploadMedia(
          file,
          (pct) => updateItem(clientId, { progress: pct }),
          controller.signal,
        )
        .then((media) => {
          updateItem(clientId, { status: "ready", media, progress: 100 });
        })
        .catch((err: unknown) => {
          if (err instanceof DOMException && err.name === "AbortError") {
            setItems((prev) => prev.filter((it) => it.clientId !== clientId));
            return;
          }
          const message =
            err instanceof ApiError ? err.message : "Falha no upload";
          updateItem(clientId, { status: "error", error: message });
        })
        .finally(() => abortControllers.delete(clientId));
    },
    [updateItem],
  );

  const handleFiles = useCallback(
    (fileList: FileList | null) => {
      if (!fileList) return;
      Array.from(fileList).forEach((file) => {
        if (isAcceptedFile(file)) {
          uploadFile(file);
        } else {
          const clientId = crypto.randomUUID();
          setItems((prev) => [
            ...prev,
            {
              clientId,
              file,
              progress: 0,
              status: "error" as const,
              error: `Formato não suportado (.${file.name.split(".").pop()})`,
            },
          ]);
        }
      });
    },
    [uploadFile],
  );

  const handleRemove = useCallback((clientId: string) => {
    abortControllers.get(clientId)?.abort();
    setItems((prev) => prev.filter((it) => it.clientId !== clientId));
  }, []);

  return (
    <div className="flex flex-col gap-6">
      <motion.button
        type="button"
        aria-label="Área de upload · arraste arquivos ou pressione Enter para selecionar"
        onClick={() => inputRef.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          handleFiles(e.dataTransfer.files);
        }}
        animate={{ scale: dragActive ? 1.01 : 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 25 }}
        className={`upload-dropzone relative isolate flex min-h-60 w-full flex-col items-center justify-center gap-2 overflow-hidden rounded-xl border border-dashed px-6 py-8 text-center transition-colors duration-200 ${
          dragActive
            ? "border-accent bg-accent/5"
            : "border-border bg-surface hover:border-text-muted"
        }`}
      >
        <span className="mb-3 flex size-12 items-center justify-center rounded-xl border border-border bg-surface-raised text-accent">
          <Icon name="upload" className="size-6" />
        </span>
        <span className="font-[var(--font-display)] text-xl text-text-primary">
          Solte áudio ou vídeo aqui
        </span>
        <span className="text-sm text-text-secondary">
          ou selecione arquivos para começar
        </span>
        <span className="mt-3 max-w-lg text-xs leading-relaxed text-text-muted">
          {ACCEPTED_EXTENSIONS.join(" · ")}
        </span>
      </motion.button>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPTED_ACCEPT_ATTR}
        className="hidden"
        aria-label="Selecionar arquivos de áudio ou vídeo"
        onChange={(e) => {
          handleFiles(e.target.files);
          e.target.value = "";
        }}
      />

      <AnimatePresence initial={false}>
        {items.length > 0 && (
          <motion.div
            layout
            className="flex flex-col gap-3"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
          >
            <AnimatePresence initial={false}>
              {items.map((item) => (
                <motion.div
                  key={item.clientId}
                  layout
                  initial={{ opacity: 0, y: -8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: 24 }}
                  transition={{ duration: 0.2 }}
                >
                  <UploadQueueItem
                    item={item}
                    appSettings={settings}
                    onRemove={handleRemove}
                  />
                </motion.div>
              ))}
            </AnimatePresence>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
