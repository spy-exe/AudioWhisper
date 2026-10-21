"use client";
import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import type { AIDocument, ShareLink } from "@/lib/types";
import { Button } from "@/components/ui/Button";

export function SharePanel({ document }: { document: AIDocument }) {
  const [links, setLinks] = useState<ShareLink[]>([]);
  const [newLink, setNewLink] = useState("");
  const [hours, setHours] = useState(24);
  const [recipient, setRecipient] = useState("");
  const [subject, setSubject] = useState("Encaminhamentos da reunião");
  const [status, setStatus] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestId = useRef<string | null>(null);
  useEffect(() => {
    api
      .shares(document.id)
      .then(setLinks)
      .catch(() => setError("Não foi possível carregar os links."));
  }, [document.id]);
  const perform = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    setStatus("");
    try {
      await action();
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Não foi possível concluir. Tente novamente.",
      );
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-5 border-t border-border pt-5">
      <div>
        <h4 className="text-sm font-semibold">
          Compartilhar documento revisado
        </h4>
        <p className="mt-1 text-xs text-text-muted">
          Escolha como enviar. O áudio original permanece privado.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-text-secondary">
          Link válido por{" "}
          <select
            aria-label="Validade do link privado"
            className="field mt-1 w-auto"
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
          >
            <option value={24}>24 horas</option>
            <option value={168}>7 dias</option>
            <option value={720}>30 dias</option>
          </select>
        </label>
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            perform(async () => {
              const link = await api.createShare(document.id, hours);
              setNewLink(window.location.origin + link.path);
              setLinks(await api.shares(document.id));
              setStatus(
                "Link privado criado. Somente quem possui o link pode ler o documento.",
              );
            })
          }
        >
          Criar link privado
        </Button>
      </div>
      {newLink && (
        <div className="flex gap-2">
          <input
            aria-label="Novo link privado"
            className="field"
            value={newLink}
            readOnly
            onFocus={(e) => e.currentTarget.select()}
          />
          <Button
            size="sm"
            onClick={() =>
              perform(async () => {
                await navigator.clipboard.writeText(newLink);
                setStatus("Link copiado.");
              })
            }
          >
            Copiar
          </Button>
        </div>
      )}
      {links.length > 0 && (
        <ul className="max-h-36 space-y-2 overflow-y-auto">
          {links.map((link) => (
            <li
              key={link.id}
              className="flex flex-wrap items-center justify-between gap-2 text-xs text-text-muted"
            >
              <span>
                {link.revoked
                  ? "Revogado"
                  : `Expira em ${new Date(link.expires_at + (link.expires_at.endsWith("Z") ? "" : "Z")).toLocaleString("pt-BR")}`}
              </span>
              {!link.revoked && (
                <Button
                  size="sm"
                  variant="danger"
                  disabled={busy}
                  onClick={() =>
                    perform(async () => {
                      await api.revokeShare(link.id);
                      setLinks(await api.shares(document.id));
                      setStatus("Link revogado.");
                    })
                  }
                >
                  Revogar
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <a
          href={`mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(document.markdown)}`}
          className="rounded-md border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-interactive"
        >
          Preparar no app de e-mail
        </a>
        {document.markdown.length < 6000 ? (
          <a
            href={`https://wa.me/?text=${encodeURIComponent(document.markdown)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="rounded-md border border-border px-3 py-2 text-xs text-text-secondary transition-colors hover:bg-surface-interactive"
          >
            Preparar no WhatsApp ↗
          </a>
        ) : (
          <Button
            size="sm"
            onClick={() =>
              perform(async () => {
                await navigator.clipboard.writeText(document.markdown);
                setStatus(
                  "Texto copiado. Cole na conversa do WhatsApp e revise o destinatário.",
                );
              })
            }
          >
            Copiar texto para WhatsApp
          </Button>
        )}
      </div>
      <details className="rounded-lg border border-border p-3">
        <summary className="text-xs font-medium text-text-secondary">
          Enviar pelo SMTP configurado
        </summary>
        <form
          noValidate
          className="mt-4 space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            if (!recipient.includes("@") || !subject.trim()) {
              setError("Preencha destinatário e assunto.");
              return;
            }
            void perform(async () => {
              requestId.current ??= crypto.randomUUID();
              const result = await api.emailDocument(
                document.id,
                recipient,
                subject,
                requestId.current,
              );
              setStatus(
                result.status === "sent"
                  ? "E-mail enviado."
                  : "O envio tem estado incerto. Verifique a caixa de saída antes de tentar outro envio.",
              );
            });
          }}
        >
          <label className="block text-xs text-text-secondary">
            Destinatário
            <input
              type="email"
              className="field mt-1"
              value={recipient}
              onChange={(e) => {
                setRecipient(e.target.value);
                requestId.current = null;
              }}
              placeholder="pessoa@empresa.com"
            />
          </label>
          <label className="block text-xs text-text-secondary">
            Assunto
            <input
              className="field mt-1"
              value={subject}
              onChange={(e) => {
                setSubject(e.target.value);
                requestId.current = null;
              }}
            />
          </label>
          <p className="text-xs text-text-muted">
            Será enviado o documento revisado exibido acima, sem anexar a
            gravação.
          </p>
          <Button type="submit" size="sm" variant="primary" disabled={busy}>
            Enviar e-mail revisado
          </Button>
        </form>
      </details>
      {status && (
        <p role="status" className="text-xs leading-relaxed text-success">
          {status}
        </p>
      )}
      {error && (
        <p role="alert" className="text-xs leading-relaxed text-danger">
          {error}
        </p>
      )}
    </div>
  );
}
