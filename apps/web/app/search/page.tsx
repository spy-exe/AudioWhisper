import { Suspense } from "react";
import { EvidenceSearch } from "@/components/hub/EvidenceSearch";
export const metadata = { title: "Buscar trechos · AudioWhisper" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div role="status" className="hub-loading">
          Carregando buscar trechos…
        </div>
      }
    >
      <EvidenceSearch />
    </Suspense>
  );
}
