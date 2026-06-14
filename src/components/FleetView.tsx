import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Cloud,
  Copy as CopyIcon,
  DownloadCloud,
  KeyRound,
  Loader2,
  Plus,
  RefreshCw,
  RotateCw,
  Server,
  ShieldCheck,
  Trash2,
} from "lucide-react";
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
 * Fleet management for org hosts (the Linux VMs that run agent bridges).
 *
 * Shows every host with live status + agents-per-machine grouped by owner,
 * and exposes the remote-control actions that previously required SSH:
 * update-and-restart, restart, rotate key, delete, register a new host,
 * and connect the org's Claude CLI subscription seat. All authorization is
 * enforced server-side (admin-only writes); we just render + call the API.
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

  const [registerOpen, setRegisterOpen] = useState(false);
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

  // Initial load + poll for fresh heartbeat-driven status/last-seen.
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

  // Live nudge: a bridge changed state on some VM → re-pull the fleet so
  // running counts update without waiting for the poll tick.
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
              Org hosts running your agents — manage, update, and monitor.
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
          <Button size="sm" onClick={() => setRegisterOpen(true)}>
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
            No hosts yet. Click <span className="font-medium">Add host</span> to
            register a VM.
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

      <RegisterHostDialog
        orgId={orgId}
        open={registerOpen}
        onOpenChange={setRegisterOpen}
        onRegistered={() => void refresh()}
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

function relativeAge(iso?: string | null): string {
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
  const [busy, setBusy] = useState<null | "update" | "restart" | "rotate" | "delete">(
    null
  );
  const [revealed, setRevealed] = useState<{ id: string; apiKey: string } | null>(
    null
  );

  const loadAgents = useCallback(async () => {
    try {
      const rows = await api.listHostAgents(orgId, host.id);
      setAgents(rows);
      setAgentsError(null);
    } catch (e) {
      setAgentsError(e instanceof Error ? e.message : "Failed to load agents");
    }
  }, [orgId, host.id]);

  useEffect(() => {
    if (expanded && agents === null) void loadAgents();
  }, [expanded, agents, loadAgents]);

  const runningCount = host.agentCount ?? host.runningAgentIds?.length ?? 0;

  const handleUpdate = async () => {
    if (
      !confirm(
        `Update "${host.name}"? It will pull the latest code, refresh deps, and ` +
          `restart — bridges briefly drop while it comes back up.`
      )
    )
      return;
    setBusy("update");
    try {
      await api.updateOrganizationHost(orgId, host.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Update failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRestart = async () => {
    if (!confirm(`Restart "${host.name}"? Bridges drop briefly while it restarts.`))
      return;
    setBusy("restart");
    try {
      await api.restartOrganizationHost(orgId, host.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Restart failed");
    } finally {
      setBusy(null);
    }
  };

  const handleRotate = async () => {
    if (
      !confirm(
        `Regenerate API key for "${host.name}"? The current key stops working ` +
          `immediately; re-run enroll.sh on the VM with the new key.`
      )
    )
      return;
    setBusy("rotate");
    try {
      const result = await api.regenerateOrganizationHostApiKey(orgId, host.id);
      setRevealed({ id: result.host.id, apiKey: result.apiKey });
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not rotate key");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async () => {
    if (
      !confirm(
        `Delete host "${host.name}"? Agents assigned here stop running on it. ` +
          `This can't be undone.`
      )
    )
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
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          {expanded ? (
            <ChevronDown className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 flex-shrink-0 text-muted-foreground" />
          )}
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="truncate font-medium">{host.name}</span>
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
            </div>
            <div className="mt-0.5 truncate text-xs text-muted-foreground">
              {runningCount} agent{runningCount === 1 ? "" : "s"} running
              {host.hostname ? ` · ${host.hostname}` : ""}
              {host.version ? ` · v${host.version}` : ""}
              {host.hostGitSha ? ` · ${host.hostGitSha}` : ""}
              {` · seen ${relativeAge(host.lastSeenAt)}`}
            </div>
          </div>
        </button>

        <div className="flex shrink-0 items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleUpdate()}
            disabled={busy !== null}
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
            onClick={() => void handleRestart()}
            disabled={busy !== null}
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
            onClick={() => void handleRotate()}
            disabled={busy !== null}
            title="Generate a new API key"
          >
            <KeyRound className="h-3.5 w-3.5" />
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
        <div className="border-t border-border px-4 py-3">
          <HostAgentList agents={agents} error={agentsError} />
        </div>
      )}

      <Dialog
        open={revealed !== null}
        onOpenChange={(next) => {
          if (!next) setRevealed(null);
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>New host credentials</DialogTitle>
            <DialogDescription>
              Copy these now — the API key is shown once. Re-run{" "}
              <code>enroll.sh</code> on the VM with the new value.
            </DialogDescription>
          </DialogHeader>
          {revealed && (
            <CredentialReveal
              hostId={revealed.id}
              apiKey={revealed.apiKey}
              onClose={() => setRevealed(null)}
            />
          )}
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
    const byOwner = new Map<
      string,
      { ownerName: string; agents: api.HostAgent[] }
    >();
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

  if (error) {
    return <p className="text-sm text-destructive">{error}</p>;
  }
  if (agents === null) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading agents…
      </div>
    );
  }
  if (agents.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        No agents assigned to this host.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {agents.length} agent{agents.length === 1 ? "" : "s"} across{" "}
        {grouped.length} owner{grouped.length === 1 ? "" : "s"}
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
                  <span className="text-xs text-muted-foreground">
                    {a.presence_mode}
                  </span>
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

function RegisterHostDialog({
  orgId,
  open,
  onOpenChange,
  onRegistered,
}: {
  orgId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onRegistered: () => void;
}) {
  const [name, setName] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<{ id: string; apiKey: string } | null>(
    null
  );

  const reset = () => {
    setName("");
    setError(null);
    setRevealed(null);
  };

  const handleRegister = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Host name is required.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const result = await api.createOrganizationHost(orgId, trimmed);
      setRevealed({ id: result.host.id, apiKey: result.apiKey });
      onRegistered();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not register host");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        // Don't let the one-time key be dismissed by accident.
        if (!next && revealed) return;
        if (!next) reset();
        onOpenChange(next);
      }}
    >
      <DialogContent showCloseButton={!revealed}>
        <DialogHeader>
          <DialogTitle>{revealed ? "Host credentials" : "Add host"}</DialogTitle>
          {!revealed && (
            <DialogDescription>
              Registers a VM. You'll get a one-time ID + API key to enroll it
              with <code>enroll.sh</code>.
            </DialogDescription>
          )}
        </DialogHeader>

        {revealed ? (
          <CredentialReveal
            hostId={revealed.id}
            apiKey={revealed.apiKey}
            onClose={() => {
              reset();
              onOpenChange(false);
            }}
          />
        ) : (
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="fleet-host-name">Host name</Label>
              <Input
                id="fleet-host-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="vm-01.lan"
              />
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
              <Button onClick={() => void handleRegister()} disabled={submitting}>
                {submitting ? "Registering…" : "Register"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function ConnectAnthropicDialog({
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
              Token stored and pushed to your hosts. New bridge runs will use it
              automatically.
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
                authorize in your browser.
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
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
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

function ProvisionDialog({
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
        if (cancelled) return;
        setCatalog(c);
      })
      .catch((e) => {
        if (!cancelled)
          setError(
            e instanceof Error ? e.message : "Could not load provisioning options"
          );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, orgId]);

  const optLabel = (o: api.ProvisioningOption) =>
    String(o.name ?? o.id);

  const handleProvision = async () => {
    if (!name.trim() || !dataCenterId || !templateId || !itemId) {
      setError("Pick a name, data center, OS template, and plan.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.provisionHost(orgId, {
        name: name.trim(),
        itemId,
        dataCenterId,
        templateId,
      });
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
            Provisions a Hostinger VPS that auto-installs the host runtime and
            enrolls itself — it shows up here as online when ready.
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
              <Button
                variant="ghost"
                onClick={() => onOpenChange(false)}
                disabled={submitting}
              >
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

function CredentialReveal({
  hostId,
  apiKey,
  onClose,
}: {
  hostId: string;
  apiKey: string;
  onClose: () => void;
}) {
  const envBlock = `ORG_HOST_ID=${hostId}\nORG_HOST_API_KEY=${apiKey}\n`;
  return (
    <div className="space-y-3 py-1">
      <CredentialField label="ORG_HOST_ID" value={hostId} />
      <CredentialField label="ORG_HOST_API_KEY" value={apiKey} />
      <DialogFooter className="gap-2 pt-1">
        <Button
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(envBlock)}
        >
          <CopyIcon className="h-3.5 w-3.5" />
          Copy as .env
        </Button>
        <Button onClick={onClose}>I've copied them</Button>
      </DialogFooter>
    </div>
  );
}

function CredentialField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="font-mono text-xs">{label}</Label>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs break-all">
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
