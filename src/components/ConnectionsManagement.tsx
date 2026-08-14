import { useEffect, useState } from "react";
import { AlertCircle, Globe, Github, Key, Loader2, Trash2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../lib/api";
import { cn } from "../lib/utils";
import { Button } from "@/components/ui/button";

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  google: Globe,
  github: Github,
};

function getProviderIcon(name: string) {
  return PROVIDER_ICONS[name] || Key;
}

type CredentialStatus = api.OrganizationCredential["status"];

const STATUS_CONFIG: Record<CredentialStatus, { labelKey: string; dot: string; text: string }> = {
  active: { labelKey: "connections.status.active", dot: "bg-success", text: "text-muted-foreground" },
  expired: { labelKey: "workspace.connections.status.expired", dot: "bg-warning", text: "text-warning" },
  revoked: { labelKey: "workspace.connections.status.revoked", dot: "bg-destructive", text: "text-destructive" },
  refresh_failed: {
    labelKey: "workspace.connections.status.refreshFailed",
    dot: "bg-destructive",
    text: "text-destructive",
  },
};

interface Props {
  /** The workspace whose integration connections we manage. */
  orgId: string;
  title?: string;
  subtitle?: string;
}

/**
 * Workspace-scoped OAuth connections (Google, GitHub, ...) — every agent
 * acting in this workspace resolves to these ahead of its owner's personal
 * connection. One connection per (workspace, provider), mirrored from
 * `mobile/components/ConnectionsManagement.tsx` and following the same
 * shape as `HostsManagement.tsx` on this client.
 */
export function ConnectionsManagement({ orgId, title, subtitle }: Props) {
  const { t } = useTranslation("settings");
  const [providers, setProviders] = useState<api.ProviderInfo[]>([]);
  const [credentials, setCredentials] = useState<api.OrganizationCredential[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connectingProvider, setConnectingProvider] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    Promise.all([
      api.listProviders().then((r) => r.providers.filter((p) => p.type === "oauth2")),
      api.listOrganizationCredentials(orgId),
    ])
      .then(([providerRows, credentialRows]) => {
        if (cancelled) return;
        setProviders(providerRows);
        setCredentials(credentialRows);
      })
      .catch((e) => {
        if (cancelled) return;
        setProviders([]);
        setCredentials([]);
        setError(e instanceof Error ? e.message : t("workspace.connections.errors.connectFailed"));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, t]);

  async function handleConnect(providerName: string) {
    setConnectingProvider(providerName);
    setError(null);
    try {
      const result = await api.authorizeOrganizationCredential(orgId, providerName);
      if (result.authorizeUrl) {
        window.open(result.authorizeUrl, "_blank", "noopener,noreferrer");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workspace.connections.errors.connectFailed"));
    } finally {
      setConnectingProvider(null);
    }
  }

  async function handleDisconnect(credential: api.OrganizationCredential, providerLabel: string) {
    if (!confirm(t("workspace.connections.disconnectTitle", { provider: providerLabel }))) return;
    try {
      await api.deleteOrganizationCredential(orgId, credential.id);
      setCredentials((prev) => prev.filter((c) => c.id !== credential.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workspace.connections.errors.disconnectFailed"));
    }
  }

  return (
    <section>
      {title && (
        <div className="mb-4">
          <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
            {title}
          </h3>
          {subtitle && <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>}
        </div>
      )}
      {!title && <p className="text-xs text-muted-foreground mb-4">{t("workspace.connections.subtitle")}</p>}

      {error && (
        <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-md mb-4">
          <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
          <p>{error}</p>
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <ul className="space-y-2">
          {providers.map((provider) => {
            const credential = credentials.find((c) => c.provider === provider.name);
            const Icon = getProviderIcon(provider.name);
            const isConnecting = connectingProvider === provider.name;
            const statusConfig = credential ? STATUS_CONFIG[credential.status] : null;

            return (
              <li
                key={provider.name}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2.5"
              >
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
                  <Icon className="h-4 w-4 text-foreground" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="font-medium truncate">{provider.displayName}</div>
                  {statusConfig ? (
                    <div className={cn("flex items-center gap-1.5 text-xs mt-0.5", statusConfig.text)}>
                      <span className={cn("h-1.5 w-1.5 rounded-full", statusConfig.dot)} />
                      {t(statusConfig.labelKey)}
                    </div>
                  ) : (
                    <div className="text-xs text-muted-foreground truncate">{provider.description}</div>
                  )}
                </div>
                {credential ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => void handleDisconnect(credential, provider.displayName)}
                    className="text-destructive hover:bg-destructive/10 hover:text-destructive"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                    {t("common:disconnect")}
                  </Button>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => void handleConnect(provider.name)}
                    disabled={isConnecting}
                  >
                    {isConnecting ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      t("workspace.connections.connect")
                    )}
                  </Button>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
