import { Suspense } from "react";
import { KnowledgeView } from "@/components/hub/KnowledgeView";
export const metadata = { title: "Consultas · AudioWhisper" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div role="status" className="hub-loading">
          Carregando assistente…
        </div>
      }
    >
      <KnowledgeView />
    </Suspense>
  );
}
