import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, Copy, Check, Terminal, Circle, FolderOpen, Plus } from "lucide-react";
import {
  createAgentInvite,
  createExternalAgent,
  getApiUrl,
  regenerateApiKey,
} from "../lib/api";
import { Button } from "@/components/ui/button";
import { useAgentStore } from "../stores/agentStore";

interface Props {
  onClose: () => void;
  /** Preselect this EXISTING external agent (opened from its row). */
  agent?: { id: string; displayName: string; tool?: string | null };
}

type CliTool = "claude-code" | "codex";

/** One Claude Code session on this machine, as `python -m agentchat sessions`
 *  reports it (via the `list_claude_sessions` Tauri command). */
interface ClaudeSession {
  sessionId: string;
  cwd: string | null;
  title: string | null;
  lastPrompt: string | null;
  /** Unix seconds — the transcript's mtime. */
  lastActiveAt: number;
  /** null when liveness can't be determined (Windows). */
  running: boolean | null;
  boundBy: "session" | "project" | "default" | null;
  agentId: string | null;
  agentName: string | null;
}

/**
 * "Connect CLI session" (#148). On desktop the primary mode is a SESSION
 * PICKER: list the Claude Code sessions on this machine, pick which agent
 * each runs as (an existing external agent or a new one), and bind it —
 * the app holds the owner's token and the bundled bridge, so no terminal
 * command is needed and a running session switches live. The code flow
 * (one-shot invite + `python -m agentchat connect`) stays for other
 * machines.
 */
export function ConnectCliSessionDialog({ onClose, agent }: Props) {
  const [mode, setMode] = useState<"picker" | "code">("picker");
  return mode === "picker" ? (
    <PickerFlow onClose={onClose} agent={agent} onUseCode={() => setMode("code")} />
  ) : (
    <CodeFlow onClose={onClose} agent={agent} onBack={() => setMode("picker")} />
  );
}

function Shell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const { t } = useTranslation("agents");
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
            {title}
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
        {children}
      </div>
    </div>
  );
}

function sessionLabel(s: ClaudeSession): string {
  if (s.title) return s.title;
  const seg = s.cwd?.split(/[\\/]/).filter(Boolean).slice(-1)[0];
  return seg ?? s.sessionId.slice(0, 8);
}

function relative(seconds: number): string {
  const diff = Math.max(0, Date.now() / 1000 - seconds);
  if (diff < 90) return "now";
  if (diff < 3600) return `${Math.round(diff / 60)}m`;
  if (diff < 86400) return `${Math.round(diff / 3600)}h`;
  return `${Math.round(diff / 86400)}d`;
}

// --- Picker ---------------------------------------------------------------

function PickerFlow({
  onClose,
  agent,
  onUseCode,
}: {
  onClose: () => void;
  agent?: Props["agent"];
  onUseCode: () => void;
}) {
  const { t } = useTranslation("agents");
  const agents = useAgentStore((s) => s.agents);
  const fetchAgents = useAgentStore((s) => s.fetchAgents);
  const externalAgents = Object.values(agents)
    .map((m) => m.agent)
    .filter((a) => a.runtime === "external")
    .sort((a, b) => a.displayName.localeCompare(b.displayName));

  const [sessions, setSessions] = useState<ClaudeSession[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  // "Start a new session": the picker generates the session id, binds it,
  // then opens a terminal running claude there — bound before its first
  // hook fires.
  const [startNew, setStartNew] = useState(false);
  const [folder, setFolder] = useState("");
  const [choice, setChoice] = useState<string>(agent?.id ?? externalAgents[0]?.id ?? "new");
  const [newName, setNewName] = useState(t("hosting.externalTool.claude_code"));
  const [binding, setBinding] = useState(false);
  const [bindError, setBindError] = useState<string | null>(null);
  const [done, setDone] = useState<{ session: string; name: string; started?: boolean } | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<ClaudeSession[]>("list_claude_sessions")
      .then((list) => {
        if (cancelled) return;
        setSessions(list);
        // Preselect the freshest running session, else the freshest.
        const first = list.find((s) => s.running) ?? list[0];
        if (first) setSelected(first.sessionId);
      })
      .catch((err) => {
        if (!cancelled) {
          setListError(err instanceof Error ? err.message : String(err));
          setSessions([]);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const session = !startNew ? (sessions?.find((s) => s.sessionId === selected) ?? null) : null;
  const existing = choice !== "new" ? externalAgents.find((a) => a.id === choice) : null;
  const folderDir = folder.trim();
  // Folders of listed sessions double as quick picks for a new session.
  const knownFolders = Array.from(
    new Set((sessions ?? []).map((s) => s.cwd).filter((c): c is string => !!c))
  ).slice(0, 4);

  async function chooseFolder() {
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ directory: true, multiple: false, defaultPath: folderDir || undefined });
      if (typeof picked === "string") setFolder(picked);
    } catch {
      // Native chooser unavailable — the path field is editable.
    }
  }

  async function resolveTarget(): Promise<{ id: string; displayName: string; apiKey: string } | null> {
    if (choice === "new") {
      const name = newName.trim();
      if (!name) return null;
      const created = await createExternalAgent({ displayName: name, externalTool: "claude_code" });
      return { id: created.agent.id, displayName: created.agent.displayName, apiKey: created.apiKey };
    }
    const re = await regenerateApiKey(choice);
    return { id: re.agent.id, displayName: re.agent.displayName, apiKey: re.apiKey };
  }

  async function bindSession(sessionId: string, cwd: string | null, target: { id: string; displayName: string; apiKey: string }) {
    await invoke("bind_claude_session", {
      args: {
        sessionId,
        cwd,
        agentId: target.id,
        apiKey: target.apiKey,
        displayName: target.displayName,
        gatewayUrl: getApiUrl(),
      },
    });
  }

  async function handleBind(e: React.FormEvent) {
    e.preventDefault();
    if (startNew) {
      if (!folderDir) {
        setBindError(t("connectCli.errors.folder"));
        return;
      }
    } else if (!session) {
      return;
    }
    setBinding(true);
    setBindError(null);
    try {
      const target = await resolveTarget();
      if (!target) return;
      if (startNew) {
        const sessionId = crypto.randomUUID();
        await bindSession(sessionId, folderDir, target);
        try {
          await invoke("launch_claude_session", { folder: folderDir, sessionId });
        } catch (err) {
          throw new Error(
            `${t("connectCli.errors.launch")} ${err instanceof Error ? err.message : String(err)}`
          );
        }
        void fetchAgents();
        const seg = folderDir.split(/[\\/]/).filter(Boolean).slice(-1)[0] ?? folderDir;
        setDone({ session: seg, name: target.displayName, started: true });
      } else if (session) {
        await bindSession(session.sessionId, session.cwd, target);
        void fetchAgents();
        setDone({ session: sessionLabel(session), name: target.displayName });
      }
    } catch (err) {
      setBindError(err instanceof Error ? err.message : t("connectCli.errors.bind"));
    } finally {
      setBinding(false);
    }
  }

  const title = agent
    ? t("connectCli.reconnectTitle", { name: agent.displayName })
    : t("connectCli.title");

  return (
    <Shell title={title} onClose={onClose}>
      {done ? (
        <div className="space-y-3">
          <p className="text-sm">
            {done.started
              ? t("connectCli.started", { folder: done.session, name: done.name })
              : t("connectCli.bound", done)}
          </p>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              {t("connectCli.done")}
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={handleBind} className="space-y-3">
          <p className="text-sm text-muted-foreground">{t("connectCli.pickerIntro")}</p>

          <button
            type="button"
            onClick={() => setStartNew(true)}
            className={
              "flex w-full items-center gap-2 rounded-md border px-3 py-2 text-left text-sm " +
              (startNew ? "border-primary bg-primary/10" : "border-border hover:bg-accent")
            }
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span className="font-medium">{t("connectCli.startNew")}</span>
          </button>
          {startNew && (
            <div className="space-y-1.5 rounded-md border border-border p-3">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="connect-cli-folder">
                {t("connectCli.folderLabel")}
              </label>
              <div className="flex gap-2">
                <input
                  id="connect-cli-folder"
                  value={folder}
                  onChange={(e) => setFolder(e.target.value)}
                  placeholder="/path/to/repo"
                  className="min-w-0 flex-1 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                  autoFocus
                />
                <Button type="button" size="sm" variant="outline" onClick={chooseFolder}>
                  <FolderOpen className="h-3.5 w-3.5" />
                  {t("connectCli.chooseFolder")}
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
              <p className="text-[11px] text-muted-foreground">{t("connectCli.folderHint")}</p>
            </div>
          )}

          {sessions === null ? (
            <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
              {t("connectCli.sessionsLoading")}
            </div>
          ) : sessions.length === 0 ? (
            <p className="rounded-md border border-border bg-muted/40 p-3 text-xs text-muted-foreground">
              {listError ? t("connectCli.errors.list") : t("connectCli.noSessions")}
            </p>
          ) : (
            <div className="max-h-56 overflow-y-auto rounded-md border border-border">
              {sessions.map((s) => {
                const isSel = s.sessionId === selected;
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
                      (isSel && !startNew ? "bg-primary/10" : "hover:bg-accent")
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
                        <span className="truncate font-medium">{sessionLabel(s)}</span>
                        <span className="shrink-0 text-[10px] text-muted-foreground">
                          {s.running === null
                            ? relative(s.lastActiveAt)
                            : `${s.running ? t("connectCli.running") : t("connectCli.idle")} · ${relative(s.lastActiveAt)}`}
                        </span>
                      </span>
                      {s.cwd && (
                        <span className="block truncate font-mono text-[10px] text-muted-foreground">{s.cwd}</span>
                      )}
                      {s.lastPrompt && (
                        <span className="block truncate text-[11px] text-muted-foreground/80">{s.lastPrompt}</span>
                      )}
                      <span className="block text-[10px] text-muted-foreground">
                        {s.agentName
                          ? t("connectCli.boundTo", { name: s.agentName })
                          : t("connectCli.unbound")}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}

          <div className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">{t("connectCli.chooseAgent")}</span>
            <div className="flex flex-wrap gap-2">
              {externalAgents.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => setChoice(a.id)}
                  className={
                    "rounded-md border px-3 py-1.5 text-sm " +
                    (choice === a.id
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:bg-accent")
                  }
                >
                  {a.displayName}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setChoice("new")}
                className={
                  "rounded-md border px-3 py-1.5 text-sm " +
                  (choice === "new"
                    ? "border-primary bg-primary/10 text-foreground"
                    : "border-border text-muted-foreground hover:bg-accent")
                }
              >
                + {t("connectCli.newAgent")}
              </button>
            </div>
            {choice === "new" && (
              <input
                aria-label={t("connectCli.newAgentName")}
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                maxLength={100}
                placeholder={t("connectCli.newAgentName")}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
              />
            )}
            {existing && (
              <p className="text-[11px] text-muted-foreground">{t("connectCli.rekeyWarning")}</p>
            )}
          </div>

          {bindError && <p className="text-xs text-destructive">{bindError}</p>}

          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onUseCode}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("connectCli.useCodeInstead")}
            </button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {t("common:cancel")}
              </Button>
              <Button
                type="submit"
                size="sm"
                disabled={
                  binding ||
                  (startNew ? !folderDir : !session) ||
                  (choice === "new" && !newName.trim())
                }
              >
                {binding && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {startNew
                  ? binding
                    ? t("connectCli.starting")
                    : t("connectCli.start")
                  : binding
                    ? t("connectCli.binding")
                    : t("connectCli.bind")}
              </Button>
            </div>
          </div>
        </form>
      )}
    </Shell>
  );
}

// --- Code flow (other machines) --------------------------------------------

function CodeFlow({
  onClose,
  agent,
  onBack,
}: {
  onClose: () => void;
  agent?: Props["agent"];
  onBack: () => void;
}) {
  const { t } = useTranslation("agents");
  const [displayName, setDisplayName] = useState(
    agent?.displayName ?? t("hosting.externalTool.claude_code")
  );
  const [tool, setTool] = useState<CliTool>(agent?.tool === "codex" ? "codex" : "claude-code");
  const [project, setProject] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paths, setPaths] = useState<{ bridgeDir: string; python: string } | null>(null);
  const [pathsFailed, setPathsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<{ bridgeDir: string; python: string }>("get_bridge_paths")
      .then((p) => {
        if (!cancelled) setPaths(p);
      })
      .catch(() => {
        if (!cancelled) setPathsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!agent && !name) return;
    setCreating(true);
    setError(null);
    try {
      const invite = await createAgentInvite(agent ? { agentId: agent.id } : { displayName: name });
      setCode(invite.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("connectCli.errors.create"));
    } finally {
      setCreating(false);
    }
  }

  const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
  const python = paths?.python ?? "python3";
  const projectDir = project.trim();
  const command = code
    ? `${paths ? `cd ${quote(paths.bridgeDir)} && ` : ""}${quote(python)} -m agentchat connect ${code}${
        tool === "codex" ? " --tool codex" : " --install"
      }${projectDir ? ` --project ${quote(projectDir)}` : ""}`
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the command is selectable in the block.
    }
  }

  const title = agent
    ? t("connectCli.reconnectTitle", { name: agent.displayName })
    : t("connectCli.title");

  return (
    <Shell title={title} onClose={onClose}>
      <p className="mb-4 text-sm text-muted-foreground">
        {agent ? t("connectCli.reconnectIntro") : t("connectCli.intro")}
      </p>

      {!code ? (
        <form onSubmit={handleCreate} className="space-y-3">
          {!agent && (
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="connect-cli-name">
                {t("connectCli.nameLabel")}
              </label>
              <input
                id="connect-cli-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={100}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                autoFocus
              />
            </div>
          )}
          {!agent && (
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t("connectCli.toolLabel")}</span>
              <div className="flex gap-2">
                {(["claude-code", "codex"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setTool(v)}
                    className={
                      "rounded-md border px-3 py-1.5 text-sm " +
                      (tool === v
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent")
                    }
                  >
                    {v === "codex"
                      ? t("hosting.externalTool.codex")
                      : t("hosting.externalTool.claude_code")}
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="space-y-1.5">
            <label className="text-xs font-medium text-muted-foreground" htmlFor="connect-cli-project">
              {t("connectCli.projectLabel")}
            </label>
            <input
              id="connect-cli-project"
              value={project}
              onChange={(e) => setProject(e.target.value)}
              placeholder="/path/to/repo"
              className="w-full rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
              autoFocus={!!agent}
            />
            <p className="text-[11px] text-muted-foreground">{t("connectCli.projectHint")}</p>
          </div>
          {error && <p className="text-xs text-destructive">{error}</p>}
          <div className="flex items-center justify-between gap-2 pt-1">
            <button
              type="button"
              onClick={onBack}
              className="text-xs text-muted-foreground underline-offset-2 hover:underline"
            >
              {t("connectCli.backToPicker")}
            </button>
            <div className="flex gap-2">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {t("common:cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={creating || (!agent && !displayName.trim())}>
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {agent ? t("connectCli.createCode") : t("connectCli.create")}
              </Button>
            </div>
          </div>
        </form>
      ) : (
        <div className="space-y-3">
          <p className="text-sm">{t("connectCli.runThis")}</p>
          <pre className="select-all overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/50 p-3 font-mono text-xs">
            {command}
          </pre>
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" onClick={copy}>
              {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? t("connectCli.copied") : t("connectCli.copy")}
            </Button>
            {pathsFailed && (
              <span className="text-xs text-muted-foreground">{t("connectCli.bridgeMissing")}</span>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{t("connectCli.expires")}</p>
          <p className="text-xs text-muted-foreground">{t("connectCli.next")}</p>
          <div className="flex justify-end">
            <Button size="sm" onClick={onClose}>
              {t("connectCli.done")}
            </Button>
          </div>
        </div>
      )}
    </Shell>
  );
}
