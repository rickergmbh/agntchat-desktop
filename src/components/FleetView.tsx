import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  Cloud,
  Loader2,
  Plus,
  RefreshCw,
  Server,
  ShieldCheck,
} from "lucide-react";
import { Trans, useTranslation } from "react-i18next";
import * as api from "../lib/api";
import { cn } from "../lib/utils";
import { ws } from "../services/websocket";
import { useAuthStore } from "../stores/authStore";
import { useWorkspaces } from "../stores/workspaceStore";
import { Button } from "@/components/ui/button";
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
import { HostRow } from "./hosts/HostRow";
import { HostList } from "./hosts/HostList";
import { HostPanels } from "./hosts/HostPanels";
import { CopyField } from "./hosts/util";

/**
 * Fleet management for org hosts. Management flows over SSH (the backend
 * connects out to each box to bootstrap/update/restart/etc), so it works for
 * Hostinger VMs and any bring-your-own Linux machine. Live agent counts still
 * come from the host's WebSocket heartbeat.
 */
export function FleetView() {
  const { t } = useTranslation("platform");
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

  const [vms, setVms] = useState<api.ProviderVm[]>([]);
  const [connectOpen, setConnectOpen] = useState(false);
  // Which VM (if any) the "Add host" dialog should preselect.
  const [connectVmId, setConnectVmId] = useState<string | undefined>(undefined);
  const [anthropicOpen, setAnthropicOpen] = useState(false);
  const [provisionOpen, setProvisionOpen] = useState(false);

  const refresh = useCallback(async () => {
    if (!orgId) return;
    // The VM inventory is best-effort (empty when provisioning isn't
    // configured for the org) — same merged hosts+VMs view as the admin tab.
    const [fleetRes, vmsRes] = await Promise.allSettled([
      api.listOrganizationHostFleet(orgId),
      api.listProviderVms(orgId),
    ]);
    if (fleetRes.status === "fulfilled") {
      setHosts(fleetRes.value.hosts);
      setAnthropicConnected(fleetRes.value.anthropicConnected);
      setError(null);
    } else {
      setError(
        fleetRes.reason instanceof Error
          ? fleetRes.reason.message
          : t("fleet.errors.loadFailed")
      );
    }
    setVms(vmsRes.status === "fulfilled" ? vmsRes.value : []);
  }, [orgId, t]);

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
        {t("fleet.loadingWorkspace")}
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-border px-6 py-4">
        <div className="flex items-center gap-2">
          <Server className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-base font-semibold leading-none">{t("fleet.title")}</h1>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("fleet.subtitle")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" size="sm" onClick={() => void refresh()}>
            <RefreshCw className="h-3.5 w-3.5" />
            {t("common:refresh")}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setAnthropicOpen(true)}
            title={t("hosts.connectAnthropicHint")}
          >
            <ShieldCheck
              className={cn(
                "h-3.5 w-3.5",
                anthropicConnected ? "text-success" : "text-muted-foreground"
              )}
            />
            {anthropicConnected ? t("fleet.anthropicConnected") : t("fleet.connectAnthropic")}
          </Button>
          {/* Provisioning buys VPSes on the platform's Hostinger account, so
              it's platform-operator only (backend-enforced too). Everyone
              else self-hosts by connecting their own machine (Add host). */}
          {participant?.platformAdmin && (
            <Button variant="outline" size="sm" onClick={() => setProvisionOpen(true)}>
              <Cloud className="h-3.5 w-3.5" />
              {t("fleet.spinUpVm")}
            </Button>
          )}
          <Button size="sm" onClick={() => setConnectOpen(true)}>
            <Plus className="h-3.5 w-3.5" />
            {t("fleet.addHost")}
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
        ) : (
          <HostList
            hosts={hosts}
            vms={vms}
            canAdd
            onAdd={(vmId) => {
              setConnectVmId(vmId);
              setConnectOpen(true);
            }}
            renderHost={(h, vm) => (
              <HostRow
                host={h}
                opsOrgId={orgId}
                vm={vm}
                onChanged={() => void refresh()}
                onRename={async (name) => {
                  await api.updateHostConnection(orgId, h.id, { name });
                }}
                onToggleShared={async (next) => {
                  await api.updateHostConnection(orgId, h.id, { shared: next });
                }}
                renderDetail={(ctx) => (
                  <HostPanels
                    host={h}
                    ctx={ctx}
                    renderResidents={() => <HostAgentList orgId={orgId} hostId={h.id} />}
                  />
                )}
              />
            )}
            empty={
              <div className="rounded-lg border border-dashed border-border py-12 text-center text-sm text-muted-foreground">
                <Trans
                  i18nKey="fleet.empty"
                  ns="platform"
                  components={{ b: <span className="font-medium" /> }}
                />
              </div>
            }
          />
        )}
      </div>

      <ConnectHostDialog
        orgId={orgId}
        open={connectOpen}
        onOpenChange={(next) => {
          if (!next) setConnectVmId(undefined);
          setConnectOpen(next);
        }}
        onChanged={() => void refresh()}
        initialVmId={connectVmId}
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
      {participant?.platformAdmin && (
        <ProvisionDialog
          orgId={orgId}
          open={provisionOpen}
          onOpenChange={setProvisionOpen}
          onProvisioned={() => void refresh()}
        />
      )}
    </div>
  );
}

function HostAgentList({
  orgId,
  hostId,
}: {
  orgId: string;
  hostId: string;
}) {
  const { t } = useTranslation("platform");
  const [agents, setAgents] = useState<api.HostAgent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Loads on mount — the shared HostRow only mounts this once expanded.
  useEffect(() => {
    let cancelled = false;
    api
      .listHostAgents(orgId, hostId)
      .then((a) => {
        if (!cancelled) setAgents(a);
      })
      .catch((e) => {
        if (!cancelled)
          setError(e instanceof Error ? e.message : t("fleet.errors.detailFailed"));
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, hostId, t]);
  const grouped = useMemo(() => {
    if (!agents) return [];
    const byOwner = new Map<string, { ownerName: string; agents: api.HostAgent[] }>();
    for (const a of agents) {
      const key = a.owner?.id ?? "unknown";
      const name = a.owner?.display_name ?? t("fleet.unknownOwner");
      if (!byOwner.has(key)) byOwner.set(key, { ownerName: name, agents: [] });
      byOwner.get(key)!.agents.push(a);
    }
    return Array.from(byOwner.values()).sort((a, b) =>
      a.ownerName.localeCompare(b.ownerName)
    );
  }, [agents, t]);

  if (error) return <p className="text-sm text-destructive">{error}</p>;
  if (agents === null)
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> {t("fleet.loadingAgents")}
      </div>
    );
  if (agents.length === 0)
    return <p className="text-sm text-muted-foreground">{t("fleet.noAgentsAssigned")}</p>;

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        {t("fleet.agentCount", { count: agents.length })}{" "}
        {t("fleet.acrossOwners", { count: grouped.length })}
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
                    title={a.running ? t("agents:status.running") : t("agents:status.idle")}
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
  const { t } = useTranslation("platform");
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
        // Never preselect a registered VM — it already backs a host, and
        // re-enrolling it would strand that host's agents.
        if (initialVmId) {
          const vm = list.find((v) => v.id === initialVmId && !v.registered);
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
      setError(t("fleet.errors.nameAndHostRequired"));
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
      // The backend refuses to re-enroll a box that already backs a host
      // (typed IP / VM id bypassing the disabled picker rows).
      if ((e as { code?: string })?.code === "host_already_registered") {
        setError(t("fleet.errors.hostAlreadyRegistered"));
      } else {
        setError(e instanceof Error ? e.message : t("fleet.errors.connectFailed"));
      }
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
      setError(e instanceof Error ? e.message : t("fleet.errors.bootstrapFailed"));
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
          <DialogTitle>
            {created ? t("fleet.authorizeBootstrap") : t("fleet.addHost")}
          </DialogTitle>
          <DialogDescription>
            {created
              ? t("fleet.addHostCreatedDescription")
              : t("fleet.addHostDescription")}
          </DialogDescription>
        </DialogHeader>

        {created ? (
          <div className="space-y-3 py-1">
            <p className="text-sm">
              <Trans
                i18nKey="fleet.appendKeyInstruction"
                ns="platform"
                values={{ user: sshUser || "root" }}
                components={{ code: <code /> }}
              />
            </p>
            <CopyField label={t("fleet.publicKey")} value={created.publicKey} mono />
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
                {t("fleet.later")}
              </Button>
              <Button onClick={() => void handleBootstrap()} disabled={bootstrapping}>
                {bootstrapping ? t("fleet.bootstrapping") : t("fleet.bootstrapNow")}
              </Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            {vms.length > 0 && (
              <div className="space-y-1">
                <Label htmlFor="ch-vm">{t("fleet.virtualMachine")}</Label>
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
                  <option value="">{t("fleet.enterHostManually")}</option>
                  {vms.map((v) => (
                    <option key={v.id} value={v.id} disabled={v.registered}>
                      {v.hostname || v.id}
                      {v.ipv4 ? ` — ${v.ipv4}` : ""}
                      {v.state ? ` (${v.state})` : ""}
                      {v.registered ? ` — ${t("fleet.vmAlreadyRegistered")}` : ""}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-muted-foreground">
                  {t("fleet.pickVmHint")}
                </p>
              </div>
            )}
            <div className="space-y-1">
              <Label htmlFor="ch-name">{t("common:name")}</Label>
              <Input
                id="ch-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="agent-host-1"
              />
            </div>
            <div className="grid grid-cols-[1fr_auto_auto] gap-2">
              <div className="space-y-1">
                <Label htmlFor="ch-host">{t("fleet.sshHostIp")}</Label>
                <Input
                  id="ch-host"
                  value={sshHost}
                  onChange={(e) => setSshHost(e.target.value)}
                  placeholder={t("fleet.sshHostPlaceholder")}
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ch-user">{t("fleet.user")}</Label>
                <Input
                  id="ch-user"
                  value={sshUser}
                  onChange={(e) => setSshUser(e.target.value)}
                  className="w-24"
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="ch-port">{t("fleet.port")}</Label>
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
                {t("common:cancel")}
              </Button>
              <Button onClick={() => void handleConnect()} disabled={submitting}>
                {submitting ? t("fleet.connecting") : t("common:continue")}
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
  const { t } = useTranslation("platform");
  const [token, setToken] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSave = async () => {
    const trimmed = token.trim();
    if (!trimmed) {
      setError(t("errors.tokenRequired"));
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
      setError(e instanceof Error ? e.message : t("errors.storeTokenFailed"));
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
          <DialogTitle>{t("connectAnthropic")}</DialogTitle>
          <DialogDescription>{t("connectAnthropicDescription")}</DialogDescription>
        </DialogHeader>

        {done ? (
          <div className="space-y-3 py-1">
            <p className="text-sm">{t("tokenStored")}</p>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t("common:done")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <ol className="list-decimal space-y-1 pl-4 text-sm text-muted-foreground">
              <li>
                {t("anthropicStep1Pre")}{" "}
                <code className="text-foreground">claude setup-token</code>{" "}
                {t("anthropicStep1Post")}
              </li>
              <li>{t("anthropicStep2")}</li>
              <li>{t("anthropicStep3")}</li>
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
                {t("common:cancel")}
              </Button>
              <Button onClick={() => void handleSave()} disabled={submitting}>
                {submitting ? t("common:saving") : t("saveToken")}
              </Button>
            </DialogFooter>
          </div>
        )}
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
  const { t } = useTranslation("platform");
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
          setError(e instanceof Error ? e.message : t("errors.loadCatalog"));
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
      setError(t("errors.provisionFieldsRequired"));
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await api.provisionHost(orgId, { name: name.trim(), itemId, dataCenterId, templateId });
      onProvisioned();
      onOpenChange(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.provisionFailed"));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("fleet.spinUpVm")}</DialogTitle>
          <DialogDescription>{t("fleet.spinUpVmDescription")}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> {t("common:loading")}
          </div>
        ) : error && !catalog ? (
          <div className="space-y-3 py-1">
            <div className="flex items-start gap-2 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
              <AlertCircle className="mt-0.5 h-4 w-4 flex-shrink-0" />
              <p>{error}</p>
            </div>
            <DialogFooter>
              <Button onClick={() => onOpenChange(false)}>{t("common:close")}</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3 py-1">
            <div className="space-y-1">
              <Label htmlFor="prov-name">{t("hostName")}</Label>
              <Input
                id="prov-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="agent-host-2"
              />
            </div>
            <ProvisionSelect
              id="prov-dc"
              label={t("dataCenter")}
              value={dataCenterId}
              onChange={setDataCenterId}
              options={catalog?.dataCenters ?? []}
              optLabel={optLabel}
            />
            <ProvisionSelect
              id="prov-tpl"
              label={t("osTemplate")}
              value={templateId}
              onChange={setTemplateId}
              options={catalog?.templates ?? []}
              optLabel={optLabel}
            />
            <ProvisionSelect
              id="prov-plan"
              label={t("plan")}
              value={itemId}
              onChange={setItemId}
              options={catalog?.plans ?? []}
              optLabel={optLabel}
            />
            {error && <p className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={submitting}>
                {t("common:cancel")}
              </Button>
              <Button onClick={() => void handleProvision()} disabled={submitting}>
                {submitting ? t("provisioning") : t("provision")}
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
  const { t } = useTranslation("platform");
  return (
    <div className="space-y-1">
      <Label htmlFor={id}>{label}</Label>
      <select
        id={id}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
      >
        <option value="">{t("selectPlaceholder")}</option>
        {options.map((o) => (
          <option key={String(o.id)} value={String(o.id)}>
            {optLabel(o)}
          </option>
        ))}
      </select>
    </div>
  );
}
