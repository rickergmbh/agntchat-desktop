import { useEffect } from "react";
import { useRailStore } from "../stores/railStore";

function isEditable(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || !el.tagName) return false;
  const tag = el.tagName.toLowerCase();
  return tag === "input" || tag === "textarea" || el.isContentEditable;
}

/**
 * Cmd/Ctrl+B toggles the left rail between icon-only and expanded — the
 * same chord VS Code and Slack use for their sidebars.
 *
 * Ignored while the caret is in a text field: composers may bind ⌘B to
 * bold, and stealing it there would be worse than having no hotkey.
 * Mirrors `web/src/hooks/useRailHotkey.ts`.
 */
export function useRailHotkey() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey || e.repeat) return;
      if (e.code !== "KeyB") return;
      if (isEditable(e.target)) return;
      e.preventDefault();
      useRailStore.getState().toggle();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
