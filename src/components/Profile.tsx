import { useState, useEffect, useRef, useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore, type ThemePreference } from "../stores/themeStore";
import { useLocaleStore } from "../stores/localeStore";
import type { LocalePreference } from "../i18n";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n/generated";
import { isDesignSystemDebugOn, setDesignSystemDebug } from "../lib/designSystemDebug";
import * as api from "../lib/api";
import { cn } from "../lib/utils";
import { PaymentWalletRow } from "./PaymentWalletRow";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
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
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  ChevronRight,
  Languages,
  ShieldCheck,
  Download,
} from "lucide-react";
import { deviceTimezone, filterTimezones, formatTimezoneLabel } from "../lib/timezones";
import { getInitials } from "../lib/utils";
import { uploadAvatar } from "../lib/imageProcessor";
import { FriendsView } from "./FriendsView";
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
  { labelKey: string; dot: string; text: string }
> = {
  active: {
    labelKey: "connections.status.active",
    dot: "bg-success",
    text: "text-muted-foreground",
  },
  expired: {
    labelKey: "connections.status.expired",
    dot: "bg-warning",
    text: "text-warning",
  },
  revoked: {
    labelKey: "connections.status.revoked",
    dot: "bg-destructive",
    text: "text-destructive",
  },
  refresh_failed: {
    labelKey: "connections.status.refreshFailed",
    dot: "bg-destructive",
    text: "text-destructive",
  },
};

// Sidebar sections. (Cloud Hosts / VM provisioning lives in the admin-only
// Platform area now, not here — operators manage hosts for everyone there.)
// Other workspace-level config (models, members, invites) returns to the
// Workspace settings modal when the workspaces feature flag is enabled.
const SECTIONS = [
  { value: "profile", labelKey: "sections.profile", icon: User },
  { value: "friends", labelKey: "sections.friends", icon: Users },
  { value: "appearance", labelKey: "sections.appearance", icon: Palette },
  { value: "region", labelKey: "sections.region", icon: Globe },
  { value: "memory", labelKey: "sections.memory", icon: Brain },
  { value: "llm-keys", labelKey: "sections.llmKeys", icon: Key },
  { value: "connections", labelKey: "sections.connections", icon: Link2 },
  { value: "privacy", labelKey: "privacy.title", icon: ShieldCheck },
] as const;

type SectionValue = (typeof SECTIONS)[number]["value"];

// ---------------------------------------------------------------------------
// Custom API persistence
// ---------------------------------------------------------------------------

// The custom endpoint is stored backend-side under the `custom` provider so
// agents can actually resolve it (encrypted at rest, walks the ownership
// chain). A single custom endpoint per user, with an API key plus any number
// of extra named values (secret ones encrypted).
type CustomFieldRow = api.CredentialFieldInput;

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Profile({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("settings");
  const { participant, logout } = useAuthStore();
  const [activeSection, setActiveSection] = useState<SectionValue>("profile");
  // Friends is behind a per-user runtime flag (resolved on /me) — hide its
  // sidebar section + content when off for this user.
  const friendsEnabled = participant?.features?.friends === true;
  const visibleSections = SECTIONS.filter(
    (s) => s.value !== "friends" || friendsEnabled
  );

  // ---- Profile editing state ----
  const storedFirstName = participant?.firstName ?? "";
  const storedLastName = participant?.lastName ?? "";
  // The raw Display Name editor is behind the `display_name_field` runtime
  // flag; by default users edit first/last name, which derives display_name.
  const displayNameFieldEnabled = participant?.features?.display_name_field === true;

  const [displayName, setDisplayName] = useState(
    participant?.displayName ?? ""
  );
  const [firstName, setFirstName] = useState(storedFirstName);
  const [lastName, setLastName] = useState(storedLastName);
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

  // ---- Custom API state (backend `custom` provider) ----
  const [customApiDialog, setCustomApiDialog] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  const [customApiKey, setCustomApiKey] = useState("");
  // How the primary API key is sent on outbound calls.
  const [customAuthMode, setCustomAuthMode] =
    useState<api.CustomAuthMode>("bearer");
  const [customAuthHeader, setCustomAuthHeader] = useState("");
  // Progressive disclosure: auth-mode + named fields live behind "Advanced".
  // Auto-expands on edit when the connection already uses non-default auth
  // or has named fields, so existing config is never hidden.
  const [customAdvancedOpen, setCustomAdvancedOpen] = useState(false);
  const [customFields, setCustomFields] = useState<CustomFieldRow[]>([]);
  const [customApiError, setCustomApiError] = useState<string | null>(null);
  const [savingCustomApi, setSavingCustomApi] = useState(false);
  const [deleteCustomApi, setDeleteCustomApi] = useState(false);

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
        e instanceof Error ? e.message : t("connections.errors.loadFailed")
      );
    } finally {
      setLoadingIntegrations(false);
    }
  }, [t]);

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
    setFirstName(storedFirstName);
  }, [storedFirstName]);

  useEffect(() => {
    setLastName(storedLastName);
  }, [storedLastName]);

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
    (firstName.trim() !== storedFirstName ||
      lastName.trim() !== storedLastName ||
      (displayNameFieldEnabled &&
        displayName.trim() !== "" &&
        displayName.trim() !== participant.displayName));

  const handleSaveProfile = async () => {
    if (!participant || !profileDirty) return;

    const body: Parameters<typeof api.updateProfile>[0] = {};
    if (firstName.trim() !== storedFirstName) body.firstName = firstName.trim();
    if (lastName.trim() !== storedLastName) body.lastName = lastName.trim();
    // Only send displayName when the raw editor is shown (flag on).
    if (displayNameFieldEnabled) {
      const trimmedName = displayName.trim();
      if (trimmedName && trimmedName !== participant.displayName) body.displayName = trimmedName;
    }

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
        e instanceof Error ? e.message : t("profile.updateFailed")
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
        err instanceof Error ? err.message : t("profile.avatarUploadFailed")
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
        e instanceof Error ? e.message : t("connections.errors.authorizeFailed")
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
        e instanceof Error ? e.message : t("connections.errors.storeTokenFailed")
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
        e instanceof Error ? e.message : t("connections.errors.disconnectFailed")
      );
      setDisconnectProvider(null);
    } finally {
      setDisconnecting(false);
    }
  };

  // ---- Custom API handlers (backend `custom` provider) ----

  const customCredential = credentials.find((c) => c.provider === "custom");

  const openCustomApiDialog = () => {
    // Prefill from the stored credential (edit). Secret values are never
    // returned by the server — start them blank so the user only re-enters
    // what they want to change; public values pre-fill from publicFields.
    // The label defaults to "custom" server-side; treat that as unnamed.
    setCustomName(
      customCredential?.label && customCredential.label !== "custom"
        ? customCredential.label
        : ""
    );
    setCustomEndpoint(customCredential?.endpoint ?? "");
    setCustomApiKey("");
    const authMode = customCredential?.authMode ?? "bearer";
    setCustomAuthMode(authMode);
    setCustomAuthHeader(customCredential?.authHeader ?? "");
    const fieldDefs = customCredential?.fieldDefs ?? [];
    setCustomFields(
      fieldDefs.map((d) => ({
        key: d.key,
        label: d.label,
        secret: d.secret,
        value: d.secret ? "" : customCredential?.publicFields?.[d.key] ?? "",
      }))
    );
    // Reveal Advanced up front when the connection already relies on it, so
    // non-default auth or named fields are never silently hidden on edit.
    setCustomAdvancedOpen(authMode !== "bearer" || fieldDefs.length > 0);
    setCustomApiError(null);
    setCustomApiDialog(true);
  };

  const addCustomField = () =>
    setCustomFields((prev) => [
      ...prev,
      { key: "", label: "", value: "", secret: false },
    ]);

  const updateCustomField = (index: number, patch: Partial<CustomFieldRow>) =>
    setCustomFields((prev) =>
      prev.map((f, i) => (i === index ? { ...f, ...patch } : f))
    );

  const removeCustomField = (index: number) =>
    setCustomFields((prev) => prev.filter((_, i) => i !== index));

  const handleSaveCustomApi = async () => {
    if (!customEndpoint.trim()) {
      setCustomApiError(t("customApis.errors.endpointRequired"));
      return;
    }
    // On CREATE the API key is required (it's the credential's access_token).
    // On EDIT it's optional — a blank key routes through the metadata-only
    // PATCH, leaving the stored token and secrets untouched.
    const editing = !!customCredential;
    if (!customApiKey.trim() && !editing) {
      setCustomApiError(t("customApis.errors.apiKeyRequired"));
      return;
    }
    if (customAuthMode === "header" && !customAuthHeader.trim()) {
      setCustomApiError(t("customApis.errors.headerNameRequired"));
      return;
    }

    setSavingCustomApi(true);
    setCustomApiError(null);
    try {
      const fields = customFields
        .filter((f) => f.key.trim() !== "" && f.value.trim() !== "")
        .map((f) => ({
          key: f.key.trim(),
          label: f.label.trim() || f.key.trim(),
          value: f.value,
          secret: f.secret,
        }));

      const authHeader =
        customAuthMode === "header" ? customAuthHeader.trim() : "";

      const { credential } =
        editing && !customApiKey.trim()
          ? await api.updateProviderConnection("custom", {
              endpoint: customEndpoint.trim(),
              label: customName.trim() || undefined,
              fields,
              authMode: customAuthMode,
              authHeader,
            })
          : await api.storeProviderToken("custom", customApiKey.trim(), {
              endpoint: customEndpoint.trim(),
              label: customName.trim() || undefined,
              fields,
              authMode: customAuthMode,
              authHeader,
            });
      setCredentials((prev) => [
        ...prev.filter((c) => c.provider !== "custom"),
        credential,
      ]);
      setCustomApiDialog(false);
    } catch (e) {
      setCustomApiError(
        e instanceof Error ? e.message : t("customApis.errors.saveFailed")
      );
    } finally {
      setSavingCustomApi(false);
    }
  };

  const handleDeleteCustomApi = async () => {
    try {
      await api.disconnectProvider("custom");
      setCredentials((prev) => prev.filter((c) => c.provider !== "custom"));
    } catch (e) {
      setIntegrationError(
        e instanceof Error ? e.message : t("customApis.errors.deleteFailed")
      );
    } finally {
      setDeleteCustomApi(false);
    }
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

          {visibleSections.map((section) => (
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
                {t(section.labelKey)}
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
                {t("common:close")}
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
              {(() => {
                const key = SECTIONS.find((s) => s.value === activeSection)?.labelKey;
                return key ? t(key) : null;
              })()}
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

            {/* First / Last name */}
            <div className="flex gap-3">
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{t("profile.firstName")}</Label>
                <Input
                  value={firstName}
                  maxLength={50}
                  onChange={(e) => {
                    setFirstName(e.target.value);
                    setProfileError(null);
                    setProfileSaved(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && profileDirty) handleSaveProfile();
                  }}
                  placeholder={t("profile.firstName")}
                />
              </div>
              <div className="flex-1 space-y-1.5">
                <Label className="text-xs">{t("profile.lastName")}</Label>
                <Input
                  value={lastName}
                  maxLength={50}
                  onChange={(e) => {
                    setLastName(e.target.value);
                    setProfileError(null);
                    setProfileSaved(false);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && profileDirty) handleSaveProfile();
                  }}
                  placeholder={t("profile.lastName")}
                />
              </div>
            </div>

            {/* Raw Display Name — behind the `display_name_field` runtime flag.
                Otherwise display name is derived from first + last on save. */}
            {displayNameFieldEnabled && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("auth:displayName")}</Label>
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
                  placeholder={t("auth:placeholders.yourName")}
                />
              </div>
            )}

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
                t("common:save")
              )}
            </Button>

            {/* Email (read-only) */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("auth:email")}</Label>
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
              {t("nav:signOut")}
            </Button>
          </div>
        )}

        {friendsEnabled && activeSection === "friends" && (
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
            <LanguageSection />
            <Separator />
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

        {activeSection === "connections" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            {/* Custom API — a single bring-your-own endpoint stored backend-side
                (encrypted, agent-usable) under the `custom` provider. */}
            <section>
              <SectionHeader
                title={t("customApis.title")}
                subtitle={t("customApis.sectionSubtitle")}
              />

              <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                {customCredential ? (
                  <div className="flex items-center gap-3 px-4 py-3">
                    <div className="w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 bg-primary/10 border border-primary/20">
                      <Globe className="w-4 h-4 text-primary" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">
                        {customCredential.label &&
                        customCredential.label !== "custom"
                          ? customCredential.label
                          : customCredential.endpoint || t("customApis.customEndpoint")}
                      </p>
                      <p className="text-xs text-muted-foreground truncate mt-0.5">
                        {customCredential.endpoint || t("common:apiKey")}
                        {(customCredential.fieldDefs?.length ?? 0) > 0
                          ? ` · ${t("customApis.values", {
                              count: customCredential.fieldDefs!.length,
                            })}`
                          : ""}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={openCustomApiDialog}
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-destructive"
                        onClick={() => setDeleteCustomApi(true)}
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    </div>
                  </div>
                ) : (
                  <button
                    onClick={openCustomApiDialog}
                    className="w-full flex items-center gap-3 px-4 py-3 text-left text-muted-foreground hover:text-foreground hover:bg-muted/40 transition-colors cursor-pointer"
                  >
                    <span className="w-8 h-8 rounded-md border border-dashed border-border flex items-center justify-center flex-shrink-0">
                      <Plus className="w-4 h-4" />
                    </span>
                    <span className="text-sm font-medium">{t("customApis.add")}</span>
                  </button>
                )}
              </div>
            </section>

            {/* Connected Accounts */}
            <section>
              <SectionHeader
                title={t("manage.connectedAccounts")}
                subtitle={t("connections.subtitle")}
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

        {activeSection === "privacy" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <PrivacyDataSection />
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
              {t("connections.connectProvider", {
                provider: tokenDialogProvider?.displayName ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {tokenDialogProvider?.description ??
                t("connections.tokenDialogDescription", {
                  provider: tokenDialogProvider?.displayName ?? "",
                })}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("connections.apiToken")}</Label>
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
                placeholder={t("connections.tokenPlaceholder")}
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
              {t("common:cancel")}
            </Button>
            <Button
              size="sm"
              onClick={handleSubmitToken}
              disabled={!tokenValue.trim() || savingToken}
            >
              {savingToken ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("common:connecting")}
                </>
              ) : (
                t("common:connect")
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
            <DialogTitle>{t("connections.disconnectTitle")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="connections.disconnectConfirm"
                ns="settings"
                values={{
                  provider:
                    providers.find((p) => p.name === disconnectProvider)
                      ?.displayName ?? disconnectProvider,
                }}
                components={{
                  b: <span className="font-medium text-foreground" />,
                }}
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDisconnectProvider(null)}
            >
              {t("common:cancel")}
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
                  {t("common:disconnecting")}
                </>
              ) : (
                t("common:disconnect")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* ADD / EDIT CUSTOM API DIALOG                                      */}
      {/* ================================================================= */}
      <Dialog
        open={customApiDialog}
        onOpenChange={(open) => {
          if (!open) setCustomApiDialog(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {customCredential ? t("customApis.editTitle") : t("customApis.add")}
            </DialogTitle>
            <DialogDescription>
              {t("customApis.dialogDescription")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("common:name")}</Label>
              <Input
                value={customName}
                onChange={(e) => {
                  setCustomName(e.target.value);
                  setCustomApiError(null);
                }}
                placeholder={t("customApis.namePlaceholder")}
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">{t("customApis.endpoint")}</Label>
              <Input
                value={customEndpoint}
                onChange={(e) => {
                  setCustomEndpoint(e.target.value);
                  setCustomApiError(null);
                }}
                placeholder="https://api.example.com/v1"
                className="font-mono text-xs"
              />
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">
                {t("common:apiKey")}
                {customCredential ? (
                  <span className="text-muted-foreground font-normal">
                    {" "}
                    — {t("llmKeys.leaveBlankHint")}
                  </span>
                ) : null}
              </Label>
              <Input
                type="password"
                value={customApiKey}
                onChange={(e) => {
                  setCustomApiKey(e.target.value);
                  setCustomApiError(null);
                }}
                placeholder={
                  customCredential
                    ? t("customApis.unchanged")
                    : t("customApis.apiKeyPlaceholder")
                }
                className="font-mono text-xs"
              />
            </div>

            {/* Advanced options — auth-mode routing + named fields. Collapsed
                by default so the common "paste one API key" flow only sees the
                fields above. Auto-expanded on edit when the connection already
                uses non-default auth or named fields. */}
            <button
              type="button"
              onClick={() => setCustomAdvancedOpen((o) => !o)}
              className="flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground transition-colors"
            >
              <ChevronRight
                className={`w-3.5 h-3.5 transition-transform ${
                  customAdvancedOpen ? "rotate-90" : ""
                }`}
              />
              {t("customApis.advancedOptions")}
            </button>

            {customAdvancedOpen ? (
              <>
            {/* How the primary key is sent on outbound calls. Bearer is the
                default; header-auth endpoints (e.g. x-agent-key-id) pick
                "Custom header" and name it. */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("customApis.sendKeyAs")}</Label>
              <Select
                value={customAuthMode}
                onValueChange={(v) => {
                  setCustomAuthMode(v as api.CustomAuthMode);
                  setCustomApiError(null);
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bearer">
                    {t("customApis.authBearer")}
                  </SelectItem>
                  <SelectItem value="header">{t("customApis.authHeader")}</SelectItem>
                  <SelectItem value="none">{t("customApis.authNone")}</SelectItem>
                </SelectContent>
              </Select>
              {customAuthMode === "header" ? (
                <Input
                  value={customAuthHeader}
                  onChange={(e) => {
                    setCustomAuthHeader(e.target.value);
                    setCustomApiError(null);
                  }}
                  placeholder={t("customApis.headerNamePlaceholder")}
                  className="font-mono text-xs"
                />
              ) : null}
              {customAuthMode === "none" ? (
                <p className="text-[11px] text-muted-foreground">
                  {t("customApis.authNoneHint")}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label className="text-xs">{t("customApis.additionalValues")}</Label>
              {customFields.map((field, index) => (
                <div key={index} className="flex items-start gap-1.5">
                  <div className="flex-1 space-y-1.5">
                    <Input
                      value={field.label}
                      onChange={(e) =>
                        updateCustomField(index, {
                          label: e.target.value,
                          key:
                            field.key ||
                            e.target.value
                              .trim()
                              .toLowerCase()
                              .replace(/\s+/g, "_"),
                        })
                      }
                      placeholder={t("customApis.fieldNamePlaceholder")}
                      className="text-xs"
                    />
                    <Input
                      type={field.secret ? "password" : "text"}
                      value={field.value}
                      onChange={(e) =>
                        updateCustomField(index, { value: e.target.value })
                      }
                      placeholder={
                        field.secret
                          ? t("customApis.valueEncryptedPlaceholder")
                          : t("customApis.valuePlaceholder")
                      }
                      className="font-mono text-xs"
                    />
                  </div>
                  <Button
                    type="button"
                    variant={field.secret ? "default" : "outline"}
                    size="sm"
                    className="mt-0 h-9"
                    onClick={() =>
                      updateCustomField(index, { secret: !field.secret })
                    }
                  >
                    {t("customApis.secret")}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="mt-1 text-muted-foreground hover:text-destructive"
                    onClick={() => removeCustomField(index)}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-primary hover:text-primary gap-1.5"
                onClick={addCustomField}
              >
                <Plus className="w-3.5 h-3.5" />
                {t("customApis.addValue")}
              </Button>
            </div>
              </>
            ) : null}

            {customApiError && (
              <p className="text-xs text-destructive">{customApiError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCustomApiDialog(false)}
              disabled={savingCustomApi}
            >
              {t("common:cancel")}
            </Button>
            <Button size="sm" onClick={handleSaveCustomApi} disabled={savingCustomApi}>
              {savingCustomApi ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("common:saving")}
                </>
              ) : customCredential ? (
                t("common:save")
              ) : (
                t("common:add")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ================================================================= */}
      {/* DELETE CUSTOM API CONFIRMATION                                     */}
      {/* ================================================================= */}
      <Dialog
        open={deleteCustomApi}
        onOpenChange={(open) => {
          if (!open) setDeleteCustomApi(false);
        }}
      >
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>{t("customApis.deleteTitle")}</DialogTitle>
            <DialogDescription>
              <Trans
                i18nKey="customApis.deleteConfirm"
                ns="settings"
                values={{
                  name:
                    customCredential?.endpoint || t("customApis.thisEndpoint"),
                }}
                components={{
                  b: <span className="font-medium text-foreground" />,
                }}
              />
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteCustomApi(false)}
            >
              {t("common:cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteCustomApi}
            >
              {t("common:delete")}
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
  labelKey: string;
  descriptionKey: string;
  icon: React.ElementType;
}[] = [
  { value: "light", labelKey: "theme.light", descriptionKey: "theme.alwaysLight", icon: Sun },
  { value: "dark", labelKey: "theme.dark", descriptionKey: "theme.alwaysDark", icon: Moon },
  { value: "system", labelKey: "theme.system", descriptionKey: "theme.matchSystem", icon: Monitor },
];

function TimezoneSection() {
  const { t } = useTranslation("settings");
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
        <Label className="text-xs">{t("timezone.current")}</Label>
        <p className="mt-1 text-sm font-medium">{formatTimezoneLabel(current)}</p>
        <p className="text-[11px] text-muted-foreground">{current}</p>
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("timezone.detail")}
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("timezone.searchPlaceholder")}
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
              <p className="text-sm font-medium text-primary">{t("timezone.useDevice")}</p>
              <p className="text-[11px] text-muted-foreground">{browserTz}</p>
            </div>
            {saving === browserTz && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          </button>
        )}

        <div className="max-h-80 overflow-y-auto">
          {items.length === 0 ? (
            <p className="px-3 py-4 text-center text-xs text-muted-foreground">
              {t("timezone.noMatches", { query })}
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

// ---------------------------------------------------------------------------
// Language — system default or an explicit supported locale.
// Locale names are endonyms (each language named in itself) — never translated.
// ---------------------------------------------------------------------------

function LanguageSection() {
  const { t } = useTranslation("settings");
  const preference = useLocaleStore((s) => s.preference);
  const setPreference = useLocaleStore((s) => s.setPreference);

  const options: {
    value: LocalePreference;
    label: string;
    icon: React.ElementType;
  }[] = [
    { value: "system", label: t("language.system"), icon: Monitor },
    ...SUPPORTED_LOCALES.map((locale) => ({
      value: locale as LocalePreference,
      label: LOCALE_LABELS[locale],
      icon: Languages as React.ElementType,
    })),
  ];

  return (
    <div className="space-y-4">
      <div className="space-y-1">
        <Label className="text-xs">{t("language.label")}</Label>
        <p className="text-[11px] text-muted-foreground">
          {t("language.description")}
        </p>
      </div>

      <div className="grid grid-cols-3 gap-2">
        {options.map((opt) => {
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
            </button>
          );
        })}
      </div>
    </div>
  );
}

function AppearanceSection() {
  const { t } = useTranslation("settings");
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
        <Label className="text-xs">{t("theme.label")}</Label>
        <p className="text-[11px] text-muted-foreground">
          {t("theme.currentlyShowing", { theme: t(`theme.${resolved}`) })}
          {preference === "system" && ` ${t("theme.fromSystem")}`}
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
              <span className="font-medium text-foreground">{t(opt.labelKey)}</span>
              <span className="text-[10px] text-muted-foreground">{t(opt.descriptionKey)}</span>
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
            <span className="font-medium text-foreground">{t("designDebug.label")}</span>
            <span className="text-[10px] text-muted-foreground">{t("designDebug.hint")}</span>
          </span>
        </span>
        <span
          className={cn(
            "rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase",
            dsDebug ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground"
          )}
        >
          {dsDebug ? t("common:on") : t("common:off")}
        </span>
      </button>
    </div>
  );
}

// ---------------------------------------------------------------------------
// LLM API Keys — multiple named keys per provider with defaults
// ---------------------------------------------------------------------------

function LlmApiKeysSection() {
  const { t } = useTranslation("settings");
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
      setOpError(e instanceof Error ? e.message : t("llmKeys.errors.saveFailed"));
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
      setOpError(e instanceof Error ? e.message : t("llmKeys.errors.updateFailed"));
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
      setOpError(e instanceof Error ? e.message : t("llmKeys.errors.deleteFailed"));
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
      setOpError(e instanceof Error ? e.message : t("llmKeys.errors.setDefaultFailed"));
    } finally {
      setBusy(null);
    }
  };

  const keyPlaceholder = (providerId: string) => {
    switch (providerId) {
      case "anthropic": return "sk-ant-...";
      case "openai": return "sk-...";
      case "xai": return "xai-...";
      default: return t("common:apiKey");
    }
  };

  return (
    <section>
      <SectionHeader
        title={t("sections.llmKeys")}
        subtitle={t("llmKeys.subtitle")}
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
                    {t("llmKeys.keys", { count: providerKeys.length })}
                  </Badge>
                </div>

                <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                  {/* Add key form */}
                  {adding === provider.id && (
                    <div className="px-4 py-3 bg-primary/5 space-y-2">
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("llmKeys.label")}</Label>
                        <Input
                          value={newLabel}
                          onChange={(e) => setNewLabel(e.target.value)}
                          placeholder={t("llmKeys.labelPlaceholder")}
                          className="text-xs"
                          autoFocus
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label className="text-xs">{t("common:apiKey")}</Label>
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
                          {t("common:add")}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={() => setAdding(null)} className="h-7 text-xs">
                          {t("common:cancel")}
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
                            <Label className="text-xs">{t("llmKeys.label")}</Label>
                            <Input
                              value={editLabel}
                              onChange={(e) => setEditLabel(e.target.value)}
                              className="text-xs"
                              autoFocus
                            />
                          </div>
                          <div className="space-y-1.5">
                            <Label className="text-xs">{t("llmKeys.rotateLabel")}</Label>
                            <Input
                              type="password"
                              value={editApiKey}
                              onChange={(e) => setEditApiKey(e.target.value)}
                              placeholder={`${keyPlaceholder(provider.id)} — ${t("llmKeys.leaveBlankHint")}`}
                              className="font-mono text-xs"
                            />
                            <p className="text-[11px] text-muted-foreground">
                              {t("llmKeys.storedEncryptedNeverShown")}
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
                              {t("common:save")}
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => setEditing(null)} className="h-7 text-xs">
                              {t("common:cancel")}
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
                                  {t("llmKeys.default")}
                                </Badge>
                              )}
                              {key.status === "revoked" && (
                                <Badge variant="secondary" className="text-[10px] py-0 bg-destructive/10 text-destructive">
                                  {t("connections.status.revoked")}
                                </Badge>
                              )}
                              {isSaved && (
                                <Badge variant="secondary" className="text-[10px] py-0">
                                  <Check className="w-3 h-3 mr-0.5" />
                                  {t("common:saved")}
                                </Badge>
                              )}
                            </div>
                            <p className="text-xs text-muted-foreground truncate mt-0.5">
                              {t("llmKeys.storedEncryptedRotate")}
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
                                title={t("llmKeys.setDefault")}
                              >
                                {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : t("llmKeys.setDefault")}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-7 w-7 text-muted-foreground hover:text-foreground"
                              onClick={() => handleStartEdit(key)}
                              disabled={isBusy}
                              title={t("llmKeys.editRotate")}
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
                                  {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : t("common:confirm")}
                                </Button>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-7 text-xs"
                                  onClick={() => setConfirmDelete(null)}
                                >
                                  {t("common:cancel")}
                                </Button>
                              </div>
                            ) : (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-7 w-7 text-muted-foreground hover:text-destructive/90"
                                onClick={() => setConfirmDelete(key.id)}
                                disabled={isBusy}
                                title={t("common:delete")}
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
                        {t("llmKeys.addProviderKey", { provider: provider.label })}
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
          {t("llmKeys.footer")}
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
// Privacy & data — GDPR self-service (export, marketing consent, delete)
// ---------------------------------------------------------------------------

type ExportState = "idle" | "preparing" | "ready" | "failed";

function PrivacyDataSection() {
  const { t } = useTranslation("settings");
  const participant = useAuthStore((s) => s.participant);
  const logout = useAuthStore((s) => s.logout);

  // Persist an updated participant_self payload the same way fetchProfile does,
  // so the rail/other consumers see consent changes without a reload.
  const persist = (updated: api.Participant) => {
    localStorage.setItem("participant", JSON.stringify(updated));
    useAuthStore.setState({ participant: updated });
  };

  // ---- Data export ----
  const [exportState, setExportState] = useState<ExportState>("idle");
  // Non-empty incompleteSections → warn that the export is partial.
  const [exportIncomplete, setExportIncomplete] = useState(false);
  // Kept when opening the browser failed, so the user can click the
  // signed URL directly as a fallback.
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const handleExport = async () => {
    setExportState("preparing");
    setExportIncomplete(false);
    setExportUrl(null);
    try {
      const { url, incompleteSections } = await api.exportMyData();
      setExportIncomplete((incompleteSections?.length ?? 0) > 0);
      setExportState("ready");
      try {
        await tauriOpen(url);
      } catch {
        // Shell plugin failed/blocked — try the webview fallback, and if
        // that is blocked too, render the URL as a clickable link.
        const opened = window.open(url, "_blank");
        if (!opened) setExportUrl(url);
      }
    } catch {
      setExportState("failed");
    }
  };

  // ---- Marketing consent ----
  const [savingMarketing, setSavingMarketing] = useState(false);
  const [marketingError, setMarketingError] = useState(false);
  const handleToggleMarketing = async (value: boolean) => {
    setSavingMarketing(true);
    setMarketingError(false);
    try {
      const updated = await api.updateConsent({ marketingOptIn: value });
      persist(updated);
    } catch {
      // toggle keeps reflecting the (unchanged) stored value; say why
      setMarketingError(true);
    } finally {
      setSavingMarketing(false);
    }
  };

  // ---- Agent memories (search & forget) ----
  const [memoryQuery, setMemoryQuery] = useState("");
  const [memorySearching, setMemorySearching] = useState(false);
  // null = no search performed yet (renders nothing, not the empty state)
  const [memoryResults, setMemoryResults] = useState<
    api.MemorySearchResult[] | null
  >(null);
  // Keys are `${type}:${id}` — ids are only unique within a store type.
  const [memorySelected, setMemorySelected] = useState<Set<string>>(new Set());
  const [memoryError, setMemoryError] = useState<"search" | "forget" | null>(
    null
  );
  const [forgetting, setForgetting] = useState(false);
  const [forgotten, setForgotten] = useState(false);
  const canSearchMemories = memoryQuery.trim().length >= 2;
  const memoryKey = (r: api.MemorySearchResult) => `${r.type}:${r.id}`;

  const handleMemorySearch = async () => {
    if (!canSearchMemories || memorySearching) return;
    setMemorySearching(true);
    setMemoryError(null);
    setForgotten(false);
    try {
      const { results } = await api.searchMemories(memoryQuery.trim());
      setMemoryResults(results);
      setMemorySelected(new Set());
    } catch {
      setMemoryError("search");
    } finally {
      setMemorySearching(false);
    }
  };

  const toggleMemory = (key: string) => {
    setMemorySelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleForgetMemories = async () => {
    if (!memoryResults || memorySelected.size === 0 || forgetting) return;
    setForgetting(true);
    setMemoryError(null);
    setForgotten(false);
    const items = memoryResults
      .filter((r) => memorySelected.has(memoryKey(r)))
      .map(({ type, id }) => ({ type, id }));
    try {
      await api.forgetMemories(items);
      setMemoryResults((prev) =>
        prev ? prev.filter((r) => !memorySelected.has(memoryKey(r))) : prev
      );
      setMemorySelected(new Set());
      setForgotten(true);
    } catch {
      setMemoryError("forget");
    } finally {
      setForgetting(false);
    }
  };

  // ---- Policy re-accept ----
  const [reaccepting, setReaccepting] = useState(false);
  const [reacceptError, setReacceptError] = useState(false);
  const handleReaccept = async () => {
    setReaccepting(true);
    setReacceptError(false);
    try {
      const updated = await api.updateConsent({ reaccept: true });
      persist(updated);
    } catch {
      // stay on the prompt so the user can retry
      setReacceptError(true);
    } finally {
      setReaccepting(false);
    }
  };

  // ---- Account deletion ----
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const canDelete = confirmText === "DELETE";

  const handleDelete = async () => {
    if (!canDelete) return;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteAccount();
      // Clears token + participant → App routes to the signed-out LoginScreen.
      logout();
    } catch (e) {
      setDeleteError(
        e instanceof Error ? e.message : t("privacy.deleteConfirmTitle")
      );
      setDeleting(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Re-consent prompt — only when the current policy version is newer
          than what the user last accepted. */}
      {participant?.policyReacceptRequired && (
        <div className="rounded-xl border border-warning/40 bg-warning/10 p-4 space-y-3">
          <div className="flex items-start gap-3">
            <ShieldCheck className="w-5 h-5 text-warning flex-shrink-0 mt-0.5" />
            <div className="min-w-0">
              <p className="text-sm font-semibold">{t("privacy.reacceptTitle")}</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {t("privacy.reacceptBody")}
              </p>
            </div>
          </div>
          <Button size="sm" onClick={handleReaccept} disabled={reaccepting}>
            {reaccepting ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              t("privacy.reacceptCta")
            )}
          </Button>
          {reacceptError && (
            <p className="text-xs text-destructive flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {t("privacy.updateFailed")}
            </p>
          )}
        </div>
      )}

      {/* Download my data */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("privacy.downloadData")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("privacy.downloadDataDesc")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={exportState === "preparing"}
            className="flex-shrink-0"
          >
            {exportState === "preparing" ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Download className="w-3.5 h-3.5" />
            )}
            {t("privacy.downloadData")}
          </Button>
        </div>
        {exportState === "preparing" && (
          <p className="text-xs text-muted-foreground mt-2">
            {t("privacy.downloadPreparing")}
          </p>
        )}
        {exportState === "ready" && (
          <p className="text-xs text-success mt-2 flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            {t("privacy.downloadReady")}
          </p>
        )}
        {exportState === "ready" && exportIncomplete && (
          <p className="text-xs text-warning mt-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("privacy.downloadIncomplete")}
          </p>
        )}
        {exportState === "ready" && exportUrl && (
          <a
            href={exportUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-primary hover:underline mt-2 inline-block"
          >
            {t("privacy.openDownload")}
          </a>
        )}
        {exportState === "failed" && (
          <p className="text-xs text-destructive mt-2 flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("privacy.downloadFailed")}
          </p>
        )}
      </div>

      {/* Marketing emails */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("privacy.marketingEmails")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("auth:consent.marketing")}
          </p>
          {marketingError && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {t("privacy.updateFailed")}
            </p>
          )}
        </div>
        <Switch
          checked={participant?.marketingOptIn === true}
          disabled={savingMarketing}
          onCheckedChange={(v) => void handleToggleMarketing(v)}
        />
      </div>

      {/* What your agents remember — search & forget */}
      <div className="rounded-xl border border-border bg-card p-4 space-y-3">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("privacy.memories")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("privacy.memoriesDesc")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Input
            value={memoryQuery}
            onChange={(e) => setMemoryQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void handleMemorySearch();
            }}
            placeholder={t("privacy.memoriesSearchPlaceholder")}
            autoComplete="off"
          />
          <Button
            variant="outline"
            size="sm"
            onClick={() => void handleMemorySearch()}
            disabled={!canSearchMemories || memorySearching}
            className="flex-shrink-0"
          >
            {memorySearching ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Search className="w-3.5 h-3.5" />
            )}
          </Button>
        </div>
        {memoryError === "search" && (
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("privacy.memoriesSearchFailed")}
          </p>
        )}
        {memoryResults !== null && memoryResults.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("privacy.memoriesEmpty")}
          </p>
        )}
        {memoryResults !== null && memoryResults.length > 0 && (
          <>
            <div className="max-h-56 overflow-y-auto rounded-lg border border-border divide-y divide-border">
              {memoryResults.map((r) => {
                const key = memoryKey(r);
                return (
                  <label
                    key={key}
                    className="flex items-start gap-2.5 px-3 py-2 cursor-pointer hover:bg-muted/50"
                  >
                    <input
                      type="checkbox"
                      checked={memorySelected.has(key)}
                      onChange={() => toggleMemory(key)}
                      className="mt-0.5 h-3.5 w-3.5 accent-primary flex-shrink-0"
                    />
                    <span className="min-w-0">
                      <span className="block text-xs font-medium truncate">
                        {r.title || r.type.replace(/_/g, " ")}
                      </span>
                      {r.snippet && (
                        <span className="block text-xs text-muted-foreground truncate">
                          {r.snippet}
                        </span>
                      )}
                    </span>
                  </label>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="destructive"
                size="sm"
                onClick={() => void handleForgetMemories()}
                disabled={memorySelected.size === 0 || forgetting}
              >
                {forgetting ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Trash2 className="w-3.5 h-3.5" />
                )}
                {t("privacy.memoriesForget")}
              </Button>
              {memorySelected.size > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setMemorySelected(new Set())}
                  disabled={forgetting}
                >
                  {t("privacy.cancel")}
                </Button>
              )}
            </div>
          </>
        )}
        {memoryError === "forget" && (
          <p className="text-xs text-destructive flex items-center gap-1.5">
            <AlertCircle className="w-3.5 h-3.5" />
            {t("privacy.updateFailed")}
          </p>
        )}
        {forgotten && (
          <p className="text-xs text-success flex items-center gap-1.5">
            <Check className="w-3.5 h-3.5" />
            {t("privacy.memoriesForgotten")}
          </p>
        )}
      </div>

      {/* Delete account */}
      <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-destructive">
              {t("privacy.deleteAccount")}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("privacy.deleteAccountDesc")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setConfirmText("");
              setDeleteError(null);
              setDeleteOpen(true);
            }}
            className="flex-shrink-0 text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive/90"
          >
            <Trash2 className="w-3.5 h-3.5" />
            {t("privacy.deleteAccount")}
          </Button>
        </div>
      </div>

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteOpen}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("privacy.deleteConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("privacy.deleteConfirmBody")}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label className="text-xs">{t("privacy.deleteConfirmPrompt")}</Label>
            <Input
              value={confirmText}
              onChange={(e) => {
                setConfirmText(e.target.value);
                setDeleteError(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canDelete) handleDelete();
              }}
              placeholder="DELETE"
              autoFocus
              autoComplete="off"
            />
            {deleteError && (
              <p className="text-xs text-destructive">{deleteError}</p>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDeleteOpen(false)}
              disabled={deleting}
            >
              {t("privacy.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDelete}
              disabled={!canDelete || deleting}
            >
              {deleting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("privacy.deleting")}
                </>
              ) : (
                t("privacy.deleteConfirmCta")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
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
  const { t } = useTranslation("settings");
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
                {t(statusConfig.labelKey)}
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
