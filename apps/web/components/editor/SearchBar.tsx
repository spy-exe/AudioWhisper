"use client";

import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/Button";

interface SearchBarProps {
  query: string;
  onQueryChange: (q: string) => void;
  replaceValue: string;
  onReplaceChange: (r: string) => void;
  matchCount: number;
  currentMatchIndex: number;
  onNext: () => void;
  onPrev: () => void;
  onReplaceAll: () => void;
  onClose: () => void;
}

export function SearchBar({
  query,
  onQueryChange,
  replaceValue,
  onReplaceChange,
  matchCount,
  currentMatchIndex,
  onNext,
  onPrev,
  onReplaceAll,
  onClose,
}: SearchBarProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  return (
    <div
      className="flex flex-wrap items-center gap-2 rounded-md border border-border bg-surface-raised p-2"
      onKeyDown={(e) => {
        if (e.nativeEvent.isComposing) return;
        if (e.key === "Escape") onClose();
        if (e.key === "Enter") {
          e.preventDefault();
          if (e.shiftKey) onPrev();
          else onNext();
        }
      }}
    >
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => onQueryChange(e.target.value)}
        placeholder="Pesquisar na transcrição…"
        aria-label="Pesquisar"
        className="min-w-[180px] flex-1 rounded bg-surface-interactive px-2 py-1 text-sm text-text-primary outline-none"
      />
      {query && (
        <Button
          variant="ghost"
          size="sm"
          aria-label="Limpar pesquisa"
          onClick={() => {
            onQueryChange("");
            inputRef.current?.focus();
          }}
        >
          ✕
        </Button>
      )}
      <span className="whitespace-nowrap text-xs text-text-muted">
        {matchCount > 0 ? `${currentMatchIndex + 1}/${matchCount}` : "0/0"}
      </span>
      <Button
        variant="ghost"
        size="sm"
        onClick={onPrev}
        disabled={matchCount === 0}
        aria-label="Resultado anterior"
      >
        ↑
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onNext}
        disabled={matchCount === 0}
        aria-label="Próximo resultado"
      >
        ↓
      </Button>
      <input
        value={replaceValue}
        onChange={(e) => onReplaceChange(e.target.value)}
        placeholder="Substituir por…"
        aria-label="Substituir por"
        className="min-w-[140px] flex-1 rounded bg-surface-interactive px-2 py-1 text-sm text-text-primary outline-none"
      />
      <Button
        variant="secondary"
        size="sm"
        onClick={onReplaceAll}
        disabled={matchCount === 0}
      >
        Substituir tudo
      </Button>
      <Button
        variant="ghost"
        size="sm"
        onClick={onClose}
        aria-label="Fechar pesquisa"
      >
        ✕
      </Button>
    </div>
  );
}
