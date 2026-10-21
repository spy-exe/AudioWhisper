import { clsx } from "clsx";
import { motion, type HTMLMotionProps } from "motion/react";

interface ButtonProps extends HTMLMotionProps<"button"> {
  variant?: "primary" | "secondary" | "ghost" | "danger";
  size?: "sm" | "md";
}

const VARIANT_CLASSES: Record<NonNullable<ButtonProps["variant"]>, string> = {
  primary: "button-primary bg-accent text-background hover:brightness-110 active:brightness-95",
  secondary:
    "bg-surface-interactive text-text-primary border border-border hover:border-accent/60",
  ghost: "bg-transparent text-text-secondary hover:text-text-primary hover:bg-surface-interactive",
  danger: "bg-transparent text-danger border border-danger/40 hover:bg-danger/10",
};

const SIZE_CLASSES: Record<NonNullable<ButtonProps["size"]>, string> = {
  sm: "min-h-10 px-3.5 py-2 text-xs gap-2",
  md: "min-h-12 px-5 py-2.5 text-sm gap-2.5",
};

export function Button({
  variant = "secondary",
  size = "md",
  className,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <motion.button
      whileTap={disabled ? undefined : { scale: 0.98 }}
      transition={{ type: "spring", stiffness: 500, damping: 30 }}
      className={clsx(
        "inline-flex items-center justify-center rounded-lg font-semibold transition-[background-color,border-color,box-shadow,color] duration-200",
        "disabled:opacity-40 disabled:pointer-events-none",
        VARIANT_CLASSES[variant],
        SIZE_CLASSES[size],
        className
      )}
      disabled={disabled}
      {...props}
    />
  );
}
