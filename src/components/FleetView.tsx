import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy as CopyIcon,
  DownloadCloud,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  ShieldCheck,
  Terminal,
  Trash2,
  X,
} from "lucide-react";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import * as api from "../lib/api";
import { cn } from "../lib/utils";
import { ws } from "../services/websocket";
import { useAuthStore } from "../stores/authStore";
import { useWorkspaces } from "../stores/workspaceStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Fleet management for org hosts. Management flows over SSH (the backend
 * connects out to each box to bootstrap/update/restart/etc), so it works for
 * Hostinger VMs and any bring-your-own Linux machine. Live agent counts still
 * come from the host's WebSocket heartbeat.
 */
export function FleetView() {
  const participant = useAuthStore((s) => s.participant);
  const workspaces = useWorkspaces();
  const orgId =
    participant?.organizationId ??
    workspaces.find((w) => w.isPersonal)?.id ??
    null;

  const [hosts, setHosts] = useState<api.OrganizationHost[]>([]);
  const [anthropicConnected, setAnthropicConnected] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [connectOpen, setConnectOpen] = useState(false);
  const [anthropicOpen, setAnthropicOpen] = useState(false);
  const [provisionOpen, setProvisionOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    try {
      const fleet = await api.listOrganizationHostFleet(orgId);
      setHosts(fleet.hosts);
      setAnthropicConnected(fleet.anthropicConnected);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load fleet");
    }
  }, [orgId]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    setLoading(true);
    refresh().finally(() => {
      if (!cancelled) setLoading(false);
    });
    const interval = setInterval(() => void refresh(), 20_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [orgId, refresh]);

  useEffect(() => {
    const off = ws.on("host_agent_status", () => void refresh());
    return off;
  }, [refresh]);

  if (!orgId) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
        Loading workspace…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-base font-semibold leading-none">Fleet</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              Org hosts running your agents — managed over SSH.
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={() => setAnthropicOpen(true)}>
            <ShieldCheck
              className={cn(
                "h-3.5 w-3.5",
                anthropicConnected ? "text-success" : "text-muted-foreground"
              )}
            />
            {anthropicConnected ? "Anthropic connected" : "Connect Anthropic"}
          </Button>
          <Button variant="outline" size="sm" onClick={() => setProvisionOpen(true)}>
            <Cloud className="h-3.5 w-3.5" />
            Spin up VM
          </Button>
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            Add host
          </Button>
        </div>
      </header>

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {error && (
          <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
            <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : hosts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
            No hosts yet. <span className="font-medium">Add host</span> to connect
            a machine over SSH, or <span className="font-medium">Spin up VM</span>.
          </div>
        ) : (
          <ul className="space-y-3">
            {hosts.map((h) => (
              <HostCard
                key={h.id}
                orgId={orgId}
                host={h}
                onChanged={() => void refresh()}
              />
            ))}
          </ul>
        )}
      </div>

      <ConnectHostDialog
        orgId={orgId}
        open={connectOpen}
        onOpenChange={setConnectOpen}
        onChanged={() => void refresh()}
      />
      <ConnectAnthropicDialog
        orgId={orgId}
        open={anthropicOpen}
        onOpenChange={setAnthropicOpen}
        onConnected={() => {
          setAnthropicConnected(true);
          void refresh();
        }}
      />
      <ProvisionDialog
        orgId={orgId}
        open={provisionOpen}
        onOpenChange={setProvisionOpen}
        onProvisioned={() => void refresh()}
      />
    </div>
  );
}

export function relativeAge(iso?: string | null): string {
  if (!iso) return "never";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "unknown";
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return `${secs}s ago`;
  const mins = Math.round(secs / 60);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

function HostCard({
  orgId,
  host,
  onChanged,
}: {
  orgId: string;
  host: api.OrganizationHost;
  onChanged: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [agents, setAgents] = useState<api.HostAgent[] | null>(null);
  const [agentsError, setAgentsError] = useState<string | null>(null);
  const [ops, setOps] = useState<api.HostOperation[]>([]);
  const [busy, setBusy] = useState<api.HostOpKind | "delete" | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(host.name);
  const [renameBusy, setRenameBusy] = useState(false);

  const loadDetail = useCallback(async () => {
    try {
      const [a, o] = await Promise.all([
        api.listHostAgents(orgId, host.id),
        api.listHostOperations(orgId, host.id),
      ]);
      setAgents(a);
      setOps(o);
      setAgentsError(null);
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : "Failed to load host detail");
    }
  }, [orgId, host.id]);

  useEffect(() => {
    if (expanded) void loadDetail();
  }, [expanded, loadDetail]);

  const runningCount = host.agentCount ?? host.runningAgentIds?.length ?? 0;
  const bootstrapped = !!host.bootstrappedAt;

  const op = async (kind: api.HostOpKind, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(kind);
    try {
      await api.runHostOp(orgId, host.id, kind);
      if (!expanded) setExpanded(true);
      await loadDetail();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(null);
    }
  };

  const rename = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === host.name) {
      setEditing(false);
      setNameInput(host.name);
      return;
    }
    setRenameBusy(true);
    try {
      await api.updateHostConnection(orgId, host.id, { name: trimmed });
      setEditing(false);
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not rename host");
      setNameInput(host.name);
    } finally {
      setRenameBusy(false);
    }
  };

  const showKey = async () => {
    setKeyOpen(true);
    if (pubKey) return;
    try {
      setPubKey(await api.getHostPublicKey(orgId, host.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not load public key");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete host "${host.name}"? Agents assigned here stop running on it.`))
      return;
    setBusy("delete");
    try {
      await api.deleteOrganizationHost(orgId, host.id);
      onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not delete host");
    } finally {
      setBusy(null);
    }
  };

  return (
    <li className="rounded-lg border border-border">
      <div className="flex items-center gap-3 px-4 py-3">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex-shrink-0 text-muted-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4" />
          ) : (
            <ChevronRight className="h-4 w-4" />
          )}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Input
                  value={nameInput}
                  autoFocus
                  disabled={renameBusy}
                  onChange={(e) => setNameInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void rename();
                    if (e.key === "Escape") {
                      setNameInput(host.name);
                      setEditing(false);
                    }
                  }}
                  className="h-7 max-w-[16rem]"
                />
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => void rename()}
                  disabled={renameBusy}
                >
                  <Check className="h-3.5 w-3.5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 w-7 p-0"
                  onClick={() => {
                    setNameInput(host.name);
                    setEditing(false);
                  }}
                  disabled={renameBusy}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  className="truncate text-left font-medium"
                >
                  {host.name}
                </button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0 text-muted-foreground"
                  onClick={() => {
                    setNameInput(host.name);
                    setEditing(true);
                  }}
                  title="Rename host"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0",
                    host.status === "online" &&
                      "border-success/30 bg-success/10 text-success",
                    host.status === "offline" && "border-muted text-muted-foreground",
                    host.status === "disabled" &&
                      "border-destructive/30 bg-destructive/10 text-destructive"
                  )}
                >
                  {host.status}
                </Badge>
                {!bootstrapped && (
                  <Badge variant="outline" className="shrink-0 border-amber-500/30 text-amber-600">
                    not bootstrapped
                  </Badge>
                )}
              </>
            )}
          </div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-0.5 block w-full truncate text-left text-xs text-muted-foreground"
          >
            {runningCount} agent{runningCount === 1 ? "" : "s"} running
            {host.sshHost ? ` · ${host.sshUser || "root"}@${host.sshHost}` : " · no SSH target"}
            {host.provider
              ? ` · ${host.provider}${host.providerVmId ? ` vm ${host.providerVmId}` : ""}${
                  host.datacenter ? ` (${host.datacenter})` : ""
                }`
              : ""}
            {host.version ? ` · v${host.version}` : ""}
            {host.hostGitSha ? ` · ${host.hostGitSha}` : ""}
            {` · seen ${relativeAge(host.lastSeenAt)}`}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!bootstrapped && host.sshHost && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void showKey()}
              disabled={busy !== null}
              title="Show the SSH public key to authorize on the host"
            >
              <KeyRound className="h-3.5 w-3.5" />
              Key
            </Button>
          )}
          {!bootstrapped && host.sshHost && (
            <Button
              variant="default"
              size="sm"
              onClick={() => void op("bootstrap")}
              disabled={busy !== null}
              title="Install the runtime over SSH"
            >
              {busy === "bootstrap" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <DownloadCloud className="h-3.5 w-3.5" />
              )}
              Bootstrap
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("update", `Update "${host.name}"? Pulls latest + restarts.`)}
            disabled={busy !== null || !host.sshHost}
            title="Pull latest code + restart"
          >
            {busy === "update" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DownloadCloud className="h-3.5 w-3.5" />
            )}
            Update
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("restart", `Restart "${host.name}"?`)}
            disabled={busy !== null || !host.sshHost}
            title="Restart the host service"
          >
            {busy === "restart" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
            Restart
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("probe")}
            disabled={busy !== null || !host.sshHost}
            title="Probe status over SSH"
          >
            {busy === "probe" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleDelete()}
            disabled={busy !== null}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            title="Delete host"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="space-y-4 border-t border-border px-4 py-3">
          <HostAgentList agents={agents} error={agentsError} />
          <HostOpLog
            ops={ops}
            onCancel={async (opId) => {
              await api.cancelHostOperation(orgId, host.id, opId);
              await loadDetail();
            }}
          />
        </div>
      )}

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Authorize "{host.name}"</DialogTitle>
            <DialogDescription>
              AgentGram connects to your VM over SSH using its own key — not your root password.
              Add this public key to {host.sshUser || "root"}@{host.sshHost}, then bootstrap.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {pubKey ? (
              <>
                <CopyField label="Public key" value={pubKey} mono />
                <CopyField
                  label={`Run this on the host (ssh ${host.sshUser || "root"}@${host.sshHost})`}
                  value={`mkdir -p ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`}
                  mono
                />
                <p className="text-xs text-muted-foreground">
                  Bootstrap needs Ubuntu 22.04+/Debian 12 with outbound internet (GitHub + PyPI).
                </p>
              </>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Loading key…
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              onClick={() => {
                setKeyOpen(false);
                void op("bootstrap");
              }}
              disabled={busy !== null || !pubKey}
            >
              Bootstrap now
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </li>
  );
}

function HostAgentList({
  agents,
  error,
}: {
  agents: api.HostAgent[] | null;
  error: string | null;
}) {
  const grouped = useMemo(() => {
    if (!agents) return [];
    const byOwner = new Map<string, { ownerName: string; agents: api.HostAgent[] }>();
    for (const a of agents) {
      const key = a.owner?.id ?? "unknown";
      const name = a.owner?.display_name ?? "Unknown owner";
      if (!byOwner.has(key)) byOwner.set(key, { ownerName: name, agents: [] });
      byOwner.get(key)!.agents.push(a);
    }
    return Array.from(byOwner.values()).sort((a, b) =>
      a.ownerName.localeCompare(b.ownerName)
    );
  }, [agents]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (agents === null)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agents…
      </div>
    );
  if (agents.length === 0)
    return <p className="text-sm text-muted-foreground">No agents assigned to this host.</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {agents.length} agent{agents.length === 1 ? "" : "s"} across {grouped.length} owner
        {grouped.length === 1 ? "" : "s"}
      </p>
      {grouped.map((g) => (
        <div key={g.ownerName}>
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            {g.ownerName}
          </div>
          <ul className="space-y-1">
            {g.agents.map((a) => (
              <li
                key={a.id}
                className="flex items-center justify-between gap-2 rounded-sm bg-muted/40 px-2.5 py-1.5 text-sm"
              >
                <span className="truncate">{a.display_name}</span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className="text-xs text-muted-foreground">{a.presence_mode}</span>
                  <span
                    className={cn(
                      "h-2 w-2 rounded-full",
                      a.running ? "bg-success" : "bg-muted-foreground/40"
                    )}
                    title={a.running ? "running" : "idle"}
                  />
                </span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

/** Wall-clock length of an op: finished ops show their total, running ops
 *  show elapsed-so-far (the caller re-polls, so this advances on each render). */
function opDuration(o: api.HostOperation): string {
  const start = new Date(o.insertedAt).getTime();
  if (Number.isNaN(start)) return "";
  const end = o.finishedAt ? new Date(o.finishedAt).getTime() : Date.now();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function HostOpLog({
  ops,
  onCancel,
}: {
  ops: api.HostOperation[];
  /** Cancel a stuck pending/running op. When omitted, no cancel control shows
   *  (e.g. for non-admins). Returns once the op is cleared so the row refreshes. */
  onCancel?: (operationId: string) => Promise<void> | void;
}) {
  // Auto-expand a running/pending op so its output streams without a click;
  // otherwise honour whatever the user last toggled open.
  const activeId =
    ops.find((o) => o.status === "pending" || o.status === "running")?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(activeId);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  // Follow the active op as it changes (a freshly-kicked-off op becomes active).
  useEffect(() => {
    if (activeId) setOpenId(activeId);
  }, [activeId]);

  const cancel = async (id: string) => {
    if (!onCancel) return;
    if (!confirm("Cancel this operation? It's marked canceled so the host's status reflects reality.")) return;
    setCancelingId(id);
    try {
      await onCancel(id);
    } finally {
      setCancelingId(null);
    }
  };

  if (ops.length === 0)
    return <p className="text-sm text-muted-foreground">No operations yet.</p>;

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Terminal className="h-3 w-3" /> Recent operations
      </div>
      <ul className="space-y-1">
        {ops.map((o) => {
          const running = o.status === "pending" || o.status === "running";
          return (
            <li key={o.id} className="rounded-sm bg-muted/40 text-sm">
              <div className="flex w-full items-center gap-2 px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => setOpenId((id) => (id === o.id ? null : o.id))}
                  className="flex flex-1 items-center justify-between gap-2 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        o.status === "ok" && "bg-success",
                        o.status === "failed" && "bg-destructive",
                        o.status === "canceled" && "bg-muted-foreground/50",
                        running && "bg-amber-500 animate-pulse"
                      )}
                    />
                    <span className="font-medium">{o.kind}</span>
                    <span
                      className={cn(
                        "text-xs",
                        o.status === "failed" ? "text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {o.status}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{opDuration(o)}</span>
                    <span>· {relativeAge(o.insertedAt)}</span>
                  </span>
                </button>
                {running && onCancel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                    disabled={cancelingId === o.id}
                    onClick={() => void cancel(o.id)}
                    title="Cancel this stuck operation"
                  >
                    {cancelingId === o.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                    Cancel
                  </Button>
                )}
              </div>
              {openId === o.id &&
                (o.output ? (
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all border-t border-border px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
                    {o.output}
                  </pre>
                ) : running ? (
                  <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> Running…
                  </div>
                ) : null)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/**
 * Clean a pasted SSH host into a bare host/IP. Operators often paste a whole
 * `ssh root@1.2.3.4` command or a `host:port` — the backend connects to this
 * verbatim, so strip the `ssh ` prefix, any `user@`, a trailing `:port`, and
 * anything after whitespace.
 */
function normalizeSshHost(input: string): string {
  let h = input.trim().replace(/^ssh\s+/i, "");
  if (h.includes("@")) h = h.slice(h.lastIndexOf("@") + 1);
  h = h.split(/\s+/)[0] ?? "";
  // Strip a trailing :port (but leave IPv6 colons alone — those have >1 colon).
  if ((h.match(/:/g) ?? []).length === 1) h = h.replace(/:\d+$/, "");
  return h;
}

export function ConnectHostDialog({
  orgId,
  open,
  onOpenChange,
  onChanged,
  initialVmId,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onChanged: () => void;
  /** Preselect this Hostinger VM when the dialog opens (e.g. "Add host" was
   *  clicked on a specific unmanaged VM row). Autofills name + SSH host. */
  initialVmId?: string;
}) {
  const [name, setName] = useState("");
  const [sshHost, setSshHost] = useState("");
  const [sshUser, setSshUser] = useState("root");
  const [sshPort, setSshPort] = useState("22");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ hostId: string; publicKey: string } | null>(
    null
  );
  const [bootstrapping, setBootstrapping] = useState(false);
  const [vms, setVms] = useState<api.ProviderVm[]>([]);
  const [selectedVmId, setSelectedVmId] = useState("");

  // Existing provider VMs the operator can pick from (best-effort: empty when
  // provisioning isn't configured — manual IP entry still works).
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    api
      .listProviderVms(orgId)
      .then((list) => {
        if (cancelled) return;
        setVms(list);
        // Preselect the VM the caller pointed us at and autofill from it.
        if (initialVmId) {
          const vm = list.find((v) => v.id === initialVmId);
          if (vm) {
            setSelectedVmId(vm.id);
            if (vm.ipv4) setSshHost(vm.ipv4);
            setName((n) => n || vm.hostname || "");
          }
        }
      })
      .catch(() => !cancelled && setVms([]));
    return () => {
      cancelled = true;
    };
  }, [open, orgId, initialVmId]);

  const reset = () => {
    setName("");
    setSshHost("");
    setSshUser("root");
    setSshPort("22");
    setSelectedVmId("");
    setError(null);
    setCreated(null);
  };

  const handleConnect = async () => {
    const host = normalizeSshHost(sshHost);
    if (!name.trim() || !host) {
      setError("Name and SSH host are required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    const vm = vms.find((v) => v.id === selectedVmId);
    try {
      const res = await api.connectHost(orgId, {
        name: name.trim(),
        sshHost: host,
        sshUser: sshUser.trim() || "root",
        sshPort: Number(sshPort) || 22,
        // Carry VM provenance so the host card shows the association + metrics work.
        ...(vm
          ? { provider: "hostinger", providerVmId: vm.id, datacenter: vm.datacenter ?? null }
          : {}),
      });
      setCreated({ hostId: res.host.id, publicKey: res.publicKey });
      onChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not connect host");
    } finally {
      setSubmitting(false);
    }
  };

  const handleBootstrap = async () => {
    if (!created) return;
    setBootstrapping(true);
    try {
      await api.runHostOp(orgId, created.hostId, "bootstrap");
      onChanged();
      reset();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Bootstrap failed");
    } finally {
      setBootstrapping(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{created ? "Authorize + bootstrap" : "Add host"}</DialogTitle>
          <DialogDescription>
            {created
              ? "Add this key to the machine, then bootstrap to install the runtime over SSH."
              : "Connect a Linux machine the backend manages over SSH."}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3 py-1">
            <p className="text-sm">
              On the host, append this to{" "}
              <code>~/.ssh/authorized_keys</code> for the{" "}
              <code>{sshUser || "root"}</code> user:
            </p>
            <CopyField label="Public key" value={created.publicKey} mono />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                disabled={bootstrapping}
              >
                Later
              </Button>
              <Button onClick={() => void handleBootstrap()} disabled={bootstrapping}>
                {bootstrapping ? "Bootstrapping…" : "Bootstrap now"}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {vms.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="ch-vm">Virtual machine</Label>
                <select
                  id="ch-vm"
                  value={selectedVmId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setSelectedVmId(id);
                    const vm = vms.find((v) => v.id === id);
                    if (vm?.ipv4) setSshHost(vm.ipv4);
                  }}
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="">Enter a host manually…</option>
                  {vms.map((v) => (
                    <option key={v.id} value={v.id}>
                      {v.hostname || v.id}
                      {v.ipv4 ? ` — ${v.ipv4}` : ""}
                      {v.state ? ` (${v.state})` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  Pick one of your Hostinger VMs to auto-fill its IP, or enter a host manually.
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ch-name">Name</Label>
              <Input
                id="ch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="agent-host-1"
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <div className="space-y-1">
                <Label htmlFor="ch-host">SSH host / IP</Label>
                <Input
                  id="ch-host"
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  placeholder="203.0.113.10 (IP only — no 'ssh' or user@)"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ch-user">User</Label>
                <Input
                  id="ch-user"
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  className="w-24"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ch-port">Port</Label>
                <Input
                  id="ch-port"
                  value={sshPort}
                  onChange={(e) => setSshPort(e.target.value)}
                  className="w-16"
                />
              </div>
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button
                variant="ghost"
                onClick={() => {
                  reset();
                  onOpenChange(false);
                }}
                disabled={submitting}
              >
                Cancel
              </Button>
              <Button onClick={() => void handleConnect()} disabled={submitting}>
                {submitting ? "Connecting…" : "Continue"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export function ConnectAnthropicDialog({
  orgId,
  open,
  onOpenChange,
  onConnected,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}) {
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSave = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError("Paste the token from `claude setup-token`.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.setOrganizationAnthropicToken(orgId, trimmed);
      setDone(true);
      setToken("");
      onConnected();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not store token");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) {
          setError(null);
          setDone(false);
          setToken("");
        }
        onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Connect Anthropic</DialogTitle>
          <DialogDescription>
            Give your hosts a shared Claude subscription seat so{" "}
            <code>claude_cli</code> agents run without logging in on each VM.
          </DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 py-1">
            <p className="text-sm">
              Token stored. A `set_token` op was sent to each bootstrapped host;
              new bridge runs use it automatically.
            </p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              <li>
                On any machine with a browser, run{" "}
                <code className="text-foreground">claude setup-token</code> and
                authorize.
              </li>
              <li>Copy the long-lived token it prints (valid ~1 year).</li>
              <li>Paste it below.</li>
            </ol>
            <div className="space-y-1">
              <Label htmlFor="anthropic-token">CLAUDE_CODE_OAUTH_TOKEN</Label>
              <Textarea
                id="anthropic-token"
                value={token}
                onChange={(e) => setToken(e.target.value)}
                placeholder="sk-ant-oat01-…"
                rows={3}
                className="font-mono text-xs"
              />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={() => void handleSave()} disabled={submitting}>
                {submitting ? "Saving…" : "Save token"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Open a URL in the system browser — Tauri native with window.open fallback. */
function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}

// Pull the OAuth authorize URL out of the captured login pane. claude /login
// prints a `https://claude.com/cai/oauth/authorize?…` (or claude.ai / anthropic
// console) URL when it can't open a browser. We match the *authorize* URL
// specifically — not just any anthropic/claude link — so an unrelated marketing
// URL in the banner (e.g. claude.com/news/…) is never mistaken for it.
//
// We anchor on the *authorize* URL specifically — not just any anthropic/claude
// link — so an unrelated marketing URL in the login banner (e.g.
// claude.com/news/…) is never mistaken for it. The backend runs the login in a
// 1000-column tmux pane and captures with `-J`, so the ~400-char URL comes back
// on a single line; from the anchor we take the contiguous run of non-whitespace.
const AUTHORIZE_URL_RE =
  /https?:\/\/(?:[a-z0-9.-]*\.)?(?:claude\.com|claude\.ai|anthropic\.com)\/[^\s]*oauth\/authorize[^\s]*/i;

function extractLoginUrl(pane: string): string | null {
  const m = pane.match(AUTHORIZE_URL_RE);
  if (!m) return null;
  return m[0].replace(/[).,]+$/, "") || null;
}

// Heuristic success / failure detection from the pane text.
function loginSucceeded(pane: string): boolean {
  return /login successful|logged in|successfully authenticated|you('| a)re now logged in/i.test(
    pane
  );
}
function loginFailed(pane: string): boolean {
  return /invalid code|authentication failed|oauth error|error:|expired/i.test(pane);
}

// Before the login URL appears, `claude` can show a "Do you trust the files in
// this folder?" prompt that must be answered (Enter = the default "Yes" option)
// before it continues. We detect it from the pane text and auto-confirm once.
function trustPromptVisible(pane: string): boolean {
  return /do you trust the files in this folder|trust the files in this|yes, proceed/i.test(
    pane
  );
}

// After the URL, `claude /login` prints a "Paste code here if prompted" line and
// blocks on stdin. Detecting it lets us reveal the code box even if URL
// extraction failed — so the operator is never stuck unable to paste.
function codePromptVisible(pane: string): boolean {
  return /paste (the )?code|enter (the )?code|authorization code|code:\s*$/im.test(pane);
}

/**
 * Drives an interactive `claude /login` on one host VM, entirely from the
 * desktop. The backend runs the login inside a detached tmux session over SSH;
 * we poll its pane text for the OAuth URL, let the operator open it locally and
 * paste the code back, then submit it. Writes the per-host file seat at
 * /home/agentgram/.claude/.credentials.json (shared by every bridge on the box).
 */
export function ClaudeLoginDialog({
  orgId,
  hostId,
  hostName,
  open,
  onOpenChange,
}: {
  orgId: string;
  hostId: string;
  hostName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pane, setPane] = useState("");
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<
    "starting" | "awaiting_url" | "awaiting_code" | "submitting" | "done" | "error"
  >("starting");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  // Auto-confirm the trust-folder prompt at most once per session so we don't
  // hammer Enter every 2s poll while the prompt is still painting.
  const trustConfirmedRef = useRef(false);

  // Fire-and-forget a navigation key into the remote session. Used both for the
  // automatic trust-prompt confirmation and the manual controls below.
  const sendKey = useCallback(
    async (key: string) => {
      setKeyBusy(true);
      try {
        const { output } = await api.sendClaudeLoginKey(orgId, hostId, key);
        setPane(output);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send key to the host");
      } finally {
        setKeyBusy(false);
      }
    },
    [orgId, hostId]
  );

  // Start the session when the dialog opens; cancel + reset when it closes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const applyPane = (text: string) => {
      if (cancelled) return;
      setPane(text);
      // Auto-answer the trust-folder prompt (Enter = the highlighted "Yes")
      // once, so the login can advance to printing the URL.
      if (!trustConfirmedRef.current && !extractLoginUrl(text) && trustPromptVisible(text)) {
        trustConfirmedRef.current = true;
        void api.sendClaudeLoginKey(orgId, hostId, "Enter").catch(() => {});
      }
      const url = extractLoginUrl(text);
      if (url) setLoginUrl(url);
      // Don't override an in-flight code submission or a finished state. Move to
      // the code step once the URL appears OR the host prints its "paste code"
      // prompt — so a failed URL extraction never traps the operator.
      setPhase((prev) => {
        if (prev === "submitting" || prev === "done" || prev === "error") return prev;
        if (loginSucceeded(text)) return "done";
        if (url || codePromptVisible(text)) return "awaiting_code";
        return "awaiting_url";
      });
    };

    const poll = async () => {
      try {
        const { output } = await api.pollClaudeLoginOutput(orgId, hostId);
        applyPane(output);
      } catch {
        // Transient SSH hiccup — keep polling.
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };

    setPhase("starting");
    setPane("");
    setLoginUrl(null);
    setCode("");
    setError(null);
    trustConfirmedRef.current = false;

    api
      .startClaudeLogin(orgId, hostId)
      .then(() => {
        if (cancelled) return;
        setPhase("awaiting_url");
        void poll();
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not start login on the host");
        setPhase("error");
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Best-effort teardown of the remote tmux session.
      void api.cancelClaudeLogin(orgId, hostId).catch(() => {});
    };
  }, [open, orgId, hostId]);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setPhase("submitting");
    setError(null);
    try {
      const { output } = await api.submitClaudeLoginCode(orgId, hostId, trimmed);
      setPane(output);
      setCode("");
      // Give claude a beat to process, then let the poller resolve success/failure.
      if (loginSucceeded(output)) setPhase("done");
      else if (loginFailed(output)) setPhase("error");
      else setPhase("awaiting_code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit code");
      setPhase("awaiting_code");
    }
  };

  const copyUrl = () => {
    if (!loginUrl) return;
    void navigator.clipboard.writeText(loginUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sign in to Claude — {hostName}</DialogTitle>
          <DialogDescription>
            Runs <code>claude /login</code> on the VM. Open the URL below in your
            browser, authorize, then paste the code it gives you. Credentials are
            stored on the host and shared by every agent running on it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {phase === "starting" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting login on the host…
            </div>
          )}

          {phase === "awaiting_url" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting for the login URL…
              </div>
              {trustPromptVisible(pane) && (
                <p className="text-xs text-muted-foreground">
                  The host is asking whether to trust this folder — confirming
                  automatically. If it's stuck, use the controls below to answer
                  it manually.
                </p>
              )}
            </div>
          )}

          {/* Manual terminal controls — a fallback for any prompt that precedes
              the login (trust-folder dialog, menu selection) that our
              auto-confirm didn't clear. Shown until the URL appears. */}
          {(phase === "awaiting_url" || phase === "starting") && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">Send key:</span>
              {(["Up", "Down", "Enter"] as const).map((k) => (
                <Button
                  key={k}
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={keyBusy}
                  onClick={() => void sendKey(k)}
                >
                  {k === "Up" ? "↑" : k === "Down" ? "↓" : "Enter ⏎"}
                </Button>
              ))}
            </div>
          )}

          {loginUrl && phase !== "done" && (
            <div className="space-y-1">
              <Label className="text-xs">Login URL</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs break-all">
                <span className="flex-1 select-all">{loginUrl}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0"
                  onClick={copyUrl}
                  title="Copy URL"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => openExternal(loginUrl)}
              >
                Open in browser
              </Button>
            </div>
          )}

          {(phase === "awaiting_code" || phase === "submitting") && (
            <div className="space-y-1">
              <Label htmlFor="claude-auth-code">Authorization code</Label>
              {!loginUrl && (
                <p className="text-xs text-muted-foreground">
                  Couldn't auto-detect the login URL — copy it from the terminal
                  output below, open it in your browser, then paste the code here.
                </p>
              )}
              <div className="flex items-center gap-2">
                <Input
                  id="claude-auth-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                  placeholder="Paste the code from the browser"
                  className="font-mono text-xs"
                  disabled={phase === "submitting"}
                  autoFocus
                />
                <Button onClick={() => void submit()} disabled={phase === "submitting" || !code.trim()}>
                  {phase === "submitting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Submit"}
                </Button>
              </div>
            </div>
          )}

          {phase === "done" && (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-2.5 py-2 text-sm text-success">
              <Check className="h-4 w-4" /> Signed in. Agents on this host can now use Claude.
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {pane && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Terminal className="h-3 w-3" /> Terminal output
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted/40 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
                {pane}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {phase === "done" ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ProvisionDialog({
  orgId,
  open,
  onOpenChange,
  onProvisioned,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onProvisioned: () => void;
}) {
  const [catalog, setCatalog] = useState<api.ProvisioningCatalog | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [name, setName] = useState("");
  const [dataCenterId, setDataCenterId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [itemId, setItemId] = useState("");

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .getProvisioningCatalog(orgId)
      .then((c) => {
        if (!cancelled) setCatalog(c);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : "Could not load provisioning options");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  const optLabel = (o: api.ProvisioningOption) => String(o.name ?? o.id);

  const handleProvision = async () => {
    if (!name.trim() || !dataCenterId || !templateId || !itemId) {
      setError("Pick a name, data center, OS template, and plan.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.provisionHost(orgId, { name: name.trim(), itemId, dataCenterId, templateId });
      onProvisioned();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provisioning failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Spin up a new VM</DialogTitle>
          <DialogDescription>
            Provisions a Hostinger VPS with our SSH key, then bootstraps it over
            SSH — it shows up here and comes online on its own.
          </DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading options…
          </div>
        ) : error && !catalog ? (
          <div className="space-y-3 py-1">
            <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{error}</p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="prov-name">Host name</Label>
              <Input
                id="prov-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="agent-host-2"
              />
            </div>
            <ProvisionSelect
              id="prov-dc"
              label="Data center"
              value={dataCenterId}
              onChange={setDataCenterId}
              options={catalog?.dataCenters ?? []}
              optLabel={optLabel}
            />
            <ProvisionSelect
              id="prov-tpl"
              label="OS template"
              value={templateId}
              onChange={setTemplateId}
              options={catalog?.templates ?? []}
              optLabel={optLabel}
            />
            <ProvisionSelect
              id="prov-plan"
              label="Plan"
              value={itemId}
              onChange={setItemId}
              options={catalog?.plans ?? []}
              optLabel={optLabel}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                Cancel
              </Button>
              <Button onClick={() => void handleProvision()} disabled={submitting}>
                {submitting ? "Provisioning…" : "Provision"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ProvisionSelect({
  id,
  label,
  value,
  onChange,
  options,
  optLabel,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (value: string) => void;
  options: api.ProvisioningOption[];
  optLabel: (o: api.ProvisioningOption) => string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">Select…</option>
        {options.map((o) => (
          <option key={String(o.id)} value={String(o.id)}>
            {optLabel(o)}
          </option>
        ))}
      </select>
    </div>
  );
}

function CopyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 text-xs break-all",
          mono && "font-mono"
        )}
      >
        <span className="flex-1 select-all">{value}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigator.clipboard.writeText(value)}
          aria-label={`Copy ${label}`}
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
