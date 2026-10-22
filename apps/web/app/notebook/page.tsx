import { Suspense } from "react";
import { NotebookView } from "@/components/hub/NotebookView";
export const metadata = { title: "Caderno · AudioWhisper" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div role="status" className="hub-loading">
          Carregando caderno…
        </div>
      }
    >
      <NotebookView />
    </Suspense>
  );
}
