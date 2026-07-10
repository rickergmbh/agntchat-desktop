import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  Check,
  Cloud,
  Loader2,
  MessageCircle,
  Plus,
  Power,
} from "lucide-react";
import { Button } from "./ui/button";
import {
  Card,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { CreateAgentModal } from "./CreateAgentModal";
import {
  useOnboardingState,
  type OnboardingStep,
} from "../hooks/useOnboardingState";
import { useAgentStore } from "../stores/agentStore";
import { useChatStore } from "../stores/chatStore";
import { useNavStore } from "../stores/navStore";
import { usePresenceStore } from "../stores/presenceStore";
import * as api from "../lib/api";
import { cn } from "../lib/utils";

const STEP_ORDER: OnboardingStep[] = ["create", "online", "greeting"];

/**
 * First-run setup guidance: ambient cards that reflect what the user should
 * do next to reach their first working agent — create it, get it online,
 * then receive its backend-seeded greeting DM. All state is derived from
 * server truth via `useOnboardingState`; there is no local checklist.
 *
 * Rendered inside the chat and agents empty states. Renders nothing for
 * established users (they already have an agent DM) and while stores load.
 *
 * `onCreateAgent`: hosts that already own a CreateAgentModal (Dashboard)
 * inject their opener so the modal isn't mounted twice; otherwise this
 * component owns one. `onOpenConversation`: hosts outside the chat view
 * (Dashboard) inject navigation; the default just activates the conversation.
 */
export function OnboardingCards({
  onCreateAgent,
  onOpenConversation,
}: {
  onCreateAgent?: () => void;
  onOpenConversation?: (conversationId: string) => void;
}) {
  const { t } = useTranslation("onboarding");
  const { active, arrived, step, variant, firstAgent, agentDmId } =
    useOnboardingState();

  const startAgent = useAgentStore((s) => s.startAgent);
  const selectAgent = useAgentStore((s) => s.selectAgent);
  const wakingAgents = usePresenceStore((s) => s.wakingAgents);
  const markWaking = usePresenceStore((s) => s.markWaking);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const createConversation = useChatStore((s) => s.createConversation);
  const setView = useNavStore((s) => s.setView);

  const [showCreate, setShowCreate] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const openConversation = (conversationId: string) => {
    if (onOpenConversation) onOpenConversation(conversationId);
    else setActiveConversation(conversationId);
  };

  if (!active) {
    // The flow just completed in this session: show the one-shot "it
    // arrived" card instead of vanishing abruptly (`arrived` comes from the
    // hook; opening the conversation unmounts the empty-state host).
    if (!arrived || !agentDmId) return null;
    const name = firstAgent?.agent.displayName ?? "";
    return (
      <div className="flex-1 flex flex-col items-center justify-center px-8">
        <Card size="sm" className="w-full max-w-md">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-success/15 text-success">
                <Check className="w-3.5 h-3.5" />
              </span>
              {t("cards.arrivedTitle", { name })}
            </CardTitle>
          </CardHeader>
          <CardFooter>
            <Button size="sm" onClick={() => openConversation(agentDmId)}>
              <MessageCircle className="w-3.5 h-3.5" />
              {t("cards.arrivedCta")}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  const name = firstAgent?.agent.displayName ?? "";
  const agentId = firstAgent?.agent.id;
  const currentIndex = STEP_ORDER.indexOf(step ?? "create");
  const starting = firstAgent?.processStatus === "starting";
  const waking = agentId ? wakingAgents.has(agentId) : false;

  const handleCreate = () => {
    if (onCreateAgent) onCreateAgent();
    else setShowCreate(true);
  };

  const handleStartLocal = async () => {
    if (!agentId) return;
    setActionError(null);
    setBusy(true);
    try {
      await startAgent(agentId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const handleWakeHosted = async () => {
    if (!agentId) return;
    setActionError(null);
    markWaking([agentId]);
    try {
      await api.wakeAgent(agentId);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    }
  };

  const handleOpenSettings = () => {
    if (!agentId) return;
    setView("agents");
    void selectAgent(agentId);
  };

  const handleSayHello = async () => {
    if (!agentId) return;
    setActionError(null);
    setBusy(true);
    try {
      const conv = await createConversation({
        type: "direct",
        memberIds: [agentId],
      });
      openConversation(conv.id);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const stepIcon = (s: OnboardingStep) =>
    s === "create" ? (
      <Bot className="w-3.5 h-3.5" />
    ) : s === "online" ? (
      variant === "hosted" ? (
        <Cloud className="w-3.5 h-3.5" />
      ) : (
        <Power className="w-3.5 h-3.5" />
      )
    ) : (
      <MessageCircle className="w-3.5 h-3.5" />
    );

  const stepTitle = (s: OnboardingStep) =>
    s === "create"
      ? t("cards.createTitle")
      : s === "online"
        ? t("cards.onlineTitle", { name })
        : t("cards.greetingTitle", { name });

  return (
    <div className="flex-1 flex flex-col items-center justify-center px-8 overflow-y-auto">
      <div className="w-full max-w-md flex flex-col gap-2 py-6">
        {STEP_ORDER.map((s, i) => {
          const state =
            i < currentIndex ? "done" : i === currentIndex ? "active" : "next";

          if (state !== "active") {
            return (
              <div
                key={s}
                className={cn(
                  "flex items-center gap-2.5 px-4 py-2",
                  state === "next" && "opacity-50"
                )}
              >
                <span
                  className={cn(
                    "flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full text-[11px] font-medium",
                    state === "done"
                      ? "bg-success/15 text-success"
                      : "bg-muted text-muted-foreground"
                  )}
                >
                  {state === "done" ? <Check className="w-3.5 h-3.5" /> : i + 1}
                </span>
                <span className="text-sm text-muted-foreground">
                  {stepTitle(s)}
                </span>
                {state === "done" && (
                  <span className="ml-auto text-[10px] uppercase tracking-wider text-success">
                    {t("cards.stepDone")}
                  </span>
                )}
              </div>
            );
          }

          return (
            <Card key={s} size="sm" className="w-full">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary ring-1 ring-primary/30">
                    {stepIcon(s)}
                  </span>
                  {stepTitle(s)}
                </CardTitle>
                <CardDescription>
                  {s === "create"
                    ? t("cards.createBody")
                    : s === "online"
                      ? variant === "hosted"
                        ? t("cards.onlineHostedBody", { name })
                        : t("cards.onlineLocalBody", { name })
                      : t("cards.greetingBody")}
                </CardDescription>
                {actionError && (
                  <p className="text-xs text-destructive">{actionError}</p>
                )}
              </CardHeader>
              <CardFooter className="gap-2">
                {s === "create" && (
                  <Button size="sm" onClick={handleCreate}>
                    <Plus className="w-3.5 h-3.5" />
                    {t("cards.createCta")}
                  </Button>
                )}
                {s === "online" && variant !== "hosted" && (
                  <>
                    <Button
                      size="sm"
                      onClick={handleStartLocal}
                      disabled={busy || starting}
                    >
                      {busy || starting ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          {t("cards.onlineLocalStarting")}
                        </>
                      ) : (
                        <>
                          <Power className="w-3.5 h-3.5" />
                          {t("cards.onlineLocalCta")}
                        </>
                      )}
                    </Button>
                    <Button size="sm" variant="ghost" onClick={handleOpenSettings}>
                      {t("cards.onlineOpenSettings")}
                    </Button>
                  </>
                )}
                {s === "online" && variant === "hosted" && (
                  <Button size="sm" onClick={handleWakeHosted} disabled={waking}>
                    {waking ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        {t("cards.onlineHostedWaking")}
                      </>
                    ) : (
                      <>
                        <Cloud className="w-3.5 h-3.5" />
                        {t("cards.onlineHostedCta")}
                      </>
                    )}
                  </Button>
                )}
                {s === "greeting" && (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-muted-foreground" />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={handleSayHello}
                      disabled={busy}
                    >
                      {t("cards.greetingFallbackCta")}
                    </Button>
                  </>
                )}
              </CardFooter>
            </Card>
          );
        })}
      </div>

      {showCreate && <CreateAgentModal onClose={() => setShowCreate(false)} />}
    </div>
  );
}
