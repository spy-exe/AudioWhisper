import { Suspense } from "react";
import { RecipesView } from "@/components/hub/RecipesView";
export const metadata = { title: "Modelos de documento · AudioWhisper" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div role="status" className="hub-loading">
          Carregando receitas…
        </div>
      }
    >
      <RecipesView />
    </Suspense>
  );
}
