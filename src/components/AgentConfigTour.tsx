import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

/** A measured screen rect for the sidebar group a step points at. `null` for
 *  the intro step, which has no anchor and centers its card. */
export type TourRect = { top: number; left: number; width: number; height: number } | null;

export interface TourStep {
  titleKey: string;
  bodyKey: string;
}

/**
 * Guided coach-mark tour for the agent details pane. Purely presentational:
 * the host (AgentConfig) owns the step index, measures the anchor rect for the
 * current step, and drives section switching. This component paints the dim
 * scrim with a cut-out spotlight over `rect` and a coach card next to it.
 *
 * The scrim uses a huge spread box-shadow on the highlight box rather than an
 * SVG mask — it dims the whole pane while leaving the anchored group crisp,
 * and lets clicks fall through only via the card's own buttons (the scrim
 * captures outside clicks and advances the tour, matching Skip-on-click-away).
 */
export function AgentConfigTour({
  steps,
  index,
  rect,
  onNext,
  onBack,
  onSkip,
}: {
  steps: TourStep[];
  index: number;
  rect: TourRect;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation("agents");
  const step = steps[index];
  if (!step) return null;

  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  // Card placement: centered for the anchorless intro; otherwise just to the
  // right of the spotlighted sidebar group, vertically aligned to its top.
  const PAD = 6;
  const CARD_W = 300;

  // Anchored steps place the card just right of the spotlighted group, top-
  // aligned. The intro step (no rect) centers via a flex wrapper — a transform
  // can push the card off the left edge on a narrow pane, flex centering can't.
  const cardStyle: React.CSSProperties | undefined = rect
    ? { top: Math.max(12, rect.top - PAD), left: rect.left + rect.width + 16, width: CARD_W }
    : undefined;

  const card = (
    <div
      className={cn(
        "rounded-xl border border-border bg-popover text-popover-foreground shadow-xl",
        "p-4 flex flex-col gap-3",
        rect ? "absolute" : "w-full"
      )}
      style={rect ? cardStyle : { maxWidth: CARD_W }}
      // Stop scrim click-away from firing when interacting with the card.
      onClick={(e) => e.stopPropagation()}
    >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-sm font-semibold leading-snug">{t(step.titleKey)}</h3>
          <button
            onClick={onSkip}
            aria-label={t("tour.skip")}
            className="text-muted-foreground hover:text-foreground transition-colors -mt-0.5 -mr-1"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-muted-foreground leading-relaxed">{t(step.bodyKey)}</p>

        <div className="flex items-center justify-between pt-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("tour.step", { current: index + 1, total: steps.length })}
          </span>
          <div className="flex items-center gap-1.5">
            {!isLast && (
              <Button size="sm" variant="ghost" onClick={onSkip}>
                {t("tour.skip")}
              </Button>
            )}
            {!isFirst && (
              <Button size="sm" variant="outline" onClick={onBack}>
                <ArrowLeft className="w-3.5 h-3.5" />
                {t("tour.back")}
              </Button>
            )}
            <Button size="sm" onClick={onNext}>
              {isLast ? (
                <>
                  <Check className="w-3.5 h-3.5" />
                  {t("tour.done")}
                </>
              ) : (
                <>
                  {t("tour.next")}
                  <ArrowRight className="w-3.5 h-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
    </div>
  );

  return (
    <div className="absolute inset-0 z-50">
      {/* Scrim + spotlight. When there's no rect (intro), a plain dim layer. */}
      {rect ? (
        <div
          onClick={onSkip}
          className="absolute rounded-xl transition-all duration-200"
          style={{
            top: rect.top - PAD,
            left: rect.left - PAD,
            width: rect.width + PAD * 2,
            height: rect.height + PAD * 2,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            outline: "2px solid var(--color-primary, #6366f1)",
            outlineOffset: 2,
          }}
        />
      ) : (
        <div onClick={onSkip} className="absolute inset-0 bg-black/55" />
      )}

      {/* Anchored steps position the card absolutely; the intro centers it in
          a flex wrapper that can't overflow the pane edges. */}
      {rect ? (
        card
      ) : (
        <div
          onClick={onSkip}
          className="absolute inset-0 flex items-center justify-center p-4"
        >
          {card}
        </div>
      )}
    </div>
  );
}
