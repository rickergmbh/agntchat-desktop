import { useEffect, useMemo, useState } from "react";
import { Loader2, Trash2 } from "lucide-react";

import * as api from "../lib/api";
import type { OrganizationProviderConfig } from "../lib/api";
import { useModelCatalog, type CatalogProvider } from "../stores/modelCatalogStore";

import { Button } from "./ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "./ui/select";
import { Switch } from "./ui/switch";

interface Props {
  /** The workspace whose model catalog overrides we manage. */
  orgId: string;
  /** Optional subtitle to render above the list. */
  subtitle?: string;
}

/**
 * Per-org LLM provider catalog override UI. For each provider in the
 * global catalog, an admin can enable/disable the provider for the
 * org and pick which subset of models org members can select. CLI
 * providers (claude_cli, codex_cli) also pick a runtime backend.
 *
 * Authorization is enforced by the backend (admin/owner only); the
 * caller is expected to gate this whole component on role too so we
 * don't show controls that always 403.
 */
export function ProvidersManagement({ orgId, subtitle }: Props) {
  const catalog = useModelCatalog();
  const [configs, setConfigs] = useState<OrganizationProviderConfig[]>([]);
  // The GLOBAL (unfiltered) catalog — NOT catalog.providers, which is
  // participant-filtered to the org's current allow-list and would hide any
  // model not already enabled (so a newly-released model could never be
  // turned on). The admin UI must see every model to configure the allow-list.
  const [globalProviders, setGlobalProviders] = useState<CatalogProvider[]>([]);
  const [loading, setLoading] = useState(true);

  // Re-fetch on org change. Cancellation guard prevents a stale fetch
  // from one workspace overwriting another's results during a switch.
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.listOrganizationProviderConfigs(orgId),
      catalog.fetchGlobalCatalog(),
    ])
      .then(([rows, providers]) => {
        if (!cancelled) {
          setConfigs(rows);
          setGlobalProviders(providers);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setConfigs([]);
          setGlobalProviders([]);
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orgId, catalog]);

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
    <section className="space-y-3">
      {subtitle && (
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <div className="space-y-3">
          {globalProviders.map((provider) => (
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
