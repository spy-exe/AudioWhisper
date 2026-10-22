import { Suspense } from "react";
import { CommandCenter } from "@/components/hub/CommandCenter";
export const metadata = { title: "Central · AudioWhisper" };
export default function Page() {
  return (
    <Suspense
      fallback={
        <div role="status" className="hub-loading">
          Carregando central…
        </div>
      }
    >
      <CommandCenter />
    </Suspense>
  );
}
