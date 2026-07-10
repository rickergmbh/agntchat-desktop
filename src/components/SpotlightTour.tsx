import { useLayoutEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";

/** A measured rect (in the host pane's coordinate space) for the element a
 *  step points at. `null` for an intro/outro step, which has no anchor and
 *  centers its card. */
export type TourRect = { top: number; left: number; width: number; height: number } | null;

/** Which side of the anchor the coach card sits on. Ignored for anchorless
 *  (centered) steps. Defaults to "right". */
export type TourPlacement = "right" | "left" | "top" | "bottom";

export interface TourStep {
  titleKey: string;
  bodyKey: string;
  placement?: TourPlacement;
}

const PAD = 6; // breathing room between the spotlight box and the anchor
const GAP = 14; // distance from the spotlight to the coach card
const CARD_W = 300;
const EDGE = 8; // keep the card this far inside the pane edges
// The spotlight outline is drawn `outlineOffset + stroke` (4px) OUTSIDE the
// box; keep the box inset from the pane edges so the ring isn't clipped by a
// rounded/overflow-hidden pane.
const EDGE_INSET = 5;

/**
 * Reusable guided coach-mark tour. Purely presentational: the host owns the
 * step index, measures the anchor rect (relative to a `relative` pane) and the
 * pane size, and drives any UI changes behind each step. This paints a dim
 * scrim with a cut-out spotlight over `rect` and a coach card beside it.
 *
 * The scrim is a huge spread box-shadow on the highlight box (not an SVG mask):
 * it dims the whole pane while leaving the anchored element crisp. Clicking the
 * scrim advances via `onSkip` (click-away = dismiss); the card stops
 * propagation so its own buttons work.
 *
 * Card placement is per-step (`placement`, default "right") and always clamped
 * inside the pane, so anchors near any edge stay fully visible. Anchorless
 * steps (rect null) center the card.
 */
export function SpotlightTour({
  namespace,
  keyPrefix = "tour",
  steps,
  index,
  rect,
  paneWidth,
  paneHeight,
  onNext,
  onBack,
  onSkip,
}: {
  namespace: string;
  /** i18n sub-object holding the nav labels: `${keyPrefix}.{skip,back,next,done,step}`. */
  keyPrefix?: string;
  steps: TourStep[];
  index: number;
  rect: TourRect;
  paneWidth: number;
  paneHeight: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  const { t } = useTranslation(namespace);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [cardSize, setCardSize] = useState<{ w: number; h: number } | null>(null);

  const step = steps[index];

  // Measure the card so placement can clamp it inside the pane. Re-measured on
  // step change (copy length varies). Hidden until measured to avoid a flash at
  // the pre-clamp position.
  useLayoutEffect(() => {
    if (!cardRef.current) return;
    const r = cardRef.current.getBoundingClientRect();
    setCardSize({ w: r.width, h: r.height });
  }, [index, rect]);

  if (!step) return null;

  const isFirst = index === 0;
  const isLast = index === steps.length - 1;

  // Spotlight box (clamped so its outline isn't clipped at any pane edge).
  const spot = rect
    ? {
        left: Math.max(EDGE_INSET, rect.left - PAD),
        top: Math.max(EDGE_INSET, rect.top - PAD),
        right: Math.min(paneWidth - EDGE_INSET, rect.left + rect.width + PAD),
        bottom: Math.min(paneHeight - EDGE_INSET, rect.top + rect.height + PAD),
      }
    : null;

  // Coach-card position: per-step side, then clamp inside the pane.
  let cardStyle: React.CSSProperties | undefined;
  if (rect && cardSize) {
    const placement = step.placement ?? "right";
    const cw = cardSize.w;
    const ch = cardSize.h;
    let left: number;
    let top: number;
    if (placement === "left") {
      left = rect.left - GAP - cw;
      top = rect.top;
    } else if (placement === "top") {
      left = rect.left;
      top = rect.top - GAP - ch;
    } else if (placement === "bottom") {
      left = rect.left;
      top = rect.top + rect.height + GAP;
    } else {
      left = rect.left + rect.width + GAP;
      top = rect.top;
    }
    left = Math.min(Math.max(EDGE, left), Math.max(EDGE, paneWidth - cw - EDGE));
    top = Math.min(Math.max(EDGE, top), Math.max(EDGE, paneHeight - ch - EDGE));
    cardStyle = { top, left, width: CARD_W };
  } else if (rect) {
    // First render before measurement: position off-anchor but hidden.
    cardStyle = { top: rect.top, left: rect.left, width: CARD_W, visibility: "hidden" };
  }

  const card = (
    <div
      ref={cardRef}
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
          aria-label={t(`${keyPrefix}.skip`)}
          className="text-muted-foreground hover:text-foreground transition-colors -mt-0.5 -mr-1"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <p className="text-xs text-muted-foreground leading-relaxed">{t(step.bodyKey)}</p>

      <div className="flex items-center justify-between pt-1">
        <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
          {t(`${keyPrefix}.step`, { current: index + 1, total: steps.length })}
        </span>
        <div className="flex items-center gap-1.5">
          {!isLast && (
            <Button size="sm" variant="ghost" onClick={onSkip}>
              {t(`${keyPrefix}.skip`)}
            </Button>
          )}
          {!isFirst && (
            <Button size="sm" variant="outline" onClick={onBack}>
              <ArrowLeft className="w-3.5 h-3.5" />
              {t(`${keyPrefix}.back`)}
            </Button>
          )}
          <Button size="sm" onClick={onNext}>
            {isLast ? (
              <>
                <Check className="w-3.5 h-3.5" />
                {t(`${keyPrefix}.done`)}
              </>
            ) : (
              <>
                {t(`${keyPrefix}.next`)}
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
      {/* Scrim + spotlight. When there's no rect (intro/outro), a plain dim
          layer. */}
      {spot ? (
        <div
          onClick={onSkip}
          className="absolute rounded-xl transition-all duration-200"
          style={{
            top: spot.top,
            left: spot.left,
            width: spot.right - spot.left,
            height: spot.bottom - spot.top,
            boxShadow: "0 0 0 9999px rgba(0,0,0,0.55)",
            outline: "2px solid var(--color-primary, #6366f1)",
            outlineOffset: 2,
          }}
        />
      ) : (
        <div onClick={onSkip} className="absolute inset-0 bg-black/55" />
      )}

      {/* Anchored steps position the card absolutely; anchorless steps center
          it in a flex wrapper that can't overflow the pane edges. */}
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
