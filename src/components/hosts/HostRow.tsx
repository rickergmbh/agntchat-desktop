import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import {
  Activity,
  Check,
  ChevronDown,
  ChevronRight,
  DownloadCloud,
  KeyRound,
  Loader2,
  Pencil,
  RefreshCw,
  RotateCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import i18n from "../../i18n";
import * as api from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ClaudeLoginDialog } from "./ClaudeLoginDialog";
import { CopyField, relativeAge } from "./util";

/** Op-log state the row owns, handed to `renderDetail` so the expanded panel
 *  can show the log (and the surface can place it wherever it wants). */
export interface HostRowDetailContext {
  ops: api.HostOperation[];
  opRunning: boolean;
  reloadOps: () => Promise<void>;
  cancelOp: (operationId: string) => Promise<void>;
}

/**
 * The ONE host row used everywhere a managed host is listed — the sidebar
 * Hosts view (FleetView) and the platform-admin Hosts tab (PlatformView).
 * Collapsed header (rename, status badges, counts summary), the SSH
 * lifecycle actions (key/bootstrap/update/restart/Anthropic/seat/probe/delete),
 * the authorize-key dialog, the Claude login dialog, and the op-log state with
 * its live re-poll all live here so the two surfaces cannot drift.
 *
 * Surface differences are injected: each surface passes its own rename and
 * shared-toggle endpoints, the admin adds an org-name summary segment, and
 * each supplies its own expanded panel via `renderDetail`.
 */
export function HostRow({
  host,
  opsOrgId,
  onChanged,
  onRename,
  vm,
  summaryExtras,
  extraBadges,
  onToggleShared,
  renderDetail,
}: {
  host: api.OrganizationHost;
  /** Org id that keys the SSH-op / public-key / delete endpoints — the
   *  caller's org on the fleet view, the host's own org on the admin view. */
  opsOrgId: string;
  onChanged: () => Promise<void> | void;
  /** Persist a rename — the two surfaces hit different endpoints. */
  onRename: (name: string) => Promise<void>;
  /** The provider VM this host runs on, when known — shows the live
   *  power-state next to the host's status. */
  vm?: api.ProviderVm;
  /** Extra ` · `-joined segments inserted into the summary line after the
   *  agent counts (e.g. the admin's user count and org name). */
  summaryExtras?: string[];
  /** Extra badges rendered after the status/VM/Shared badges. */
  extraBadges?: ReactNode;
  /** Persist a shared-flag toggle — the admin uses the cross-org endpoint,
   *  the Hosts view the org-scoped one (backend enforces who may flip it).
   *  When given, the row renders the Shared switch next to its actions. */
  onToggleShared?: (next: boolean) => Promise<void>;
  /** Expanded panel content. Receives the row's op-log state. */
  renderDetail: (ctx: HostRowDetailContext) => ReactNode;
}) {
  const { t } = useTranslation("platform");
  const [expanded, setExpanded] = useState(false);
  const [ops, setOps] = useState<api.HostOperation[]>([]);
  const [busy, setBusy] = useState<api.HostOpKind | "delete" | null>(null);
  const [keyOpen, setKeyOpen] = useState(false);
  const [loginOpen, setLoginOpen] = useState(false);
  const [pubKey, setPubKey] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [nameInput, setNameInput] = useState(host.name);
  const [renameBusy, setRenameBusy] = useState(false);
  // Optimistic shared flag; re-seeded whenever a refresh delivers the host.
  const [shared, setShared] = useState(!!host.shared);
  useEffect(() => setShared(!!host.shared), [host.shared]);

  const bootstrapped = !!host.bootstrappedAt;
  const assigned = host.assignedAgentCount ?? host.agentCount ?? 0;
  const online = host.onlineAgentCount ?? host.runningAgentIds?.length ?? 0;

  const statusLabel = ["online", "offline", "disabled"].includes(host.status)
    ? t(`common:${host.status}`)
    : host.status;

  const reloadOps = useCallback(async () => {
    try {
      setOps(await api.listHostOperations(opsOrgId, host.id));
    } catch {
      // Transient (SSH hiccup / refresh race) — the next poll or expand retries.
    }
  }, [opsOrgId, host.id]);

  useEffect(() => {
    if (expanded) void reloadOps();
  }, [expanded, reloadOps]);

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
    const poll = setInterval(() => void reloadOps(), 4_000);
    const giveUp = setTimeout(() => clearInterval(poll), 300_000);
    return () => {
      clearInterval(poll);
      clearTimeout(giveUp);
    };
  }, [expanded, opRunning, reloadOps]);

  const op = async (kind: api.HostOpKind, confirmMsg?: string) => {
    if (confirmMsg && !confirm(confirmMsg)) return;
    setBusy(kind);
    try {
      await api.runHostOp(opsOrgId, host.id, kind);
      // Surface progress: expand the row and refresh so the running badge + op
      // log appear; the live re-poll keeps it current.
      setExpanded(true);
      await reloadOps();
    } catch (e) {
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.operationFailed"));
    } finally {
      setBusy(null);
    }
  };

  const cancelOp = useCallback(
    async (operationId: string) => {
      await api.cancelHostOperation(opsOrgId, host.id, operationId);
      await reloadOps();
    },
    [opsOrgId, host.id, reloadOps]
  );

  const rename = async () => {
    const trimmed = nameInput.trim();
    if (!trimmed || trimmed === host.name) {
      setEditing(false);
      setNameInput(host.name);
      return;
    }
    setRenameBusy(true);
    try {
      await onRename(trimmed);
      setEditing(false);
      await onChanged();
    } catch (e) {
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.renameHost"));
      setNameInput(host.name);
    } finally {
      setRenameBusy(false);
    }
  };

  const showKey = async () => {
    setKeyOpen(true);
    if (pubKey) return;
    try {
      setPubKey(await api.getHostPublicKey(opsOrgId, host.id));
    } catch (e) {
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.loadPublicKey"));
    }
  };

  const toggleShared = async (next: boolean) => {
    if (!onToggleShared) return;
    setShared(next); // optimistic
    try {
      await onToggleShared(next);
    } catch (e) {
      setShared(!next);
      alert(e instanceof Error ? e.message : i18n.t("platform:errors.updateHost"));
    }
  };

  const handleDelete = async () => {
    if (!confirm(t("hosts.deleteConfirm", { name: host.name }))) return;
    setBusy("delete");
    try {
      await api.deleteOrganizationHost(opsOrgId, host.id);
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
                    host.status === "disabled" &&
                      "border-destructive/30 bg-destructive/10 text-destructive"
                  )}
                >
                  {statusLabel}
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
                {extraBadges}
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
            {host.userCount != null
              ? ` · ${t("hosts.usersCount", { count: host.userCount })}`
              : ""}
            {(summaryExtras ?? []).map((s) => ` · ${s}`).join("")}
            {host.sshHost
              ? ` · ${host.sshUser || "root"}@${host.sshHost}`
              : ` · ${t("hosts.noSshTarget")}`}
            {host.provider
              ? ` · ${host.provider}${host.providerVmId ? ` vm ${host.providerVmId}` : ""}${
                  host.datacenter ? ` (${host.datacenter})` : ""
                }`
              : ""}
            {host.version ? ` · v${host.version}` : ""}
            {host.hostGitSha ? ` · ${host.hostGitSha}` : ""}
            {` · ${t("hosts.seen", { age: relativeAge(host.lastSeenAt) })}`}
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {!bootstrapped && host.sshHost && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void showKey()}
              disabled={busy !== null}
              title={t("hosts.keyHint")}
            >
              <KeyRound className="h-3.5 w-3.5" />
              {t("hosts.key")}
            </Button>
          )}
          {!bootstrapped && host.sshHost && (
            <Button
              variant="default"
              size="sm"
              onClick={() => void op("bootstrap")}
              disabled={busy !== null}
              title={t("hosts.bootstrapHint")}
            >
              {busy === "bootstrap" ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <DownloadCloud className="h-3.5 w-3.5" />
              )}
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
            {busy === "update" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <DownloadCloud className="h-3.5 w-3.5" />
            )}
            {t("common:update")}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void op("restart", t("hosts.restartConfirm", { name: host.name }))}
            disabled={busy !== null || !host.sshHost}
            title={t("hosts.restartHint")}
          >
            {busy === "restart" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <RotateCw className="h-3.5 w-3.5" />
            )}
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
            {busy === "probe" ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Activity className="h-3.5 w-3.5" />
            )}
          </Button>
          {onToggleShared && (
            <label
              className="ml-1 flex items-center gap-1.5 text-xs text-muted-foreground"
              title={t("hosts.sharedHint")}
            >
              {t("hosts.shared")}
              <Switch checked={shared} onCheckedChange={(v) => void toggleShared(v)} />
            </label>
          )}
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
          {renderDetail({ ops, opRunning, reloadOps, cancelOp })}
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
              <>
                <CopyField label={t("hosts.publicKey")} value={pubKey} mono />
                <CopyField
                  label={t("hosts.runOnHost", {
                    target: `${host.sshUser || "root"}@${host.sshHost}`,
                  })}
                  value={`mkdir -p ~/.ssh && echo '${pubKey}' >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys`}
                  mono
                />
                <p className="text-xs text-muted-foreground">
                  {t("hosts.bootstrapRequirements")}
                </p>
              </>
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
        orgId={opsOrgId}
        hostId={host.id}
        hostName={host.name}
        open={loginOpen}
        onOpenChange={setLoginOpen}
      />
    </li>
  );
}
