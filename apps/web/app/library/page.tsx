import { Suspense } from "react";
import { LibraryView } from "@/components/jobs/LibraryView";

export default function LibraryPage() {
  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-7 px-4 py-8 sm:px-8">
      <div className="page-heading">
        <h1 className="font-[var(--font-display)] text-3xl font-semibold">
          Biblioteca
        </h1>
        <p className="mt-2 text-sm text-text-secondary">
          Gravações, transcrições e documentos.
        </p>
      </div>
      <Suspense fallback={<p role="status">Carregando biblioteca…</p>}>
        <LibraryView />
      </Suspense>
    </div>
  );
}
