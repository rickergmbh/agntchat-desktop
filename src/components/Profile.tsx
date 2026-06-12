import { useState, useEffect, useRef, useCallback } from "react";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore, type ThemePreference } from "../stores/themeStore";
import { isDesignSystemDebugOn, setDesignSystemDebug } from "../lib/designSystemDebug";
import * as api from "../lib/api";
import { cn } from "../lib/utils";
import { PaymentWalletRow } from "./PaymentWalletRow";
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
  Users,
  Camera,
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
  Eye,
  EyeOff,
  Plus,
  Pencil,
  Trash2,
  Globe,
  Brain,
  Calendar,
  RefreshCw,
  Search,
  Sun,
  Moon,
  Monitor,
  Palette,
} from "lucide-react";
import { deviceTimezone, filterTimezones, formatTimezoneLabel } from "../lib/timezones";
import { getInitials } from "../lib/utils";
import { uploadAvatar } from "../lib/imageProcessor";
import { FriendsView } from "./FriendsView";
import { Textarea } from "@/components/ui/textarea";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import { PROVIDERS } from "../lib/models";
import { useLlmKeyStore, type LlmApiKey as LlmApiKeyEntry } from "../stores/llmKeyStore";
import { useWorkspaces } from "../stores/workspaceStore";
import { HostsManagement } from "./HostsManagement";

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
  { label: string; dot: string; text: string }
> = {
  active: {
    label: "Connected",
    dot: "bg-success",
    text: "text-muted-foreground",
  },
  expired: {
    label: "Expired",
    dot: "bg-warning",
    text: "text-warning",
  },
  revoked: {
    label: "Revoked",
    dot: "bg-destructive",
    text: "text-destructive",
  },
  refresh_failed: {
    label: "Refresh failed",
    dot: "bg-destructive",
    text: "text-destructive",
  },
};

// Sidebar sections. Cloud Hosts lets a user register a dedicated Linux VM
// so their agents run in the cloud without a local machine — it lives here
// (against the user's Personal workspace) now that the workspace switcher /
// settings modal are gated off. Other workspace-level config (models,
// members, invites) returns to the Workspace settings modal when
// WORKSPACES_ENABLED is flipped back on.
const SECTIONS = [
  { value: "profile", label: "Profile", icon: User },
  { value: "friends", label: "Friends", icon: Users },
  { value: "appearance", label: "Appearance", icon: Palette },
  { value: "region", label: "Region", icon: Globe },
  { value: "memory", label: "Memory", icon: Brain },
  { value: "llm-keys", label: "LLM Keys", icon: Key },
  { value: "cloud-hosts", label: "Cloud Hosts", icon: Cloud },
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
  const storedTagline =
    typeof participant?.metadata?.tagline === "string"
      ? (participant.metadata.tagline as string)
      : "";
  const storedDescription = participant?.description ?? "";

  const [displayName, setDisplayName] = useState(
    participant?.displayName ?? ""
  );
  const [tagline, setTagline] = useState(storedTagline);
  const [description, setDescription] = useState(storedDescription);
  const [savingProfile, setSavingProfile] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

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

  // Sync editable fields when the participant refreshes (e.g. background
  // fetchProfile after restoreSession, or another device's edit landing).
  useEffect(() => {
    if (participant?.displayName) {
      setDisplayName(participant.displayName);
    }
  }, [participant?.displayName]);

  useEffect(() => {
    setTagline(storedTagline);
  }, [storedTagline]);

  useEffect(() => {
    setDescription(storedDescription);
  }, [storedDescription]);

  // ---- Handlers ----

  // PATCH /api/me returns the full participant_self payload — persist it the
  // same way fetchProfile does so every consumer (rail avatar, friends cards)
  // sees the update without a reload.
  const persistParticipant = (updated: api.Participant) => {
    localStorage.setItem("participant", JSON.stringify(updated));
    useAuthStore.setState({ participant: updated });
  };

  const profileDirty =
    !!participant &&
    displayName.trim() !== "" &&
    (displayName.trim() !== participant.displayName ||
      tagline.trim() !== storedTagline ||
      description.trim() !== storedDescription);

  const handleSaveProfile = async () => {
    if (!participant || !profileDirty) return;

    const body: Parameters<typeof api.updateProfile>[0] = {};
    const trimmedName = displayName.trim();
    if (trimmedName !== participant.displayName) body.displayName = trimmedName;
    // Tagline/description send even when empty — clearing is a valid edit.
    if (tagline.trim() !== storedTagline) body.tagline = tagline.trim();
    if (description.trim() !== storedDescription) body.description = description.trim();

    setSavingProfile(true);
    setProfileError(null);
    setProfileSaved(false);
    try {
      const updated = await api.updateProfile(body);
      persistParticipant(updated);
      setProfileSaved(true);
      setTimeout(() => setProfileSaved(false), 2000);
    } catch (e) {
      setProfileError(
        e instanceof Error ? e.message : "Failed to update profile"
      );
    } finally {
      setSavingProfile(false);
    }
  };

  const handleAvatarChange = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file || !participant) return;

    setUploadingAvatar(true);
    setAvatarError(null);
    try {
      const newUrl = await uploadAvatar(file, `avatars/${participant.id}`);
      const updated = await api.updateProfile({ avatarUrl: newUrl });
      persistParticipant(updated);
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : "Failed to upload avatar"
      );
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
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
            {/* Avatar + identity header */}
            <div className="flex items-center gap-4">
              <div className="relative group">
                <Avatar className="h-16 w-16">
                  {participant?.avatarUrl && (
                    <AvatarImage src={participant.avatarUrl} />
                  )}
                  <AvatarFallback className="text-lg bg-primary/10 text-primary">
                    {getInitials(participant?.displayName)}
                  </AvatarFallback>
                </Avatar>
                <label
                  className={cn(
                    "absolute inset-0 flex cursor-pointer items-center justify-center rounded-full bg-black/50 text-white opacity-0 transition-opacity group-hover:opacity-100",
                    uploadingAvatar && "opacity-100"
                  )}
                >
                  {uploadingAvatar ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Camera className="h-5 w-5" />
                  )}
                  <input
                    type="file"
                    accept="image/jpeg,image/png,image/webp,image/gif"
                    className="hidden"
                    onChange={handleAvatarChange}
                    disabled={uploadingAvatar}
                  />
                </label>
              </div>
              <div className="min-w-0">
                <h3 className="text-base font-semibold truncate">
                  {participant?.displayName}
                </h3>
                <p className="text-sm text-muted-foreground truncate">
                  {participant?.email ?? ""}
                </p>
              </div>
            </div>
            {avatarError && (
              <p className="text-xs text-destructive">{avatarError}</p>
            )}

            {/* Display name */}
            <div className="space-y-1.5">
              <Label className="text-xs">Display Name</Label>
              <Input
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  setProfileError(null);
                  setProfileSaved(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && profileDirty) handleSaveProfile();
                }}
                placeholder="Your display name"
              />
            </div>

            {/* Tagline — short one-liner shown on friend cards */}
            <div className="space-y-1.5">
              <Label className="text-xs">Tagline</Label>
              <Input
                value={tagline}
                maxLength={140}
                onChange={(e) => {
                  setTagline(e.target.value);
                  setProfileError(null);
                  setProfileSaved(false);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && profileDirty) handleSaveProfile();
                }}
                placeholder="A short line about you"
              />
              <p className="text-[10px] text-muted-foreground">
                {tagline.length}/140 — shown on your friend card
              </p>
            </div>

            {/* Description — longer bio */}
            <div className="space-y-1.5">
              <Label className="text-xs">About</Label>
              <Textarea
                value={description}
                rows={3}
                maxLength={500}
                onChange={(e) => {
                  setDescription(e.target.value);
                  setProfileError(null);
                  setProfileSaved(false);
                }}
                placeholder="Tell others a bit about yourself..."
                className="resize-none"
              />
              <p className="text-[10px] text-muted-foreground">
                {description.length}/500
              </p>
            </div>

            {profileError && (
              <p className="text-xs text-destructive">{profileError}</p>
            )}

            <Button
              size="sm"
              onClick={handleSaveProfile}
              disabled={!profileDirty || savingProfile}
            >
              {savingProfile ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : profileSaved ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                "Save Changes"
              )}
            </Button>

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

        {activeSection === "friends" && (
          // FriendsView manages its own header/scroll — give it the full
          // section area (no p-5 wrapper like the other sections).
          <div className="flex flex-1 min-h-0 overflow-hidden">
            <FriendsView onNavigate={onClose} />
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

        {activeSection === "cloud-hosts" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <CloudHostsSection />
          </div>
        )}

        {activeSection === "connections" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Custom APIs — listed first so users immediately see they can
                bring their own service endpoints, not just the built-ins. */}
            <section>
              <SectionHeader
                title="Custom APIs"
                subtitle="Connect custom service endpoints for agent use"
              />

              <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                <button
                  onClick={openAddCustomApi}
                  className="w-full flex items-center gap-3 px-4 py-3 text-left text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
                >
                  <span className="w-8 h-8 rounded-md border border-dashed border-border flex items-center justify-center flex-shrink-0">
                    <Plus className="w-4 h-4" />
                  </span>
                  <span className="text-sm font-medium">Add Custom API</span>
                </button>
                {customApis.map((entry) => (
                  <div key={entry.id} className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/10 border border-primary/20">
                      <Globe className="w-4 h-4 text-primary" />
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
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() => openEditCustomApi(entry)}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteCustomApiId(entry.id)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </section>

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
              ) : (
                <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                  {standardProviders.map((provider) => {
                    const credential = getCredentialForProvider(provider.name);
                    const isConnecting = connectingProvider === provider.name;
                    const Icon = getProviderIcon(provider.name);

                    return (
                      <ProviderRow
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
                  <PaymentWalletRow />
                </div>
              )}
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
              <div key={provider.id}>
                <div className="flex items-center gap-2 mb-2">
                  <Label className="text-sm font-medium">{provider.label}</Label>
                  <Badge variant="secondary" className="text-[10px] py-0">
                    {providerKeys.length} key{providerKeys.length !== 1 ? "s" : ""}
                  </Badge>
                </div>

                <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                  {/* Add key form */}
                  {adding === provider.id && (
                    <div className="px-4 py-3 bg-primary/5 space-y-2">
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

                  {providerKeys.map((key) => {
                    const isDefault = key.isDefault;
                    const isEditing = editing === key.id;
                    const isSaved = saved === key.id;
                    const isBusy = busy === key.id;

                    if (isEditing) {
                      return (
                        <div key={key.id} className="px-4 py-3 bg-primary/5 space-y-2">
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
                      <div key={key.id} className="px-4 py-3">
                        <div className="flex items-center gap-3">
                          <div
                            className={cn(
                              "w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border",
                              isDefault
                                ? "bg-primary/10 border-primary/20 text-primary"
                                : "bg-muted border-transparent text-muted-foreground"
                            )}
                          >
                            <Key className="w-4 h-4" />
                          </div>
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
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
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

                  {adding !== provider.id && (
                    <button
                      onClick={() => handleStartAdd(provider.id)}
                      className="w-full flex items-center gap-3 px-4 py-3 text-left text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
                    >
                      <span className="w-8 h-8 rounded-md border border-dashed border-border flex items-center justify-center flex-shrink-0">
                        <Plus className="w-4 h-4" />
                      </span>
                      <span className="text-sm font-medium">
                        Add {provider.label} Key
                      </span>
                    </button>
                  )}
                </div>
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
      <section>
        <SectionHeader
          title="Semantic Memory"
          subtitle="Agents store memories as they learn about you — preferences, facts, decisions. An embedding provider lets them recall by meaning, so asking about scheduling meetings can surface a note like prefers mornings before 10am."
        />

        <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
          {/* OpenAI API key — the embedding provider, and the section's
              status in one row: connected, broken, or not yet set up. */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-3">
              <div
                className={cn(
                  "w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border",
                  isConnected
                    ? "bg-primary/10 border-primary/20 text-primary"
                    : "bg-muted border-transparent text-muted-foreground"
                )}
              >
                <Brain className="w-4 h-4" />
              </div>

              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">OpenAI API Key</p>
                {isConnected ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground truncate mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                    <span className="truncate">
                      Active — agents recall memories by meaning
                      {openaiCred?.lastUsedAt &&
                        ` · Last used ${new Date(openaiCred.lastUsedAt).toLocaleDateString()}`}
                    </span>
                  </p>
                ) : hasIssue ? (
                  <p className="flex items-center gap-1.5 text-xs text-destructive truncate mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
                    <span className="truncate">
                      {isRevoked
                        ? "Key revoked — it may be invalid or out of funds. Enter a new one below."
                        : "Key failed — check your account balance or enter a new one below."}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    Not configured — agents fall back to keyword-only recall
                  </p>
                )}
              </div>

              {isConnected && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="flex-shrink-0 text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmDisconnect(true)}
                >
                  Remove
                </Button>
              )}
            </div>

            {/* Key entry — shown whenever there's no working key */}
            {!isConnected && (
              <div className="ml-11 mt-2.5 space-y-1.5">
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
                <p className="text-[11px] text-muted-foreground">
                  Uses <code className="bg-muted px-1 rounded">text-embedding-3-small</code> —
                  about $0.02 per million tokens. Encrypted at rest, never shared.
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

            {error && (
              <p className="ml-11 mt-1 flex items-center gap-1 text-[11px] text-destructive">
                <AlertCircle className="w-3 h-3" />
                {error}
              </p>
            )}
            {saved && !isConnected && (
              <p className="ml-11 mt-1 flex items-center gap-1 text-[11px] text-success">
                <Check className="w-3 h-3" />
                API key saved — semantic memory is now active.
              </p>
            )}
          </div>

          {/* Local embedding model — not yet available */}
          <div className="px-4 py-3 flex items-center gap-3">
            <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 bg-muted border border-transparent text-muted-foreground">
              <Database className="w-4 h-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium truncate">
                Local Embedding Model
              </p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                Runs entirely on your machine — no API key, no data leaving your device
              </p>
            </div>
            <Badge variant="secondary" className="text-[10px] py-0 flex-shrink-0">
              Coming soon
            </Badge>
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


// ---------------------------------------------------------------------------
// Cloud Hosts — register a dedicated Linux VM so agents run in the cloud
// without a local machine. Mounted against the user's Personal workspace
// org id (host management is org-scoped on the backend; the user owns their
// Personal org, so they're owner/admin and the calls succeed).
// ---------------------------------------------------------------------------

function CloudHostsSection() {
  const participant = useAuthStore((s) => s.participant);
  const workspaces = useWorkspaces();
  // Prefer the human's direct org; fall back to the workspace flagged
  // isPersonal. Null only before the profile has loaded — render nothing
  // until it resolves rather than calling the API with no org.
  const personalOrgId =
    participant?.organizationId ??
    workspaces.find((w) => w.isPersonal)?.id ??
    null;

  return (
    <section>
      <SectionHeader
        title="Cloud Hosts"
        subtitle="Run agents on a dedicated Linux VM so they stay online without your local machine. Setup currently requires access to the Agentgram private host repo — reach out to opt in."
      />
      {personalOrgId ? (
        <HostsManagement orgId={personalOrgId} />
      ) : (
        <p className="text-sm text-muted-foreground">Loading…</p>
      )}
    </section>
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

function ProviderRow({
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

  // Strip OAuth URL prefixes so token scopes read as "repo, gist" instead of
  // full https://... identifiers.
  const shortScopes = credential?.scopes
    .map((s) => s.split("/").pop() || s)
    .join(", ");

  return (
    <div className="px-4 py-3">
      <div className="flex items-center gap-3">
        <div
          className={cn(
            "w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border",
            isConnected
              ? "bg-primary/10 border-primary/20 text-primary"
              : "bg-muted border-transparent text-muted-foreground"
          )}
        >
          <Icon className="w-4 h-4" />
        </div>

        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">
            {provider.displayName}
          </p>
          {statusConfig ? (
            <p
              className={cn(
                "flex items-center gap-1.5 text-xs truncate mt-0.5",
                statusConfig.text
              )}
            >
              <span
                className={cn(
                  "w-1.5 h-1.5 rounded-full flex-shrink-0",
                  statusConfig.dot
                )}
              />
              <span className="truncate">
                {statusConfig.label}
                {credential?.providerUid && (
                  <span className="text-muted-foreground">
                    {" · "}
                    {credential.providerUid}
                  </span>
                )}
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted-foreground truncate mt-0.5">
              {provider.description || "Not connected"}
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
              variant="ghost"
              size="sm"
              onClick={onDisconnect}
              className="text-muted-foreground hover:text-destructive"
            >
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
              Connect
            </Button>
          )}
        </div>
      </div>

      {/* Google: per-service pills derived from granted scopes */}
      {credential && provider.name === "google" && (
        <GoogleServicesDetail
          credential={credential}
          onReconnect={onConnectOAuth}
        />
      )}

      {/* Non-Google: compact scope summary */}
      {credential && provider.name !== "google" && credential.scopes.length > 0 && (
        <p className="ml-11 mt-1 text-[11px] text-muted-foreground truncate">
          Scopes: {shortScopes}
        </p>
      )}
    </div>
  );
}

function GoogleServicesDetail({
  credential,
  onReconnect,
}: {
  credential: api.UserCredential;
  onReconnect: () => void;
}) {
  const scopeStr = credential.scopes.join(" ");
  const services = GOOGLE_SERVICES.map((svc) => ({
    ...svc,
    connected: scopeStr.includes(svc.scope),
  }));
  const hasMissing = services.some((s) => !s.connected);

  return (
    <div className="ml-11 mt-2 flex flex-wrap items-center gap-1.5">
      {services.map((svc) => {
        const SvcIcon = svc.icon;
        return (
          <span
            key={svc.scope}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-md px-2 py-0.5 text-[11px] border",
              svc.connected
                ? "bg-muted/60 border-transparent text-foreground"
                : "border-dashed border-border text-muted-foreground/60"
            )}
          >
            <SvcIcon className="w-3 h-3" />
            {svc.label}
            {svc.connected ? (
              <Check className="w-3 h-3 text-success" />
            ) : (
              <AlertCircle className="w-3 h-3 text-warning" />
            )}
          </span>
        );
      })}
      {hasMissing && (
        <button
          onClick={onReconnect}
          className="flex items-center gap-1 text-[11px] text-primary hover:underline cursor-pointer"
        >
          <RefreshCw className="w-3 h-3" />
          Reconnect to enable all services
        </button>
      )}
    </div>
  );
}
