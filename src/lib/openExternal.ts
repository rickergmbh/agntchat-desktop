import { open as tauriOpen } from "@tauri-apps/plugin-shell";

/** Open a URL in the system browser — Tauri native with window.open fallback. */
export function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}
