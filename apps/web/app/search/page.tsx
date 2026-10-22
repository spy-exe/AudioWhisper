import { Suspense } from "react";
import { SearchView } from "@/components/search/SearchView";

export default function SearchPage() {
  return (
    <div className="mx-auto flex max-w-5xl flex-col gap-7 px-4 py-8 sm:px-8">
      <div className="page-heading">
        <p className="mb-2 text-xs uppercase tracking-widest text-accent">Em tudo que foi dito</p>
        <h1 className="font-[var(--font-display)] text-3xl font-semibold">Buscar momentos</h1>
        <p className="mt-2 text-sm text-text-secondary">
          Encontre o instante exato de uma fala e ouça a partir dali.
        </p>
      </div>
      <Suspense fallback={<p role="status">Carregando busca…</p>}>
        <SearchView />
      </Suspense>
    </div>
  );
}
