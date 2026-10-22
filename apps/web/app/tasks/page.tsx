import { Suspense } from "react";
import { TasksView } from "@/components/hub/TasksView";
export const metadata = { title: "Tarefas · AudioWhisper" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div role="status" className="hub-loading">
          Carregando próximos passos…
        </div>
      }
    >
      <TasksView />
    </Suspense>
  );
}
