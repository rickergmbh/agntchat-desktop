import { useEffect, useState } from "react";
import { AlertCircle, Copy as CopyIcon, Loader2, Plus, RefreshCw, Trash2 } from "lucide-react";
import * as api from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface Props {
  /** The workspace whose hosts we manage. */
  orgId: string;
  /** Optional title above the list. Profile.tsx already has its own
   *  SectionHeader; the modal tab passes a title to render inline. */
  title?: string;
  subtitle?: string;
}

/**
 * Reusable hosts CRUD UI: list + register + rotate API key + delete +
 * one-time credentials reveal. Shared between Profile.tsx's
 * Organization section and WorkspaceSettingsModal's Hosts tab so the
 * two surfaces don't drift.
 *
 * Authorization is enforced by the backend (admin/owner only); we
 * just render the UI and let the API return 403 if the caller isn't
 * permitted.
 */
export function HostsManagement({ orgId, title, subtitle }: Props) {
  const [hosts, setHosts] = useState<api.OrganizationHost[]>([]);
  const [hostsLoading, setHostsLoading] = useState(false);
  const [hostsError, setHostsError] = useState<string | null>(null);

  const [hostModalOpen, setHostModalOpen] = useState(false);
  const [hostName, setHostName] = useState("");
  const [registeringHost, setRegisteringHost] = useState(false);
  const [hostError, setHostError] = useState<string | null>(null);
  const [revealedHost, setRevealedHost] = useState<{ id: string; apiKey: string } | null>(null);

  // Re-fetch on org change. Cancellation guard prevents a stale fetch
  // from one workspace overwriting another's results during a switch.
  useEffect(() => {
    let cancelled = false;
    setHostsLoading(true);
    setHostsError(null);
    api
      .listOrganizationHosts(orgId)
      .then((rows) => {
        if (!cancelled) setHosts(rows);
      })
      .catch((e) => {
        if (!cancelled) {
          setHosts([]);
          setHostsError(e instanceof Error ? e.message : "Failed to load hosts");
        }
      })
      .finally(() => {
        if (!cancelled) setHostsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const handleRegisterHost = async () => {
    setHostError(null);
    const trimmed = hostName.trim();
    if (trimmed.length === 0) {
      setHostError("Host name is required.");
      return;
    }
    setRegisteringHost(true);
    try {
      const result = await api.createOrganizationHost(orgId, trimmed);
      setRevealedHost({ id: result.host.id, apiKey: result.apiKey });
      setHostName("");
      const rows = await api.listOrganizationHosts(orgId).catch(() => null);
      if (rows) setHosts(rows);
    } catch (e) {
      setHostError(e instanceof Error ? e.message : "Could not register host");
    } finally {
      setRegisteringHost(false);
    }
  };

  const handleRegenerateHostKey = async (host: api.OrganizationHost) => {
    if (
      !confirm(
        `Regenerate API key for "${host.name}"? The current key stops working immediately. ` +
          `You'll need to update host.env on the VM and restart agentgram-host.`
      )
    ) {
      return;
    }
    try {
      const result = await api.regenerateOrganizationHostApiKey(orgId, host.id);
      setRevealedHost({ id: result.host.id, apiKey: result.apiKey });
      setHostModalOpen(true);
    } catch (e) {
      setHostsError(e instanceof Error ? e.message : "Could not regenerate key");
    }
  };

  const handleDeleteHost = async (host: api.OrganizationHost) => {
    if (
      !confirm(
        `Delete host "${host.name}"? Any agents assigned to this host will stop ` +
          `running there. This can't be undone.`
      )
    ) {
      return;
    }
    try {
      await api.deleteOrganizationHost(orgId, host.id);
      setHosts((prev) => prev.filter((h) => h.id !== host.id));
    } catch (e) {
      setHostsError(e instanceof Error ? e.message : "Could not delete host");
    }
  };

  return (
    <section>
      {title && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {title}
          </h3>
          {subtitle && (
            <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
          )}
        </div>
      )}

      {hostsError && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-md mb-4">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{hostsError}</p>
        </div>
      )}

      {hostsLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : hosts.length === 0 ? (
        <div className="text-sm text-muted-foreground mb-3">
          No hosts registered yet. Register one and follow the install steps
          in <code>host/README.md</code> on your VM.
        </div>
      ) : (
        <ul className="space-y-2 mb-3">
          {hosts.map((h) => (
            <HostRow
              key={h.id}
              host={h}
              onRegenerate={() => void handleRegenerateHostKey(h)}
              onDelete={() => void handleDeleteHost(h)}
            />
          ))}
        </ul>
      )}

      <Button
        variant="outline"
        onClick={() => {
          setHostError(null);
          setRevealedHost(null);
          setHostName("");
          setHostModalOpen(true);
        }}
      >
        <Plus className="w-4 h-4" />
        Register host
      </Button>

      <Dialog
        open={hostModalOpen}
        onOpenChange={(next) => {
          // While the one-time credentials are showing, prevent backdrop /
          // Esc dismissal — losing them here means the user has to delete +
          // recreate the host to recover.
          if (!next && revealedHost) return;
          setHostModalOpen(next);
        }}
      >
        <DialogContent showCloseButton={!revealedHost}>
          <DialogHeader>
            <DialogTitle>
              {revealedHost ? "Host credentials" : "Register host"}
            </DialogTitle>
          </DialogHeader>

          {revealedHost ? (
            <HostCredentialsReveal
              host={revealedHost}
              onClose={() => {
                setRevealedHost(null);
                setHostModalOpen(false);
              }}
            />
          ) : (
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label htmlFor="host-name">Host name</Label>
                <Input
                  id="host-name"
                  value={hostName}
                  onChange={(e) => setHostName(e.target.value)}
                  placeholder="vm-01.lan"
                />
              </div>
              {hostError && (
                <div className="text-sm text-destructive">{hostError}</div>
              )}
              <DialogFooter>
                <Button
                  variant="ghost"
                  onClick={() => setHostModalOpen(false)}
                  disabled={registeringHost}
                >
                  Cancel
                </Button>
                <Button
                  onClick={() => void handleRegisterHost()}
                  disabled={registeringHost}
                >
                  {registeringHost ? "Registering…" : "Register"}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}

function HostRow({
  host,
  onRegenerate,
  onDelete,
}: {
  host: api.OrganizationHost;
  onRegenerate: () => void;
  onDelete: () => void;
}) {
  return (
    <li className="rounded-md border border-border px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="font-medium truncate">{host.name}</div>
          <div className="text-xs text-muted-foreground">
            {host.status}
            {host.hostname ? ` · ${host.hostname}` : ""}
            {host.version ? ` · v${host.version}` : ""}
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "shrink-0",
            host.status === "online" && "border-success/30 text-success bg-success/10",
            host.status === "offline" && "border-muted text-muted-foreground",
            host.status === "disabled" && "border-destructive/30 text-destructive bg-destructive/10"
          )}
        >
          {host.status}
        </Badge>
      </div>

      <div className="flex items-center gap-2 rounded-sm bg-muted/50 px-2 py-1 font-mono text-[11px] text-muted-foreground">
        <span className="text-[10px] uppercase tracking-wide opacity-60">ID</span>
        <span className="flex-1 truncate select-all">{host.id}</span>
        <Button
          variant="ghost"
          size="sm"
          className="h-5 w-5 p-0"
          onClick={() => void navigator.clipboard.writeText(host.id)}
          aria-label="Copy host ID"
        >
          <CopyIcon className="w-3 h-3" />
        </Button>
      </div>

      <div className="flex justify-end gap-1 pt-0.5">
        <Button
          variant="ghost"
          size="sm"
          onClick={onRegenerate}
          title="Generate a new API key (UUID stays the same)"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Rotate key
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={onDelete}
          className="text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="w-3.5 h-3.5" />
          Delete
        </Button>
      </div>
    </li>
  );
}

function HostCredentialsReveal({
  host,
  onClose,
}: {
  host: { id: string; apiKey: string };
  onClose: () => void;
}) {
  const envBlock = `ORG_HOST_ID=${host.id}\nORG_HOST_API_KEY=${host.apiKey}\n`;

  return (
    <div className="space-y-3 py-2">
      <p className="text-sm">
        Copy these now — the API key is shown <strong>once</strong>. The
        host runtime needs both as env vars (see <code>host/README.md</code>).
      </p>

      <CredentialField label="ORG_HOST_ID" value={host.id} />
      <CredentialField label="ORG_HOST_API_KEY" value={host.apiKey} />

      <DialogFooter className="gap-2 pt-2">
        <Button
          variant="outline"
          onClick={() => void navigator.clipboard.writeText(envBlock)}
        >
          <CopyIcon className="w-3.5 h-3.5" />
          Copy as .env
        </Button>
        <Button onClick={onClose}>I&apos;ve copied them</Button>
      </DialogFooter>
    </div>
  );
}

function CredentialField({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1">
      <Label className="text-xs font-mono">{label}</Label>
      <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs break-all">
        <span className="flex-1 select-all">{value}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigator.clipboard.writeText(value)}
          aria-label={`Copy ${label}`}
        >
          <CopyIcon className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
}
