import { useEffect, useRef, useState } from "react";
import { Brain } from "lucide-react";
import { useTranslation } from "react-i18next";

import { ws } from "../services/websocket";
import { useNavStore } from "../stores/navStore";
import { useAgentStore } from "../stores/agentStore";
import { useMemoryToastStore, type MemorySavedEvent } from "../stores/memoryToastStore";

/**
 * "Memory island" — the transient surface for agent memory saves. A small
 * brain dot appears top-center, blooms into a pill showing who remembered
 * what, holds, then collapses back to the dot and fades. Clicking the open
 * pill deep-links to that agent's Memory section on the matching scope tab.
 * Mounted once in AppShell. Mirrors mobile's MemorySavedToast.
 *
 * The pill paints in the FOREGROUND color (black on light, white on dark) —
 * the inversion is what keeps it from getting lost against app chrome.
 */
const HOLD_MS = 4000;
const COLLAPSE_MS = 240;

export function MemorySavedToast() {
  const { t } = useTranslation("memory");
  const event = useMemoryToastStore((s) => s.queue[0] ?? null);
  const queued = useMemoryToastStore((s) => s.queue.length);
  const push = useMemoryToastStore((s) => s.push);
  const openMemoryDeepLink = useNavStore((s) => s.openMemoryDeepLink);
  const setView = useNavStore((s) => s.setView);
  const selectAgent = useAgentStore((s) => s.selectAgent);

  const [open, setOpen] = useState(false);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    const unsub = ws.on("memory_saved", (payload) => {
      push(payload as unknown as MemorySavedEvent);
    });
    return unsub;
  }, [push]);

  // Bloom → hold → collapse → advance, restarted for each queued event.
  const eventKey = event?.memoryId ?? null;
  useEffect(() => {
    if (!eventKey) return;
    setOpen(false);
    const clearAll = () => {
      timers.current.forEach(clearTimeout);
      timers.current = [];
    };

    timers.current.push(window.setTimeout(() => setOpen(true), 40));
    timers.current.push(
      window.setTimeout(() => setOpen(false), 40 + HOLD_MS)
    );
    timers.current.push(
      window.setTimeout(
        () => useMemoryToastStore.getState().dismiss(),
        40 + HOLD_MS + COLLAPSE_MS
      )
    );
    return clearAll;
  }, [eventKey]);

  if (!event) return null;

  const title = event.agentName
    ? event.scope === "family"
      ? t("savedToast.titleFamily", { name: event.agentName })
      : t("savedToast.title", { name: event.agentName })
    : t("savedToast.titleUnknown");

  const review = () => {
    useMemoryToastStore.getState().clear();
    void selectAgent(event.agentId);
    openMemoryDeepLink(event.agentId, event.scope);
    setView("agents");
  };

  return (
    <div className="pointer-events-none fixed left-1/2 top-4 z-50 -translate-x-1/2">
      <div className="relative">
        {/* Entrance ring — catches peripheral vision on arrival. */}
        {open && (
          <span className="pointer-events-none absolute inset-0 animate-ping rounded-full border-2 border-primary opacity-60" />
        )}
        <button
          type="button"
          onClick={review}
          title={`${title} — ${event.content}`}
          className={[
            "pointer-events-auto relative flex h-11 items-center overflow-hidden rounded-full",
            "bg-foreground text-background shadow-lg transition-[max-width] duration-300 ease-out",
            open ? "max-w-md" : "max-w-11",
          ].join(" ")}
        >
          <span className="flex h-11 w-11 shrink-0 items-center justify-center">
            <Brain className="h-5 w-5 text-primary" />
          </span>
          <span
            className={[
              "min-w-0 pr-5 text-left transition-opacity duration-200",
              open ? "opacity-100" : "opacity-0",
            ].join(" ")}
          >
            <span className="block truncate text-xs font-medium">
              {title}
              {queued > 1 ? `  ·  +${queued - 1}` : ""}
            </span>
            <span className="block truncate text-[11px] opacity-70">
              {event.content}
            </span>
          </span>
        </button>
      </div>
    </div>
  );
}

/** Presentational island for the component preview gallery — always open. */
export function MemorySavedToastCard({
  title,
  content,
}: {
  title: string;
  content: string;
}) {
  return (
    <div className="flex h-11 max-w-md items-center overflow-hidden rounded-full bg-foreground text-background shadow-lg">
      <span className="flex h-11 w-11 shrink-0 items-center justify-center">
        <Brain className="h-5 w-5 text-primary" />
      </span>
      <span className="min-w-0 pr-5 text-left">
        <span className="block truncate text-xs font-medium">{title}</span>
        <span className="block truncate text-[11px] opacity-70">{content}</span>
      </span>
    </div>
  );
}
