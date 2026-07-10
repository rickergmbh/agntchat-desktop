import { SpotlightTour, type TourRect, type TourStep } from "./SpotlightTour";

export type { TourRect, TourStep };

/**
 * Guided coach-mark tour for the agent details pane. Thin wrapper over the
 * shared {@link SpotlightTour} pinned to the `agents` catalog (`agents:tour.*`).
 * The host (AgentConfig) owns step state, anchor measurement, and section
 * switching. All steps use the default "right" placement (the sidebar hugs the
 * pane's left edge).
 */
export function AgentConfigTour({
  steps,
  index,
  rect,
  paneWidth,
  paneHeight,
  onNext,
  onBack,
  onSkip,
}: {
  steps: TourStep[];
  index: number;
  rect: TourRect;
  paneWidth: number;
  paneHeight: number;
  onNext: () => void;
  onBack: () => void;
  onSkip: () => void;
}) {
  return (
    <SpotlightTour
      namespace="agents"
      steps={steps}
      index={index}
      rect={rect}
      paneWidth={paneWidth}
      paneHeight={paneHeight}
      onNext={onNext}
      onBack={onBack}
      onSkip={onSkip}
    />
  );
}
