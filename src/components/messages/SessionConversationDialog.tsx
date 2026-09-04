import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, Terminal, FolderOpen, ChevronRight, Plus, Link2, MonitorSmartphone, SquareTerminal } from "lucide-react";
import { cn } from "../../lib/utils";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  createExternalAgent,
  createSessionConversation,
  getApiUrl,
  linkSessionConversation,
  regenerateApiKey,
  type Agent,
} from "../../lib/api";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "../../stores/agentStore";
import { useChatStore } from "../../stores/chatStore";
import { useLocalDeviceName } from "../../hooks/useRunningElsewhere";
import { ConnectCliSessionDialog } from "../ConnectCliSessionDialog";

interface ClaudeSession {
  sessionId: string;
  cwd: string | null;
  title: string | null;
  lastPrompt: string | null;
  lastActiveAt: number;
  running: boolean | null;
  boundBy: "session" | "project" | "default" | null;
  agentId: string | null;
  agentName: string | null;
  conversationId: string | null;
}

interface Identity {
  agentId: string;
  displayName: string | null;
  default: boolean;
}

/**
 * New "Claude Code session" conversation (#148): a conversation that IS a
 * Claude Code session. Link a session running on this Mac, or start a new
 * one (in the Claude app, or a terminal). There is no agent to choose: the
 * session runs as this machine's identity — the external agent this Mac
 * already holds credentials for, created on first use and named after the
 * machine. The backend links session ↔ conversation; the transcript
 * mirrors there and what is typed there reaches only that session.
 */
/** Claude Code's model aliases (`claude --model <alias>`), newest first. */
const MODEL_ALIASES = ["opus", "sonnet", "haiku"] as const;

export function SessionConversationDialog({
  onClose,
  linkInto,
}: {
  onClose: () => void;
  /** Re-link mode: attach the chosen/new session to THIS existing session
   *  conversation (its history stays) instead of creating a new one. */
  linkInto?: { id: string; title?: string | null };
}) {
  const { t } = useTranslation("chat");
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const recordApiKey = useAgentStore((s) => s.recordApiKey);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const deviceName = useLocalDeviceName();

  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  const [identities, setIdentities] = useState<Identity[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [startNew, setStartNew] = useState(true);
  const [folder, setFolder] = useState("");
  const [name, setName] = useState("");
  // Where a new session runs: detached in the background (screen; live
  // channel push, survives closed windows) or a terminal window.
  const [where, setWhere] = useState<"background" | "terminal">("terminal");
  // Claude Code model for a NEW session: an alias passed as `--model`, or
  // "default" for whatever Claude Code itself is set to.
  const [model, setModel] = useState<string>("default");
  const [backgroundAvailable, setBackgroundAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showCode, setShowCode] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<ClaudeSession[]>("list_claude_sessions")
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        const first = list.find((s) => s.running && !s.conversationId) ?? list.find((s) => s.running) ?? list[0];
        if (first) setSelected(first.sessionId);
        // A running session nobody has linked yet is the likelier intent.
        if (list.some((s) => s.running && !s.conversationId)) setStartNew(false);
      })
      .catch(() => {
        if (!cancelled) setSessions([]);
      });
    invoke<Identity[]>("list_external_identities")
      .then((ids) => {
        if (!cancelled) setIdentities(ids);
      })
      .catch(() => {});
    invoke<boolean>("background_session_available")
      .then((ok) => {
        if (!cancelled && ok) {
          setBackgroundAvailable(true);
          setWhere("background");
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const externalAgents = Object.values(agents)
    .map((m) => m.agent)
    .filter((a) => a.runtime === "external");
  // The machine identity: an external agent this Mac holds credentials for
  // (default first), else any external agent, else one is created.
  const identity: Agent | null =
    externalAgents.find((a) => identities.find((i) => i.agentId === a.id && i.default)) ??
    externalAgents.find((a) => identities.some((i) => i.agentId === a.id)) ??
    externalAgents[0] ??
    null;
  const identityName = identity?.displayName ?? `Claude Code · ${deviceName ?? "this Mac"}`;

  const session = !startNew ? (sessions?.find((s) => s.sessionId === selected) ?? null) : null;
  const folderDir = folder.trim();
  const knownFolders = Array.from(new Set((sessions ?? []).map((s) => s.cwd).filter((c): c is string => !!c))).slice(0, 4);

  async function chooseFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, defaultPath: folderDir || undefined });
      if (typeof picked === "string") setFolder(picked);
    } catch {
      // Native chooser unavailable — the path field is editable.
    }
  }

  function label(s: ClaudeSession): string {
    if (s.title) return s.title;
    return s.cwd?.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? s.sessionId.slice(0, 8);
  }

  function relative(seconds: number): string {
    const diff = Math.max(0, Date.now() / 1000 - seconds);
    if (diff < 90) return "now";
    if (diff < 3600) return `${Math.round(diff / 60)}m`;
    if (diff < 86400) return `${Math.round(diff / 3600)}h`;
    return `${Math.round(diff / 86400)}d`;
  }

  /** The machine identity with a key this Mac holds: reuse saved
   *  credentials when the bridge knows this agent, else (re)issue. */
  async function resolveIdentity(): Promise<{ id: string; displayName: string; apiKey: string | null }> {
    if (identity) {
      if (identities.some((i) => i.agentId === identity.id)) {
        return { id: identity.id, displayName: identity.displayName, apiKey: null };
      }
      const re = await regenerateApiKey(identity.id);
      recordApiKey(re.agent.id, re.apiKey);
      return { id: re.agent.id, displayName: re.agent.displayName, apiKey: re.apiKey };
    }
    const created = await createExternalAgent({ displayName: identityName, externalTool: "claude_code" });
    await fetchAgents();
    recordApiKey(created.agent.id, created.apiKey);
    return { id: created.agent.id, displayName: created.agent.displayName, apiKey: created.apiKey };
  }

  /** Bind the session to the identity. `apiKey` null means "reuse the
   *  credentials this Mac already holds for the agent" — the bridge copies
   *  them; it never regenerates. Rotating the key here invalidated every
   *  other session's copy and silenced the identity (2026-09-04). */
  async function bind(
    sessionId: string,
    cwd: string | null,
    target: { id: string; displayName: string; apiKey: string | null },
    conversationId: string,
    title: string | null
  ) {
    await invoke("bind_claude_session", {
      args: {
        sessionId,
        cwd,
        agentId: target.id,
        apiKey: target.apiKey,
        displayName: target.displayName,
        gatewayUrl: getApiUrl(),
        title,
        conversationId,
      },
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (startNew ? !folderDir : !session) return;
    setBusy(true);
    setError(null);
    try {
      const target = await resolveIdentity();
      const cwd = startNew ? folderDir : session!.cwd;
      const sessionKey = startNew ? crypto.randomUUID() : session!.sessionId;
      const title = name.trim() || (startNew ? folderDir.split(/[\\/]/).filter(Boolean).slice(-1)[0] : label(session!)) || null;
      const conv = linkInto
        ? await linkSessionConversation(linkInto.id, {
            agentId: target.id,
            sessionKey,
            cwd: cwd ?? undefined,
          })
        : await createSessionConversation({
            agentId: target.id,
            title: title ?? undefined,
            sessionKey,
            cwd: cwd ?? undefined,
            tool: "claude_code",
          });
      // Bind locally so the session's hooks run as the identity and know
      // their conversation. A session already bound to this identity keeps
      // its credentials; anything else gets them now.
      await bind(sessionKey, cwd, target, conv.id, title);
      if (startNew) {
        await invoke(where === "background" ? "launch_claude_session_background" : "launch_claude_session", {
          folder: folderDir,
          sessionId: sessionKey,
          model: model === "default" ? null : model,
        });
      }
      setActiveConversation(conv.id);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : t("session.connectFailed"));
    } finally {
      setBusy(false);
    }
  }

  if (showCode) {
    return <ConnectCliSessionDialog onClose={onClose} />;
  }

  const folderName = folderDir.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "";
  const runningCount = (sessions ?? []).filter((s) => s.running).length;
  const canSubmit = !busy && (startNew ? !!folderDir : !!session);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <form
        onSubmit={handleSubmit}
        className="flex max-h-[85vh] w-full max-w-md flex-col rounded-xl border border-border bg-card shadow-2xl"
      >
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-border px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <Terminal className="h-4 w-4 text-muted-foreground" />
            {linkInto ? t("session.relink") : t("session.kind")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            aria-label={t("common:close")}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Mode */}
        <div className="flex shrink-0 gap-1 border-b border-border px-4 py-2">
          <button
            type="button"
            onClick={() => setStartNew(true)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              startNew ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Plus className="mr-1 inline h-3 w-3" />
            {t("agents:connectCli.tabNew")}
          </button>
          <button
            type="button"
            onClick={() => setStartNew(false)}
            className={cn(
              "rounded-md px-3 py-1 text-xs font-medium transition-colors",
              !startNew ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            )}
          >
            <Link2 className="mr-1 inline h-3 w-3" />
            {t("agents:connectCli.tabLink")}
            {runningCount > 0 && (
              <span className="ml-1.5 rounded-full bg-success/15 px-1.5 text-[10px] font-semibold text-success">
                {runningCount}
              </span>
            )}
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
          {startNew ? (
            <>
              {/* Folder */}
              <div className="space-y-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t("agents:connectCli.folderLabel")}</span>
                <button
                  type="button"
                  onClick={chooseFolder}
                  className={cn(
                    "flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-accent",
                    folderDir ? "border-border" : "border-dashed border-border"
                  )}
                >
                  <span
                    className={cn(
                      "flex h-8 w-8 shrink-0 items-center justify-center rounded-md",
                      folderDir ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                    )}
                  >
                    <FolderOpen className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    {folderDir ? (
                      <>
                        <span className="block truncate text-sm font-medium">{folderName}</span>
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{folderDir}</span>
                      </>
                    ) : (
                      <span className="block text-sm text-muted-foreground">{t("agents:connectCli.folderPlaceholder")}</span>
                    )}
                  </span>
                  <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
                </button>
                {knownFolders.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                    <span className="text-[10px] text-muted-foreground">{t("agents:connectCli.recentFolders")}</span>
                    {knownFolders.map((f) => (
                      <button
                        key={f}
                        type="button"
                        onClick={() => setFolder(f)}
                        title={f}
                        className={cn(
                          "max-w-[12rem] truncate rounded-full border px-2 py-0.5 text-[11px] transition-colors",
                          f === folderDir
                            ? "border-primary/40 bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent hover:text-foreground"
                        )}
                      >
                        {f.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? f}
                      </button>
                    ))}
                  </div>
                )}
              </div>

              {/* Name */}
              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="session-conv-name">
                  {t("agents:connectCli.sessionNameLabel")}
                </label>
                <Input
                  id="session-conv-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder={folderName}
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">{t("agents:connectCli.nameOptionalHint")}</p>
              </div>

              {/* Where + model */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("agents:connectCli.whereLabel")}</span>
                  <div className="flex rounded-lg bg-muted p-[3px]">
                    {(backgroundAvailable ? (["background", "terminal"] as const) : (["terminal"] as const)).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setWhere(w)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-xs font-medium transition-all",
                          where === w ? "bg-card text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"
                        )}
                      >
                        {w === "background" ? (
                          <MonitorSmartphone className="h-3 w-3" />
                        ) : (
                          <SquareTerminal className="h-3 w-3" />
                        )}
                        {w === "background" ? t("agents:connectCli.whereBackground") : t("agents:connectCli.whereTerminal")}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">{t("agents:connectCli.modelLabel")}</span>
                  <Select value={model} onValueChange={(v) => setModel(v ?? "default")}>
                    <SelectTrigger className="h-8 w-full text-xs">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="default">{t("agents:connectCli.modelDefault")}</SelectItem>
                      {MODEL_ALIASES.map((m) => (
                        <SelectItem key={m} value={m}>
                          {m}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-[11px] leading-relaxed text-muted-foreground">
                {where === "background"
                  ? t("agents:connectCli.whereBackgroundHint")
                  : t("agents:connectCli.whereTerminalHint")}
              </p>
            </>
          ) : (
            <>
              {/* Running sessions */}
              {sessions === null ? (
                <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  {t("agents:connectCli.sessionsLoading")}
                </div>
              ) : sessions.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-6 text-center">
                  <Terminal className="mx-auto mb-2 h-5 w-5 text-muted-foreground/60" />
                  <p className="text-xs text-muted-foreground">{t("agents:connectCli.noSessions")}</p>
                </div>
              ) : (
                <div className="overflow-hidden rounded-lg border border-border">
                  {sessions.map((s) => {
                    const isSel = s.sessionId === selected;
                    return (
                      <button
                        key={s.sessionId}
                        type="button"
                        onClick={() => setSelected(s.sessionId)}
                        className={cn(
                          "flex w-full items-start gap-2.5 border-b border-border px-3 py-2.5 text-left transition-colors last:border-b-0",
                          isSel ? "bg-primary/10" : "hover:bg-accent"
                        )}
                      >
                        <span
                          className={cn(
                            "mt-1.5 h-2 w-2 shrink-0 rounded-full",
                            s.running ? "bg-success" : s.running === false ? "bg-muted-foreground/30" : "bg-muted-foreground/50"
                          )}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-baseline gap-2">
                            <span className="truncate text-sm font-medium">{label(s)}</span>
                            <span className="shrink-0 text-[10px] text-muted-foreground">
                              {s.running === null
                                ? relative(s.lastActiveAt)
                                : `${s.running ? t("agents:connectCli.running") : t("agents:connectCli.idle")} · ${relative(s.lastActiveAt)}`}
                            </span>
                          </span>
                          {s.cwd && <span className="block truncate font-mono text-[10px] text-muted-foreground">{s.cwd}</span>}
                          {s.lastPrompt && (
                            <span className="block truncate text-[11px] text-muted-foreground/80">{s.lastPrompt}</span>
                          )}
                          {s.conversationId && (
                            <span className="mt-0.5 block text-[10px] text-warning">{t("session.alreadyLinked")}</span>
                          )}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}

              <div className="space-y-1.5">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="session-conv-name">
                  {t("agents:connectCli.sessionNameLabel")}
                </label>
                <Input
                  id="session-conv-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={100}
                  placeholder={session ? label(session) : ""}
                  className="h-9 text-sm"
                />
                <p className="text-[11px] text-muted-foreground">{t("agents:connectCli.linkNameHint")}</p>
              </div>
            </>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-4 py-3">
          <div className="min-w-0">
            <p className="truncate text-[11px] text-muted-foreground">{t("session.identity", { name: identityName })}</p>
            <button
              type="button"
              onClick={() => setShowCode(true)}
              className="text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
            >
              {t("agents:connectCli.useCodeInstead")}
            </button>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button type="button" variant="ghost" size="sm" onClick={onClose}>
              {t("common:cancel")}
            </Button>
            <Button type="submit" size="sm" disabled={!canSubmit}>
              {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
              {busy ? t("session.connecting") : startNew ? t("agents:connectCli.start") : t("agents:connectCli.bind")}
            </Button>
          </div>
        </div>
      </form>
    </div>
  );
}
