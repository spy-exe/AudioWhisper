import { Suspense } from "react";
import { ProjectDetailView } from "@/components/hub/ProjectsView";
export const metadata = { title: "Projeto · AudioWhisper" };
export default async function Page({
  params,
}: {
  params: Promise<{ name: string }>;
}) {
  const { name } = await params;
  const projectName = decodeURIComponent(name);
  return (
    <Suspense
      fallback={
        <div role="status" className="hub-loading">
          Carregando projeto…
        </div>
      }
    >
      <ProjectDetailView name={projectName} />
    </Suspense>
  );
}
