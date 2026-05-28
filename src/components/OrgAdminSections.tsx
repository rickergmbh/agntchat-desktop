import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import * as api from "../lib/api";
import type {
  Organization,
  OrganizationMembership,
  OrganizationProviderConfig,
} from "../lib/api";
import { useModelCatalog, type CatalogProvider } from "../stores/modelCatalogStore";
import { useAuthStore } from "../stores/authStore";

import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";

// Section header is duplicated from Profile.tsx — same shape, kept
// inline so this component can be moved/shared without imports back.
function SectionHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="mb-3">
      <h3 className="text-base font-semibold">{title}</h3>
      {subtitle && <p className="text-sm text-muted-foreground mt-0.5">{subtitle}</p>}
    </div>
  );
}

interface Props {
  org: Organization;
  members: OrganizationMembership[];
}

/**
 * Admin-only management UI for an org: per-provider model catalog
 * overrides. Renders nothing for non-admin members.
 *
 * Invitation management lives in `WorkspaceSettingsModal.InvitesTab`
 * — opened from the gear icon in the workspace switcher — so it isn't
 * duplicated here.
 */
export function OrgAdminSections({ org, members }: Props) {
  const participantId = useAuthStore((s) => s.participant?.id);

  // Compute admin-ness from the members list. The org owner is
  // always an admin; explicit admin role also qualifies.
  const isAdmin = useMemo(() => {
    if (!participantId) return false;
    const me = members.find((m) => m.participantId === participantId);
    return me?.role === "owner" || me?.role === "admin";
  }, [members, participantId]);

  if (!isAdmin) return null;

  return <ProvidersSection orgId={org.id} />;
}

// ---------------------------------------------------------------------------
// Providers (model catalog override)
// ---------------------------------------------------------------------------

function ProvidersSection({ orgId }: { orgId: string }) {
  const catalog = useModelCatalog();
  const [configs, setConfigs] = useState<OrganizationProviderConfig[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    void catalog.ensureLoaded();
  }, [catalog]);

  const refresh = async () => {
    try {
      const rows = await api.listOrganizationProviderConfigs(orgId);
      setConfigs(rows);
    } catch (e) {
      setConfigs([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId]);

  // Index by providerId for quick lookup.
  const configByProvider = useMemo(() => {
    const map = new Map<string, OrganizationProviderConfig>();
    for (const c of configs) map.set(c.providerId, c);
    return map;
  }, [configs]);

  const handleUpsert = async (
    providerId: string,
    patch: Partial<OrganizationProviderConfig>
  ) => {
    try {
      const updated = await api.upsertOrganizationProviderConfig(orgId, providerId, {
        enabled: patch.enabled,
        models: patch.models,
        cliConnection: patch.cliConnection,
      });
      setConfigs((rows) => {
        const existing = rows.findIndex((r) => r.providerId === providerId);
        if (existing >= 0) {
          const next = rows.slice();
          next[existing] = updated;
          return next;
        }
        return [...rows, updated];
      });
    } catch (e) {
      console.warn("upsert provider config failed", e);
    }
  };

  const handleReset = async (providerId: string) => {
    try {
      await api.deleteOrganizationProviderConfig(orgId, providerId);
      setConfigs((rows) => rows.filter((r) => r.providerId !== providerId));
    } catch (e) {
      console.warn("reset provider config failed", e);
    }
  };

  return (
    <section>
      <SectionHeader
        title="LLM providers"
        subtitle="Choose which providers and models your org members can use. Leave a provider unconfigured to allow the global default list."
      />

      {loading || !catalog.loaded ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {catalog.providers.map((provider) => (
            <ProviderRow
              key={provider.id}
              provider={provider}
              config={configByProvider.get(provider.id)}
              onUpsert={(patch) => void handleUpsert(provider.id, patch)}
              onReset={() => void handleReset(provider.id)}
            />
          ))}
        </div>
      )}
    </section>
  );
}

interface ProviderRowProps {
  provider: CatalogProvider;
  config?: OrganizationProviderConfig;
  onUpsert: (patch: Partial<OrganizationProviderConfig>) => void;
  onReset: () => void;
}

function ProviderRow({ provider, config, onUpsert, onReset }: ProviderRowProps) {
  // Local UI state mirrors server state but defers writes until the
  // user toggles a model checkbox or changes the runtime — debounced
  // to avoid flooding the API. We keep it simple: write on every
  // change (orgs have <10 providers and admins don't spam-click).
  const isCli = provider.id === "claude_cli" || provider.id === "codex_cli";
  const enabled = config?.enabled ?? true;
  const cliConnection = config?.cliConnection ?? null;

  // Effective allowed-models set: server config wins; if no config
  // exists, every model in the catalog is allowed.
  const allowedModels = config?.models ?? null;
  const isExplicitlyConfigured = !!config;

  const toggleModel = (modelId: string, on: boolean) => {
    const current = allowedModels ?? provider.models.map((m) => m.id);
    const next = on
      ? Array.from(new Set([...current, modelId]))
      : current.filter((id) => id !== modelId);

    onUpsert({
      enabled,
      models: next,
      cliConnection: isCli ? cliConnection : undefined,
    });
  };

  const toggleEnabled = (on: boolean) => {
    onUpsert({
      enabled: on,
      models: allowedModels ?? provider.models.map((m) => m.id),
      cliConnection: isCli ? cliConnection : undefined,
    });
  };

  const setCliConnection = (next: "anthropic" | "bedrock" | "vertex") => {
    onUpsert({
      enabled,
      models: allowedModels ?? provider.models.map((m) => m.id),
      cliConnection: next,
    });
  };

  return (
    <div className="rounded-md border border-border px-3 py-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Switch
            checked={enabled}
            onCheckedChange={(v: boolean) => toggleEnabled(v)}
          />
          <div className="min-w-0">
            <div className="text-sm font-medium">{provider.label}</div>
            <div className="text-xs text-muted-foreground">
              {isExplicitlyConfigured
                ? `Configured (${(allowedModels ?? []).length} model${
                    (allowedModels ?? []).length === 1 ? "" : "s"
                  })`
                : "Using global default"}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {isCli && enabled && (
            <Select
              value={cliConnection ?? ""}
              onValueChange={(v) =>
                v && setCliConnection(v as "anthropic" | "bedrock" | "vertex")
              }
            >
              <SelectTrigger className="w-32">
                <SelectValue placeholder="Runtime…" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="anthropic">Anthropic API</SelectItem>
                <SelectItem value="bedrock">AWS Bedrock</SelectItem>
                <SelectItem value="vertex">GCP Vertex</SelectItem>
              </SelectContent>
            </Select>
          )}
          {isExplicitlyConfigured && (
            <Button
              variant="ghost"
              size="sm"
              onClick={onReset}
              title="Reset to global default"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      </div>

      {enabled && (
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-1.5">
          {provider.models.map((model) => {
            const allowed =
              allowedModels === null || allowedModels.includes(model.id);
            return (
              <label
                key={model.id}
                className="flex items-center gap-2 text-sm cursor-pointer"
              >
                <Switch
                  size="sm"
                  checked={allowed}
                  onCheckedChange={(v: boolean) => toggleModel(model.id, v)}
                />
                <span className="truncate">{model.label}</span>
              </label>
            );
          })}
        </div>
      )}
    </div>
  );
}
