import { useCallback, useEffect, useState } from "react";
import { SpotlightTour, type TourRect, type TourStep } from "../SpotlightTour";
import { FTUE_KEYS, hasSeenTour, markTourSeen } from "../../lib/ftue";

// data-tour anchor names. The anchored elements live in sibling components
// (MessageComposer's textarea, the ConversationPane header's info pill), so we
// find them by attribute inside the shared pane rather than threading refs
// across components.
export const CONV_TOUR_ANCHOR = {
  info: "conv-tour-info",
  composer: "conv-tour-composer",
} as const;

type ConvStep = TourStep & { anchor: string };

const TOUR_SEEN_KEY = FTUE_KEYS.conversationTour;

/**
 * First-run orientation for an open conversation. Auto-starts once ever (the
 * first time the user opens any conversation). Deliberately tiny — two steps,
 * only the things that are genuinely non-obvious: @-mentioning agents into
 * the conversation, and the conversation-details pill. Anything discoverable
 * (the attach paperclip) or promotional doesn't earn a step.
 *
 * Self-contained: owns its own step state and measures `data-tour` anchors
 * inside the host pane (viewport coordinates — the overlay portals to body).
 *
 * `isGroup` swaps the @-mention copy: in a 1:1 the phrasing nudges toward
 * adding more agents; in a group it describes mentioning the ones present.
 */
export function ConversationTour({
  paneRef,
  isGroup,
}: {
  paneRef: React.RefObject<HTMLElement | null>;
  isGroup: boolean;
}) {
  const steps: ConvStep[] = [
    {
      anchor: CONV_TOUR_ANCHOR.composer,
      titleKey: "convTour.mentionsTitle",
      bodyKey: isGroup ? "convTour.mentionsBodyGroup" : "convTour.mentionsBody",
      placement: "top",
    },
    {
      anchor: CONV_TOUR_ANCHOR.info,
      titleKey: "convTour.infoTitle",
      bodyKey: "convTour.infoBody",
      placement: "bottom",
    },
  ];

  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<TourRect>(null);

  // Auto-start once ever (across all devices), the first time a conversation
  // is opened. The seen-flag roams via participant metadata.
  useEffect(() => {
    if (hasSeenTour(TOUR_SEEN_KEY)) return;
    void markTourSeen(TOUR_SEEN_KEY);
    setStep(0);
  }, []);

  // Measure the anchor for the current step (viewport coordinates). Deferred a
  // frame so layout settles; re-measured on resize.
  useEffect(() => {
    if (step === null) return;
    const measure = () => {
      const paneEl = paneRef.current;
      const anchorName = steps[step]?.anchor;
      const el = anchorName
        ? paneEl?.querySelector<HTMLElement>(`[data-tour="${anchorName}"]`)
        : null;
      if (!el) {
        setRect(null);
        return;
      }
      const a = el.getBoundingClientRect();
      setRect({ top: a.top, left: a.left, width: a.width, height: a.height });
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
    // steps is rebuilt each render but its anchors/placement are stable per step.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, paneRef]);

  const next = useCallback(
    () => setStep((s) => (s === null || s + 1 >= steps.length ? null : s + 1)),
    [steps.length]
  );
  const back = useCallback(() => setStep((s) => (s === null || s === 0 ? s : s - 1)), []);
  const end = useCallback(() => setStep(null), []);

  if (step === null) return null;

  return (
    <SpotlightTour
      namespace="chat"
      keyPrefix="convTour"
      steps={steps}
      index={step}
      rect={rect}
      onNext={next}
      onBack={back}
      onSkip={end}
    />
  );
}
