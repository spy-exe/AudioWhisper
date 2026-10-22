"use client";

import { Button } from "@/components/ui/Button";
import { Dialog } from "@/components/ui/Dialog";

export const SHORTCUTS: { keys: string[]; action: string }[] = [
  { keys: ["Espaço"], action: "Reproduzir ou pausar" },
  { keys: ["J"], action: "Voltar 2 segundos (Shift+J: 10 segundos)" },
  { keys: ["L"], action: "Avançar 2 segundos (Shift+L: 10 segundos)" },
  { keys: ["M"], action: "Marcar o momento atual" },
  { keys: ["N"], action: "Próximo trecho incerto" },
  { keys: ["Shift", "N"], action: "Trecho incerto anterior" },
  { keys: ["Ctrl", "F"], action: "Buscar e substituir no texto" },
  { keys: ["Ctrl", "S"], action: "Salvar agora" },
  { keys: ["Ctrl", "Z"], action: "Desfazer (fora dos campos de texto)" },
  { keys: ["?"], action: "Mostrar estes atalhos" },
];

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog
      open={open}
      title="Atalhos do editor"
      description="Os atalhos de reprodução não disparam enquanto você digita em um campo."
      onClose={onClose}
    >
      <dl className="shortcut-list">
        {SHORTCUTS.map((shortcut) => (
          <div key={shortcut.action}>
            <dt>
              {shortcut.keys.map((key) => (
                <kbd key={key}>{key}</kbd>
              ))}
            </dt>
            <dd>{shortcut.action}</dd>
          </div>
        ))}
      </dl>
      <div className="dialog-actions">
        <Button variant="primary" onClick={onClose} data-autofocus>
          Entendi
        </Button>
      </div>
    </Dialog>
  );
}
