import { Suspense } from "react";
import { ProjectsView } from "@/components/hub/ProjectsView";
export const metadata = { title: "Projetos — AudioWhisper" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div role="status" className="hub-loading">
          Carregando projetos…
        </div>
      }
    >
      <ProjectsView />
    </Suspense>
  );
}
