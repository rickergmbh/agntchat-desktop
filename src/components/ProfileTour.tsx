import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ArrowLeft, ArrowRight, Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import * as api from "../lib/api";
import { useAuthStore } from "../stores/authStore";
import { identifyAnalytics } from "../lib/analytics";
import { FTUE_KEYS, hasSeenTour, markTourSeen } from "../lib/ftue";

/**
 * First-run orientation tour for the profile / settings page.
 *
 * The profile is a long scrolling settings page, so this is a *centered modal
 * coach card* over a dim scrim — not an anchored spotlight (there's no single
 * element to point at, and the sections live behind a section switcher). It
 * walks through: welcome → analytics (an ACTIONABLE step: a toggle defaulted
 * ON that applies its choice when the user proceeds) → LLM keys → connected
 * accounts → memory.
 *
 * Auto-starts once ever, gated on the roamed `profileTour` seen-flag (server
 * source of truth via `lib/ftue`). Bumping the `replay` prop re-opens it at
 * step 0, bypassing the seen-flag, for a "Replay tour" affordance.
 */

interface ProfileTourStep {
  titleKey: string;
  bodyKey: string;
  /** The analytics step renders a consent toggle and applies it on proceed. */
  analytics?: boolean;
}

const STEPS: ProfileTourStep[] = [
  { titleKey: "profileTour.welcomeTitle", bodyKey: "profileTour.welcomeBody" },
  {
    titleKey: "profileTour.analyticsTitle",
    bodyKey: "profileTour.analyticsBody",
    analytics: true,
  },
  { titleKey: "profileTour.llmKeysTitle", bodyKey: "profileTour.llmKeysBody" },
  {
    titleKey: "profileTour.connectedAccountsTitle",
    bodyKey: "profileTour.connectedAccountsBody",
  },
  { titleKey: "profileTour.memoryTitle", bodyKey: "profileTour.memoryBody" },
];

export function ProfileTour({ replay = 0 }: { replay?: number }) {
  const { t } = useTranslation("settings");
  // step === null means the tour is closed.
  const [step, setStep] = useState<number | null>(null);
  const [analyticsChoice, setAnalyticsChoice] = useState(true);

  // Auto-start once ever, gated on the roamed seen-flag.
  useEffect(() => {
    if (!hasSeenTour(FTUE_KEYS.profileTour)) setStep(0);
    // Run once on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Replay: any bump of the prop re-opens at step 0, bypassing the seen-flag.
  useEffect(() => {
    if (replay > 0) {
      setAnalyticsChoice(true);
      setStep(0);
    }
  }, [replay]);

  const current = step === null ? undefined : STEPS[step];
  if (step === null || !current) return null;

  const isFirst = step === 0;
  const isLast = step === STEPS.length - 1;

  // Apply the analytics consent choice. Mirrors Profile.tsx's analytics
  // handler: api.updateConsent then persist the refreshed participant into the
  // auth store (which re-runs analytics identify).
  const applyAnalytics = async () => {
    try {
      const updated = await api.updateConsent({ analyticsOptIn: analyticsChoice });
      localStorage.setItem("participant", JSON.stringify(updated));
      useAuthStore.setState({ participant: updated });
      void identifyAnalytics(updated);
    } catch {
      // Non-fatal — the toggle simply keeps its current server value.
    }
  };

  const finish = () => {
    setStep(null);
    void markTourSeen(FTUE_KEYS.profileTour);
  };

  const handleNext = () => {
    // Advancing FORWARD past the analytics step applies the choice.
    if (current.analytics) void applyAnalytics();
    if (isLast) {
      finish();
    } else {
      setStep(step + 1);
    }
  };

  const handleBack = () => {
    if (!isFirst) setStep(step - 1);
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-4"
      onClick={finish}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-popover p-5 text-popover-foreground shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-base font-semibold leading-snug">
            {t(current.titleKey)}
          </h3>
          <button
            onClick={finish}
            aria-label={t("profileTour.skip")}
            className="-mr-1 -mt-0.5 text-muted-foreground transition-colors hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mt-2 text-sm text-muted-foreground">{t(current.bodyKey)}</p>

        {current.analytics && (
          <label className="mt-4 flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 p-3">
            <span className="text-sm">{t("profileTour.analyticsToggle")}</span>
            <Switch
              checked={analyticsChoice}
              onCheckedChange={(v) => setAnalyticsChoice(v)}
            />
          </label>
        )}

        <div className="mt-5 flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {t("profileTour.step", { current: step + 1, total: STEPS.length })}
          </span>
          <div className="flex items-center gap-1.5">
            {!isLast && (
              <Button size="sm" variant="ghost" onClick={finish}>
                {t("profileTour.skip")}
              </Button>
            )}
            {!isFirst && (
              <Button size="sm" variant="outline" onClick={handleBack}>
                <ArrowLeft className="h-3.5 w-3.5" />
                {t("profileTour.back")}
              </Button>
            )}
            <Button size="sm" onClick={handleNext}>
              {isLast ? (
                <>
                  <Check className="h-3.5 w-3.5" />
                  {t("profileTour.done")}
                </>
              ) : (
                <>
                  {t("profileTour.next")}
                  <ArrowRight className="h-3.5 w-3.5" />
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
