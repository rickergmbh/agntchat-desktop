import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
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
import i18n from "../i18n";
import { cn } from "../lib/utils";
import { useAuthStore } from "../stores/authStore";
import { useModelCatalog, type CatalogProvider } from "../stores/modelCatalogStore";
import { useWorkspaces } from "../stores/workspaceStore";
import {
  ClaudeLoginDialog,
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
  const { t } = useTranslation("platform");
  const [tab, setTab] = useState("overview");
  // Host management is behind the `org_hosts` flag. When off the Hosts tab is
  // hidden (its host routes 404 server-side anyway); the Features tab stays
  // visible so an operator can grant themselves the flag to light it up.
  const orgHostsEnabled = useAuthStore((s) => s.participant?.features?.org_hosts === true);

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-6 py-4">
        <ShieldHalf className="h-5 w-5 text-muted-foreground" />
        <div>
          <h1 className="text-base font-semibold leading-none">{t("nav:platform")}</h1>
          <p className="mt-1 text-xs text-muted-foreground">{t("subtitle")}</p>
        </div>
      </header>

      <Tabs value={tab} onValueChange={setTab} className="flex flex-1 flex-col overflow-hidden">
        <TabsList className="mx-6 mt-3 w-fit">
          <TabsTrigger value="overview">{t("tabs.overview")}</TabsTrigger>
          {orgHostsEnabled && <TabsTrigger value="hosts">{t("tabs.hosts")}</TabsTrigger>}
          <TabsTrigger value="users">{t("tabs.users")}</TabsTrigger>
          <TabsTrigger value="features">{t("tabs.features")}</TabsTrigger>
        </TabsList>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          <TabsContent value="overview">
            <OverviewTab />
          </TabsContent>
          {orgHostsEnabled && (
            <TabsContent value="hosts">
              {/* Hosts + provisioning live together: your managed hosts up top,
                  then the full Hostinger VM inventory and the "provision a new
                  host" form below. */}
              <HostsTab />
              <div className="my-6 border-t border-border" />
              <ProvisioningTab />
            </TabsContent>
          )}
          <TabsContent value="users">
            <UsersTab />
          </TabsContent>
          <TabsContent value="features">
            <FeatureFlagsTab />
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
  if (runtime === "org_host") return i18n.t("platform:runtime.hosted");
  if (runtime === "local") return i18n.t("platform:runtime.local");
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
  if (days <= 0) return i18n.t("common:today");
  if (days < 31) return i18n.t("common:time.shortDays", { count: days });
  const months = Math.floor(days / 30.44);
  if (months < 12) return i18n.t("common:time.shortMonths", { count: months });
  const years = Math.floor(months / 12);
  const rem = months % 12;
  return rem
    ? i18n.t("common:time.shortYearsMonths", { years, months: rem })
    : i18n.t("common:time.shortYears", { count: years });
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
  const { t } = useTranslation("platform");
  const [stats, setStats] = useState<api.PlatformStats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api.getAdminStats().then(setStats).catch((e) =>
      setError(e instanceof Error ? e.message : i18n.t("platform:errors.loadStats"))
    );
  }, []);

  if (error) return <ErrorBox message={error} />;
  if (!stats)
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> {t("common:loading")}
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
    {
      label: t("tabs.users"),
      value: stats.users,
      sub: t("overview.usersSub", { online: stats.usersOnline ?? 0, paying: stats.payingUsers }),
    },
    {
      label: t("nav:agents"),
      value: stats.agents,
      sub: t("overview.agentsSub", { online: stats.agentsOnline ?? 0, hosted, local }),
    },
    {
      label: t("overview.workspaces"),
      value: stats.organizations,
      sub: t("overview.workspacesTotal", { count: workspaces.length }),
    },
    { label: t("overview.hostsOnline"), value: `${onlineHosts}/${totalHosts}`, sub: t("overview.byHeartbeat") },
    {
      label: t("overview.mrr"),
      value: fmtUsdCents(rev.mrrCents, rev.currency),
      sub: t("overview.subsCount", { count: rev.tiers.reduce((n, tier) => n + tier.count, 0) }),
    },
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
            <span>{t("overview.revenueByTier")}</span>
            {rev.unpricedCount > 0 && (
              <span className="text-amber-500" title={t("overview.unpricedHint")}>
                {t("overview.unpriced", { count: rev.unpricedCount })}
              </span>
            )}
          </div>
          {rev.tiers.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t("overview.noSubscriptions")}</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr>
                  <th className="px-4 py-1.5 font-medium">{t("overview.tier")}</th>
                  <th className="px-4 py-1.5 text-right font-medium">{t("overview.subs")}</th>
                  <th className="px-4 py-1.5 text-right font-medium">{t("overview.mrr")}</th>
                </tr>
              </thead>
              <tbody>
                {rev.tiers.map((tier) => (
                  <tr key={tier.plan ?? tier.tier} className="border-t border-border">
                    <td className="px-4 py-1.5 truncate" title={tier.plan ?? undefined}>{tier.tier ?? tier.plan ?? "—"}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{tier.count}</td>
                    <td className="px-4 py-1.5 text-right tabular-nums">{fmtUsdCents(tier.mrrCents, rev.currency)}</td>
                  </tr>
                ))}
                <tr className="border-t border-border font-medium">
                  <td className="px-4 py-1.5">{t("overview.total")}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{rev.tiers.reduce((n, tier) => n + tier.count, 0)}</td>
                  <td className="px-4 py-1.5 text-right tabular-nums">{fmtUsdCents(rev.mrrCents, rev.currency)}</td>
                </tr>
              </tbody>
            </table>
          )}
        </section>

        {/* Agents per workspace */}
        <section className="rounded-lg border border-border">
          <div className="border-b border-border px-4 py-2 text-xs font-medium text-muted-foreground">
            {t("overview.agentsByWorkspace")}
          </div>
          {workspaces.length === 0 ? (
            <p className="px-4 py-3 text-sm text-muted-foreground">{t("overview.noWorkspaces")}</p>
          ) : (
            <ul className="max-h-72 overflow-y-auto">
              {workspaces.map((w) => (
                <li
                  key={w.id}
                  className="flex items-center justify-between gap-3 border-t border-border px-4 py-1.5 text-sm first:border-t-0"
                >
                  <span className="min-w-0 flex-1 truncate">{w.name ?? w.id.slice(0, 8)}</span>
                  <span className="shrink-0 tabular-nums text-muted-foreground">
                    {t("agentsCount", { count: w.agentCount })}
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
  const { t } = useTranslation("platform");
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
        hostsRes.reason instanceof Error
          ? hostsRes.reason.message
          : i18n.t("platform:errors.loadHosts")
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
          : i18n.t("platform:errors.loadVms")
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
          <ServerIcon className="h-4 w-4" /> {t("hosts.title")}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("common:refresh")}
          </Button>
          {operatorOrgId && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAnthropicOpen(true)}
              title={t("hosts.connectAnthropicHint")}
            >
              <ShieldCheck className="h-3.5 w-3.5 text-muted-foreground" />
              {t("hosts.connectAnthropic")}
            </Button>
          )}
          {operatorOrgId && (
            <Button size="sm" onClick={() => openAddHost()}>
              <Plus className="h-3.5 w-3.5" />
              {t("hosts.addHost")}
            </Button>
          )}
        </div>
      </div>

      {error && <ErrorBox message={error} />}

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common:loading")}
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
              {t("hosts.vmInventoryError", { error: vmsError })}
            </p>
          )}

          {/* Hosts with no Hostinger VM behind them (manually-added boxes). */}
          {otherHosts.length > 0 && (
            <div className="space-y-2 pt-2">
              <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                {t("hosts.otherHosts")}
              </div>
              <ul className="space-y-2">
                {otherHosts.map((h) => (
                  <MergedHostRow key={h.id} host={h} allHosts={hosts} onChanged={refresh} />
                ))}
              </ul>
            </div>
          )}

          {vms.length === 0 && otherHosts.length === 0 && (
            <p className="text-sm text-muted-foreground">{t("hosts.empty")}</p>
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
  const { t } = useTranslation("platform");
  return (
    <li className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{vm.hostname || vm.id}</span>
          <Badge variant={vm.state === "running" ? "default" : "outline"} className="shrink-0">
            {vm.state || t("common:unknown")}
          </Badge>
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            {t("hosts.notAdded")}
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {[vm.ipv4, vm.plan, vm.datacenter].filter(Boolean).join(" · ") || vm.id}
        </div>
      </div>
      {canAdd && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          {t("hosts.addHost")}
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
  const { t } = useTranslation("platform");
  const hostOrgId = host.organizationId;
  const [expanded, setExpanded] = useState(false);
  // Which inner panel shows once expanded — residents vs the SSH op log.
  const [panel, setPanel] = useState<"residents" | "operations">("residents");
  const [detail, setDetail] = useState<api.AdminHostDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);
  const [ops, setOps] = useState<api.HostOperation[]>([]);
  const [busy, setBusy] = useState<api.HostOpKind | "delete" | null>(null);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(host.name);
  const [renameBusy, setRenameBusy] = useState(false);
  const [shared, setShared] = useState(!!host.shared);
  const [keyOpen, setKeyOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
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
      setDetailError(e instanceof Error ? e.message : i18n.t("platform:errors.loadHostDetail"));
    }
  }, [host.id, hostOrgId]);

  useEffect(() => {
    if (expanded) void loadDetail();
  }, [expanded, loadDetail]);

  // Is an SSH op in flight (kicked off here, or still finishing from a prior
  // session)? Drives the header badge + the live re-poll below.
  const opRunning = useMemo(
    () => ops.some((o) => o.status === "pending" || o.status === "running"),
    [ops]
  );

  // While an op is in flight, re-poll the op log so its status + output update
  // in place — no collapse/reopen to see progress. Give up after ~5 min.
  useEffect(() => {
    if (!expanded || !opRunning) return;
    const poll = setInterval(() => void loadDetail(), 4_000);
    const giveUp = setTimeout(() => clearInterval(poll), 300_000);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [expanded, opRunning, loadDetail]);

  const op = async (kind: api.HostOpKind, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(kind);
    try {
      await api.runHostOp(hostOrgId, host.id, kind);
      // Surface progress: expand the row and refresh so the running badge + op
      // log appear. We don't force the Operations panel — the badge points the
      // way; the live re-poll keeps it current once they switch to it.
      setExpanded(true);
      await loadDetail();
    } catch (e) {
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.operationFailed"));
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
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.renameHost"));
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
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.updateHost"));
    }
  };

  const showKey = async () => {
    setKeyOpen(true);
    if (pubKey) return;
    try {
      setPubKey(await api.getHostPublicKey(hostOrgId, host.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.loadPublicKey"));
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("hosts.deleteConfirm", { name: host.name }))) return;
    setBusy("delete");
    try {
      await api.deleteOrganizationHost(hostOrgId, host.id);
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.deleteHost"));
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
          aria-label={expanded ? t("common:collapse") : t("common:expand")}
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
                  title={t("hosts.renameHost")}
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
                  {t(`status.${host.status}`, { defaultValue: host.status })}
                </Badge>
                {vm?.state && (
                  <Badge
                    variant="outline"
                    className="shrink-0 text-muted-foreground"
                    title={t("hosts.vmStateHint")}
                  >
                    {t("hosts.vmState", { state: vm.state })}
                  </Badge>
                )}
                {shared && (
                  <Badge variant="outline" className="shrink-0 border-primary/30 text-primary">
                    {t("hosts.sharedBadge")}
                  </Badge>
                )}
                {!bootstrapped && (
                  <Badge variant="outline" className="shrink-0 border-amber-500/30 text-amber-600">
                    {t("hosts.notBootstrapped")}
                  </Badge>
                )}
                {opRunning && (
                  <Badge
                    variant="outline"
                    className="shrink-0 gap-1 border-amber-500/30 text-amber-600"
                    title={t("hosts.opRunningHint")}
                  >
                    <Loader2 className="h-3 w-3 animate-spin" />
                    {ops.find((o) => o.status === "pending" || o.status === "running")?.kind ??
                      t("status.running")}
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
            <span className="tabular-nums">/{assigned}</span>{" "}
            {t("hosts.agentsOnlineSuffix", { count: assigned })}
            {` · ${t("hosts.usersCount", { count: users })}`}
            {host.orgName ? ` · ${host.orgName}` : ""}
            {host.sshHost
              ? ` · ${host.sshUser || "root"}@${host.sshHost}`
              : ` · ${t("hosts.noSshTarget")}`}
            {host.provider ? ` · ${host.provider}${host.providerVmId ? ` vm ${host.providerVmId}` : ""}` : ""}
            {host.version ? ` · v${host.version}` : ""}
            {` · ${t("hosts.seen", { age: relativeAge(host.lastSeenAt) })}`}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!bootstrapped && host.sshHost && (
            <Button variant="outline" size="sm" onClick={() => void showKey()} disabled={busy !== null} title={t("hosts.keyHint")}>
              <KeyRound className="h-3.5 w-3.5" />
              {t("hosts.key")}
            </Button>
          )}
          {!bootstrapped && host.sshHost && (
            <Button variant="default" size="sm" onClick={() => void op("bootstrap")} disabled={busy !== null} title={t("hosts.bootstrapHint")}>
              {busy === "bootstrap" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
              {t("hosts.bootstrap")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("update", t("hosts.updateConfirm", { name: host.name }))}
            disabled={busy !== null || !host.sshHost}
            title={t("hosts.updateHint")}
          >
            {busy === "update" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <DownloadCloud className="h-3.5 w-3.5" />}
            {t("common:update")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("restart", t("hosts.restartConfirm", { name: host.name }))}
            disabled={busy !== null || !host.sshHost}
            title={t("hosts.restartHint")}
          >
            {busy === "restart" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCw className="h-3.5 w-3.5" />}
            {t("hosts.restart")}
          </Button>
          {bootstrapped && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLoginOpen(true)}
              disabled={busy !== null || !host.sshHost}
              title={t("hosts.anthropicHint")}
            >
              <ShieldCheck className="h-3.5 w-3.5" />
              Anthropic
            </Button>
          )}
          {bootstrapped && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => void op("set_token")}
              disabled={busy !== null || !host.sshHost}
              title={t("hosts.seatHint")}
            >
              {busy === "set_token" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {t("hosts.seat")}
            </Button>
          )}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("probe")}
            disabled={busy !== null || !host.sshHost}
            title={t("hosts.probeHint")}
          >
            {busy === "probe" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Activity className="h-3.5 w-3.5" />}
          </Button>
          <label className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground" title={t("hosts.sharedHint")}>
            {t("hosts.shared")}
            <Switch checked={shared} onCheckedChange={(v) => void toggleShared(v)} />
          </label>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void handleDelete()}
            disabled={busy !== null}
            className="text-destructive hover:bg-destructive/10 hover:text-destructive"
            title={t("hosts.deleteHost")}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-border px-4 py-3">
          {/* Segmented switch: residents (users + agents) vs the SSH op log.
              Operations is one click away — no scrolling to the bottom — and
              its tab flags a live op so you can jump straight to progress. */}
          <div className="mb-3 inline-flex rounded-md border border-border p-0.5 text-sm">
            <button
              type="button"
              onClick={() => setPanel("residents")}
              className={cn(
                "rounded-[5px] px-3 py-1 font-medium transition-colors",
                panel === "residents"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("hosts.residents")}
              <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
                {t("hosts.residentsSummary", { users, agents: assigned })}
              </span>
            </button>
            <button
              type="button"
              onClick={() => setPanel("operations")}
              className={cn(
                "flex items-center gap-1.5 rounded-[5px] px-3 py-1 font-medium transition-colors",
                panel === "operations"
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              {t("hosts.operations")}
              {opRunning ? (
                <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
              ) : (
                ops.length > 0 && (
                  <span className="tabular-nums text-xs text-muted-foreground">{ops.length}</span>
                )
              )}
            </button>
          </div>

          {panel === "residents" ? (
            <HostResidents
              host={host}
              detail={detail}
              error={detailError}
              allHosts={allHosts}
              reload={loadDetail}
              onChanged={onChanged}
            />
          ) : (
            <HostOpLog
              ops={ops}
              onCancel={async (opId) => {
                await api.cancelHostOperation(hostOrgId, host.id, opId);
                await loadDetail();
              }}
            />
          )}
        </div>
      )}

      <Dialog open={keyOpen} onOpenChange={setKeyOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t("hosts.authorizeTitle", { name: host.name })}</DialogTitle>
            <DialogDescription>
              {t("hosts.authorizeDescription", {
                target: `${host.sshUser || "root"}@${host.sshHost}`,
              })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-1">
            {pubKey ? (
              <div className="space-y-1">
                <Label className="text-xs">{t("hosts.publicKey")}</Label>
                <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs break-all">
                  <span className="flex-1 select-all">{pubKey}</span>
                </div>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> {t("hosts.loadingKey")}
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
              {t("hosts.bootstrapNow")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ClaudeLoginDialog
        orgId={hostOrgId}
        hostId={host.id}
        hostName={host.name}
        open={loginOpen}
        onOpenChange={setLoginOpen}
      />
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
  const { t } = useTranslation("platform");
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
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.bulkMoveFailed"));
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
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.moveFailed"));
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
        alert(
          i18n.t("platform:errors.noRemoteReset", {
            reason: r.reason ?? i18n.t("platform:errors.unavailable"),
          })
        );
      }
    } catch (e) {
      unmarkRestarting([agentId]);
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.resetFailed"));
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
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.bulkResetFailed"));
    } finally {
      setBulkBusy(false);
    }
  };

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (!detail)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("hosts.loadingResidents")}
      </div>
    );

  return (
    <div className="space-y-5">
            <section>
              <div className="mb-2 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <UsersIcon className="h-3.5 w-3.5" /> {t("hosts.usersHeader", { count: detail.users.length })}
              </div>
              {detail.users.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t("hosts.noUsers")}</p>
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
                          {t("agentsCount", { count: u.agentCount })}
                        </span>
                      </span>
                      <Sparkline values={u.series} />
                      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                        {t("hosts.tokenUsage", {
                          tokens: fmtTokens(u.tokens?.totalTokens),
                          cost: fmtUsd(u.tokens?.costUsd),
                        })}
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
                    {ownerFilter
                      ? t("hosts.agentsHeaderFiltered", {
                          shown: visibleAgents.length,
                          total: detail.agents.length,
                        })
                      : t("hosts.agentsHeader", { count: visibleAgents.length })}
                  </span>
                  {detail.users.length > 1 && (
                    <select
                      value={ownerFilter}
                      onChange={(e) => setOwnerFilter(e.target.value)}
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">{t("hosts.allOwners")}</option>
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
                      title={t("hosts.restartOfflineHint")}
                    >
                      {bulkBusy ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <RotateCw className="h-3.5 w-3.5" />
                      )}
                      {t("hosts.restartOffline", { count: offlineVisible.length })}
                    </Button>
                  )}
                </div>
                {selected.size > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground">
                      {t("common:selectedCount", { count: selected.size })}
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8"
                      disabled={bulkBusy}
                      onClick={() => void bulkReset([...selected])}
                      title={t("hosts.resetSelectedHint")}
                    >
                      <RotateCw className="h-3.5 w-3.5" />
                      {t("hosts.resetAgent")}
                    </Button>
                    <select
                      value=""
                      disabled={bulkBusy}
                      onChange={(e) => void bulkMove(e.target.value)}
                      className="h-8 rounded-md border border-input bg-transparent px-2 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    >
                      <option value="">{t("hosts.moveSelectedTo")}</option>
                      <option value="local">{t("hosts.localOffHost")}</option>
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
                    ? t("hosts.noAgentsPinned")
                    : t("hosts.noAgentsForOwner")}
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
                            title={t("hosts.selectAllShown")}
                          />
                        </th>
                        <th className="px-3 py-2 font-medium">{t("table.agent")}</th>
                        <th className="px-3 py-2 font-medium">{t("table.owner")}</th>
                        <th className="px-3 py-2 font-medium">{t("table.model")}</th>
                        <th className="px-3 py-2 font-medium">{t("table.tokens30d")}</th>
                        <th className="px-3 py-2 font-medium">{t("table.cost")}</th>
                        <th className="px-3 py-2 font-medium">{t("table.trend")}</th>
                        <th className="px-3 py-2 font-medium">{t("table.moveTo")}</th>
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
                                  aria-label={t("status.restarting")}
                                />
                              ) : (
                                <span
                                  className={cn(
                                    "h-1.5 w-1.5 rounded-full",
                                    a.running ? "bg-success" : "bg-muted-foreground/40"
                                  )}
                                  title={a.running ? t("status.running") : t("status.notRunning")}
                                />
                              )}
                              {a.displayName}
                              {restarting.has(a.id) && !a.running && (
                                <span className="text-xs font-normal text-amber-500">
                                  {t("status.restarting")}
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
                              <option value="">{t("hosts.rebalance")}</option>
                              <option value="local">{t("hosts.localOffHost")}</option>
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
                              title={t("hosts.resetHint")}
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

/**
 * Runtime feature flags: a global on/off per capability plus a per-user
 * allowlist (early-access cohort) for shipping a feature dark and lighting it
 * up for a select few. Backed by `/api/admin/feature-flags`; the backend
 * enforces each gated route regardless of what the UI shows.
 */
function FeatureFlagsTab() {
  const [flags, setFlags] = useState<api.FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFlags(await api.listFeatureFlags());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load feature flags");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // Replace one flag in place after a mutation returns the fresh row.
  const onFlagChanged = useCallback((flag: api.FeatureFlag) => {
    setFlags((prev) => prev.map((f) => (f.key === flag.key ? flag : f)));
  }, []);

  if (loading) {
    return (
      <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading…
      </div>
    );
  }

  return (
    <div>
      {error && <ErrorBox message={error} />}
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">
        Toggle a capability platform-wide, or enable it for a select few while it
        stays off for everyone else. Changes take effect immediately — no
        redeploy.
      </p>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {flags.map((flag) => (
          <FeatureFlagCard key={flag.key} flag={flag} onChanged={onFlagChanged} setError={setError} />
        ))}
        {flags.length === 0 && (
          <p className="py-8 text-sm text-muted-foreground">No feature flags defined.</p>
        )}
      </div>
    </div>
  );
}

function FeatureFlagCard({
  flag,
  onChanged,
  setError,
}: {
  flag: api.FeatureFlag;
  onChanged: (flag: api.FeatureFlag) => void;
  setError: (msg: string | null) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [results, setResults] = useState<api.AdminUser[]>([]);
  const [searching, setSearching] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout>>(null);

  const run = useCallback(
    async (fn: () => Promise<api.FeatureFlag>) => {
      setBusy(true);
      try {
        onChanged(await fn());
        setError(null);
        // The toggle/grant/revoke may have changed THIS admin's own resolved
        // `features` map (e.g. flipping `workspaces` on lights up the rail
        // switcher). Refetch /api/me so the running session reflects it
        // immediately instead of only after a relogin. The backend flushes
        // its profile cache on the same mutation, so this read is fresh.
        await useAuthStore.getState().fetchProfile();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Update failed");
      } finally {
        setBusy(false);
      }
    },
    [onChanged, setError]
  );

  // Debounced user search for the allowlist picker (reuses the admin user list).
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    if (search.trim().length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    searchTimer.current = setTimeout(async () => {
      try {
        const users = await api.listAdminUsers(search.trim());
        // Drop anyone already allowlisted.
        setResults(users.filter((u) => !flag.allowedParticipantIds.includes(u.id)));
      } catch {
        setResults([]);
      } finally {
        setSearching(false);
      }
    }, 300);
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [search, flag.allowedParticipantIds]);

  return (
    <div
      className={cn(
        // NOTE: no `overflow-hidden` here — the user-search dropdown in the
        // allowlist section is absolutely positioned and would be clipped by
        // the card. The header rounds its own top corners instead.
        "flex flex-col rounded-xl border bg-card shadow-sm transition-colors",
        flag.enabled ? "border-primary/40" : "border-border"
      )}
    >
      {/* Card header — a tinted strip so each flag reads as its own object,
          with the on/off state mirrored in both the strip and the badge. */}
      <div
        className={cn(
          "flex items-start justify-between gap-4 rounded-t-xl border-b p-4",
          flag.enabled ? "border-primary/30 bg-primary/5" : "border-border bg-muted/30"
        )}
      >
        <div className="min-w-0">
          <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-sm font-semibold">
            {flag.key}
          </code>
          {flag.description && (
            <p className="mt-2 text-xs text-muted-foreground">{flag.description}</p>
          )}
        </div>
        <div className="flex shrink-0 flex-col items-end gap-2">
          <div className="flex items-center gap-2">
            {busy && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
            <Switch
              checked={flag.enabled}
              disabled={busy}
              onCheckedChange={(v) => void run(() => api.setFeatureFlagEnabled(flag.key, v))}
            />
          </div>
          <Badge
            variant={flag.enabled ? "default" : flag.allowed.length > 0 ? "outline" : "secondary"}
          >
            {flag.enabled
              ? "On for everyone"
              : flag.allowed.length > 0
                ? `On for ${flag.allowed.length} ${flag.allowed.length === 1 ? "person" : "people"}`
                : "Off"}
          </Badge>
        </div>
      </div>

      {/* Per-user allowlist — early-access cohort, used when the global flag is
          off. Members see the feature even while everyone else doesn't. */}
      <div className="p-4">
        <Label className="text-xs text-muted-foreground">
          Early access {flag.enabled && "(superseded while On for everyone)"}
        </Label>

        {flag.allowed.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {flag.allowed.map((u) => (
              <span
                key={u.id}
                className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 py-0.5 pl-1 pr-1.5 text-xs"
              >
                <Avatar className="h-4 w-4">
                  {u.avatarUrl ? (
                    <AvatarImage src={u.avatarUrl} alt={u.displayName} displaySize={16} />
                  ) : null}
                  <AvatarFallback className="text-[8px]">
                    {initials(u.displayName, u.email)}
                  </AvatarFallback>
                </Avatar>
                <span className="max-w-[140px] truncate">{u.displayName}</span>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => void run(() => api.revokeFeatureFlag(flag.key, u.id))}
                  className="text-muted-foreground hover:text-destructive"
                  aria-label={`Remove ${u.displayName}`}
                >
                  <X className="h-3 w-3" />
                </button>
              </span>
            ))}
          </div>
        ) : (
          <p className="mt-1 text-xs text-muted-foreground">No users in early access.</p>
        )}

        <div className="relative mt-2 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            disabled={flag.enabled}
            placeholder={
              flag.enabled ? "Turn off to scope to specific users…" : "Add a user by name or email…"
            }
            className="pl-8"
          />
          {!flag.enabled && (searching || results.length > 0) && search.trim().length >= 2 && (
            <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
              {searching ? (
                <div className="px-3 py-2 text-xs text-muted-foreground">Searching…</div>
              ) : (
                results.slice(0, 6).map((u) => (
                  <button
                    type="button"
                    key={u.id}
                    disabled={busy}
                    onClick={() => {
                      setSearch("");
                      setResults([]);
                      void run(() => api.grantFeatureFlag(flag.key, u.id));
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <Avatar className="h-6 w-6">
                      {u.avatarUrl ? (
                        <AvatarImage src={u.avatarUrl} alt={u.displayName} displaySize={24} />
                      ) : null}
                      <AvatarFallback className="text-[9px]">
                        {initials(u.displayName, u.email)}
                      </AvatarFallback>
                    </Avatar>
                    <div className="min-w-0">
                      <div className="truncate">{u.displayName}</div>
                      <div className="truncate text-xs text-muted-foreground">{u.email}</div>
                    </div>
                  </button>
                ))
              )}
            </div>
          )}
        </div>
      </div>
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
