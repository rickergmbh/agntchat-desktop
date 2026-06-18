import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  AlertCircle,
  ArrowRightLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Cloud,
  DownloadCloud,
  KeyRound,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Server as ServerIcon,
  ShieldCheck,
  ShieldHalf,
  Trash2,
  Users as UsersIcon,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import { cn } from "../lib/utils";
import { useAuthStore } from "../stores/authStore";
import { useModelCatalog, type CatalogProvider } from "../stores/modelCatalogStore";
import { useWorkspaces } from "../stores/workspaceStore";
import {
  ConnectAnthropicDialog,
  ConnectHostDialog,
  HostOpLog,
  relativeAge,
} from "./FleetView";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
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
        </TabsList>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          <TabsContent value="hosts">
            {/* Hosts + provisioning live together: your managed hosts up top,
                then the full Hostinger VM inventory and the "provision a new
                host" form below. */}
            <HostsTab />
            <div className="my-6 border-t border-border" />
            <ProvisioningTab />
          </TabsContent>
          <TabsContent value="users">
            <UsersTab />
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

/** Two-letter avatar fallback from a name (or email when unnamed). */
function initials(name?: string | null, email?: string | null): string {
  const src = (name || email || "?").trim();
  const parts = src.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return src.slice(0, 2).toUpperCase();
}

/** Compact "how long a member": "today", "12d", "5mo", "2y 3mo". */
function memberFor(iso?: string | null): string {
  if (!iso) return "—";
  const start = new Date(iso).getTime();
  if (Number.isNaN(start)) return "—";
  const days = Math.floor((Date.now() - start) / 86_400_000);
  if (days <= 0) return "today";
  if (days < 31) return `${days}d`;
  const months = Math.floor(days / 30.44);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem ? `${years}y ${rem}mo` : `${years}y`;
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
  const hosted = stats.agentsByRuntime?.org_host ?? 0;
  const local = stats.agentsByRuntime?.local ?? 0;
  // Tolerate a partial payload (e.g. a dev app pointed at a backend that
  // predates these fields) so the tab degrades instead of crashing.
  const rev = stats.revenue ?? { currency: null, mrrCents: 0, unpricedCount: 0, tiers: [] };
  const workspaces = stats.workspaces ?? [];
  const fmtUsdCents = (cents: number, currency?: string | null) =>
    new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: (currency ?? "usd").toUpperCase(),
      maximumFractionDigits: 0,
    }).format(cents / 100);

  const cards = [
    { label: "Users", value: stats.users, sub: `${stats.usersOnline ?? 0} online · ${stats.payingUsers} paying` },
    { label: "Agents", value: stats.agents, sub: `${stats.agentsOnline ?? 0} online · ${hosted} hosted · ${local} local` },
    { label: "Workspaces", value: stats.organizations, sub: `${workspaces.length} total` },
    { label: "Hosts online", value: `${onlineHosts}/${totalHosts}`, sub: "by heartbeat" },
    { label: "MRR", value: fmtUsdCents(rev.mrrCents, rev.currency), sub: `${rev.tiers.reduce((n, t) => n + t.count, 0)} subs` },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => (
          <div key={c.label} className="rounded-lg border border-border p-4">
            <div className="text-2xl font-semibold tabular-nums">{c.value}</div>
            <div className="mt-1 text-xs font-medium text-muted-foreground">{c.label}</div>
            {c.sub && <div className="mt-0.5 text-[11px] text-muted-foreground/70">{c.sub}</div>}
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        {/* Revenue per tier */}
        <section className="rounded-lg border border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
            <span>Revenue by tier</span>
            {rev.unpricedCount > 0 && (
              <span className="text-amber-500" title="Run Release.backfill_subscription_amounts() to populate amounts from Stripe">
                {rev.unpricedCount} unpriced
              </span>
            )}
          </div>
          {rev.tiers.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No active subscriptions.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-1.5 font-medium">Tier</th>
                  <th className="px-4 py-1.5 text-right font-medium">Subs</th>
                  <th className="px-4 py-1.5 text-right font-medium">MRR</th>
                </tr>
              </thead>
              <tbody>
                {rev.tiers.map((t) => (
                  <tr key={t.plan ?? t.tier} className="border-t border-border">
                    <td className="px-4 py-1.5 truncate" title={t.plan ?? undefined}>{t.tier ?? t.plan ?? "—"}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{t.count}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{fmtUsdCents(t.mrrCents, rev.currency)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-medium">
                  <td className="px-4 py-1.5">Total</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{rev.tiers.reduce((n, t) => n + t.count, 0)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmtUsdCents(rev.mrrCents, rev.currency)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {/* Agents per workspace */}
        <section className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
            Agents by workspace
          </div>
          {workspaces.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">No workspaces.</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {workspaces.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-3 border-t border-border px-4 py-1.5 text-sm first:border-t-0"
                >
                  <span className="min-w-0 flex-1 truncate">{w.name ?? w.id.slice(0, 8)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {w.agentCount} agent{w.agentCount === 1 ? "" : "s"}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function HostsTab() {
  // Operator's own org — backs the org-scoped management endpoints (add host,
  // Anthropic seat, provider VM picker). Cross-org hosts are still listed via
  // the admin endpoint; each row's SSH ops key on the host's own org id. Same
  // fallback as the old Fleet view so personal-mode operators still get the
  // Add host / Connect Anthropic actions.
  const participantOrgId = useAuthStore((s) => s.participant?.organizationId);
  const workspaces = useWorkspaces();
  const operatorOrgId =
    participantOrgId ?? workspaces.find((w) => w.isPersonal)?.id ?? null;

  const [hosts, setHosts] = useState<Array<api.OrganizationHost & { orgName?: string | null }>>(
    []
  );
  const [vms, setVms] = useState<api.ProviderVm[]>([]);
  const [vmsError, setVmsError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [connectOpen, setConnectOpen] = useState(false);
  // Which VM (if any) the "Add host" dialog should preselect.
  const [connectVmId, setConnectVmId] = useState<string | undefined>(undefined);
  const [anthropicOpen, setAnthropicOpen] = useState(false);

  // Only show the full-page "Loading…" gate on the very first load. Later
  // refreshes (triggered by host/agent actions) must NOT swap the list out for
  // a spinner — that unmounts any expanded host row and reads as the tab
  // "refreshing" out from under the user mid-action.
  const loadedOnce = useRef(false);

  const refresh = useCallback(async () => {
    if (!loadedOnce.current) setLoading(true);
    const [hostsRes, vmsRes] = await Promise.allSettled([
      api.listAdminHosts(),
      api.adminListProviderVms(),
    ]);

    if (hostsRes.status === "fulfilled") {
      setHosts(hostsRes.value);
      setError(null);
    } else {
      setError(
        hostsRes.reason instanceof Error ? hostsRes.reason.message : "Failed to load hosts"
      );
    }

    if (vmsRes.status === "fulfilled") {
      setVms(vmsRes.value);
      setVmsError(null);
    } else {
      setVms([]);
      setVmsError(
        vmsRes.reason instanceof Error
          ? vmsRes.reason.message
          : "Failed to load Hostinger VMs"
      );
    }

    loadedOnce.current = true;
    setLoading(false);
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Resolve which host (if any) backs a given VM. Prefer the explicit
  // provider_vm_id link; fall back to matching the host's SSH IP to the VM's
  // IPv4 — that covers hosts added manually by IP (no VM link stored), which
  // would otherwise look orphaned even though they run on a known VM.
  const hostForVm = useMemo(() => {
    const byVmId = new Map<string, (typeof hosts)[number]>();
    const byIp = new Map<string, (typeof hosts)[number]>();
    for (const h of hosts) {
      if (h.providerVmId) byVmId.set(h.providerVmId, h);
      const ip = h.sshHost?.trim();
      if (ip && !byIp.has(ip)) byIp.set(ip, h);
    }
    return (vm: api.ProviderVm) =>
      byVmId.get(vm.id) ?? (vm.ipv4 ? byIp.get(vm.ipv4.trim()) : undefined);
  }, [hosts]);

  // Hosts not backed by any VM in the inventory (manually-added boxes, or a VM
  // we couldn't list) — shown in their own group so they aren't lost.
  const otherHosts = useMemo(() => {
    const matchedHostIds = new Set<string>();
    for (const vm of vms) {
      const h = hostForVm(vm);
      if (h) matchedHostIds.add(h.id);
    }
    return hosts.filter((h) => !matchedHostIds.has(h.id));
  }, [hosts, vms, hostForVm]);

  const openAddHost = (vmId?: string) => {
    setConnectVmId(vmId);
    setConnectOpen(true);
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <ServerIcon className="h-4 w-4" /> Hosts &amp; VMs
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </Button>
          {operatorOrgId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAnthropicOpen(true)}
              title="Set a shared Claude seat for the whole org — applied to every host. Use a host's “Anthropic” button to re-push it to just that host."
            >
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              Connect Anthropic
            </Button>
          )}
          {operatorOrgId && (
            <Button size="sm" onClick={() => openAddHost()}>
              <Plus className="h-3.5 w-3.5" />
              Add host
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {/* One entry per Hostinger VM. Managed VMs expand to their full host
              controls; unmanaged VMs offer to add a host on them. */}
          {vms.length > 0 && (
            <ul className="space-y-2">
              {vms.map((vm) => {
                const host = hostForVm(vm);
                return host ? (
                  <MergedHostRow
                    key={vm.id}
                    host={host}
                    allHosts={hosts}
                    onChanged={refresh}
                    vm={vm}
                  />
                ) : (
                  <UnmanagedVmRow
                    key={vm.id}
                    vm={vm}
                    canAdd={!!operatorOrgId}
                    onAdd={() => openAddHost(vm.id)}
                  />
                );
              })}
            </ul>
          )}

          {vmsError && (
            <p className="text-xs text-muted-foreground">
              Couldn’t load the Hostinger VM inventory: {vmsError}
            </p>
          )}

          {/* Hosts with no Hostinger VM behind them (manually-added boxes). */}
          {otherHosts.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Other hosts (no Hostinger VM)
              </div>
              <ul className="space-y-2">
                {otherHosts.map((h) => (
                  <MergedHostRow key={h.id} host={h} allHosts={hosts} onChanged={refresh} />
                ))}
              </ul>
            </div>
          )}

          {vms.length === 0 && otherHosts.length === 0 && (
            <p className="text-sm text-muted-foreground">No hosts or VMs yet.</p>
          )}
        </>
      )}

      {operatorOrgId && (
        <>
          <ConnectHostDialog
            orgId={operatorOrgId}
            open={connectOpen}
            onOpenChange={setConnectOpen}
            onChanged={() => void refresh()}
            initialVmId={connectVmId}
          />
          <ConnectAnthropicDialog
            orgId={operatorOrgId}
            open={anthropicOpen}
            onOpenChange={setAnthropicOpen}
            onConnected={() => void refresh()}
          />
        </>
      )}
    </div>
  );
}

/**
 * A Hostinger VM that isn't (yet) registered as an AgentGram host. Compact row
 * showing the VM facts with an "Add host" action that opens the connect dialog
 * preselected on this VM.
 */
function UnmanagedVmRow({
  vm,
  canAdd,
  onAdd,
}: {
  vm: api.ProviderVm;
  canAdd: boolean;
  onAdd: () => void;
}) {
  return (
    <li className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{vm.hostname || vm.id}</span>
          <Badge variant={vm.state === "running" ? "default" : "outline"} className="shrink-0">
            {vm.state || "unknown"}
          </Badge>
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            Not added
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {[vm.ipv4, vm.plan, vm.datacenter].filter(Boolean).join(" · ") || vm.id}
        </div>
      </div>
      {canAdd && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          Add host
        </Button>
      )}
    </li>
  );
}

/**
 * One host in the merged operator view: an enriched collapsed row (online /
 * total agents, user count, status) that expands inline to the residents
 * breakdown + SSH op log. Carries the host-lifecycle controls that used to
 * live in the separate Fleet tab. Rename + shared-toggle go through the admin
 * endpoints (cross-org); SSH ops + delete go through the org-scoped endpoints
 * keyed on the host's own organization id (works for operator-owned/shared
 * hosts — the common case).
 */
function MergedHostRow({
  host,
  allHosts,
  onChanged,
  vm,
}: {
  host: api.OrganizationHost & { orgName?: string | null };
  allHosts: Array<api.OrganizationHost & { orgName?: string | null }>;
  onChanged: () => Promise<void> | void;
  /** The Hostinger VM this host is provisioned on, when known — shows the
   *  live power-state next to the host's AgentGram status. */
  vm?: api.ProviderVm;
}) {
  const hostOrgId = host.organizationId;
  const [expanded, setExpanded] = useState(false);
  const [detail, setDetail] = useState<api.AdminHostDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [ops, setOps] = useState<api.HostOperation[]>([]);
  const [busy, setBusy] = useState<api.HostOpKind | "delete" | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(host.name);
  const [renameBusy, setRenameBusy] = useState(false);
  const [shared, setShared] = useState(!!host.shared);
  const [keyOpen, setKeyOpen] = useState(false);
  const [pubKey, setPubKey] = useState<string | null>(null);

  const bootstrapped = !!host.bootstrappedAt;
  const assigned = host.assignedAgentCount ?? host.agentCount ?? 0;
  const online = host.onlineAgentCount ?? host.runningAgentIds?.length ?? 0;
  const users = host.userCount ?? 0;

  const loadDetail = useCallback(async () => {
    try {
      const [d, o] = await Promise.all([
        api.getAdminHost(host.id),
        api.listHostOperations(hostOrgId, host.id),
      ]);
      setDetail(d);
      setOps(o);
      setDetailError(null);
    } catch (e) {
      setDetailError(e instanceof Error ? e.message : "Failed to load host detail");
    }
  }, [host.id, hostOrgId]);

  useEffect(() => {
    if (expanded) void loadDetail();
  }, [expanded, loadDetail]);

  const op = async (kind: api.HostOpKind, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(kind);
    try {
      await api.runHostOp(hostOrgId, host.id, kind);
      if (!expanded) setExpanded(true);
      else await loadDetail();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Operation failed");
    } finally {
      setBusy(null);
    }
  };

  const rename = async () => {
    const trimmed = name.trim();
    if (!trimmed || trimmed === host.name) {
      setEditing(false);
      setName(host.name);
      return;
    }
    setRenameBusy(true);
    try {
      await api.updateAdminHost(host.id, { name: trimmed });
      setEditing(false);
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not rename host");
      setName(host.name);
    } finally {
      setRenameBusy(false);
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

  const showKey = async () => {
    setKeyOpen(true);
    if (pubKey) return;
    try {
      setPubKey(await api.getHostPublicKey(hostOrgId, host.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : "Could not load public key");
    }
  };

  const handleDelete = async () => {
    if (!confirm(`Delete host "${host.name}"? Agents assigned here stop running on it.`)) return;
    setBusy("delete");
    try {
      await api.deleteOrganizationHost(hostOrgId, host.id);
      await onChanged();
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
          className="shrink-0 text-muted-foreground"
          aria-label={expanded ? "Collapse" : "Expand"}
        >
          {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {editing ? (
              <>
                <Input
                  value={name}
                  autoFocus
                  disabled={renameBusy}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void rename();
                    if (e.key === "Escape") {
                      setName(host.name);
                      setEditing(false);
                    }
                  }}
                  className="h-7 max-w-[16rem]"
                />
                <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => void rename()} disabled={renameBusy}>
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
                  onClick={() => setEditing(true)}
                  title="Rename host"
                >
                  <Pencil className="h-3 w-3" />
                </Button>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0",
                    host.status === "online" && "border-success/30 bg-success/10 text-success",
                    host.status === "offline" && "border-muted text-muted-foreground",
                    host.status === "disabled" && "border-destructive/30 bg-destructive/10 text-destructive"
                  )}
                >
                  {host.status}
                </Badge>
                {vm?.state && (
                  <Badge
                    variant="outline"
                    className="shrink-0 text-muted-foreground"
                    title="Hostinger power state"
                  >
                    VM: {vm.state}
                  </Badge>
                )}
                {shared && (
                  <Badge variant="outline" className="shrink-0 border-primary/30 text-primary">
                    shared
                  </Badge>
                )}
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
            <span className={cn("tabular-nums", online > 0 && "text-success")}>{online}</span>
            <span className="tabular-nums">/{assigned}</span> agent{assigned === 1 ? "" : "s"} online
            {` · ${users} user${users === 1 ? "" : "s"}`}
            {host.orgName ? ` · ${host.orgName}` : ""}
            {host.sshHost ? ` · ${host.sshUser || "root"}@${host.sshHost}` : " · no SSH target"}
            {host.provider ? ` · ${host.provider}${host.providerVmId ? ` vm ${host.providerVmId}` : ""}` : ""}
            {host.version ? ` · v${host.version}` : ""}
            {` · seen ${relativeAge(host.lastSeenAt)}`}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!bootstrapped && host.sshHost && (
            <Button variant="outline" size="sm" onClick={() => void showKey()} disabled={busy !== null} title="Show the SSH public key to authorize on the host">
              <KeyRound className="h-3.5 w-3.5" />
              Key
            </Button>
          )}
          {!bootstrapped && host.sshHost && (
            <Button variant="default" size="sm" onClick={() => void op("bootstrap")} disabled={busy !== null} title="Install the runtime over SSH">
              {busy === "bootstrap" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
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
            {busy === "update" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
            Update
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("restart", `Restart "${host.name}"?`)}
            disabled={busy !== null || !host.sshHost}
            title="Restart the host service"
          >
            {busy === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            Restart
          </Button>
          {bootstrapped && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void op("set_token")}
              disabled={busy !== null || !host.sshHost}
              title="Push the org's shared Claude seat token to this host (re-sync Anthropic)"
            >
              {busy === "set_token" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldCheck className="h-3.5 w-3.5" />
              )}
              Anthropic
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("probe")}
            disabled={busy !== null || !host.sshHost}
            title="Probe status over SSH"
          >
            {busy === "probe" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          </Button>
          <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground" title="Shared (multi-tenant) host">
            Shared
            <Switch checked={shared} onCheckedChange={(v) => void toggleShared(v)} />
          </label>
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
          <HostResidents
            host={host}
            detail={detail}
            error={detailError}
            allHosts={allHosts}
            reload={loadDetail}
            onChanged={onChanged}
          />
          <HostOpLog ops={ops} />
        </div>
      )}

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Authorize "{host.name}"</DialogTitle>
            <DialogDescription>
              AgentGram connects to the VM over SSH using its own key. Add this public key to{" "}
              {host.sshUser || "root"}@{host.sshHost}, then bootstrap.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {pubKey ? (
              <div className="space-y-1">
                <Label className="text-xs">Public key</Label>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs break-all">
                  <span className="flex-1 select-all">{pubKey}</span>
                </div>
              </div>
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

/** Inline residents panel for an expanded host: users + agents on it, token
 *  consumption, and rebalance/reset controls. `detail` is loaded by the row. */
function HostResidents({
  host,
  detail,
  error,
  allHosts,
  reload,
  onChanged,
}: {
  host: api.OrganizationHost & { orgName?: string | null };
  detail: api.AdminHostDetail | null;
  error: string | null;
  allHosts: Array<api.OrganizationHost & { orgName?: string | null }>;
  reload: () => Promise<void>;
  onChanged: () => Promise<void> | void;
}) {
  const [busyAgent, setBusyAgent] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState(false);
  const [ownerFilter, setOwnerFilter] = useState<string>(""); // "" = all owners
  // Agents we just asked the host to restart. Bridges respawn asynchronously
  // (and staggered), so we show a "restarting" pill on each until the host's
  // heartbeat reports it running again — otherwise the action looks like a
  // no-op. Cleared per-agent below as `running` flips true, with a safety net.
  const [restarting, setRestarting] = useState<Set<string>>(new Set());

  const markRestarting = (ids: string[]) =>
    setRestarting((prev) => new Set([...prev, ...ids]));

  const unmarkRestarting = (ids: string[]) =>
    setRestarting((prev) => {
      const next = new Set(prev);
      ids.forEach((id) => next.delete(id));
      return next;
    });

  // Clear the pill once the heartbeat shows the bridge back up.
  useEffect(() => {
    if (!detail || restarting.size === 0) return;
    const running = new Set(detail.agents.filter((a) => a.running).map((a) => a.id));
    setRestarting((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const id of prev) if (running.has(id)) (next.delete(id), (changed = true));
      return changed ? next : prev;
    });
  }, [detail, restarting.size]);

  // While anything is restarting, re-poll host detail so the dots update
  // without a manual Refresh; give up after ~3 min (a staggered fleet restart
  // can take a while, and the recovery worker backstops anything still down).
  useEffect(() => {
    if (restarting.size === 0) return;
    const poll = setInterval(() => void reload(), 12_000);
    const giveUp = setTimeout(() => {
      clearInterval(poll);
      setRestarting(new Set());
    }, 180_000);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [restarting.size, reload]);

  // Agents shown after the owner filter; selection/select-all operate on these.
  const visibleAgents = useMemo(
    () =>
      (detail?.agents ?? []).filter((a) => !ownerFilter || a.ownerId === ownerFilter),
    [detail, ownerFilter]
  );
  const allVisibleSelected =
    visibleAgents.length > 0 && visibleAgents.every((a) => selected.has(a.id));

  const toggleSelect = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const toggleSelectAllVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (allVisibleSelected) visibleAgents.forEach((a) => next.delete(a.id));
      else visibleAgents.forEach((a) => next.add(a.id));
      return next;
    });

  const bulkMove = async (target: string) => {
    if (!target || selected.size === 0) return;
    setBulkBusy(true);
    try {
      await api.bulkReassignAgents([...selected], target === "local" ? null : target);
      setSelected(new Set());
      await reload();
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Bulk move failed");
    } finally {
      setBulkBusy(false);
    }
  };

  // Other hosts an agent can move to (any host except this one).
  const moveTargets = useMemo(
    () => allHosts.filter((h) => h.id !== host.id),
    [allHosts, host.id]
  );

  const move = async (agentId: string, target: string) => {
    if (!target) return;
    setBusyAgent(agentId);
    try {
      await api.reassignAgent(agentId, target === "local" ? null : target);
      await reload();
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : "Move failed");
    } finally {
      setBusyAgent(null);
    }
  };

  const reset = async (agentId: string) => {
    setBusyAgent(agentId);
    markRestarting([agentId]);
    try {
      const r = await api.resetAgent(agentId);
      if (!r.reset) {
        unmarkRestarting([agentId]);
        alert(`No remote reset: ${r.reason ?? "unavailable"}`);
      }
    } catch (e) {
      unmarkRestarting([agentId]);
      alert(e instanceof Error ? e.message : "Reset failed");
    } finally {
      setBusyAgent(null);
    }
  };

  // Agents shown that aren't currently running on the host — the targets for a
  // one-click "restart offline" after a host restart.
  const offlineVisible = visibleAgents.filter((a) => !a.running);

  const bulkReset = async (ids: string[]) => {
    if (ids.length === 0) return;
    setBulkBusy(true);
    markRestarting(ids);
    try {
      await api.bulkResetAgents(ids);
      setSelected(new Set());
      // Refresh residents so the "restarting" pills can clear as bridges come
      // back; the poll above keeps them current. `onChanged` updates the parent
      // host counts but no longer collapses the row (refresh is non-blocking now).
      await reload();
      void onChanged();
    } catch (e) {
      unmarkRestarting(ids);
      alert(e instanceof Error ? e.message : "Bulk reset failed");
    } finally {
      setBulkBusy(false);
    }
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!detail)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading residents…
      </div>
    );

  return (
    <div className="space-y-5">
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
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground">
                    Agents ({visibleAgents.length}
                    {ownerFilter ? ` of ${detail.agents.length}` : ""})
                  </span>
                  {detail.users.length > 1 && (
                    <select
                      value={ownerFilter}
                      onChange={(e) => setOwnerFilter(e.target.value)}
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">All owners</option>
                      {detail.users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.displayName ?? u.email ?? u.id.slice(0, 8)} ({u.agentCount})
                        </option>
                      ))}
                    </select>
                  )}
                  {offlineVisible.length > 0 && (
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={bulkBusy}
                      onClick={() => void bulkReset(offlineVisible.map((a) => a.id))}
                      title="Stop + respawn every offline agent shown (after a host restart)"
                    >
                      {bulkBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCw className="h-3.5 w-3.5" />
                      )}
                      Restart offline ({offlineVisible.length})
                    </Button>
                  )}
                </div>
                {selected.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">{selected.size} selected</span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={bulkBusy}
                      onClick={() => void bulkReset([...selected])}
                      title="Stop + respawn the selected agents"
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      Reset
                    </Button>
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
              {visibleAgents.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  {detail.agents.length === 0
                    ? "No agents pinned to this host."
                    : "No agents for this owner."}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr>
                        <th className="w-8 px-3 py-2">
                          <input
                            type="checkbox"
                            checked={allVisibleSelected}
                            onChange={toggleSelectAllVisible}
                            className="h-3.5 w-3.5 accent-primary"
                            title="Select all shown"
                          />
                        </th>
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
                      {visibleAgents.map((a) => (
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
                              {restarting.has(a.id) && !a.running ? (
                                <Loader2
                                  className="h-3 w-3 animate-spin text-amber-500"
                                  aria-label="restarting"
                                />
                              ) : (
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    a.running ? "bg-success" : "bg-muted-foreground/40"
                                  )}
                                  title={a.running ? "running" : "not running"}
                                />
                              )}
                              {a.displayName}
                              {restarting.has(a.id) && !a.running && (
                                <span className="text-xs font-normal text-amber-500">
                                  restarting…
                                </span>
                              )}
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
                <th className="px-3 py-2 font-medium">Member for</th>
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
                    <div className="flex items-center gap-2.5">
                      <Avatar className="h-7 w-7 shrink-0">
                        {u.avatarUrl ? (
                          <AvatarImage src={u.avatarUrl} alt={u.displayName} displaySize={28} />
                        ) : null}
                        <AvatarFallback className="text-[10px]">
                          {initials(u.displayName, u.email)}
                        </AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="truncate font-medium">{u.displayName}</div>
                        <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-muted-foreground">{u.orgName ?? "—"}</td>
                  <td
                    className="px-3 py-2 text-muted-foreground"
                    title={u.memberSince ? new Date(u.memberSince).toLocaleDateString() : undefined}
                  >
                    {memberFor(u.memberSince)}
                  </td>
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
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
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
      const res = await api.allocateUserToHost(user.id, hostId);
      if (res.total === 0) {
        setError("This user has no active agents to allocate.");
        return;
      }
      if (res.allocated === 0) {
        const why = res.failed[0]?.reason;
        setError(
          why
            ? `Couldn't allocate any agents: ${why}`
            : "Couldn't allocate any agents."
        );
        return;
      }
      if (res.failed.length > 0) {
        setError(
          `Allocated ${res.allocated} of ${res.total} — ${res.failed.length} failed (${res.failed[0].reason}).`
        );
        return;
      }
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

  const opt = (o: api.ProvisioningOption) => String(o.name ?? o.id);

  // The existing-VM inventory now lives in the unified Hosts list above; this
  // section is just the "provision a new VM" form.
  return (
    <div className="max-w-md space-y-3">
      <div className="flex items-center gap-2 text-sm font-medium">
        <Plus className="h-4 w-4" /> Provision a new shared host (Hostinger)
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading catalog…
        </div>
      ) : error && !catalog ? (
        <ErrorBox message={error} />
      ) : (
        <>
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
        </>
      )}
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
