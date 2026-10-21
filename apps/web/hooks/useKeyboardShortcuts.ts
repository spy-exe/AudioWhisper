"use client";

import { useEffect } from "react";

export interface ShortcutHandlers {
  togglePlay?: () => void;
  seekBack?: () => void;
  seekForward?: () => void;
  seekBackBig?: () => void;
  seekForwardBig?: () => void;
  search?: () => void;
  save?: () => void;
  playSelected?: () => void;
}

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    target.isContentEditable ||
    !!target.closest("button, a, select, summary")
  );
}

/** Global playback/editing shortcuts. Only Ctrl+F (search) and Ctrl+S (save) fire while the
 * user is typing in a field — everything else is suppressed there, per spec section 10.4. */
export function useKeyboardShortcuts(
  handlers: ShortcutHandlers,
  enabled = true,
) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      const typing = isTypingTarget(e.target);
      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      if (ctrlOrCmd && e.key.toLowerCase() === "f") {
        e.preventDefault();
        handlers.search?.();
        return;
      }
      if (ctrlOrCmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        handlers.save?.();
        return;
      }

      if (typing) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          handlers.togglePlay?.();
          break;
        case "j":
        case "J":
          e.preventDefault();
          if (e.shiftKey) handlers.seekBackBig?.();
          else handlers.seekBack?.();
          break;
        case "l":
        case "L":
          e.preventDefault();
          if (e.shiftKey) handlers.seekForwardBig?.();
          else handlers.seekForward?.();
          break;
        case "Enter":
          handlers.playSelected?.();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [handlers, enabled]);
}
