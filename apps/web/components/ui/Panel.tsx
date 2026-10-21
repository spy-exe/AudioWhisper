import { clsx } from "clsx";
import type { HTMLAttributes } from "react";

interface PanelProps extends HTMLAttributes<HTMLDivElement> {
  raised?: boolean;
}

export function Panel({ raised = false, className, ...props }: PanelProps) {
  return (
    <div
      className={clsx(
        "studio-panel rounded-2xl border border-border",
        raised ? "bg-surface-raised" : "bg-surface",
        className
      )}
      {...props}
    />
  );
}
