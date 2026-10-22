"use client";

import { useEffect, useRef } from "react";

export interface ShortcutHandlers {
  togglePlay?: () => void;
  seekBack?: () => void;
  seekForward?: () => void;
  seekBackBig?: () => void;
  seekForwardBig?: () => void;
  search?: () => void;
  save?: () => void;
  playSelected?: () => void;
  undo?: () => void;
  bookmark?: () => void;
  nextUncertain?: () => void;
  previousUncertain?: () => void;
  help?: () => void;
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

function insideDialog(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !!target.closest("[aria-modal='true']");
}

/** Global playback/editing shortcuts. Only Ctrl+F (search) and Ctrl+S (save) fire while the
 * user is typing in a field — everything else is suppressed there, per spec section 10.4.
 * Ctrl+Z outside fields undoes editor changes; inside a field the browser's own undo applies. */
export function useKeyboardShortcuts(
  handlers: ShortcutHandlers,
  enabled = true,
) {
  // Latest handlers without re-subscribing the listener on every render.
  const current = useRef(handlers);
  current.current = handlers;

  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.isComposing || insideDialog(e.target)) return;
      const h = current.current;
      const typing = isTypingTarget(e.target);
      const ctrlOrCmd = e.ctrlKey || e.metaKey;

      if (ctrlOrCmd && e.key.toLowerCase() === "f") {
        e.preventDefault();
        h.search?.();
        return;
      }
      if (ctrlOrCmd && e.key.toLowerCase() === "s") {
        e.preventDefault();
        h.save?.();
        return;
      }

      if (typing) return;

      if (ctrlOrCmd && !e.shiftKey && e.key.toLowerCase() === "z") {
        if (h.undo) {
          e.preventDefault();
          h.undo();
        }
        return;
      }
      if (ctrlOrCmd || e.altKey) return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          h.togglePlay?.();
          break;
        case "j":
        case "J":
          e.preventDefault();
          if (e.shiftKey) h.seekBackBig?.();
          else h.seekBack?.();
          break;
        case "l":
        case "L":
          e.preventDefault();
          if (e.shiftKey) h.seekForwardBig?.();
          else h.seekForward?.();
          break;
        case "m":
        case "M":
          if (h.bookmark) {
            e.preventDefault();
            h.bookmark();
          }
          break;
        case "n":
        case "N":
          if (e.shiftKey ? h.previousUncertain : h.nextUncertain) {
            e.preventDefault();
            if (e.shiftKey) h.previousUncertain?.();
            else h.nextUncertain?.();
          }
          break;
        case "?":
          if (h.help) {
            e.preventDefault();
            h.help();
          }
          break;
        case "Enter":
          h.playSelected?.();
          break;
        default:
          break;
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enabled]);
}
