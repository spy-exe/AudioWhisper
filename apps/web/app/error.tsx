"use client";

import Link from "next/link";
import { useEffect } from "react";

import { Button } from "@/components/ui/Button";

/** Last-resort boundary: a rendering failure keeps the shell and offers a way back. */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className="mx-auto flex max-w-xl flex-col items-center gap-4 px-6 py-20 text-center">
      <h1 className="font-[var(--font-display)] text-2xl font-semibold">Algo saiu do previsto nesta tela</h1>
      <p className="text-text-secondary">
        Seus dados continuam salvos. Tente carregar a tela de novo; se o problema continuar, volte ao Studio.
      </p>
      {error.digest && <p className="font-mono text-xs text-text-muted">Código: {error.digest}</p>}
      <div className="flex flex-wrap justify-center gap-3">
        <Button variant="primary" onClick={reset}>
          Tentar novamente
        </Button>
        <Link href="/" className="inline-flex min-h-12 items-center px-4 text-sm text-text-secondary hover:text-accent">
          Voltar ao Studio
        </Link>
      </div>
    </div>
  );
}
