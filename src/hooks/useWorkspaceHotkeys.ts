import { useEffect } from "react";
import {
  useWorkspaceStore,
  useWorkspaces,
  useWorkspacesEnabled,
} from "../stores/workspaceStore";

export const IS_MACOS = navigator.userAgent.includes("Macintosh");

/**
 * Slack-style workspace switching: Cmd+1..9 (macOS) / Ctrl+1..9
 * (Windows) jumps to the Nth workspace in switcher order — the order of
 * `participant.organizations`, same as the WorkspaceSwitcher dropdown.
 *
 * Listens on window capture so it fires regardless of focus (Slack
 * switches even while you're typing — the modifier chord never inserts
 * text). Physical digit keys via e.code, so layouts where digits are
 * shifted (AZERTY) still work; Shift is therefore NOT treated as a
 * disqualifier, but Alt is (Alt+Cmd+digit is a different chord).
 */
export function useWorkspaceHotkeys() {
  const enabled = useWorkspacesEnabled();
  const workspaces = useWorkspaces();

  useEffect(() => {
    if (!enabled || workspaces.length < 2) return;

    const onKey = (e: KeyboardEvent) => {
      const mod = IS_MACOS ? e.metaKey && !e.ctrlKey : e.ctrlKey && !e.metaKey;
      if (!mod || e.altKey || e.repeat) return;

      const match = /^(?:Digit|Numpad)([1-9])$/.exec(e.code);
      if (!match) return;

      const target = workspaces[Number(match[1]) - 1];
      if (!target) return;

      e.preventDefault();
      // switch() no-ops on the active workspace and coalesces while a
      // switch is in flight; failures surface via the switcher's
      // ErrorBanner (lastError), so swallow the rejection here.
      useWorkspaceStore
        .getState()
        .switch(target.id)
        .catch(() => {});
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [enabled, workspaces]);
}
