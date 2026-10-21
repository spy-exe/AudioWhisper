"use client";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { Button } from "./Button";
import { Icon } from "./Icon";

export function AuthGate({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const publicPage = pathname.startsWith("/shared/");
  const [state, setState] = useState<"loading" | "login" | "ready" | "error">(
    "loading",
  );
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState(false);
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState("");
  const check = useCallback(() => {
    setState("loading");
    fetch("/api/session", { cache: "no-store" })
      .then((r) => {
        if (!r.ok) throw new Error();
        return r.json();
      })
      .then((s) => setState(s.authenticated ? "ready" : "login"))
      .catch(() => setState("error"));
  }, []);
  useEffect(() => {
    if (!publicPage) check();
    const expired = () => {
      setState("login");
      setError("Sua sessão expirou. Entre novamente para continuar.");
    };
    window.addEventListener("audiowhisper:unauthorized", expired);
    return () =>
      window.removeEventListener("audiowhisper:unauthorized", expired);
  }, [check, publicPage]);
  if (publicPage || state === "ready") return children;
  if (state === "loading")
    return (
      <div role="status" className="mx-auto mt-24 max-w-md p-6">
        <div className="skeleton h-48" aria-label="Verificando sessão local" />
      </div>
    );
  if (state === "error")
    return (
      <div role="alert" className="mx-auto mt-24 max-w-md space-y-4 p-6">
        <p>Não foi possível conectar ao AudioWhisper.</p>
        <Button onClick={check}>Tentar novamente</Button>
      </div>
    );
  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-5 p-6">
      <Icon name="shield" className="size-9 text-accent" />
      <h1 className="font-[var(--font-display)] text-3xl">
        Seu Studio, protegido.
      </h1>
      <p className="text-sm text-text-secondary">
        Entre com o token de acesso configurado nesta instalação.
      </p>
      <form
        noValidate
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy) return;
          if (!token.trim()) {
            setError("Informe o token de acesso.");
            return;
          }
          setBusy(true);
          setError("");
          try {
            const r = await fetch("/api/session", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ token }),
            });
            if (!r.ok) throw new Error();
            setToken("");
            setState("ready");
          } catch {
            setError(
              "Token inválido ou serviço indisponível. Verifique e tente novamente.",
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        <label htmlFor="access-token" className="text-sm">
          Token de acesso
        </label>
        <div className="flex gap-2">
          <input
            id="access-token"
            autoComplete="current-password"
            autoFocus
            type={visible ? "text" : "password"}
            value={token}
            onChange={(e) => setToken(e.target.value)}
            className="field"
            aria-invalid={!!error}
            aria-describedby={error ? "login-error" : undefined}
          />
          <Button
            type="button"
            aria-label={visible ? "Ocultar token" : "Mostrar token"}
            onClick={() => setVisible(!visible)}
          >
            {visible ? "Ocultar" : "Mostrar"}
          </Button>
        </div>
        {error && (
          <p id="login-error" role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <Button
          type="submit"
          variant="primary"
          className="min-w-28"
          disabled={busy}
        >
          {busy ? "Entrando…" : "Entrar no Studio"}
        </Button>
      </form>
    </div>
  );
}
