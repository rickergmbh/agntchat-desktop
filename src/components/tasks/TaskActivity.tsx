import { useTranslation } from "react-i18next";
import { PhaseOrb } from "../PhaseOrb";
import { cn } from "../../lib/utils";

/** Older steps kept under the current one before the trail is cut off. */
const HISTORY_LIMIT = 4;

/**
 * The live activity rail on an in-flight action.
 *
 * The current step is pinned at the top beside the thinking orb and the trail
 * of what came before descends underneath it, newest first, fading out as it
 * goes. Pinning the head means a new step pushes history DOWN instead of
 * moving the line the reader is watching, and the fade gives the rail an end
 * without needing a hard rule.
 *
 * Purely presentational — callers pass the step list (see `taskStore`'s
 * `taskProgress`), which is also what lets the previews gallery render it.
 * Kept in parity with web/src/components/tasks/TaskActivity.tsx.
 */
export function TaskActivity({
  steps,
  className,
}: {
  /** Oldest → newest, as accumulated by the task store. */
  steps: string[];
  className?: string;
}) {
  const { t } = useTranslation("tasks");
  if (steps.length === 0) return null;

  const current = steps[steps.length - 1];
  const history = steps.slice(0, -1).slice(-HISTORY_LIMIT).reverse();

  return (
    <section className={cn("space-y-2", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {t("liveActivity")}
      </h3>

      <ol
        aria-live="polite"
        className="relative rounded-xl border border-border/70 bg-muted/40 px-4 py-3.5 space-y-2"
      >
        {/* The rail. Runs from just under the orb to the last dot; the gradient
         *  lets it dissolve into the card instead of stopping on a hard edge.
         *  Offsets are measured from the padding box: 16px (px-4) + half the
         *  20px marker gutter puts it on the markers' centre line, and 14px
         *  (py-3.5) + the 20px orb starts it just clear of the head. */}
        {history.length > 0 && (
          <span
            aria-hidden="true"
            className="pointer-events-none absolute left-[25.5px] top-[34px] bottom-[20px] w-px bg-gradient-to-b from-border-strong to-transparent"
          />
        )}

        <li className="relative flex items-start gap-2.5">
          <PhaseOrb state="working" className="shrink-0" />
          <span className="text-[13px] font-medium leading-5 text-foreground">
            {current}
          </span>
        </li>

        {history.map((step, i) => (
          <li key={`${i}-${step}`} className="relative flex items-start gap-2.5">
            <span className="flex h-5 w-5 shrink-0 items-center justify-center">
              <span className="h-1.5 w-1.5 rounded-full bg-border-strong" />
            </span>
            <span
              className="text-xs leading-5 text-muted-foreground"
              // Older steps recede rather than disappearing — the trail reads
              // as depth, not as four equally-loud lines competing with the head.
              style={{ opacity: 1 - i * 0.18 }}
            >
              {step}
            </span>
          </li>
        ))}
      </ol>
    </section>
  );
}
