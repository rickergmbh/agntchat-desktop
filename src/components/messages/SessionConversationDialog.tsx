import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, Terminal, Circle, FolderOpen, Plus } from "lucide-react";
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
  const [startNew, setStartNew] = useState(false);
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

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-popover p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Terminal className="h-4 w-4 text-warning" />
            {linkInto ? t("session.relink") : t("session.kind")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common:close")}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("session.intro")}</p>

          <button
            type="button"
            onClick={() => setStartNew(true)}
            className={
              "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm " +
              (startNew ? "border-primary bg-primary/10" : "border-border hover:bg-accent")
            }
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{t("agents:connectCli.startNew")}</span>
          </button>
          {startNew && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="session-conv-folder">
                {t("agents:connectCli.folderLabel")}
              </label>
              <div className="flex gap-2">
                <input
                  id="session-conv-folder"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="/path/to/repo"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                  autoFocus
                />
                <Button type="button" size="sm" variant="outline" onClick={chooseFolder}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("agents:connectCli.chooseFolder")}
                </Button>
              </div>
              {knownFolders.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {knownFolders.map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFolder(f)}
                      className="max-w-full truncate rounded border border-border px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground hover:bg-accent"
                      title={f}
                    >
                      {f.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? f}
                    </button>
                  ))}
                </div>
              )}
              {backgroundAvailable && (
                <div className="space-y-1 pt-1">
                  <span className="text-xs font-medium text-muted-foreground">{t("agents:connectCli.whereLabel")}</span>
                  <div className="flex gap-2">
                    {(["background", "terminal"] as const).map((w) => (
                      <button
                        key={w}
                        type="button"
                        onClick={() => setWhere(w)}
                        className={
                          "rounded-md border px-3 py-1.5 text-sm " +
                          (where === w
                            ? "border-primary bg-primary/10 text-foreground"
                            : "border-border text-muted-foreground hover:bg-accent")
                        }
                      >
                        {w === "background" ? t("agents:connectCli.whereBackground") : t("agents:connectCli.whereTerminal")}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              <p className="text-[11px] text-muted-foreground">
                {where === "background"
                  ? t("agents:connectCli.whereBackgroundHint")
                  : t("agents:connectCli.whereTerminalHint")}
              </p>
              <div className="space-y-1 pt-1">
                <label className="text-xs font-medium text-muted-foreground" htmlFor="session-conv-model">
                  {t("agents:connectCli.modelLabel")}
                </label>
                <select
                  id="session-conv-model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full rounded-md border border-border bg-background px-2 py-1.5 text-sm"
                >
                  <option value="default">{t("agents:connectCli.modelDefault")}</option>
                  {MODEL_ALIASES.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
                <p className="text-[11px] text-muted-foreground">{t("agents:connectCli.modelHint")}</p>
              </div>
            </div>
          )}

          <span className="block text-xs font-medium text-muted-foreground">{t("session.linkExisting")}</span>
          {sessions === null ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("agents:connectCli.sessionsLoading")}
            </div>
          ) : sessions.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {t("agents:connectCli.noSessions")}
            </p>
          ) : (
            <div className="max-h-48 overflow-y-auto rounded-md border border-border">
              {sessions.map((s) => {
                const isSel = s.sessionId === selected && !startNew;
                return (
                  <button
                    key={s.sessionId}
                    type="button"
                    onClick={() => {
                      setStartNew(false);
                      setSelected(s.sessionId);
                    }}
                    className={
                      "flex w-full items-start gap-2 border-b border-border px-3 py-2 text-left last:border-b-0 " +
                      (isSel ? "bg-primary/10" : "hover:bg-accent")
                    }
                  >
                    <Circle
                      className={
                        "mt-1 h-2.5 w-2.5 shrink-0 " +
                        (s.running
                          ? "fill-success text-success"
                          : s.running === false
                            ? "fill-muted-foreground/30 text-muted-foreground/30"
                            : "text-muted-foreground/40")
                      }
                    />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2 text-sm">
                        <span className="truncate font-medium">{label(s)}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {s.running === null
                            ? relative(s.lastActiveAt)
                            : `${s.running ? t("agents:connectCli.running") : t("agents:connectCli.idle")} · ${relative(s.lastActiveAt)}`}
                        </span>
                      </span>
                      {s.cwd && <span className="block truncate font-mono text-[10px] text-muted-foreground">{s.cwd}</span>}
                      {s.conversationId && (
                        <span className="block text-[10px] text-warning">{t("session.alreadyLinked")}</span>
                      )}
                      {s.lastPrompt && (
                        <span className="block truncate text-[11px] text-muted-foreground/80">{s.lastPrompt}</span>
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
            <input
              id="session-conv-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              placeholder={startNew ? folderDir.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? "" : session ? label(session) : ""}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
            />
            <p className="text-[11px] text-muted-foreground">{t("session.identity", { name: identityName })}</p>
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={() => setShowCode(true)}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("agents:connectCli.useCodeInstead")}
            </button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {t("common:cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={busy || (startNew ? !folderDir : !session)}>
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {busy
                  ? t("session.connecting")
                  : startNew
                    ? t("agents:connectCli.start")
                    : t("agents:connectCli.bind")}
              </Button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
