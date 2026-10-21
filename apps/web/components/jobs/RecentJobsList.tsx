"use client";
import { Suspense } from "react";
import { LibraryView } from "./LibraryView";
export function RecentJobsList() {
  return (
    <Suspense
      fallback={
        <div
          className="skeleton h-48"
          role="status"
          aria-label="Carregando atividade recente"
        />
      }
    >
      <LibraryView recent />
    </Suspense>
  );
}
