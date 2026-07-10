import { useCallback, useEffect, useState } from "react";
import { SpotlightTour, type TourRect, type TourStep } from "../SpotlightTour";
import { FTUE_KEYS } from "../../lib/ftue";

// data-tour anchor names. The anchored elements live in sibling components
// (MessageComposer's paperclip + textarea, the ConversationPane header's info
// pill), so we find them by attribute inside the shared pane rather than
// threading refs across components.
export const CONV_TOUR_ANCHOR = {
  files: "conv-tour-files",
  info: "conv-tour-info",
  composer: "conv-tour-composer",
} as const;

// Steps. The last step is anchorless (centered) — it's the cross-platform
// message, which points at no single element. `bodyKey` marked with `*Group`
// is swapped in for group conversations (see step build below).
type ConvStep = TourStep & { anchor: string | null };

const TOUR_SEEN_KEY = FTUE_KEYS.conversationTour;

/**
 * First-run orientation for an open conversation. Auto-starts once ever (the
 * first time the user opens any conversation), spotlighting the things that
 * aren't obvious: attach files, open conversation details, @-mention other
 * agents, and a closing note that the same agents are reachable from the web
 * and mobile apps while they're online.
 *
 * Self-contained: owns its own step state and measures `data-tour` anchors
 * against the host pane. Mount it inside the chat `<section>` (a `relative`,
 * overflow-hidden container) as a sibling of the header/thread/composer.
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
      anchor: CONV_TOUR_ANCHOR.files,
      titleKey: "convTour.filesTitle",
      bodyKey: "convTour.filesBody",
      placement: "top",
    },
    {
      anchor: CONV_TOUR_ANCHOR.info,
      titleKey: "convTour.infoTitle",
      bodyKey: "convTour.infoBody",
      placement: "bottom",
    },
    {
      anchor: CONV_TOUR_ANCHOR.composer,
      titleKey: "convTour.mentionsTitle",
      bodyKey: isGroup ? "convTour.mentionsBodyGroup" : "convTour.mentionsBody",
      placement: "top",
    },
    {
      anchor: null,
      titleKey: "convTour.anywhereTitle",
      bodyKey: "convTour.anywhereBody",
    },
  ];

  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<TourRect>(null);
  const [pane, setPane] = useState({ width: 0, height: 0 });

  // Auto-start once ever, the first time a conversation is opened.
  useEffect(() => {
    if (localStorage.getItem(TOUR_SEEN_KEY)) return;
    localStorage.setItem(TOUR_SEEN_KEY, "1");
    setStep(0);
  }, []);

  // Measure the anchor for the current step against the pane. Deferred a frame
  // so layout settles; re-measured on resize.
  useEffect(() => {
    if (step === null) return;
    const measure = () => {
      const paneEl = paneRef.current;
      if (!paneEl) return;
      const p = paneEl.getBoundingClientRect();
      setPane({ width: p.width, height: p.height });

      const anchorName = steps[step]?.anchor;
      if (!anchorName) {
        setRect(null);
        return;
      }
      const el = paneEl.querySelector<HTMLElement>(`[data-tour="${anchorName}"]`);
      if (!el) {
        setRect(null);
        return;
      }
      const a = el.getBoundingClientRect();
      setRect({ top: a.top - p.top, left: a.left - p.left, width: a.width, height: a.height });
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
      paneWidth={pane.width}
      paneHeight={pane.height}
      onNext={next}
      onBack={back}
      onSkip={end}
    />
  );
}
