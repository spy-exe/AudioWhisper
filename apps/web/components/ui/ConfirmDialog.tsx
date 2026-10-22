"use client";

import { useState } from "react";
import type { ReactNode } from "react";

import { Button } from "./Button";
import { Dialog } from "./Dialog";

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  onConfirm: () => Promise<void> | void;
  onClose: () => void;
}

/** Replaces window.confirm: the error of a failed action stays inside the dialog, next to it. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  danger = false,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const dismiss = () => {
    if (busy) return;
    setError("");
    onClose();
  };
  return (
    <Dialog
      open={open}
      title={title}
      description={description}
      onClose={dismiss}
      role="alertdialog"
    >
      {error && (
        <p role="alert" className="mt-4 text-sm text-danger">
          {error}
        </p>
      )}
      <div className="dialog-actions">
        <Button variant="ghost" onClick={dismiss} disabled={busy} data-autofocus>
          Cancelar
        </Button>
        <Button
          variant={danger ? "danger" : "primary"}
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError("");
            try {
              await onConfirm();
              setBusy(false);
              onClose();
            } catch (failure) {
              setBusy(false);
              setError(
                failure instanceof Error && failure.message
                  ? failure.message
                  : "Não foi possível concluir. Tente novamente.",
              );
            }
          }}
        >
          {busy ? "Aguarde…" : confirmLabel}
        </Button>
      </div>
    </Dialog>
  );
}
