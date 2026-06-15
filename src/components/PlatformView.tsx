import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowRightLeft,
  Check,
  ChevronRight,
  Cloud,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  ShieldHalf,
  Users as UsersIcon,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import { cn } from "../lib/utils";
import { useModelCatalog, type CatalogProvider } from "../stores/modelCatalogStore";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/**
 * Platform-operator console (super-admin only — gated server-side by the env
 * allowlist; this surface is only mounted when participant.platformAdmin).
 * Cross-org view of the whole platform: stats, fleet, users, allocation,
 * provisioning.
 */
export function PlatformView() {
  const [tab, setTab] = useState("overview");

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-6 py-4">
        <ShieldHalf className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-base font-semibold leading-none">Platform</h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Operator console — fleet, users, and allocation across all workspaces.
          </p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-6 mt-3 w-fit">
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="hosts">Hosts</TabsTrigger>
          <TabsTrigger value="users">Users</TabsTrigger>
          <TabsTrigger value="provisioning">Provisioning</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="hosts">
            <HostsTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="provisioning">
            <ProvisioningTab />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}

/** Compact token count: 1234567 → "1.2M", 3500 → "3.5K", 0 → "0". */
function fmtTokens(n?: number): string {
  const v = n ?? 0;
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1)}M`;
  if (v >= 1_000) return `${(v / 1_000).toFixed(1)}K`;
  return String(v);
}

/** "Local", "Hosted", etc. from an agent's runtime. */
function runtimeLabel(runtime?: string): string {
  if (runtime === "org_host") return "Hosted";
  if (runtime === "local") return "Local";
  return runtime ?? "—";
}

/** Estimated USD cost: "$12.40", "$0.03", or "—" when unpriced/zero. */
function fmtUsd(n?: number | null): string {
  if (n == null) return "—";
  if (n === 0) return "$0";
  if (n < 0.01) return "<$0.01";
  return `$${n.toFixed(2)}`;
}

/** Tiny inline sparkline of a daily-token series. */
function Sparkline({ values, className }: { values?: number[]; className?: string }) {
  if (!values || values.length < 2 || values.every((v) => v === 0)) {
    return <span className="text-xs text-muted-foreground">—</span>;
  }
  const w = 64;
  const h = 18;
  const max = Math.max(...values, 1);
  const step = w / (values.length - 1);
  const points = values
    .map((v, i) => `${(i * step).toFixed(1)},${(h - (v / max) * h).toFixed(1)}`)
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className={cn("overflow-visible", className)}
      preserveAspectRatio="none"
      aria-hidden
    >
      <polyline
        points={points}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.25}
        className="text-primary"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

function ErrorBox({ message }: { message: string }) {
  return (
    <div className="mb-4 flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
      <p>{message}</p>
    </div>
  );
}

function OverviewTab() {
  const [stats, setStats] = useState<api.PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminStats().then(setStats).catch((e) =>
      setError(e instanceof Error ? e.message : "Failed to load stats")
    );
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!stats)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );

  const onlineHosts = stats.hostsByStatus?.online ?? 0;
  const totalHosts = Object.values(stats.hostsByStatus ?? {}).reduce((a, b) => a + b, 0);

  const cards = [
    { label: "Users", value: stats.users },
    { label: "Paying", value: stats.payingUsers },
    { label: "Agents", value: stats.agents },
    { label: "Workspaces", value: stats.organizations },
    { label: "Hosts online", value: `${onlineHosts}/${totalHosts}` },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
      {cards.map((c) => (
        <div key={c.label} className="rounded-lg border border-border p-4">
          <div className="text-2xl font-semibold tabular-nums">{c.value}</div>
          <div className="mt-1 text-xs text-muted-foreground">{c.label}</div>
        </div>
      ))}
    </div>
  );
}

function HostsTab() {
  const [hosts, setHosts] = useState<Array<api.OrganizationHost & { orgName?: string | null }>>(
    []
  );
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<
    (api.OrganizationHost & { orgName?: string | null }) | null
  >(null);

  const refresh = useCallback(async () => {
    try {
      setHosts(await api.listAdminHosts());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load hosts");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  if (error) return <ErrorBox message={error} />;
  if (loading)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  if (hosts.length === 0)
    return <p className="text-sm text-muted-foreground">No hosts across the platform yet.</p>;

  return (
    <>
      <ul className="space-y-2">
        {hosts.map((h) => (
          <AdminHostRow key={h.id} host={h} onChanged={refresh} onView={() => setViewing(h)} />
        ))}
      </ul>
      <HostDetailDialog
        host={viewing}
        allHosts={hosts}
        onOpenChange={(o) => !o && setViewing(null)}
        onChanged={refresh}
      />
    </>
  );
}

function AdminHostRow({
  host,
  onChanged,
  onView,
}: {
  host: api.OrganizationHost & { orgName?: string | null };
  onChanged: () => Promise<void> | void;
  onView: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(host.name);
  const [busy, setBusy] = useState(false);
  const [shared, setShared] = useState(!!host.shared);

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === host.name) {
      setEditing(false);
      setName(host.name);
      return;
    }
    setBusy(true);
    try {
      await api.updateAdminHost(host.id, { name: trimmed });
      setEditing(false);
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not rename host");
      setName(host.name);
    } finally {
      setBusy(false);
    }
  };

  const toggleShared = async (next: boolean) => {
    setShared(next); // optimistic
    try {
      await api.setHostShared(host.id, next);
    } catch (e) {
      setShared(!next);
      alert(e instanceof Error ? e.message : "Could not update host");
    }
  };

  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-border px-4 py-3">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {editing ? (
            <>
              <Input
                value={name}
                autoFocus
                disabled={busy}
                onChange={(e) => setName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void save();
                  if (e.key === "Escape") {
                    setName(host.name);
                    setEditing(false);
                  }
                }}
                className="h-7 max-w-[16rem]"
              />
              <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => void save()} disabled={busy}>
                <Check className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0"
                onClick={() => {
                  setName(host.name);
                  setEditing(false);
                }}
                disabled={busy}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            </>
          ) : (
            <>
              <span className="truncate font-medium">{host.name}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 w-6 p-0 text-muted-foreground"
                onClick={() => setEditing(true)}
                title="Rename host"
              >
                <Pencil className="h-3 w-3" />
              </Button>
              <Badge
                variant="outline"
                className={cn(
                  host.status === "online" && "border-success/30 bg-success/10 text-success",
                  host.status === "offline" && "border-muted text-muted-foreground"
                )}
              >
                {host.status}
              </Badge>
              {shared && (
                <Badge variant="outline" className="border-primary/30 text-primary">
                  shared
                </Badge>
              )}
            </>
          )}
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {host.orgName ?? "—"} · {host.agentCount ?? 0} agents
          {host.sshHost ? ` · ${host.sshHost}` : ""}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-3">
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          Shared
          <Switch checked={shared} onCheckedChange={(v) => void toggleShared(v)} />
        </label>
        <Button variant="outline" size="sm" onClick={onView} title="View residents">
          View
          <ChevronRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    </li>
  );
}

/** Drill into one host: users + agents on it, token consumption, rebalance. */
function HostDetailDialog({
  host,
  allHosts,
  onOpenChange,
  onChanged,
}: {
  host: (api.OrganizationHost & { orgName?: string | null }) | null;
  allHosts: Array<api.OrganizationHost & { orgName?: string | null }>;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [detail, setDetail] = useState<api.AdminHostDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);

  const load = useCallback(async (hostId: string) => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getAdminHost(hostId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load host");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (host) void load(host.id);
    else {
      setDetail(null);
      setSelected(new Set());
    }
  }, [host, load]);

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const bulkMove = async (target: string) => {
    if (!target || selected.size === 0) return;
    setBulkBusy(true);
    try {
      await api.bulkReassignAgents([...selected], target === "local" ? null : target);
      setSelected(new Set());
      if (host) await load(host.id);
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk move failed");
    } finally {
      setBulkBusy(false);
    }
  };

  // Other hosts an agent can move to (any host except this one).
  const moveTargets = useMemo(
    () => allHosts.filter((h) => h.id !== host?.id),
    [allHosts, host]
  );

  const move = async (agentId: string, target: string) => {
    if (!target) return;
    setBusyAgent(agentId);
    try {
      await api.reassignAgent(agentId, target === "local" ? null : target);
      if (host) await load(host.id);
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Move failed");
    } finally {
      setBusyAgent(null);
    }
  };

  const reset = async (agentId: string) => {
    setBusyAgent(agentId);
    try {
      const r = await api.resetAgent(agentId);
      if (!r.reset) alert(`No remote reset: ${r.reason ?? "unavailable"}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusyAgent(null);
    }
  };

  return (
    <Dialog open={!!host} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-5xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Server className="h-4 w-4" /> {host?.name}
          </DialogTitle>
          <DialogDescription>
            {host?.orgName ?? "—"} · {host?.status} · who's running here and what they've used (last 30 days).
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorBox message={error} />}
        {loading || !detail ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="max-h-[60vh] space-y-5 overflow-y-auto py-1">
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <UsersIcon className="h-3.5 w-3.5" /> Users ({detail.users.length})
              </div>
              {detail.users.length === 0 ? (
                <p className="text-sm text-muted-foreground">No users on this host.</p>
              ) : (
                <ul className="space-y-1">
                  {detail.users.map((u) => (
                    <li
                      key={u.id}
                      className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5 text-sm"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {u.displayName ?? u.email ?? u.id.slice(0, 8)}
                        <span className="ml-2 text-xs text-muted-foreground">
                          {u.agentCount} agent{u.agentCount === 1 ? "" : "s"}
                        </span>
                      </span>
                      <Sparkline values={u.series} />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {fmtTokens(u.tokens?.totalTokens)} tok · {fmtUsd(u.tokens?.costUsd)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <div className="text-xs font-medium text-muted-foreground">
                  Agents ({detail.agents.length})
                </div>
                {selected.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                    <select
                      value=""
                      disabled={bulkBusy}
                      onChange={(e) => void bulkMove(e.target.value)}
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">Move selected to…</option>
                      <option value="local">Local (off host)</option>
                      {moveTargets.map((h) => (
                        <option key={h.id} value={h.id}>
                          {h.name}
                        </option>
                      ))}
                    </select>
                  </div>
                )}
              </div>
              {detail.agents.length === 0 ? (
                <p className="text-sm text-muted-foreground">No agents pinned to this host.</p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="w-8 px-3 py-2" />
                        <th className="px-3 py-2 font-medium">Agent</th>
                        <th className="px-3 py-2 font-medium">Owner</th>
                        <th className="px-3 py-2 font-medium">Model</th>
                        <th className="px-3 py-2 font-medium">Tokens (30d)</th>
                        <th className="px-3 py-2 font-medium">Cost</th>
                        <th className="px-3 py-2 font-medium">Trend</th>
                        <th className="px-3 py-2 font-medium">Move to</th>
                        <th className="px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {detail.agents.map((a) => (
                        <tr key={a.id} className="border-t border-border">
                          <td className="px-3 py-2">
                            <input
                              type="checkbox"
                              checked={selected.has(a.id)}
                              onChange={() => toggleSelect(a.id)}
                              className="h-3.5 w-3.5 accent-primary"
                            />
                          </td>
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-1.5 font-medium">
                              <span
                                className={cn(
                                  "h-1.5 w-1.5 rounded-full",
                                  a.running ? "bg-success" : "bg-muted-foreground/40"
                                )}
                                title={a.running ? "running" : "not running"}
                              />
                              {a.displayName}
                            </div>
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">
                            {a.ownerName ?? a.ownerEmail ?? "—"}
                          </td>
                          <td className="px-3 py-2 text-xs text-muted-foreground">{a.model ?? "—"}</td>
                          <td className="px-3 py-2 tabular-nums">{fmtTokens(a.tokens?.totalTokens)}</td>
                          <td className="px-3 py-2 tabular-nums text-muted-foreground">
                            {fmtUsd(a.tokens?.costUsd)}
                          </td>
                          <td className="px-3 py-2">
                            <Sparkline values={a.series} />
                          </td>
                          <td className="px-3 py-2">
                            <select
                              value=""
                              disabled={busyAgent === a.id}
                              onChange={(e) => void move(a.id, e.target.value)}
                              className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                            >
                              <option value="">Rebalance…</option>
                              <option value="local">Local (off host)</option>
                              {moveTargets.map((h) => (
                                <option key={h.id} value={h.id}>
                                  {h.name}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 px-2"
                              disabled={busyAgent === a.id}
                              onClick={() => void reset(a.id)}
                              title="Reset (stop + respawn)"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function UsersTab() {
  const [users, setUsers] = useState<api.AdminUser[]>([]);
  const [hosts, setHosts] = useState<api.OrganizationHost[]>([]);
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [allocating, setAllocating] = useState<api.AdminUser | null>(null);
  const [planning, setPlanning] = useState<api.AdminUser | null>(null);
  const [viewing, setViewing] = useState<api.AdminUser | null>(null);

  const refresh = useCallback(async (q?: string) => {
    setLoading(true);
    try {
      const [u, h] = await Promise.all([api.listAdminUsers(q), api.listAdminHosts()]);
      setUsers(u);
      setHosts(h);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load users");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const hostName = (id: string) => hosts.find((h) => h.id === id)?.name ?? id.slice(0, 8);

  return (
    <div>
      {error && <ErrorBox message={error} />}
      <div className="mb-3 flex items-center gap-2">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && void refresh(search)}
            placeholder="Search name or email…"
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh(search)}>
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">User</th>
                <th className="px-3 py-2 font-medium">Workspace</th>
                <th className="px-3 py-2 font-medium">Agents</th>
                <th className="px-3 py-2 font-medium">Tokens (30d)</th>
                <th className="px-3 py-2 font-medium">Plan</th>
                <th className="px-3 py-2 font-medium">Allocated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr key={u.id} className="border-t border-border">
                  <td className="px-3 py-2">
                    <div className="font-medium">{u.displayName}</div>
                    <div className="text-xs text-muted-foreground">{u.email}</div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{u.orgName ?? "—"}</td>
                  <td className="px-3 py-2 tabular-nums">{u.agentCount}</td>
                  <td className="px-3 py-2 tabular-nums text-muted-foreground">
                    {fmtTokens(u.tokens?.totalTokens)}
                  </td>
                  <td className="px-3 py-2">
                    {u.subscription?.status ? (
                      <Badge variant="outline" className="border-success/30 text-success">
                        {u.subscription.plan ?? u.subscription.status}
                      </Badge>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-xs text-muted-foreground">
                    {u.allocatedHostIds.length
                      ? u.allocatedHostIds.map(hostName).join(", ")
                      : "—"}
                  </td>
                  <td className="px-3 py-2 text-right">
                    <Button variant="ghost" size="sm" onClick={() => setViewing(u)} disabled={u.agentCount === 0}>
                      Agents
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPlanning(u)}>
                      Plan
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAllocating(u)}>
                      Allocate
                    </Button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                    No users.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}

      <AllocateDialog
        user={allocating}
        hosts={hosts}
        onOpenChange={(o) => !o && setAllocating(null)}
        onDone={() => {
          setAllocating(null);
          void refresh(search);
        }}
      />
      <SetPlanDialog
        user={planning}
        onOpenChange={(o) => !o && setPlanning(null)}
        onDone={() => {
          setPlanning(null);
          void refresh(search);
        }}
      />
      <UserDetailDialog
        user={viewing}
        hosts={hosts}
        onOpenChange={(o) => !o && setViewing(null)}
        onChanged={() => void refresh(search)}
      />
    </div>
  );
}

/** Drill into a user's agents: adjust model, connection (local/hosted), reset. */
function UserDetailDialog({
  user,
  hosts,
  onOpenChange,
  onChanged,
}: {
  user: api.AdminUser | null;
  hosts: Array<api.OrganizationHost & { orgName?: string | null }>;
  onOpenChange: (open: boolean) => void;
  onChanged: () => Promise<void> | void;
}) {
  const [detail, setDetail] = useState<api.AdminUserDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [managing, setManaging] = useState<api.AdminAgent | null>(null);

  const load = useCallback(async (userId: string) => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getAdminUser(userId));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load agents");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) void load(user.id);
    else setDetail(null);
  }, [user, load]);

  const hostName = (id?: string | null) =>
    id ? hosts.find((h) => h.id === id)?.name ?? id.slice(0, 8) : null;

  const afterChange = async () => {
    if (user) await load(user.id);
    await onChanged();
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Agents — {user?.displayName}</DialogTitle>
          <DialogDescription>
            Adjust each agent's model and connection, or reset a stuck one. Token totals are last 30 days.
          </DialogDescription>
        </DialogHeader>

        {error && <ErrorBox message={error} />}
        {loading || !detail ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto py-1">
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Agent</th>
                    <th className="px-3 py-2 font-medium">Model</th>
                    <th className="px-3 py-2 font-medium">Connection</th>
                    <th className="px-3 py-2 font-medium">Tokens (30d)</th>
                    <th className="px-3 py-2 font-medium">Cost</th>
                    <th className="px-3 py-2 font-medium">Trend</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {detail.agents.map((a) => (
                    <tr key={a.id} className="border-t border-border">
                      <td className="px-3 py-2 font-medium">{a.displayName}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">{a.model ?? "—"}</td>
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {runtimeLabel(a.runtime)}
                        {a.runtime === "org_host" && a.assignedHostId
                          ? ` · ${hostName(a.assignedHostId)}`
                          : ""}
                      </td>
                      <td className="px-3 py-2 tabular-nums">{fmtTokens(a.tokens?.totalTokens)}</td>
                      <td className="px-3 py-2 tabular-nums text-muted-foreground">
                        {fmtUsd(a.tokens?.costUsd)}
                      </td>
                      <td className="px-3 py-2">
                        <Sparkline values={a.series} />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button variant="ghost" size="sm" onClick={() => setManaging(a)}>
                          Manage
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {detail.agents.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                        No agents.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <AgentManageDialog
          agent={managing}
          hosts={hosts}
          onOpenChange={(o) => !o && setManaging(null)}
          onDone={() => {
            setManaging(null);
            void afterChange();
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

/** Adjust one agent: model (from the backend catalog), connection, reset. */
function AgentManageDialog({
  agent,
  hosts,
  onOpenChange,
  onDone,
}: {
  agent: api.AdminAgent | null;
  hosts: Array<api.OrganizationHost & { orgName?: string | null }>;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const fetchGlobalCatalog = useModelCatalog((s) => s.fetchGlobalCatalog);
  const [providers, setProviders] = useState<CatalogProvider[]>([]);

  const [model, setModel] = useState("");
  const [backend, setBackend] = useState(""); // "" = keep current
  // Connection: "local" or a host id.
  const [connection, setConnection] = useState("local");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mcBackend = (agent?.modelConfig?.backend as string) || "";
  const mcModel = (agent?.modelConfig?.model as string) || agent?.model || "";

  useEffect(() => {
    if (!agent) return;
    setModel(mcModel);
    setBackend("");
    setConnection(
      agent.runtime === "org_host" && agent.assignedHostId ? agent.assignedHostId : "local"
    );
    setError(null);
    // Admin manages agents across orgs — fetch the unfiltered global catalog so
    // every model the backend accepts is selectable (the single source of truth).
    void fetchGlobalCatalog().then(setProviders).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agent, fetchGlobalCatalog]);

  // Which provider's models to list: the explicit pick, else the agent's
  // current backend. Models come straight from the backend catalog.
  const effectiveBackend = backend || mcBackend;
  const catalogModels = useMemo(
    () => providers.find((p) => p.id === effectiveBackend)?.models ?? [],
    [providers, effectiveBackend]
  );
  // Keep the agent's current model selectable even if it's not in the list.
  const modelOptions = useMemo(() => {
    const opts = catalogModels.map((m) => ({ id: m.id, label: m.label }));
    if (model && !opts.some((o) => o.id === model)) {
      return [{ id: model, label: `${model} (current)` }, ...opts];
    }
    return opts;
  }, [catalogModels, model]);

  // Hosted targets: agent's own-org hosts + any shared host (matches the
  // backend's host-eligibility — admin reassign carries the shared bypass).
  const hostOptions = useMemo(
    () =>
      hosts.filter(
        (h) => h.status === "online" || h.status === "offline" || h.id === agent?.assignedHostId
      ),
    [hosts, agent]
  );

  const save = async () => {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      // Model config: only PATCH when the model or backend actually changed.
      const cfg: Record<string, unknown> = {};
      if (model && model !== mcModel) cfg.model = model;
      if (backend && backend !== mcBackend) cfg.backend = backend;
      if (Object.keys(cfg).length) await api.updateAdminAgent(agent.id, cfg);

      // Connection: reassign when it changed.
      const currentConn =
        agent.runtime === "org_host" && agent.assignedHostId ? agent.assignedHostId : "local";
      if (connection !== currentConn) {
        await api.reassignAgent(agent.id, connection === "local" ? null : connection);
      }

      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not save");
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    if (!agent) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api.resetAgent(agent.id);
      if (!r.reset) {
        setError(
          r.reason === "local_runtime"
            ? "This agent runs on the owner's own device — reset it from there."
            : `Reset unavailable: ${r.reason ?? "unknown"}`
        );
      } else {
        onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  };

  const byModel = agent?.tokens?.byModel ?? [];

  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Manage — {agent?.displayName}</DialogTitle>
          <DialogDescription>
            Change the model or where this agent runs, or reset it if it's stuck. Models come from
            the platform catalog.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="agent-backend">Backend</Label>
            <select
              id="agent-backend"
              value={backend}
              onChange={(e) => {
                const b = e.target.value;
                setBackend(b);
                // Default to the new backend's first model if the current one
                // isn't offered there.
                const models = providers.find((p) => p.id === b)?.models ?? [];
                if (b && !models.some((m) => m.id === model)) {
                  setModel(models[0]?.id ?? "");
                }
              }}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">
                {mcBackend ? `Keep current (${mcBackend})` : "Keep current"}
              </option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-model">Model</Label>
            <select
              id="agent-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={modelOptions.length === 0}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              {modelOptions.length === 0 && <option value="">Pick a backend first…</option>}
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-conn">
              <span className="inline-flex items-center gap-1.5">
                <ArrowRightLeft className="h-3.5 w-3.5" /> Connection
              </span>
            </Label>
            <select
              id="agent-conn"
              value={connection}
              onChange={(e) => setConnection(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="local">Local (owner's device)</option>
              {hostOptions.map((h) => (
                <option key={h.id} value={h.id}>
                  Hosted · {h.name}
                  {h.shared ? " (shared)" : ""}
                </option>
              ))}
            </select>
          </div>

          {byModel.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">Usage by model (30d)</Label>
              <ul className="rounded-md border border-border text-xs">
                {byModel.map((m) => (
                  <li
                    key={m.model}
                    className="flex items-center justify-between border-b border-border px-3 py-1.5 last:border-b-0"
                  >
                    <span className="truncate">{m.model}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">
                      {fmtTokens(m.totalTokens)} · {fmtUsd(m.costUsd)}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="justify-between">
            <Button variant="ghost" onClick={() => void reset()} disabled={busy}>
              <RotateCcw className="h-3.5 w-3.5" />
              Reset
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SetPlanDialog({
  user,
  onOpenChange,
  onDone,
}: {
  user: api.AdminUser | null;
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [plan, setPlan] = useState("comp");
  const [status, setStatus] = useState("active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Seed from the user's current plan when the dialog opens.
  useEffect(() => {
    if (user) {
      setPlan(user.subscription?.plan ?? "comp");
      setStatus(user.subscription?.status ?? "active");
      setError(null);
    }
  }, [user]);

  const save = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.setUserPlan(user.id, plan.trim() || "comp", status);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not set plan");
    } finally {
      setBusy(false);
    }
  };

  const clear = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.clearUserPlan(user.id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not clear plan");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Plan — {user?.displayName}</DialogTitle>
          <DialogDescription>
            Manually set a plan (no Stripe needed). When Stripe billing is live,
            its webhook updates this same record.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="plan-name">Plan</Label>
            <Input
              id="plan-name"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="comp / pro / founder…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="plan-status">Status</Label>
            <select
              id="plan-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="active">active (paying)</option>
              <option value="trialing">trialing (paying)</option>
              <option value="past_due">past_due</option>
              <option value="canceled">canceled</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="justify-between">
            <Button variant="ghost" onClick={() => void clear()} disabled={busy}>
              Clear plan
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function AllocateDialog({
  user,
  hosts,
  onOpenChange,
  onDone,
}: {
  user: api.AdminUser | null;
  hosts: api.OrganizationHost[];
  onOpenChange: (open: boolean) => void;
  onDone: () => void;
}) {
  const [hostId, setHostId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Only shared, reachable hosts can take cross-org tenants.
  const eligible = useMemo(
    () => hosts.filter((h) => h.shared && (h.status === "online" || h.status === "offline")),
    [hosts]
  );

  const allocate = async () => {
    if (!user || !hostId) return;
    setBusy(true);
    setError(null);
    try {
      await api.allocateUserToHost(user.id, hostId);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Allocation failed");
    } finally {
      setBusy(false);
    }
  };

  const deallocate = async () => {
    if (!user) return;
    setBusy(true);
    setError(null);
    try {
      await api.deallocateUser(user.id);
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Deallocation failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Allocate {user?.displayName}</DialogTitle>
          <DialogDescription>
            Pin this user's agents to a shared host. They stay in their own
            workspace; agents come online on the host.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="alloc-host">Shared host</Label>
            <select
              id="alloc-host"
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">Select a shared host…</option>
              {eligible.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({h.status})
                </option>
              ))}
            </select>
            {eligible.length === 0 && (
              <p className="text-xs text-muted-foreground">
                No shared hosts yet — toggle a host to “Shared” in the Hosts tab.
              </p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="justify-between">
            <Button variant="ghost" onClick={() => void deallocate()} disabled={busy}>
              Deallocate all
            </Button>
            <Button onClick={() => void allocate()} disabled={busy || !hostId}>
              {busy ? "Working…" : "Allocate"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProvisioningTab() {
  const [catalog, setCatalog] = useState<{
    dataCenters: api.ProvisioningOption[];
    templates: api.ProvisioningOption[];
    plans: api.ProvisioningOption[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [dataCenterId, setDataCenterId] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [itemId, setItemId] = useState("");

  useEffect(() => {
    api
      .getAdminProvisioningCatalog()
      .then(setCatalog)
      .catch((e) => setError(e instanceof Error ? e.message : "Could not load catalog"))
      .finally(() => setLoading(false));
  }, []);

  const provision = async () => {
    if (!name.trim() || !dataCenterId || !templateId || !itemId) {
      setError("Pick a name, data center, template, and plan.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.adminProvision({ name: name.trim(), itemId, dataCenterId, templateId });
      setDone(`Provisioning ${res.host.name} — it will appear in Hosts when online.`);
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Provisioning failed");
    } finally {
      setSubmitting(false);
    }
  };

  if (loading)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  if (error && !catalog) return <ErrorBox message={error} />;

  const opt = (o: api.ProvisioningOption) => String(o.name ?? o.id);

  return (
    <div className="max-w-md space-y-3">
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Cloud className="h-4 w-4" /> Spin up a new shared host (Hostinger).
      </div>
      {done && (
        <div className="rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
          {done}
        </div>
      )}
      <div className="space-y-1">
        <Label htmlFor="p-name">Host name</Label>
        <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="agentgram-2" />
      </div>
      <Sel id="p-dc" label="Data center" value={dataCenterId} set={setDataCenterId} opts={catalog?.dataCenters ?? []} fmt={opt} />
      <Sel id="p-tpl" label="OS template" value={templateId} set={setTemplateId} opts={catalog?.templates ?? []} fmt={opt} />
      <Sel id="p-plan" label="Plan" value={itemId} set={setItemId} opts={catalog?.plans ?? []} fmt={opt} />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button onClick={() => void provision()} disabled={submitting}>
        {submitting ? "Provisioning…" : "Provision"}
      </Button>
    </div>
  );
}

function Sel({
  id,
  label,
  value,
  set,
  opts,
  fmt,
}: {
  id: string;
  label: string;
  value: string;
  set: (v: string) => void;
  opts: api.ProvisioningOption[];
  fmt: (o: api.ProvisioningOption) => string;
}) {
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">Select…</option>
        {opts.map((o) => (
          <option key={String(o.id)} value={String(o.id)}>
            {fmt(o)}
          </option>
        ))}
      </select>
    </div>
  );
}
