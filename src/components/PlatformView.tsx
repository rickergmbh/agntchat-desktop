import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  AlertCircle,
  ArrowRightLeft,
  ChevronRight,
  Loader2,
  Plus,
  RefreshCw,
  RotateCcw,
  RotateCw,
  Search,
  Server as ServerIcon,
  ShieldCheck,
  ShieldHalf,
  Users as UsersIcon,
  X,
} from "lucide-react";
import * as api from "../lib/api";
import i18n from "../i18n";
import { cn } from "../lib/utils";
import { useAuthStore } from "../stores/authStore";
import { useModelCatalog, type CatalogProvider } from "../stores/modelCatalogStore";
import { useWorkspaces } from "../stores/workspaceStore";
import { ConnectAnthropicDialog, ConnectHostDialog } from "./FleetView";
import { HostRow, type HostRowDetailContext } from "./hosts/HostRow";
import { HostList } from "./hosts/HostList";
import { HostPanels } from "./hosts/HostPanels";
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
          <HostList
            hosts={hosts}
            vms={vms}
            vmsError={vmsError}
            canAdd={!!operatorOrgId}
            onAdd={openAddHost}
            renderHost={(host, vm) => (
              <AdminHostRow host={host} allHosts={hosts} onChanged={refresh} vm={vm} />
            )}
            empty={<p className="text-sm text-muted-foreground">{t("hosts.empty")}</p>}
          />
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
 * Admin flavor of the shared HostRow: cross-org rename + shared-host toggle,
 * VM power-state badge, user/org summary segments, and a residents/operations
 * panel. Rename + shared-toggle go through the admin endpoints (cross-org);
 * SSH ops + delete go through the org-scoped endpoints keyed on the host's own
 * organization id (works for operator-owned/shared hosts — the common case).
 */
function AdminHostRow({
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
  const [shared, setShared] = useState(!!host.shared);

  const toggleShared = async (next: boolean) => {
    setShared(next); // optimistic
    try {
      await api.setHostShared(host.id, next);
    } catch (e) {
      setShared(!next);
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.updateHost"));
    }
  };

  return (
    <HostRow
      host={{ ...host, shared }}
      opsOrgId={host.organizationId}
      onChanged={onChanged}
      onRename={async (name) => {
        await api.updateAdminHost(host.id, { name });
      }}
      vm={vm}
      summaryExtras={host.orgName ? [host.orgName] : []}
      extraActions={
        <label
          className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground"
          title={t("hosts.sharedHint")}
        >
          {t("hosts.shared")}
          <Switch checked={shared} onCheckedChange={(v) => void toggleShared(v)} />
        </label>
      }
      renderDetail={(ctx) => (
        <AdminHostPanels host={host} allHosts={allHosts} onChanged={onChanged} ctx={ctx} />
      )}
    />
  );
}

/** Admin residents panel wrapper: loads the cross-org host detail and hands
 *  it to HostResidents inside the shared segmented HostPanels. */
function AdminHostPanels({
  host,
  allHosts,
  onChanged,
  ctx,
}: {
  host: api.OrganizationHost & { orgName?: string | null };
  allHosts: Array<api.OrganizationHost & { orgName?: string | null }>;
  onChanged: () => Promise<void> | void;
  ctx: HostRowDetailContext;
}) {
  const [detail, setDetail] = useState<api.AdminHostDetail | null>(null);
  const [detailError, setDetailError] = useState<string | null>(null);

  const loadDetail = useCallback(async () => {
    try {
      setDetail(await api.getAdminHost(host.id));
      setDetailError(null);
    } catch (e) {
      setDetailError(
        e instanceof Error ? e.message : i18n.t("platform:errors.loadHostDetail")
      );
    }
  }, [host.id]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail]);

  return (
    <HostPanels
      host={host}
      ctx={ctx}
      renderResidents={() => (
        <HostResidents
          host={host}
          detail={detail}
          error={detailError}
          allHosts={allHosts}
          reload={loadDetail}
          onChanged={onChanged}
        />
      )}
    />
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
  const { t } = useTranslation("platform");
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
      setError(e instanceof Error ? e.message : t("errors.loadUsers"));
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
            placeholder={t("searchUsersPlaceholder")}
            className="pl-8"
          />
        </div>
        <Button variant="outline" size="sm" onClick={() => void refresh(search)}>
          <RefreshCw className="h-3.5 w-3.5" />
          {t("common:refresh")}
        </Button>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("common:loading")}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
              <tr>
                <th className="px-3 py-2 font-medium">{t("columns.user")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.workspace")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.memberFor")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.agents")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.tokens30d")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.plan")}</th>
                <th className="px-3 py-2 font-medium">{t("columns.allocated")}</th>
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
                      {t("columns.agents")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setPlanning(u)}>
                      {t("columns.plan")}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setAllocating(u)}>
                      {t("allocate")}
                    </Button>
                  </td>
                </tr>
              ))}
              {users.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-3 py-6 text-center text-muted-foreground">
                    {t("noUsers")}
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
  const { t } = useTranslation("platform");
  const [flags, setFlags] = useState<api.FeatureFlag[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setFlags(await api.listFeatureFlags());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.loadFlags"));
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
        <Loader2 className="h-4 w-4 animate-spin" /> {t("common:loading")}
      </div>
    );
  }

  return (
    <div>
      {error && <ErrorBox message={error} />}
      <p className="mb-4 max-w-2xl text-sm text-muted-foreground">{t("flagsIntro")}</p>
      <div className="divide-y divide-border rounded-lg border border-border">
        {flags.map((flag) => (
          <FeatureFlagRow key={flag.key} flag={flag} onChanged={onFlagChanged} setError={setError} />
        ))}
        {flags.length === 0 && (
          <p className="px-4 py-8 text-sm text-muted-foreground">{t("noFlags")}</p>
        )}
      </div>
    </div>
  );
}

function FeatureFlagRow({
  flag,
  onChanged,
  setError,
}: {
  flag: api.FeatureFlag;
  onChanged: (flag: api.FeatureFlag) => void;
  setError: (msg: string | null) => void;
}) {
  const { t } = useTranslation("platform");
  const [busy, setBusy] = useState(false);
  const [expanded, setExpanded] = useState(false);
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
        setError(e instanceof Error ? e.message : t("errors.updateFailed"));
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
    // NOTE: no `overflow-hidden` anywhere in this row — the user-search
    // dropdown in the allowlist panel is absolutely positioned and would be
    // clipped by it.
    <div>
      <div className="flex items-center gap-3 px-3 py-2.5">
        <button
          type="button"
          onClick={() => setExpanded((e) => !e)}
          aria-expanded={expanded}
          aria-label={t("flagEarlyAccessAria", { key: flag.key })}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <ChevronRight
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform",
              expanded && "rotate-90"
            )}
          />
          <code className="shrink-0 font-mono text-sm font-semibold">{flag.key}</code>
          {flag.description && (
            <span className="truncate text-xs text-muted-foreground">{flag.description}</span>
          )}
        </button>
        {!flag.enabled && flag.allowed.length > 0 && (
          <Badge variant="outline" className="shrink-0">
            {t("onForCount", { count: flag.allowed.length })}
          </Badge>
        )}
        {busy && <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />}
        <Switch
          checked={flag.enabled}
          disabled={busy}
          onCheckedChange={(v) => void run(() => api.setFeatureFlagEnabled(flag.key, v))}
        />
      </div>

      {/* Per-user allowlist — early-access cohort, used when the global flag is
          off. Members see the feature even while everyone else doesn't. */}
      {expanded && (
        <div className="px-3 pb-3 pl-9">
          <Label className="text-xs text-muted-foreground">
            {t("earlyAccess")} {flag.enabled && t("earlyAccessSuperseded")}
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
                    aria-label={t("removeUser", { name: u.displayName })}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted-foreground">{t("noEarlyAccess")}</p>
          )}

          <div className="relative mt-2 max-w-sm">
            <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              disabled={flag.enabled}
              placeholder={
                flag.enabled ? t("turnOffToScope") : t("addUserPlaceholder")
              }
              className="pl-8"
            />
            {!flag.enabled && (searching || results.length > 0) && search.trim().length >= 2 && (
              <div className="absolute z-10 mt-1 w-full overflow-hidden rounded-md border border-border bg-popover shadow-md">
                {searching ? (
                  <div className="px-3 py-2 text-xs text-muted-foreground">{t("searching")}</div>
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
      )}
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
  const { t } = useTranslation("platform");
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
      setError(e instanceof Error ? e.message : t("errors.loadAgents"));
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
          <DialogTitle>{t("agentsFor", { name: user?.displayName ?? "" })}</DialogTitle>
          <DialogDescription>{t("agentsForHint")}</DialogDescription>
        </DialogHeader>

        {error && <ErrorBox message={error} />}
        {loading || !detail ? (
          <div className="flex items-center gap-2 py-8 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common:loading")}
          </div>
        ) : (
          <div className="max-h-[60vh] overflow-y-auto py-1">
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">{t("columns.agent")}</th>
                    <th className="px-3 py-2 font-medium">{t("columns.model")}</th>
                    <th className="px-3 py-2 font-medium">{t("columns.connection")}</th>
                    <th className="px-3 py-2 font-medium">{t("columns.tokens30d")}</th>
                    <th className="px-3 py-2 font-medium">{t("columns.cost")}</th>
                    <th className="px-3 py-2 font-medium">{t("columns.trend")}</th>
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
                          {t("manage")}
                        </Button>
                      </td>
                    </tr>
                  ))}
                  {detail.agents.length === 0 && (
                    <tr>
                      <td colSpan={7} className="px-3 py-6 text-center text-muted-foreground">
                        {t("noAgents")}
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
  const { t } = useTranslation("platform");
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
      return [{ id: model, label: t("currentModel", { model }) }, ...opts];
    }
    return opts;
  }, [catalogModels, model, t]);

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
      setError(e instanceof Error ? e.message : t("errors.saveFailed"));
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
            ? t("errors.localRuntimeReset")
            : t("errors.resetUnavailable", { reason: r.reason ?? t("errors.unavailable") })
        );
      } else {
        onDone();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.resetFailed"));
    } finally {
      setBusy(false);
    }
  };

  const byModel = agent?.tokens?.byModel ?? [];

  return (
    <Dialog open={!!agent} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("manageAgent", { name: agent?.displayName ?? "" })}</DialogTitle>
          <DialogDescription>{t("manageAgentHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="agent-backend">{t("backend")}</Label>
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
                {mcBackend ? t("keepCurrentWith", { value: mcBackend }) : t("keepCurrent")}
              </option>
              {providers.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <Label htmlFor="agent-model">{t("columns.model")}</Label>
            <select
              id="agent-model"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              disabled={modelOptions.length === 0}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:opacity-50"
            >
              {modelOptions.length === 0 && <option value="">{t("pickBackendFirst")}</option>}
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
                <ArrowRightLeft className="h-3.5 w-3.5" /> {t("columns.connection")}
              </span>
            </Label>
            <select
              id="agent-conn"
              value={connection}
              onChange={(e) => setConnection(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="local">{t("localOwnersDevice")}</option>
              {hostOptions.map((h) => (
                <option key={h.id} value={h.id}>
                  {t("hostedOn", { name: h.name })}
                  {h.shared ? ` ${t("sharedSuffix")}` : ""}
                </option>
              ))}
            </select>
          </div>

          {byModel.length > 0 && (
            <div className="space-y-1">
              <Label className="text-xs text-muted-foreground">{t("usageByModel")}</Label>
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
              {t("reset")}
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? t("common:saving") : t("common:save")}
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
  const { t } = useTranslation("platform");
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
      setError(e instanceof Error ? e.message : t("errors.setPlanFailed"));
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
      setError(e instanceof Error ? e.message : t("errors.clearPlanFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("planFor", { name: user?.displayName ?? "" })}</DialogTitle>
          <DialogDescription>{t("planForHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="plan-name">{t("plan")}</Label>
            <Input
              id="plan-name"
              value={plan}
              onChange={(e) => setPlan(e.target.value)}
              placeholder="comp / pro / founder…"
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="plan-status">{t("statusLabel")}</Label>
            <select
              id="plan-status"
              value={status}
              onChange={(e) => setStatus(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="active">{t("planStatus.active")}</option>
              <option value="trialing">{t("planStatus.trialing")}</option>
              <option value="past_due">{t("planStatus.pastDue")}</option>
              <option value="canceled">{t("planStatus.canceled")}</option>
            </select>
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="justify-between">
            <Button variant="ghost" onClick={() => void clear()} disabled={busy}>
              {t("clearPlan")}
            </Button>
            <Button onClick={() => void save()} disabled={busy}>
              {busy ? t("common:saving") : t("common:save")}
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
  const { t } = useTranslation("platform");
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
        setError(t("errors.noAgentsToAllocate"));
        return;
      }
      if (res.allocated === 0) {
        const why = res.failed[0]?.reason;
        setError(
          why
            ? t("errors.allocateNoneWithReason", { reason: why })
            : t("errors.allocateNone")
        );
        return;
      }
      if (res.failed.length > 0) {
        setError(
          t("errors.allocatePartial", {
            allocated: res.allocated,
            total: res.total,
            failed: res.failed.length,
            reason: res.failed[0].reason,
          })
        );
        return;
      }
      onDone();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.allocationFailed"));
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
      setError(e instanceof Error ? e.message : t("errors.deallocationFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!user} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("allocateUser", { name: user?.displayName ?? "" })}</DialogTitle>
          <DialogDescription>{t("allocateHint")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-1">
          <div className="space-y-1">
            <Label htmlFor="alloc-host">{t("sharedHost")}</Label>
            <select
              id="alloc-host"
              value={hostId}
              onChange={(e) => setHostId(e.target.value)}
              className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            >
              <option value="">{t("selectSharedHost")}</option>
              {eligible.map((h) => (
                <option key={h.id} value={h.id}>
                  {h.name} ({t(`common:${h.status}`, { defaultValue: h.status })})
                </option>
              ))}
            </select>
            {eligible.length === 0 && (
              <p className="text-xs text-muted-foreground">
                {t("noSharedHosts")}
              </p>
            )}
          </div>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <DialogFooter className="justify-between">
            <Button variant="ghost" onClick={() => void deallocate()} disabled={busy}>
              {t("deallocateAll")}
            </Button>
            <Button onClick={() => void allocate()} disabled={busy || !hostId}>
              {busy ? t("working") : t("allocate")}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ProvisioningTab() {
  const { t } = useTranslation("platform");
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
      .catch((e) => setError(e instanceof Error ? e.message : t("errors.loadCatalog")))
      .finally(() => setLoading(false));
  }, []);

  const provision = async () => {
    if (!name.trim() || !dataCenterId || !templateId || !itemId) {
      setError(t("errors.provisionFieldsRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.adminProvision({ name: name.trim(), itemId, dataCenterId, templateId });
      setDone(t("provisioningStarted", { name: res.host.name }));
      setName("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.provisionFailed"));
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
        <Plus className="h-4 w-4" /> {t("provisionTitle")}
      </div>
      {loading ? (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> {t("loadingCatalog")}
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
            <Label htmlFor="p-name">{t("hostName")}</Label>
            <Input id="p-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="agentgram-2" />
          </div>
          <Sel id="p-dc" label={t("dataCenter")} value={dataCenterId} set={setDataCenterId} opts={catalog?.dataCenters ?? []} fmt={opt} />
          <Sel id="p-tpl" label={t("osTemplate")} value={templateId} set={setTemplateId} opts={catalog?.templates ?? []} fmt={opt} />
          <Sel id="p-plan" label={t("plan")} value={itemId} set={setItemId} opts={catalog?.plans ?? []} fmt={opt} />
          {error && <p className="text-sm text-destructive">{error}</p>}
          <Button onClick={() => void provision()} disabled={submitting}>
            {submitting ? t("provisioning") : t("provision")}
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
  const { t } = useTranslation("platform");
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => set(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">{t("selectPlaceholder")}</option>
        {opts.map((o) => (
          <option key={String(o.id)} value={String(o.id)}>
            {fmt(o)}
          </option>
        ))}
      </select>
    </div>
  );
}
