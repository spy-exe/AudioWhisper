import type { JobStatus } from "./types";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export async function requestNotificationPermission(): Promise<
  NotificationPermission | "unsupported"
> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  return Notification.requestPermission();
}

const MESSAGES: Partial<Record<JobStatus, string>> = {
  completed: "Transcrição concluída. Pronta para revisão.",
  failed: "A transcrição não foi concluída. Abra para tentar novamente.",
};

/** Only when the tab is in the background: on screen, the page itself already shows the result. */
export function notifyJobFinished(
  title: string,
  status: JobStatus,
  onOpen?: () => void,
): Notification | null {
  const body = MESSAGES[status];
  if (
    !body ||
    !notificationsSupported() ||
    Notification.permission !== "granted" ||
    document.visibilityState === "visible"
  )
    return null;
  const notification = new Notification(title, {
    body,
    tag: `audiowhisper-${title}`,
    icon: "/favicon.svg",
  });
  notification.onclick = () => {
    window.focus();
    onOpen?.();
    notification.close();
  };
  return notification;
}

export function progressTitle(base: string, progress: number | null): string {
  if (progress == null || !Number.isFinite(progress)) return base;
  return `(${Math.round(Math.min(1, Math.max(0, progress)) * 100)}%) ${base}`;
}
