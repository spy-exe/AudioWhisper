import { clsx } from "clsx";

interface ProgressBarProps {
  value: number; // 0..1
  tone?: "accent" | "success" | "danger";
  className?: string;
  label?: string;
}

const TONE_CLASSES: Record<NonNullable<ProgressBarProps["tone"]>, string> = {
  accent: "bg-accent",
  success: "bg-success",
  danger: "bg-danger",
};

export function ProgressBar({ value, tone = "accent", className, label = "Progresso do processamento" }: ProgressBarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div
      className={clsx("h-1.5 w-full overflow-hidden rounded-full bg-surface-interactive", className)}
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div
        className={clsx("h-full rounded-full transition-[width] duration-300 ease-out", TONE_CLASSES[tone])}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}
