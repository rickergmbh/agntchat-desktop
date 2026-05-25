import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore, type ThemePreference } from "../stores/themeStore";
import { isDesignSystemDebugOn, setDesignSystemDebug } from "../lib/designSystemDebug";
import * as api from "../lib/api";
import { useOrgStore } from "../stores/orgStore";
import { cn } from "../lib/utils";
import { PaymentWalletCard } from "./PaymentWalletCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { TooltipProvider } from "@/components/ui/tooltip";
import {
  X,
  LogOut,
  User,
  Link2,
  Mail,
  Github,
  Cloud,
  Database,
  Key,
  Check,
  Loader2,
  AlertCircle,
  ExternalLink,
  Unlink,
  Eye,
  EyeOff,
  Plus,
  Pencil,
  Trash2,
  Globe,
  Brain,
  Building2,
  Copy as CopyIcon,
  CircleCheck,
  CircleX,
  Info,
  Calendar,
  Search,
  Sun,
  Moon,
  Monitor,
  Palette,
} from "lucide-react";
import { deviceTimezone, filterTimezones, formatTimezoneLabel } from "../lib/timezones";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import { PROVIDERS } from "../lib/models";
import { useLlmKeyStore, type LlmApiKey as LlmApiKeyEntry } from "../stores/llmKeyStore";

/** Open a URL in the system browser — Tauri native with window.open fallback. */
function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}

// ---------------------------------------------------------------------------
// Types & constants
// ---------------------------------------------------------------------------

const PROVIDER_ICONS: Record<string, React.ElementType> = {
  google: Globe,
  github: Github,
  flyio: Cloud,
  supabase: Database,
};

/** Google services derived from OAuth scopes. */
const GOOGLE_SERVICES: { scope: string; label: string; icon: React.ElementType }[] = [
  { scope: "gmail.modify", label: "Gmail", icon: Mail },
  { scope: "calendar", label: "Calendar", icon: Calendar },
];

function getProviderIcon(name: string) {
  return PROVIDER_ICONS[name] || Key;
}

type CredentialStatus = api.UserCredential["status"];

const STATUS_CONFIG: Record<
  CredentialStatus,
  { label: string; className: string }
> = {
  active: {
    label: "Connected",
    className: "border-success/30 text-success bg-success/10",
  },
  expired: {
    label: "Expired",
    className: "border-warning/30 text-warning bg-warning/10",
  },
  revoked: {
    label: "Revoked",
    className: "border-destructive/30 text-destructive bg-destructive/10",
  },
  refresh_failed: {
    label: "Refresh Failed",
    className: "border-destructive/30 text-destructive bg-destructive/10",
  },
};

// Sidebar sections
const SECTIONS = [
  { value: "profile", label: "Profile", icon: User },
  { value: "appearance", label: "Appearance", icon: Palette },
  { value: "region", label: "Region", icon: Globe },
  { value: "memory", label: "Memory", icon: Brain },
  { value: "llm-keys", label: "LLM Keys", icon: Key },
  { value: "org", label: "Organization", icon: Building2 },
  { value: "connections", label: "Connections", icon: Link2 },
] as const;

type SectionValue = (typeof SECTIONS)[number]["value"];

// ---------------------------------------------------------------------------
// Custom API persistence
// ---------------------------------------------------------------------------

export interface CustomApi {
  id: string;
  name: string;
  apiKey: string;
  endpoint: string;
}

function loadCustomApis(): CustomApi[] {
  const raw = localStorage.getItem("customApis");
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveCustomApis(apis: CustomApi[]) {
  localStorage.setItem("customApis", JSON.stringify(apis));
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Profile({ onClose }: { onClose: () => void }) {
  const { participant, logout } = useAuthStore();
  const [activeSection, setActiveSection] = useState<SectionValue>("profile");

  // ---- Profile editing state ----
  const [displayName, setDisplayName] = useState(
    participant?.displayName ?? ""
  );
  const [savingName, setSavingName] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [nameSaved, setNameSaved] = useState(false);

  // ---- Integration state ----
  const [providers, setProviders] = useState<api.ProviderInfo[]>([]);
  const [credentials, setCredentials] = useState<api.UserCredential[]>([]);
  const [loadingIntegrations, setLoadingIntegrations] = useState(true);
  const [integrationError, setIntegrationError] = useState<string | null>(null);

  // ---- OAuth polling state ----
  const [connectingProvider, setConnectingProvider] = useState<string | null>(
    null
  );
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const pollCountRef = useRef(0);

  // ---- Token input dialog ----
  const [tokenDialogProvider, setTokenDialogProvider] =
    useState<api.ProviderInfo | null>(null);
  const [tokenValue, setTokenValue] = useState("");
  const [savingToken, setSavingToken] = useState(false);
  const [tokenError, setTokenError] = useState<string | null>(null);

  // ---- Disconnect confirmation dialog ----
  const [disconnectProvider, setDisconnectProvider] = useState<string | null>(
    null
  );
  const [disconnecting, setDisconnecting] = useState(false);

  // ---- Custom API state ----
  const [customApis, setCustomApis] = useState<CustomApi[]>(loadCustomApis);
  const [customApiDialog, setCustomApiDialog] = useState<{
    open: boolean;
    editing?: CustomApi;
  }>({ open: false });
  const [customApiForm, setCustomApiForm] = useState({
    name: "",
    apiKey: "",
    endpoint: "",
  });
  const [customApiError, setCustomApiError] = useState<string | null>(null);
  const [deleteCustomApiId, setDeleteCustomApiId] = useState<string | null>(
    null
  );

  // ---- Fetch providers & credentials on mount ----
  const fetchIntegrations = useCallback(async () => {
    try {
      const [provRes, credRes] = await Promise.all([
        api.listProviders(),
        api.listCredentials(),
      ]);
      setProviders(provRes.providers);
      setCredentials(credRes.credentials);
      setIntegrationError(null);
    } catch (e) {
      setIntegrationError(
        e instanceof Error ? e.message : "Failed to load integrations"
      );
    } finally {
      setLoadingIntegrations(false);
    }
  }, []);

  useEffect(() => {
    fetchIntegrations();
  }, [fetchIntegrations]);

  // Cleanup poll interval on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // Sync displayName when participant changes
  useEffect(() => {
    if (participant?.displayName) {
      setDisplayName(participant.displayName);
    }
  }, [participant?.displayName]);

  // ---- Handlers ----

  const handleSaveName = async () => {
    const trimmed = displayName.trim();
    if (!trimmed || trimmed === participant?.displayName) return;

    setSavingName(true);
    setNameError(null);
    setNameSaved(false);
    try {
      const result = await api.updateProfile({ displayName: trimmed });
      const stored = localStorage.getItem("participant");
      if (stored) {
        try {
          const p = JSON.parse(stored);
          p.displayName = result.participant.displayName;
          localStorage.setItem("participant", JSON.stringify(p));
        } catch {
          // ignore parse errors
        }
      }
      useAuthStore.getState().restoreSession();
      setNameSaved(true);
      setTimeout(() => setNameSaved(false), 2000);
    } catch (e) {
      setNameError(
        e instanceof Error ? e.message : "Failed to update display name"
      );
    } finally {
      setSavingName(false);
    }
  };

  const handleConnectOAuth = async (providerName: string) => {
    setConnectingProvider(providerName);
    try {
      const { authorizeUrl } = await api.authorizeProvider(providerName);
      await openExternal(authorizeUrl);

      pollCountRef.current = 0;
      pollRef.current = setInterval(async () => {
        pollCountRef.current += 1;
        if (pollCountRef.current > 40) {
          if (pollRef.current) clearInterval(pollRef.current);
          setConnectingProvider(null);
          return;
        }
        try {
          const { credentials: updated } = await api.listCredentials();
          const found = updated.find(
            (c) => c.provider === providerName && c.status === "active"
          );
          if (found) {
            setCredentials(updated);
            if (pollRef.current) clearInterval(pollRef.current);
            setConnectingProvider(null);
          }
        } catch {
          // keep polling on transient errors
        }
      }, 3000);
    } catch (e) {
      setConnectingProvider(null);
      setIntegrationError(
        e instanceof Error ? e.message : "Failed to start authorization"
      );
    }
  };

  const handleConnectToken = (provider: api.ProviderInfo) => {
    setTokenDialogProvider(provider);
    setTokenValue("");
    setTokenError(null);
  };

  const handleSubmitToken = async () => {
    if (!tokenDialogProvider || !tokenValue.trim()) return;
    setSavingToken(true);
    setTokenError(null);
    try {
      const { credential } = await api.storeProviderToken(
        tokenDialogProvider.name,
        tokenValue.trim()
      );
      setCredentials((prev) => [
        ...prev.filter((c) => c.provider !== tokenDialogProvider.name),
        credential,
      ]);
      setTokenDialogProvider(null);
      setTokenValue("");
    } catch (e) {
      setTokenError(
        e instanceof Error ? e.message : "Failed to store token"
      );
    } finally {
      setSavingToken(false);
    }
  };

  const handleDisconnect = async () => {
    if (!disconnectProvider) return;
    setDisconnecting(true);
    try {
      await api.disconnectProvider(disconnectProvider);
      setCredentials((prev) =>
        prev.filter((c) => c.provider !== disconnectProvider)
      );
      setDisconnectProvider(null);
    } catch (e) {
      setIntegrationError(
        e instanceof Error ? e.message : "Failed to disconnect"
      );
      setDisconnectProvider(null);
    } finally {
      setDisconnecting(false);
    }
  };

  // ---- Custom API handlers ----

  const openAddCustomApi = () => {
    setCustomApiForm({ name: "", apiKey: "", endpoint: "" });
    setCustomApiError(null);
    setCustomApiDialog({ open: true });
  };

  const openEditCustomApi = (apiEntry: CustomApi) => {
    setCustomApiForm({
      name: apiEntry.name,
      apiKey: apiEntry.apiKey,
      endpoint: apiEntry.endpoint,
    });
    setCustomApiError(null);
    setCustomApiDialog({ open: true, editing: apiEntry });
  };

  const handleSaveCustomApi = () => {
    const { name, apiKey, endpoint } = customApiForm;
    if (!name.trim()) {
      setCustomApiError("Name is required");
      return;
    }
    if (!apiKey.trim()) {
      setCustomApiError("API key is required");
      return;
    }
    if (!endpoint.trim()) {
      setCustomApiError("Service endpoint is required");
      return;
    }

    const entry: CustomApi = {
      id: customApiDialog.editing?.id || crypto.randomUUID(),
      name: name.trim(),
      apiKey: apiKey.trim(),
      endpoint: endpoint.trim(),
    };

    const updated = customApiDialog.editing
      ? customApis.map((a) => (a.id === entry.id ? entry : a))
      : [...customApis, entry];

    setCustomApis(updated);
    saveCustomApis(updated);
    setCustomApiDialog({ open: false });
  };

  const handleDeleteCustomApi = () => {
    if (!deleteCustomApiId) return;
    const updated = customApis.filter((a) => a.id !== deleteCustomApiId);
    setCustomApis(updated);
    saveCustomApis(updated);
    setDeleteCustomApiId(null);
  };

  // ---- Helpers ----

  function getCredentialForProvider(
    providerName: string
  ): api.UserCredential | undefined {
    return credentials.find((c) => c.provider === providerName);
  }

  const nameChanged =
    displayName.trim() !== "" &&
    displayName.trim() !== participant?.displayName;

  // Filter out "custom" provider from the backend list (we manage it ourselves).
  // Also exclude LLM-key providers — they live in the dedicated LLM Keys tab
  // so users have a single home for them. Connections is for service
  // integrations (Gmail/Calendar/Drive/GitHub/etc.), not raw model keys.
  const LLM_PROVIDER_NAMES = new Set(["anthropic", "openai"]);
  const standardProviders = providers.filter(
    (p) =>
      p.name !== "custom" &&
      p.name !== "custom_api" &&
      !LLM_PROVIDER_NAMES.has(p.name)
  );

  // ---- Render ----

  return (
    <div className="flex h-full">
      {/* Vertical icon sidebar — matches AgentConfig */}
      <TooltipProvider delay={300}>
        <div className="w-12 border-r border-border bg-muted/30 flex flex-col items-center py-3 gap-1 flex-shrink-0">
          {/* User avatar at top */}
          <div className="mb-2">
            <Avatar className="h-8 w-8 rounded-lg">
              {participant?.avatarUrl && (
                <AvatarImage src={participant.avatarUrl} className="rounded-lg" />
              )}
              <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
                <User className="w-3.5 h-3.5" />
              </AvatarFallback>
            </Avatar>
          </div>

          <Separator className="w-6 mb-1" />

          {SECTIONS.map((section) => (
            <Tooltip key={section.value}>
              <TooltipTrigger
                render={
                  <button
                    onClick={() => setActiveSection(section.value)}
                    className={cn(
                      "w-8 h-8 rounded-md flex items-center justify-center transition-colors",
                      activeSection === section.value
                        ? "bg-primary/10 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-accent"
                    )}
                  >
                    <section.icon className="w-4 h-4" />
                  </button>
                }
              />
              <TooltipContent side="right" className="text-xs">
                {section.label}
              </TooltipContent>
            </Tooltip>
          ))}

          {/* Close button at bottom */}
          <div className="mt-auto">
            <Tooltip>
              <TooltipTrigger
                render={
                  <button
                    onClick={onClose}
                    className="w-8 h-8 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
                }
              />
              <TooltipContent side="right" className="text-xs">
                Close
              </TooltipContent>
            </Tooltip>
          </div>
        </div>
      </TooltipProvider>

      {/* Content panel */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="px-5 py-3 border-b border-border flex items-center gap-2.5 flex-shrink-0">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold truncate">
              {SECTIONS.find((s) => s.value === activeSection)?.label}
            </h2>
            <p className="text-[11px] text-muted-foreground truncate">
              {participant?.email}
            </p>
          </div>
        </div>

        {/* Section content */}
        {activeSection === "profile" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Display name */}
            <div className="space-y-1.5">
              <Label className="text-xs">Display Name</Label>
              <div className="flex gap-2">
                <Input
                  value={displayName}
                  onChange={(e) => {
                    setDisplayName(e.target.value);
                    setNameError(null);
                    setNameSaved(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && nameChanged) handleSaveName();
                  }}
                  placeholder="Your display name"
                  className="flex-1"
                />
                <Button
                  size="sm"
                  onClick={handleSaveName}
                  disabled={!nameChanged || savingName}
                >
                  {savingName ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : nameSaved ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
              {nameError && (
                <p className="text-xs text-destructive">{nameError}</p>
              )}
              {nameSaved && (
                <p className="text-xs text-success">Name updated</p>
              )}
            </div>

            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <Label className="text-xs">Email</Label>
              <Input
                value={participant?.email ?? ""}
                readOnly
                className="text-muted-foreground bg-muted/30"
              />
            </div>

            {/* Sign out */}
            <Separator />
            <Button
              variant="outline"
              size="sm"
              onClick={logout}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive/90"
            >
              <LogOut className="w-3.5 h-3.5" />
              Sign Out
            </Button>
          </div>
        )}

        {activeSection === "appearance" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <AppearanceSection />
          </div>
        )}

        {activeSection === "region" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <TimezoneSection />
          </div>
        )}

        {activeSection === "memory" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {loadingIntegrations ? (
              <div className="flex items-center justify-center py-10">
                <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <MemorySection
                credentials={credentials}
                onRefreshCredentials={fetchIntegrations}
              />
            )}
          </div>
        )}

        {activeSection === "llm-keys" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <LlmApiKeysSection />
          </div>
        )}

        {activeSection === "org" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <OrganizationSection />
          </div>
        )}

        {activeSection === "connections" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Connected Accounts */}
            <section>
              <SectionHeader
                title="Connected Accounts"
                subtitle="Link external services to enable agent integrations"
              />

              {integrationError && (
                <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-md mb-4">
                  <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                  <p>{integrationError}</p>
                </div>
              )}

              {loadingIntegrations ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
                </div>
              ) : standardProviders.length === 0 && customApis.length === 0 ? (
                <div className="rounded-md border border-dashed border-border p-6 text-center">
                  <Link2 className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm text-muted-foreground">
                    No integration providers available
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  {standardProviders.map((provider) => {
                    const credential = getCredentialForProvider(provider.name);
                    const isConnecting = connectingProvider === provider.name;
                    const Icon = getProviderIcon(provider.name);

                    return (
                      <ProviderCard
                        key={provider.name}
                        provider={provider}
                        credential={credential}
                        icon={Icon}
                        isConnecting={isConnecting}
                        onConnectOAuth={() => handleConnectOAuth(provider.name)}
                        onConnectToken={() => handleConnectToken(provider)}
                        onDisconnect={() =>
                          setDisconnectProvider(provider.name)
                        }
                      />
                    );
                  })}
                </div>
              )}
              <div className="mt-2">
                <PaymentWalletCard />
              </div>
            </section>

            <Separator />

            {/* Custom APIs */}
            <section>
              <SectionHeader
                title="Custom APIs"
                subtitle="Connect custom service endpoints for agent use"
              />

              {customApis.length > 0 && (
                <div className="space-y-2 mb-3">
                  {customApis.map((entry) => (
                    <div
                      key={entry.id}
                      className="rounded-lg border border-border bg-card p-3.5"
                    >
                      <div className="flex items-center gap-3">
                        <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0 bg-primary/10">
                          <Globe className="w-4.5 h-4.5 text-primary" />
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium truncate">
                            {entry.name}
                          </p>
                          <p className="text-xs text-muted-foreground truncate mt-0.5">
                            {entry.endpoint}
                          </p>
                        </div>
                        <div className="flex items-center gap-1 flex-shrink-0">
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            onClick={() => openEditCustomApi(entry)}
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            className="text-destructive hover:text-destructive/90"
                            onClick={() => setDeleteCustomApiId(entry.id)}
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </Button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              <Button
                variant="outline"
                size="sm"
                className="w-full"
                onClick={openAddCustomApi}
              >
                <Plus className="w-3.5 h-3.5" />
                Add Custom API
              </Button>
            </section>
          </div>
        )}
      </div>

      {/* ================================================================= */}
      {/* TOKEN INPUT DIALOG                                                */}
      {/* ================================================================= */}
      <Dialog
        open={!!tokenDialogProvider}
        onOpenChange={(open) => {
          if (!open) {
            setTokenDialogProvider(null);
            setTokenValue("");
            setTokenError(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              Connect {tokenDialogProvider?.displayName}
            </DialogTitle>
            <DialogDescription>
              {tokenDialogProvider?.description ??
                `Enter your API token to connect ${tokenDialogProvider?.displayName}.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">API Token</Label>
              <Input
                type="password"
                value={tokenValue}
                onChange={(e) => {
                  setTokenValue(e.target.value);
                  setTokenError(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && tokenValue.trim())
                    handleSubmitToken();
                }}
                placeholder="Paste your API token..."
                autoFocus
              />
              {tokenError && (
                <p className="text-xs text-destructive">{tokenError}</p>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                setTokenDialogProvider(null);
                setTokenValue("");
                setTokenError(null);
              }}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitToken}
              disabled={!tokenValue.trim() || savingToken}
            >
              {savingToken ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Connecting...
                </>
              ) : (
                "Connect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* DISCONNECT CONFIRMATION DIALOG                                    */}
      {/* ================================================================= */}
      <Dialog
        open={!!disconnectProvider}
        onOpenChange={(open) => {
          if (!open) setDisconnectProvider(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Disconnect Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to disconnect{" "}
              <span className="font-medium text-foreground">
                {providers.find((p) => p.name === disconnectProvider)
                  ?.displayName ?? disconnectProvider}
              </span>
              ? Agents will no longer be able to use this integration.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDisconnectProvider(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  Disconnecting...
                </>
              ) : (
                "Disconnect"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* ADD / EDIT CUSTOM API DIALOG                                      */}
      {/* ================================================================= */}
      <Dialog
        open={customApiDialog.open}
        onOpenChange={(open) => {
          if (!open) setCustomApiDialog({ open: false });
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {customApiDialog.editing ? "Edit Custom API" : "Add Custom API"}
            </DialogTitle>
            <DialogDescription>
              Configure a custom service endpoint your agents can use.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">Name</Label>
              <Input
                value={customApiForm.name}
                onChange={(e) => {
                  setCustomApiForm((f) => ({ ...f, name: e.target.value }));
                  setCustomApiError(null);
                }}
                placeholder="e.g. My Weather API"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Service Endpoint</Label>
              <Input
                value={customApiForm.endpoint}
                onChange={(e) => {
                  setCustomApiForm((f) => ({ ...f, endpoint: e.target.value }));
                  setCustomApiError(null);
                }}
                placeholder="https://api.example.com/v1"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">API Key</Label>
              <Input
                type="password"
                value={customApiForm.apiKey}
                onChange={(e) => {
                  setCustomApiForm((f) => ({ ...f, apiKey: e.target.value }));
                  setCustomApiError(null);
                }}
                placeholder="Your API key"
                className="font-mono text-xs"
              />
            </div>
            {customApiError && (
              <p className="text-xs text-destructive">{customApiError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCustomApiDialog({ open: false })}
            >
              Cancel
            </Button>
            <Button size="sm" onClick={handleSaveCustomApi}>
              {customApiDialog.editing ? "Save" : "Add"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* DELETE CUSTOM API CONFIRMATION                                     */}
      {/* ================================================================= */}
      <Dialog
        open={!!deleteCustomApiId}
        onOpenChange={(open) => {
          if (!open) setDeleteCustomApiId(null);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Delete Custom API</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete{" "}
              <span className="font-medium text-foreground">
                {customApis.find((a) => a.id === deleteCustomApiId)?.name}
              </span>
              ? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteCustomApiId(null)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteCustomApi}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Appearance — light / dark / system theme preference
// ---------------------------------------------------------------------------

const THEME_OPTIONS: {
  value: ThemePreference;
  label: string;
  description: string;
  icon: React.ElementType;
}[] = [
  { value: "light", label: "Light", description: "Always light", icon: Sun },
  { value: "dark", label: "Dark", description: "Always dark", icon: Moon },
  { value: "system", label: "System", description: "Match OS setting", icon: Monitor },
];

function TimezoneSection() {
  const participant = useAuthStore((s) => s.participant);
  const current = participant?.timezone || "Etc/UTC";
  const browserTz = deviceTimezone();
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState<string | null>(null);

  const items = filterTimezones(query);

  const apply = useCallback(async (tz: string) => {
    setSaving(tz);
    try {
      const res = await api.request<{ timezone: string }>("/api/me/timezone", {
        method: "PUT",
        body: JSON.stringify({ timezone: tz }),
      });
      const cur = useAuthStore.getState().participant;
      if (cur) {
        const next = { ...cur, timezone: res.timezone };
        localStorage.setItem("participant", JSON.stringify(next));
        useAuthStore.setState({ participant: next });
      }
      setQuery("");
    } catch (err) {
      console.warn("[Tz] update failed:", err);
    } finally {
      setSaving(null);
    }
  }, []);

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">Current timezone</Label>
        <p className="mt-1 text-sm font-medium">{formatTimezoneLabel(current)}</p>
        <p className="text-[11px] text-muted-foreground">{current}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Drives how agents interpret &ldquo;today&rdquo; and &ldquo;tomorrow&rdquo;, and the
          local time used by routine schedules. Auto-detected from your device on
          login — change it here if it&rsquo;s wrong or you&rsquo;re traveling.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search timezones (e.g. New York, Tokyo)"
            className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        {!query && browserTz && browserTz !== current && (
          <button
            type="button"
            onClick={() => apply(browserTz)}
            disabled={!!saving}
            className="flex w-full items-center gap-3 border-b border-border bg-primary/5 px-3 py-2.5 text-left transition-colors hover:bg-primary/10"
          >
            <Monitor className="h-4 w-4 text-primary" />
            <div className="flex-1">
              <p className="text-sm font-medium text-primary">Use device timezone</p>
              <p className="text-[11px] text-muted-foreground">{browserTz}</p>
            </div>
            {saving === browserTz && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </button>
        )}

        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              No timezones match &ldquo;{query}&rdquo;
            </p>
          ) : (
            items.slice(0, 200).map((tz) => {
              const selected = tz === current;
              return (
                <button
                  key={tz}
                  type="button"
                  onClick={() => apply(tz)}
                  disabled={!!saving}
                  className={cn(
                    "flex w-full items-center justify-between border-b border-border/40 px-3 py-2 text-left transition-colors last:border-b-0 hover:bg-muted/50",
                    selected && "bg-muted/30"
                  )}
                >
                  <div className="min-w-0">
                    <p className="text-sm">{formatTimezoneLabel(tz)}</p>
                    <p className="truncate text-[11px] text-muted-foreground">{tz}</p>
                  </div>
                  {selected ? (
                    <Check className="h-3.5 w-3.5 shrink-0 text-primary" />
                  ) : saving === tz ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : null}
                </button>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function AppearanceSection() {
  const preference = useThemeStore((s) => s.preference);
  const resolved = useThemeStore((s) => s.resolved);
  const setPreference = useThemeStore((s) => s.setPreference);
  const [dsDebug, setDsDebug] = useState(() => isDesignSystemDebugOn());

  const toggleDsDebug = () => {
    const next = !dsDebug;
    setDesignSystemDebug(next);
    setDsDebug(next);
  };

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs">Theme</Label>
        <p className="text-[11px] text-muted-foreground">
          Currently showing <span className="font-medium capitalize">{resolved}</span>
          {preference === "system" && " (from system)"}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {THEME_OPTIONS.map((opt) => {
          const Icon = opt.icon;
          const selected = preference === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPreference(opt.value)}
              className={cn(
                "flex flex-col items-center gap-1.5 rounded-lg border px-3 py-3 text-xs transition-colors",
                "hover:bg-muted/50",
                selected
                  ? "border-primary bg-primary/10 text-foreground"
                  : "border-border text-muted-foreground"
              )}
              aria-pressed={selected}
            >
              <Icon className="h-4 w-4" />
              <span className="font-medium text-foreground">{opt.label}</span>
              <span className="text-[10px] text-muted-foreground">{opt.description}</span>
            </button>
          );
        })}
      </div>

      {/* Design-system debug — flips every tokenized color/radius/shadow to
       *  a garish override so hardcoded values visually stand out. */}
      <button
        type="button"
        onClick={toggleDsDebug}
        className={cn(
          "flex w-full items-center justify-between rounded-lg border px-3 py-2.5 text-xs transition-colors",
          "hover:bg-muted/50",
          dsDebug ? "border-primary bg-primary/10" : "border-border"
        )}
        aria-pressed={dsDebug}
      >
        <span className="flex items-center gap-2">
          <Palette className="h-4 w-4 text-muted-foreground" />
          <span className="flex flex-col items-start">
            <span className="font-medium text-foreground">Design-system debug</span>
            <span className="text-[10px] text-muted-foreground">Also toggles with ⌘⇧D</span>
          </span>
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold",
            dsDebug ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          {dsDebug ? "ON" : "OFF"}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LLM API Keys — multiple named keys per provider with defaults
// ---------------------------------------------------------------------------

function LlmApiKeysSection() {
  const keys = useLlmKeyStore((s) => s.keys);
  const loading = useLlmKeyStore((s) => s.loading);
  const loaded = useLlmKeyStore((s) => s.loaded);
  const error = useLlmKeyStore((s) => s.error);
  const refresh = useLlmKeyStore((s) => s.refresh);
  const addKey = useLlmKeyStore((s) => s.addKey);
  const updateKey = useLlmKeyStore((s) => s.updateKey);
  const removeKey = useLlmKeyStore((s) => s.removeKey);
  const setDefault = useLlmKeyStore((s) => s.setDefault);

  const [adding, setAdding] = useState<string | null>(null); // provider id being added to
  const [newLabel, setNewLabel] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [editing, setEditing] = useState<string | null>(null); // key id being edited
  const [editLabel, setEditLabel] = useState("");
  const [editApiKey, setEditApiKey] = useState("");
  const [saved, setSaved] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [opError, setOpError] = useState<string | null>(null);

  const providersWithKeys = PROVIDERS.filter((p) => p.requiresLlmKey);

  // Pull from the backend every time the section mounts (not just the
  // first time). Avoids the failure mode where a stale Zustand
  // snapshot — e.g. preserved across Vite HMR or carried over from a
  // partial migration — would hold ids the backend doesn't have, which
  // surfaces as a confusing "I clicked delete and nothing happened" UX.
  // The migration shim short-circuits via `MIGRATION_DONE_KEY` so this
  // is a normal list call after the first launch.
  useEffect(() => {
    refresh();
  }, [refresh]);

  const flashSaved = (id: string) => {
    setSaved(id);
    setTimeout(() => setSaved(null), 1500);
  };

  const handleStartAdd = (providerId: string) => {
    const count = keys.filter((k) => k.provider === providerId).length;
    const providerLabel = providersWithKeys.find((p) => p.id === providerId)?.label || providerId;
    setNewLabel(`${providerLabel} ${count + 1}`);
    setNewApiKey("");
    setOpError(null);
    setAdding(providerId);
  };

  const handleConfirmAdd = async () => {
    if (!adding || !newApiKey.trim()) return;
    const label =
      newLabel.trim() || `Key ${keys.filter((k) => k.provider === adding).length + 1}`;
    setBusy("adding");
    setOpError(null);
    try {
      const id = await addKey(adding, label, newApiKey.trim());
      flashSaved(id);
      setAdding(null);
      setNewLabel("");
      setNewApiKey("");
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "Failed to save key");
    } finally {
      setBusy(null);
    }
  };

  const handleStartEdit = (key: LlmApiKeyEntry) => {
    setEditing(key.id);
    setEditLabel(key.label);
    setEditApiKey(""); // never populate; rotation requires a fresh value.
    setOpError(null);
  };

  const handleConfirmEdit = async () => {
    if (!editing) return;
    setBusy(editing);
    setOpError(null);
    try {
      await updateKey(editing, {
        label: editLabel.trim() || undefined,
        apiKey: editApiKey.trim() || undefined,
      });
      flashSaved(editing);
      setEditing(null);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "Failed to update key");
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (id: string) => {
    setBusy(id);
    setOpError(null);
    try {
      await removeKey(id);
      setConfirmDelete(null);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "Failed to delete key");
    } finally {
      setBusy(null);
    }
  };

  const handleSetDefault = async (provider: string, keyId: string) => {
    setBusy(keyId);
    setOpError(null);
    try {
      await setDefault(provider, keyId);
    } catch (e) {
      setOpError(e instanceof Error ? e.message : "Failed to set default");
    } finally {
      setBusy(null);
    }
  };

  const keyPlaceholder = (providerId: string) => {
    switch (providerId) {
      case "anthropic": return "sk-ant-...";
      case "openai": return "sk-...";
      case "xai": return "xai-...";
      default: return "API key";
    }
  };

  return (
    <section>
      <SectionHeader
        title="LLM API Keys"
        subtitle="Manage multiple keys per provider. The default key is used by all agents unless overridden."
      />
      {opError && (
        <div className="mb-4 flex items-start gap-2 text-xs text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2 rounded-md">
          <AlertCircle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <p>{opError}</p>
        </div>
      )}
      <div className="space-y-5">
        {loading && !loaded ? (
          <div className="flex items-center justify-center py-8">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          providersWithKeys.map((provider) => {
            const providerKeys = keys.filter((k) => k.provider === provider.id);

            return (
              <div key={provider.id} className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Label className="text-sm font-medium">{provider.label}</Label>
                    <Badge variant="secondary" className="text-[10px] py-0">
                      {providerKeys.length} key{providerKeys.length !== 1 ? "s" : ""}
                    </Badge>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => handleStartAdd(provider.id)}
                    className="h-7 text-xs"
                  >
                    <Plus className="w-3 h-3" />
                    Add Key
                  </Button>
                </div>

                {/* Add key form */}
                {adding === provider.id && (
                  <div className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                    <div className="space-y-1.5">
                      <Label className="text-xs">Label</Label>
                      <Input
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                        placeholder="e.g. Work, Personal, Project X"
                        className="text-xs"
                        autoFocus
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs">API Key</Label>
                      <Input
                        type="password"
                        value={newApiKey}
                        onChange={(e) => setNewApiKey(e.target.value)}
                        placeholder={keyPlaceholder(provider.id)}
                        className="font-mono text-xs"
                      />
                    </div>
                    <div className="flex gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={handleConfirmAdd}
                        disabled={!newApiKey.trim() || busy === "adding"}
                        className="h-7 text-xs"
                      >
                        {busy === "adding" ? (
                          <Loader2 className="w-3 h-3 animate-spin" />
                        ) : (
                          <Check className="w-3 h-3" />
                        )}
                        Add
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setAdding(null)} className="h-7 text-xs">
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}

                {/* Key list */}
                {providerKeys.length === 0 && adding !== provider.id && (
                  <p className="text-xs text-muted-foreground pl-1">No keys configured</p>
                )}

                {providerKeys.map((key) => {
                  const isDefault = key.isDefault;
                  const isEditing = editing === key.id;
                  const isSaved = saved === key.id;
                  const isBusy = busy === key.id;

                  if (isEditing) {
                    return (
                      <div key={key.id} className="rounded-lg border border-primary/30 bg-primary/5 p-3 space-y-2">
                        <div className="space-y-1.5">
                          <Label className="text-xs">Label</Label>
                          <Input
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            className="text-xs"
                            autoFocus
                          />
                        </div>
                        <div className="space-y-1.5">
                          <Label className="text-xs">Rotate API key (optional)</Label>
                          <Input
                            type="password"
                            value={editApiKey}
                            onChange={(e) => setEditApiKey(e.target.value)}
                            placeholder={`${keyPlaceholder(provider.id)} — leave blank to keep current`}
                            className="font-mono text-xs"
                          />
                          <p className="text-[11px] text-muted-foreground">
                            Stored encrypted on the backend. We never display the value back.
                          </p>
                        </div>
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={handleConfirmEdit}
                            disabled={isBusy}
                            className="h-7 text-xs"
                          >
                            {isBusy ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <Check className="w-3 h-3" />
                            )}
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setEditing(null)} className="h-7 text-xs">
                            Cancel
                          </Button>
                        </div>
                      </div>
                    );
                  }

                  return (
                    <div
                      key={key.id}
                      className={cn(
                        "rounded-lg border p-3 transition-colors",
                        isDefault ? "border-primary/30 bg-primary/5" : "border-border bg-card"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-sm font-medium truncate">{key.label}</span>
                            {isDefault && (
                              <Badge variant="secondary" className="text-[10px] py-0 bg-primary/10 text-primary">
                                Default
                              </Badge>
                            )}
                            {key.status === "revoked" && (
                              <Badge variant="secondary" className="text-[10px] py-0 bg-destructive/10 text-destructive">
                                Revoked
                              </Badge>
                            )}
                            {isSaved && (
                              <Badge variant="secondary" className="text-[10px] py-0">
                                <Check className="w-3 h-3 mr-0.5" />
                                Saved
                              </Badge>
                            )}
                          </div>
                          <p className="text-[11px] text-muted-foreground mt-1">
                            Stored encrypted on the backend. Rotate to update.
                          </p>
                        </div>

                        <div className="flex items-center gap-1 flex-shrink-0">
                          {!isDefault && (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleSetDefault(provider.id, key.id)}
                              disabled={isBusy}
                              className="h-7 text-xs text-muted-foreground"
                              title="Set as default"
                            >
                              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Set Default"}
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-7 w-7 text-muted-foreground hover:text-foreground"
                            onClick={() => handleStartEdit(key)}
                            disabled={isBusy}
                            title="Edit / rotate"
                          >
                            <Pencil className="w-3 h-3" />
                          </Button>
                          {confirmDelete === key.id ? (
                            <div className="flex items-center gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs text-destructive hover:text-destructive/90"
                                onClick={() => handleDelete(key.id)}
                                disabled={isBusy}
                              >
                                {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : "Confirm"}
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-7 text-xs"
                                onClick={() => setConfirmDelete(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          ) : (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-destructive/90"
                              onClick={() => setConfirmDelete(key.id)}
                              disabled={isBusy}
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })
        )}
        {error && !loading && (
          <p className="text-xs text-destructive">{error}</p>
        )}
        <p className="text-xs text-muted-foreground">
          The default key for each provider is used by all agents automatically.
          You can override which key an agent uses in that agent's config, or
          enter a custom key there.
        </p>
      </div>
    </section>
  );
}


// ---------------------------------------------------------------------------
// Memory Section
// ---------------------------------------------------------------------------

function MemorySection({
  credentials,
  onRefreshCredentials,
}: {
  credentials: api.UserCredential[];
  onRefreshCredentials: () => Promise<void>;
}) {
  const openaiCred = credentials.find((c) => c.provider === "openai");
  const isConnected = openaiCred?.status === "active";
  const isRevoked = openaiCred?.status === "revoked";
  const isFailed = openaiCred?.status === "refresh_failed";
  const hasIssue = isRevoked || isFailed;

  const [apiKey, setApiKey] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [showKey, setShowKey] = useState(false);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);

  const handleSaveKey = async () => {
    if (!apiKey.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.storeProviderToken("openai", apiKey.trim());
      setApiKey("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      await onRefreshCredentials();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save API key");
    } finally {
      setSaving(false);
    }
  };

  const handleDisconnect = async () => {
    setDisconnecting(true);
    try {
      await api.disconnectProvider("openai");
      setConfirmDisconnect(false);
      await onRefreshCredentials();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to disconnect");
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <>
      {/* Explainer */}
      <section>
        <SectionHeader
          title="Semantic Memory"
          subtitle="How your agents remember and recall information"
        />

        <div className="rounded-lg border border-border bg-card p-4 space-y-3">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 mt-0.5">
              <Brain className="w-4.5 h-4.5 text-primary" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium">How it works</p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Your agents store memories as they learn about you — preferences,
                facts, decisions. Semantic memory uses AI embeddings to understand
                the <em>meaning</em> of those memories, not just keywords.
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                This means when you ask about "scheduling meetings", your agent
                can recall "prefers mornings before 10am" — even though those
                phrases share no words.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Status */}
      <section>
        <SectionHeader title="Status" />

        <div
          className={cn(
            "rounded-lg border p-3.5 flex items-center gap-3",
            isConnected
              ? "border-border bg-card"
              : hasIssue
                ? "border-destructive/30 bg-destructive/5"
                : "border-dashed border-border bg-muted/20"
          )}
        >
          {isConnected ? (
            <CircleCheck className="w-5 h-5 text-success flex-shrink-0" />
          ) : hasIssue ? (
            <AlertCircle className="w-5 h-5 text-destructive flex-shrink-0" />
          ) : (
            <CircleX className="w-5 h-5 text-muted-foreground flex-shrink-0" />
          )}

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium">
              {isConnected
                ? "Semantic memory is active"
                : hasIssue
                  ? "Semantic memory has an issue"
                  : "Semantic memory is not configured"}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isConnected
                ? "Agents are using AI embeddings for smarter memory recall."
                : hasIssue
                  ? isRevoked
                    ? "Your OpenAI API key was revoked — it may be invalid or out of funds."
                    : "Your OpenAI API key failed. Check your account balance or replace the key."
                  : "Without an embedding provider, agents use keyword-only search to recall memories. This works but misses semantically related memories."}
            </p>
          </div>

          {isConnected && (
            <Badge
              variant="outline"
              className="border-success/30 text-success bg-success/10 text-[10px] py-0 flex-shrink-0"
            >
              Active
            </Badge>
          )}
          {hasIssue && (
            <Badge
              variant="outline"
              className="border-destructive/30 text-destructive bg-destructive/10 text-[10px] py-0 flex-shrink-0"
            >
              {isRevoked ? "Revoked" : "Failed"}
            </Badge>
          )}
        </div>
      </section>

      {/* API Key Setup */}
      <section>
        <SectionHeader
          title="Embedding Provider"
          subtitle="Provide an API key to enable semantic memory"
        />

        {/* Info callout */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground bg-muted/30 border border-border px-3 py-2.5 rounded-md mb-4">
          <Info className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
          <div className="space-y-1">
            <p>
              Semantic memory requires an embedding model to convert text into
              vectors. We use OpenAI's <code className="text-[11px] bg-muted px-1 rounded">text-embedding-3-small</code> — it costs
              about <strong>$0.02 per million tokens</strong> (thousands of
              memories for less than a penny).
            </p>
            <p>
              Your key is encrypted at rest and never shared. Each user provides
              their own key so costs scale with your usage, not ours.
            </p>
          </div>
        </div>

        {/* Connected state */}
        {isConnected && (
          <div className="rounded-lg border border-border bg-card p-3.5">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Key className="w-4.5 h-4.5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium">OpenAI API Key</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Connected
                  {openaiCred?.lastUsedAt &&
                    ` · Last used ${new Date(openaiCred.lastUsedAt).toLocaleDateString()}`}
                </p>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setConfirmDisconnect(true)}
                className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive/90"
              >
                <Unlink className="w-3.5 h-3.5" />
                Remove
              </Button>
            </div>
          </div>
        )}

        {/* Error state — allow re-entering key */}
        {hasIssue && (
          <div className="space-y-3">
            <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-md">
              <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
              <p className="text-xs">
                {isRevoked
                  ? "Your API key was invalid, revoked, or your OpenAI account is out of funds. Please enter a new key."
                  : "Your API key encountered an error. Try replacing it with a new one."}
              </p>
            </div>

            <div className="space-y-2">
              <Label className="text-xs">New OpenAI API Key</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => {
                      setApiKey(e.target.value);
                      setError(null);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && apiKey.trim()) handleSaveKey();
                    }}
                    placeholder="sk-proj-..."
                    className="pr-8"
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    aria-label={showKey ? "Hide API key" : "Show API key"}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? (
                      <EyeOff className="w-3.5 h-3.5" />
                    ) : (
                      <Eye className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
                <Button
                  size="sm"
                  onClick={handleSaveKey}
                  disabled={!apiKey.trim() || saving}
                >
                  {saving ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : saved ? (
                    <Check className="w-3.5 h-3.5" />
                  ) : (
                    "Save"
                  )}
                </Button>
              </div>
            </div>
          </div>
        )}

        {/* Not connected — setup form */}
        {!isConnected && !hasIssue && (
          <div className="space-y-2">
            <Label className="text-xs">OpenAI API Key</Label>
            <div className="flex gap-2">
              <div className="relative flex-1">
                <Input
                  type={showKey ? "text" : "password"}
                  value={apiKey}
                  onChange={(e) => {
                    setApiKey(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && apiKey.trim()) handleSaveKey();
                  }}
                  placeholder="sk-proj-..."
                  className="pr-8"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? (
                    <EyeOff className="w-3.5 h-3.5" />
                  ) : (
                    <Eye className="w-3.5 h-3.5" />
                  )}
                </button>
              </div>
              <Button
                size="sm"
                onClick={handleSaveKey}
                disabled={!apiKey.trim() || saving}
              >
                {saving ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : saved ? (
                  <Check className="w-3.5 h-3.5" />
                ) : (
                  "Save"
                )}
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">
              Get your key at{" "}
              <button
                onClick={() =>
                  openExternal("https://platform.openai.com/api-keys")
                }
                className="text-primary hover:underline"
              >
                platform.openai.com/api-keys
              </button>
            </p>
          </div>
        )}

        {error && <p className="text-xs text-destructive mt-2">{error}</p>}
        {saved && !isConnected && (
          <p className="text-xs text-success mt-2">
            API key saved — semantic memory is now active.
          </p>
        )}
      </section>

      {/* Local LLM Alternative */}
      <section>
        <SectionHeader title="Alternative: Local Embedding Model" />

        <div className="rounded-lg border border-dashed border-border bg-muted/20 p-4">
          <div className="flex items-start gap-3">
            <div className="w-9 h-9 rounded-lg bg-muted flex items-center justify-center flex-shrink-0 mt-0.5">
              <Database className="w-4.5 h-4.5 text-muted-foreground" />
            </div>
            <div className="space-y-1.5">
              <p className="text-sm font-medium text-muted-foreground">
                Coming soon
              </p>
              <p className="text-xs text-muted-foreground leading-relaxed">
                We're working on support for local embedding models that run
                entirely on your machine — no API key, no cost, no data leaving
                your device. This will use lightweight models like
                all-MiniLM-L6-v2 (~80MB) for comparable quality.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Disconnect confirmation */}
      <Dialog
        open={confirmDisconnect}
        onOpenChange={(open) => {
          if (!open) setConfirmDisconnect(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove OpenAI Key</DialogTitle>
            <DialogDescription>
              Semantic memory will stop working. Your agents will fall back to
              keyword-only search until you add a new key.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDisconnect(false)}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDisconnect}
              disabled={disconnecting}
            >
              {disconnecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                "Remove"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------


function OrganizationSection() {
  const { organization, hosts, loaded, loading, error, fetchCurrentOrg, createOrg, registerHost, fetchHosts } =
    useOrgStore();
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [hostModalOpen, setHostModalOpen] = useState(false);
  const [hostName, setHostName] = useState("");
  const [registeringHost, setRegisteringHost] = useState(false);
  const [revealedHostKey, setRevealedHostKey] = useState<string | null>(null);
  const [hostError, setHostError] = useState<string | null>(null);

  const [members, setMembers] = useState<api.OrganizationMembership[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  useEffect(() => {
    if (!loaded && !loading) void fetchCurrentOrg();
  }, [loaded, loading, fetchCurrentOrg]);

  useEffect(() => {
    if (!organization) {
      setMembers([]);
      return;
    }
    let cancelled = false;
    setMembersLoading(true);
    api
      .listOrganizationMembers(organization.id)
      .then((rows) => {
        if (!cancelled) setMembers(rows);
      })
      .catch(() => {
        // Listing members shouldn't block the rest of the section.
        if (!cancelled) setMembers([]);
      })
      .finally(() => {
        if (!cancelled) setMembersLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [organization]);

  const handleCreate = async () => {
    setCreateError(null);
    const trimmedName = name.trim();
    const trimmedSlug = slug.trim().toLowerCase();
    if (trimmedName.length === 0 || trimmedSlug.length < 2) {
      setCreateError("Name and slug (≥ 2 chars) are required.");
      return;
    }
    setCreating(true);
    try {
      await createOrg(trimmedName, trimmedSlug);
      setCreateOpen(false);
      setName("");
      setSlug("");
    } catch (e) {
      setCreateError(e instanceof Error ? e.message : "Could not create organization");
    } finally {
      setCreating(false);
    }
  };

  const handleRegisterHost = async () => {
    setHostError(null);
    const trimmed = hostName.trim();
    if (trimmed.length === 0) {
      setHostError("Host name is required.");
      return;
    }
    setRegisteringHost(true);
    try {
      const result = await registerHost(trimmed);
      setRevealedHostKey(result.apiKey);
      setHostName("");
      await fetchHosts();
    } catch (e) {
      setHostError(e instanceof Error ? e.message : "Could not register host");
    } finally {
      setRegisteringHost(false);
    }
  };

  if (!loaded) {
    return (
      <section>
        <SectionHeader
          title="Organization"
          subtitle="Loading organization details…"
        />
        <div className="flex items-center justify-center py-10">
          <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
        </div>
      </section>
    );
  }

  if (!organization) {
    return (
      <section>
        <SectionHeader
          title="Organization"
          subtitle="Create a shared workspace so your agents can run on a dedicated Linux host instead of your laptop."
        />
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-md mb-4">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}
        <Button onClick={() => setCreateOpen(true)}>Create organization</Button>

        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Create organization</DialogTitle>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1">
                <Label htmlFor="org-name">Name</Label>
                <Input
                  id="org-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Acme, Inc."
                />
              </div>
              <div className="space-y-1">
                <Label htmlFor="org-slug">Slug</Label>
                <Input
                  id="org-slug"
                  value={slug}
                  onChange={(e) => setSlug(e.target.value)}
                  placeholder="acme"
                />
                <p className="text-xs text-muted-foreground">
                  Lowercase, 2–64 chars, alphanumerics + hyphens.
                </p>
              </div>
              {createError && (
                <div className="text-sm text-destructive">{createError}</div>
              )}
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                Cancel
              </Button>
              <Button onClick={() => void handleCreate()} disabled={creating}>
                {creating ? "Creating…" : "Create"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </section>
    );
  }

  return (
    <>
      <section>
        <SectionHeader
          title={organization.name}
          subtitle={`Slug: ${organization.slug}`}
        />
      </section>

      <section>
        <SectionHeader title="Hosts" subtitle="Linux VMs that run agent bridges on your org's behalf." />
        {error && (
          <div className="flex items-start gap-2 text-sm text-destructive bg-destructive/10 border border-destructive/20 px-3 py-2.5 rounded-md mb-4">
            <AlertCircle className="w-4 h-4 mt-0.5 flex-shrink-0" />
            <p>{error}</p>
          </div>
        )}
        {hosts.length === 0 ? (
          <div className="text-sm text-muted-foreground mb-3">
            No hosts registered yet. Register one and follow the install steps
            in <code>host/README.md</code> on your VM.
          </div>
        ) : (
          <ul className="space-y-2 mb-3">
            {hosts.map((h) => (
              <li
                key={h.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate">{h.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {h.status}
                    {h.hostname ? ` · ${h.hostname}` : ""}
                    {h.version ? ` · v${h.version}` : ""}
                  </div>
                </div>
                <Badge
                  variant="outline"
                  className={cn(
                    "shrink-0",
                    h.status === "online" && "border-success/30 text-success bg-success/10",
                    h.status === "offline" && "border-muted text-muted-foreground",
                    h.status === "disabled" && "border-destructive/30 text-destructive bg-destructive/10"
                  )}
                >
                  {h.status}
                </Badge>
              </li>
            ))}
          </ul>
        )}
        <Button
          variant="outline"
          onClick={() => {
            setHostError(null);
            setRevealedHostKey(null);
            setHostName("");
            setHostModalOpen(true);
          }}
        >
          <Plus className="w-4 h-4" />
          Register host
        </Button>
      </section>

      <section>
        <SectionHeader title="Members" subtitle="People in this organization." />
        {membersLoading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <ul className="space-y-2">
            {members.map((m) => (
              <li
                key={m.id}
                className="flex items-center justify-between rounded-md border border-border px-3 py-2"
              >
                <div className="min-w-0 flex items-center gap-2">
                  <Avatar className="h-7 w-7 rounded-lg">
                    {m.participant?.avatarUrl && (
                      <AvatarImage src={m.participant.avatarUrl} className="rounded-lg" />
                    )}
                    <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs">
                      {(m.participant?.displayName ?? "?").charAt(0).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="text-sm truncate">
                    {m.participant?.displayName ?? m.participantId}
                  </div>
                </div>
                <Badge variant="outline" className="shrink-0">
                  {m.role}
                </Badge>
              </li>
            ))}
          </ul>
        )}
      </section>

      <Dialog
        open={hostModalOpen}
        onOpenChange={(next) => {
          // While the one-time API key is showing, prevent backdrop /
          // Esc dismissal — losing the key here means the user has
          // to delete + recreate the host to recover.
          if (!next && revealedHostKey) return;
          setHostModalOpen(next);
        }}
      >
        <DialogContent showCloseButton={!revealedHostKey}>
          <DialogHeader>
            <DialogTitle>
              {revealedHostKey ? "Host API key" : "Register host"}
            </DialogTitle>
          </DialogHeader>

          {revealedHostKey ? (
            <div className="space-y-3 py-2">
              <p className="text-sm">
                Copy this API key now — it's shown <strong>once</strong>. Paste
                it into <code>host/scripts/enroll.sh</code> on the VM.
              </p>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs break-all">
                <span className="flex-1 select-all">{revealedHostKey}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void navigator.clipboard.writeText(revealedHostKey)}
                >
                  <CopyIcon className="w-3.5 h-3.5" />
                </Button>
              </div>
              <DialogFooter>
                <Button
                  onClick={() => {
                    setRevealedHostKey(null);
                    setHostModalOpen(false);
                  }}
                >
                  I've copied it
                </Button>
              </DialogFooter>
            </div>
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
    </>
  );
}

function SectionHeader({
  title,
  subtitle,
}: {
  title: string;
  subtitle?: string;
}) {
  return (
    <div className="mb-4">
      <h3 className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
        {title}
      </h3>
      {subtitle && (
        <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
      )}
    </div>
  );
}

function ProviderCard({
  provider,
  credential,
  icon: Icon,
  isConnecting,
  onConnectOAuth,
  onConnectToken,
  onDisconnect,
}: {
  provider: api.ProviderInfo;
  credential?: api.UserCredential;
  icon: React.ElementType;
  isConnecting: boolean;
  onConnectOAuth: () => void;
  onConnectToken: () => void;
  onDisconnect: () => void;
}) {
  const isConnected = !!credential;
  const status = credential?.status;
  const statusConfig = status ? STATUS_CONFIG[status] : null;

  return (
    <div
      className={cn(
        "rounded-lg border p-3.5 transition-colors",
        isConnected
          ? "border-border bg-card"
          : "border-dashed border-border bg-muted/20"
      )}
    >
      {/* Top row: icon, name, status/action */}
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0",
            isConnected ? "bg-primary/10" : "bg-muted"
          )}
        >
          <Icon
            className={cn(
              "w-4.5 h-4.5",
              isConnected ? "text-primary" : "text-muted-foreground"
            )}
          />
        </div>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">
              {provider.displayName}
            </p>
            {statusConfig && (
              <Badge
                variant="outline"
                className={cn("text-[10px] py-0", statusConfig.className)}
              >
                {statusConfig.label}
              </Badge>
            )}
          </div>
          {provider.description && !isConnected && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {provider.description}
            </p>
          )}
          {credential?.providerUid && (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {credential.providerUid}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isConnecting ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              Waiting...
            </Button>
          ) : isConnected ? (
            <Button
              variant="outline"
              size="sm"
              onClick={onDisconnect}
              className="text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive/90"
            >
              <Unlink className="w-3.5 h-3.5" />
              Disconnect
            </Button>
          ) : provider.type === "oauth2" ? (
            <Button variant="outline" size="sm" onClick={onConnectOAuth}>
              <ExternalLink className="w-3.5 h-3.5" />
              Connect
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onConnectToken}>
              <Key className="w-3.5 h-3.5" />
              Add Token
            </Button>
          )}
        </div>
      </div>

      {/* Google: show services with status */}
      {credential && provider.name === "google" && (
        <GoogleServicesDetail
          credential={credential}
          onReconnect={onConnectOAuth}
        />
      )}

      {/* Non-Google: show raw scopes */}
      {credential && provider.name !== "google" && credential.scopes.length > 0 && (
        <div className="mt-2.5 pt-2.5 border-t border-border/50">
          <div className="flex flex-wrap gap-1">
            {credential.scopes.map((scope) => (
              <Badge
                key={scope}
                variant="secondary"
                className="text-[10px] font-normal py-0"
              >
                {scope}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
