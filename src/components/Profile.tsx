import { useState, useEffect, useRef, useCallback } from "react";
import { Trans, useTranslation } from "react-i18next";
import { useAuthStore } from "../stores/authStore";
import { useThemeStore, type ThemePreference } from "../stores/themeStore";
import { useLocaleStore } from "../stores/localeStore";
import { useIntegrationStore } from "../stores/integrationStore";
import type { LocalePreference } from "../i18n";
import { LOCALE_LABELS, SUPPORTED_LOCALES } from "../i18n/generated";
import { isDesignSystemDebugOn, setDesignSystemDebug } from "../lib/designSystemDebug";
import { useLocalDeviceName } from "../hooks/useRunningElsewhere";
import * as api from "../lib/api";
import { identifyAnalytics, track, ANALYTICS_EVENTS } from "../lib/analytics";
import { cn } from "../lib/utils";
import { PaymentWalletRow } from "./PaymentWalletRow";
import { ProfileTour } from "./ProfileTour";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { getVersion } from "@tauri-apps/api/app";
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
  ShieldCheck,
  Sparkles,
  Download,
  Bug,
  Send,
  Bell,
  ListTodo,
  CheckCircle,
  Clock,
  AtSign,
  Bot,
  Languages,
} from "lucide-react";
import { deviceTimezone, filterTimezones, formatTimezoneLabel } from "../lib/timezones";
import { getInitials } from "../lib/utils";
import { uploadAvatar } from "../lib/imageProcessor";
import { FriendsView } from "./FriendsView";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import { openExternal } from "../lib/openExternal";
import { PROVIDERS } from "../lib/models";
import { useLlmKeyStore, type LlmApiKey as LlmApiKeyEntry } from "../stores/llmKeyStore";

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
  // Language and Timezone are their own rows, as on mobile — they were a
  // combined "Region" section, which buried two unrelated settings behind a
  // word neither of them uses. Same label keys mobile's rows use.
  { value: "language", labelKey: "language.label", icon: Languages },
  { value: "timezone", labelKey: "timezone.label", icon: Globe },
  { value: "notifications", labelKey: "sections.notifications", icon: Bell },
  { value: "memory", labelKey: "sections.memory", icon: Brain },
  { value: "llm-keys", labelKey: "sections.llmKeys", icon: Key },
  { value: "connections", labelKey: "sections.connections", icon: Link2 },
  { value: "privacy", labelKey: "privacy.title", icon: ShieldCheck },
  { value: "help", labelKey: "sections.help", icon: Bug },
] as const;

type SectionValue = (typeof SECTIONS)[number]["value"];

// ---------------------------------------------------------------------------
// Custom API persistence
// ---------------------------------------------------------------------------

// The custom endpoint is stored backend-side under the `custom` provider so
// agents can actually resolve it (encrypted at rest, walks the ownership
// chain). A single custom endpoint per user, with an API key plus any number
// of extra named values (secret ones encrypted).
// `existing` marks rows prefilled from stored fieldDefs on edit. A secret
// row's value is never returned by the server, so an existing secret with a
// blank value means "unchanged" and MUST still be submitted — dropping it
// would delete the field's definition (and stored value) server-side.
type CustomFieldRow = api.CredentialFieldInput & { existing?: boolean };

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function Profile({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation("settings");
  const { participant, logout } = useAuthStore();
  const [activeSection, setActiveSection] = useState<SectionValue>("profile");
  // Bumped to replay the first-run profile tour (bypasses the seen-flag).
  const [profileTourReplay, setProfileTourReplay] = useState(0);
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

  // ---- Per-agent access (issue #66) ----
  const [ownedAgents, setOwnedAgents] = useState<api.Agent[]>([]);
  // Connect-time scope, carried into the token dialog.
  const [connectScope, setConnectScope] =
    useState<api.CredentialGrantScope>("family");
  const [connectAgentIds, setConnectAgentIds] = useState<string[]>([]);
  // Standalone "Access" editor for an already-connected provider.
  const [accessDialog, setAccessDialog] = useState<{
    provider: api.ProviderInfo;
    credential: api.UserCredential;
  } | null>(null);
  const [accessScope, setAccessScope] =
    useState<api.CredentialGrantScope>("family");
  const [accessAgentIds, setAccessAgentIds] = useState<string[]>([]);
  const [savingAccess, setSavingAccess] = useState(false);

  // ---- Custom API state (backend `custom` provider) ----
  const [customApiDialog, setCustomApiDialog] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customEndpoint, setCustomEndpoint] = useState("");
  // What the API is / how to call it. This is the only thing that tells an
  // agent what lives behind the endpoint — without it, it has to guess.
  const [customDescription, setCustomDescription] = useState("");
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
      const [provRes, credRes, agentRes] = await Promise.all([
        api.listProviders(),
        api.listCredentials(),
        api.listAgents().catch(() => ({ agents: [] as api.Agent[] })),
      ]);
      setProviders(provRes.providers);
      setCredentials(credRes.credentials);
      setOwnedAgents(agentRes.agents ?? []);
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
            if (providerName === "google") {
              track(ANALYTICS_EVENTS.GOOGLE_ACCOUNT_CONNECTED);
            }
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
    // Seed the access selector from any existing grant, else family-wide.
    const existing = credentials.find((c) => c.provider === provider.name);
    setConnectScope(existing?.grantScope === "agents" ? "agents" : "family");
    setConnectAgentIds(existing?.grantedAgentIds ?? []);
  };

  const handleSubmitToken = async () => {
    if (!tokenDialogProvider || !tokenValue.trim()) return;
    setSavingToken(true);
    setTokenError(null);
    try {
      const { credential } = await api.storeProviderToken(
        tokenDialogProvider.name,
        tokenValue.trim(),
        {
          grantScope: connectScope,
          grantedAgentIds: connectScope === "agents" ? connectAgentIds : [],
        }
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

  const openAccessDialog = (
    provider: api.ProviderInfo,
    credential: api.UserCredential
  ) => {
    setAccessScope(credential.grantScope === "agents" ? "agents" : "family");
    setAccessAgentIds(credential.grantedAgentIds ?? []);
    setAccessDialog({ provider, credential });
  };

  const handleSaveAccess = async () => {
    if (!accessDialog) return;
    setSavingAccess(true);
    try {
      const { credential } = await api.setConnectionGrant(
        accessDialog.provider.name,
        accessScope,
        accessScope === "agents" ? accessAgentIds : [],
        accessDialog.credential.id
      );
      setCredentials((prev) =>
        prev.map((c) => (c.id === credential.id ? credential : c))
      );
      setAccessDialog(null);
    } catch (e) {
      setIntegrationError(
        e instanceof Error ? e.message : t("connections.errors.saveFailed")
      );
    } finally {
      setSavingAccess(false);
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
    setCustomDescription(customCredential?.description ?? "");
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
        existing: true,
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
    if (customAuthMode === "header") {
      if (!customAuthHeader.trim()) {
        setCustomApiError(t("customApis.errors.headerNameRequired"));
        return;
      }
      // An HTTP field name is an RFC 9110 token. Mirrors the backend's
      // write-time check so a pasted value in the name slot is caught here
      // instead of dying at call time with an opaque client error.
      if (!/^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/.test(customAuthHeader.trim())) {
        setCustomApiError(t("customApis.errors.headerNameInvalid"));
        return;
      }
    }

    setSavingCustomApi(true);
    setCustomApiError(null);
    try {
      // Keep existing secret rows even with a blank value: blank means
      // "unchanged" (the server never echoes secret values), and omitting
      // the row would delete the field server-side. Blank NON-secret rows
      // and never-filled new rows are genuinely empty — drop those.
      const fields = customFields
        .filter(
          (f) =>
            f.key.trim() !== "" &&
            (f.value.trim() !== "" || (f.secret && f.existing))
        )
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
              description: customDescription.trim(),
              label: customName.trim() || undefined,
              fields,
              authMode: customAuthMode,
              authHeader,
            })
          : await api.storeProviderToken("custom", customApiKey.trim(), {
              endpoint: customEndpoint.trim(),
              description: customDescription.trim(),
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
      {/* Vertical section rail — labelled rows, matching the agent-detail rail */}
      <div className="w-56 border-r border-border bg-muted/30 flex flex-col flex-shrink-0">
        {/* Avatar band, h-14 so its bottom border lines up with the content
            panel's header divider across the seam. */}
        <div className="h-14 shrink-0 flex items-center px-3 border-b border-border w-full">
          <Avatar className="h-8 w-8 rounded-lg">
            {participant?.avatarUrl && (
              <AvatarImage src={participant.avatarUrl} className="rounded-lg" />
            )}
            <AvatarFallback className="rounded-lg bg-primary/10 text-primary text-xs font-semibold">
              <User className="w-3.5 h-3.5" />
            </AvatarFallback>
          </Avatar>
        </div>

        {/* Scrolls on short windows — eleven labelled rows outgrow a small
            viewport where eleven icons didn't. */}
        <div className="flex flex-1 flex-col gap-0.5 py-3 px-2 overflow-y-auto">
          {visibleSections.map((section) => (
            <button
              key={section.value}
              onClick={() => setActiveSection(section.value)}
              className={cn(
                "w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors",
                activeSection === section.value
                  ? "bg-primary/10 text-primary font-medium"
                  : "text-muted-foreground hover:text-foreground hover:bg-accent"
              )}
            >
              <section.icon className="w-4 h-4 flex-shrink-0" />
              <span className="truncate" title={t(section.labelKey)}>
                {t(section.labelKey)}
              </span>
            </button>
          ))}

          {/* Close, pinned to the bottom of the rail. */}
          <div className="mt-auto pt-1">
            <Separator className="mb-1" />
            <button
              onClick={onClose}
              className="w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
            >
              <X className="w-4 h-4 flex-shrink-0" />
              <span className="truncate">{t("common:close")}</span>
            </button>
          </div>
        </div>
      </div>

      {/* Content panel */}
      <div className="flex-1 flex flex-col min-h-0 min-w-0 overflow-hidden">
        {/* Header */}
        <div className="h-14 px-5 border-b border-border flex items-center gap-2.5 flex-shrink-0">
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

        {activeSection === "language" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <LanguageSection />
          </div>
        )}

        {activeSection === "timezone" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <TimezoneSection />
            {/* Device nickname sits with Timezone: both describe THIS
                machine, and the timezone picker offers "use device". */}
            <Separator />
            <DeviceSection />
          </div>
        )}

        {activeSection === "notifications" && (
          <div className="flex-1 overflow-y-auto p-5">
            <NotificationsSection />
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
                      <p className="flex items-center gap-1 text-[11px] text-muted-foreground truncate mt-0.5">
                        <Users className="w-3 h-3 flex-shrink-0" />
                        {customCredential.grantScope === "agents"
                          ? t("integrations.access.someAgents", {
                              count: customCredential.grantedAgentIds?.length ?? 0,
                            })
                          : t("integrations.access.allAgents")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 flex-shrink-0">
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground"
                        onClick={() =>
                          openAccessDialog(
                            providers.find((p) => p.name === "custom") ?? {
                              name: "custom",
                              type: "api_token",
                              displayName: t("customApis.title"),
                            },
                            customCredential
                          )
                        }
                        title={t("integrations.access.button")}
                      >
                        <Users className="w-3.5 h-3.5" />
                      </Button>
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
                        onEditAccess={() =>
                          credential && openAccessDialog(provider, credential)
                        }
                        onDisconnect={() =>
                          setDisconnectProvider(provider.name)
                        }
                      />
                    );
                  })}
                </div>
              )}
            </section>

            {/* Payment — its own category (matches web), not just another row
                in the Connected Accounts list. Behind the `payments_wallet`
                flag; the backend routes 404 when it's off. */}
            {participant?.features?.payments_wallet === true && (
              <section>
                <SectionHeader
                  title={t("wallet.title")}
                  subtitle={t("wallet.description")}
                />
                <div className="rounded-xl border border-border bg-card divide-y divide-border overflow-hidden">
                  <PaymentWalletRow />
                </div>
              </section>
            )}
          </div>
        )}

        {activeSection === "privacy" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <PrivacyDataSection />
          </div>
        )}

        {activeSection === "help" && (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <BugReportSection />
            <Separator />
            <button
              onClick={() => setProfileTourReplay((n) => n + 1)}
              className="text-sm text-primary hover:underline"
            >
              {t("profileTour.replay")}
            </button>
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

            {/* Per-agent access (issue #66). Defaults to All agents. */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("integrations.access.title")}</Label>
              <p className="text-[11px] text-muted-foreground">
                {t("integrations.access.help")}
              </p>
              <ScopeSelector
                scope={connectScope}
                onScope={setConnectScope}
                agentIds={connectAgentIds}
                onToggleAgent={(id) =>
                  setConnectAgentIds((prev) =>
                    prev.includes(id)
                      ? prev.filter((x) => x !== id)
                      : [...prev, id]
                  )
                }
                agents={ownedAgents}
              />
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
      {/* AGENT ACCESS DIALOG (issue #66)                                   */}
      {/* ================================================================= */}
      <Dialog
        open={!!accessDialog}
        onOpenChange={(open) => {
          if (!open) setAccessDialog(null);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {t("integrations.access.editTitle", {
                name: accessDialog?.provider.displayName ?? "",
              })}
            </DialogTitle>
            <DialogDescription>
              {t("integrations.access.help")}
            </DialogDescription>
          </DialogHeader>
          <div className="py-2">
            <ScopeSelector
              scope={accessScope}
              onScope={setAccessScope}
              agentIds={accessAgentIds}
              onToggleAgent={(id) =>
                setAccessAgentIds((prev) =>
                  prev.includes(id)
                    ? prev.filter((x) => x !== id)
                    : [...prev, id]
                )
              }
              agents={ownedAgents}
            />
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setAccessDialog(null)}
            >
              {t("common:cancel")}
            </Button>
            <Button size="sm" onClick={handleSaveAccess} disabled={savingAccess}>
              {savingAccess ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  {t("common:saving")}
                </>
              ) : (
                t("common:save")
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
            {/* The agent's only source of truth for what this endpoint serves.
                Without it the prompt carries a bare hostname and the model has
                to guess paths and schema. */}
            <div className="space-y-1.5">
              <Label className="text-xs">{t("customApis.description")}</Label>
              <Textarea
                value={customDescription}
                onChange={(e) => {
                  setCustomDescription(e.target.value);
                  setCustomApiError(null);
                }}
                placeholder={t("customApis.descriptionPlaceholder")}
                className="min-h-16 text-xs"
              />
              <p className="text-muted-foreground text-xs">
                {t("customApis.descriptionHint")}
              </p>
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
                  <SelectValue>
                    {(val: unknown) => {
                      const v = String(val);
                      if (v === "bearer") return t("customApis.authBearer");
                      if (v === "header") return t("customApis.authHeader");
                      return t("customApis.authNone");
                    }}
                  </SelectValue>
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
                          ? field.existing
                            ? t("customApis.unchanged")
                            : t("customApis.valueEncryptedPlaceholder")
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

      <ProfileTour replay={profileTourReplay} />
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
  // Collapsed by default (matches web): the summary shows the current zone;
  // the search + long list only appear once the user chooses to change it, so
  // the section doesn't take a screenful of timezones at rest.
  const [open, setOpen] = useState(false);
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
      setOpen(false);
      setQuery("");
    } catch (err) {
      console.warn("[Tz] update failed:", err);
    } finally {
      setSaving(null);
    }
  }, []);

  return (
    <div className="space-y-2">
      <Label className="text-xs">{t("timezone.label")}</Label>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:bg-accent"
      >
        <div className="flex min-w-0 items-center gap-3">
          <Globe className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0">
            <p className="text-sm font-medium">{formatTimezoneLabel(current)}</p>
            <p className="truncate text-[11px] text-muted-foreground">{current}</p>
          </div>
        </div>
        <span className="text-xs text-muted-foreground">
          {open ? t("common:close") : t("common:change")}
        </span>
      </button>

      {open && (
      <div className="rounded-lg border border-border bg-card">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2">
          <Search className="h-3.5 w-3.5 text-muted-foreground" />
          <input
            autoFocus
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
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// This computer — a friendly nickname for the machine the desktop app runs
// on. The raw OS name (e.g. "DE-34002938") stays the identity everywhere;
// the nickname is what presence strings show on every client. Hidden when
// Tauri can't report the device name (e.g. plain-browser dev).
// ---------------------------------------------------------------------------

function DeviceSection() {
  const { t } = useTranslation("settings");
  const myDevice = useLocalDeviceName();
  const [nickname, setNickname] = useState("");
  const [savedNickname, setSavedNickname] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!myDevice) return;
    let mounted = true;
    api
      .listDeviceNicknames()
      .then((devices) => {
        if (!mounted) return;
        const mine = devices.find((d) => d.deviceName === myDevice);
        setNickname(mine?.nickname ?? "");
        setSavedNickname(mine?.nickname ?? "");
        setLoaded(true);
      })
      .catch(() => {
        if (mounted) setLoaded(true);
      });
    return () => {
      mounted = false;
    };
  }, [myDevice]);

  if (!myDevice) return null;

  const dirty = nickname.trim() !== savedNickname;

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      const res = await api.setDeviceNickname(myDevice, nickname.trim() || null);
      setSavedNickname(res.nickname ?? "");
      setNickname(res.nickname ?? "");
      setJustSaved(true);
      setTimeout(() => setJustSaved(false), 2000);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("device.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4">
      <div>
        <Label className="text-xs">{t("device.title")}</Label>
        <p className="mt-1 flex items-center gap-2 text-sm font-medium">
          <Monitor className="h-4 w-4 text-muted-foreground" />
          {savedNickname || myDevice}
        </p>
        {savedNickname && (
          <p className="text-[11px] text-muted-foreground">{myDevice}</p>
        )}
        <p className="mt-2 text-[11px] text-muted-foreground">
          {t("device.detail")}
        </p>
      </div>

      <div className="space-y-1.5">
        <Label className="text-xs" htmlFor="device-nickname">
          {t("device.nicknameLabel")}
        </Label>
        <div className="flex items-center gap-2">
          <Input
            id="device-nickname"
            value={nickname}
            disabled={!loaded || saving}
            maxLength={100}
            placeholder={t("device.nicknamePlaceholder")}
            onChange={(e) => setNickname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && dirty && !saving) void save();
            }}
            className="max-w-xs"
          />
          <Button
            size="sm"
            onClick={() => void save()}
            disabled={!loaded || saving || !dirty}
          >
            {saving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : justSaved ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              t("device.save")
            )}
          </Button>
        </div>
        {error && <p className="text-[11px] text-destructive">{error}</p>}
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

  // Endonyms (LOCALE_LABELS) are never translated. Text-only cards (no
  // per-language icon) — matches the web app and keeps the grid compact
  // vertically.
  const options: { value: LocalePreference; label: string }[] = [
    { value: "system", label: t("language.system") },
    ...SUPPORTED_LOCALES.map((locale) => ({
      value: locale as LocalePreference,
      label: LOCALE_LABELS[locale],
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
          const selected = preference === opt.value;
          return (
            <button
              key={opt.value}
              type="button"
              onClick={() => setPreference(opt.value)}
              className={cn(
                "flex items-center justify-center rounded-lg border px-3 py-2 text-center text-xs font-medium transition-colors",
                selected
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
              aria-pressed={selected}
            >
              {opt.label}
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
// Notifications Section — per-type push toggles (mirrors the web app).
// ---------------------------------------------------------------------------

interface NotificationPrefs {
  messages: boolean;
  task_assigned: boolean;
  task_completed: boolean;
  task_reminders: boolean;
  agent_activity: boolean;
  mentions: boolean;
  invites: boolean;
}

const DEFAULT_NOTIFICATION_PREFS: NotificationPrefs = {
  messages: true,
  task_assigned: true,
  task_completed: true,
  task_reminders: true,
  agent_activity: true,
  mentions: true,
  invites: true,
};

// `i18nKey` resolves under settings:notificationPrefs.* (label) and
// settings:notificationPrefs.descriptions.* (description).
const NOTIFICATION_ITEMS: {
  key: keyof NotificationPrefs;
  icon: React.ElementType;
  i18nKey: string;
}[] = [
  { key: "messages", icon: Bell, i18nKey: "messages" },
  { key: "task_assigned", icon: ListTodo, i18nKey: "taskAssigned" },
  { key: "task_completed", icon: CheckCircle, i18nKey: "taskCompleted" },
  { key: "task_reminders", icon: Clock, i18nKey: "taskReminders" },
  { key: "agent_activity", icon: Bot, i18nKey: "agentActivity" },
  { key: "mentions", icon: AtSign, i18nKey: "mentions" },
  { key: "invites", icon: Mail, i18nKey: "invites" },
];

function NotificationsSection() {
  const { t } = useTranslation("settings");
  const [prefs, setPrefs] = useState<NotificationPrefs>(DEFAULT_NOTIFICATION_PREFS);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api
      .request<{ notificationPreferences: NotificationPrefs }>(
        "/api/me/notification-preferences"
      )
      .then((data) =>
        setPrefs({ ...DEFAULT_NOTIFICATION_PREFS, ...data.notificationPreferences })
      )
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const handleToggle = useCallback(async (key: keyof NotificationPrefs) => {
    let newValue = false;
    setPrefs((p) => {
      newValue = !p[key];
      return { ...p, [key]: newValue };
    });
    try {
      await api.request("/api/me/notification-preferences", {
        method: "PATCH",
        body: JSON.stringify({ [key]: newValue }),
      });
    } catch {
      setPrefs((p) => ({ ...p, [key]: !newValue }));
    }
  }, []);

  if (!loaded) {
    return (
      <div className="flex justify-center py-4">
        <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {NOTIFICATION_ITEMS.map(({ key, icon: Icon, i18nKey }) => (
        <div key={key} className="flex items-center gap-3 rounded-lg px-2 py-2.5">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-medium">{t(`notificationPrefs.${i18nKey}`)}</p>
            <p className="text-[11px] text-muted-foreground">
              {t(`notificationPrefs.descriptions.${i18nKey}`)}
            </p>
          </div>
          <Switch checked={prefs[key]} onCheckedChange={() => handleToggle(key)} />
        </div>
      ))}
    </div>
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
  const { t } = useTranslation("settings");
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
      // The composer's mic gates on this — re-read it so voice notes light
      // up without a reload.
      await useIntegrationStore.getState().refresh({ force: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("memory.saveError"));
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
      await useIntegrationStore.getState().refresh({ force: true });
    } catch (e) {
      setError(e instanceof Error ? e.message : t("memory.disconnectError"));
    } finally {
      setDisconnecting(false);
    }
  };

  return (
    <>
      <section>
        <SectionHeader
          title={t("memory.title")}
          subtitle={t("memory.subtitle")}
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
                <p className="text-sm font-medium truncate">{t("memory.openaiKey")}</p>
                {isConnected ? (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground truncate mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                    <span className="truncate">
                      {t("memory.activeStatus")}
                      {openaiCred?.lastUsedAt &&
                        ` · ${t("memory.lastUsed", {
                          date: new Date(openaiCred.lastUsedAt).toLocaleDateString(),
                        })}`}
                    </span>
                  </p>
                ) : hasIssue ? (
                  <p className="flex items-center gap-1.5 text-xs text-destructive truncate mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive flex-shrink-0" />
                    <span className="truncate">
                      {isRevoked
                        ? t("memory.revokedStatus")
                        : t("memory.failedStatus")}
                    </span>
                  </p>
                ) : (
                  <p className="text-xs text-muted-foreground truncate mt-0.5">
                    {t("memory.notConfigured")}
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
                  {t("memory.remove")}
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
                      aria-label={showKey ? t("memory.hideKey") : t("memory.showKey")}
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
                      t("common:save")
                    )}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">
                  {t("memory.keyHelp")} {t("memory.getKeyPrefix")}{" "}
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
                {t("memory.savedConfirm")}
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
                {t("memory.localModel")}
              </p>
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {t("memory.localModelDesc")}
              </p>
            </div>
            <Badge variant="secondary" className="text-[10px] py-0 flex-shrink-0">
              {t("memory.comingSoon")}
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
            <DialogTitle>{t("memory.removeTitle")}</DialogTitle>
            <DialogDescription>
              {t("memory.removeBody")}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmDisconnect(false)}
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
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                t("memory.remove")
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
    // Consent changes land here — re-sync so an analytics opt-out stops
    // capture immediately (and an opt-in starts it).
    void identifyAnalytics(updated);
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

  // ---- Usage-analytics consent ----
  const [savingAnalytics, setSavingAnalytics] = useState(false);
  const [analyticsError, setAnalyticsError] = useState(false);
  const handleToggleAnalytics = async (value: boolean) => {
    setSavingAnalytics(true);
    setAnalyticsError(false);
    try {
      const updated = await api.updateConsent({ analyticsOptIn: value });
      persist(updated);
    } catch {
      setAnalyticsError(true);
    } finally {
      setSavingAnalytics(false);
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

  // ---- Start Fresh (account reset) ----
  const [freshOpen, setFreshOpen] = useState(false);
  const [freshRunning, setFreshRunning] = useState(false);
  const [freshError, setFreshError] = useState<string | null>(null);

  const handleStartFresh = async () => {
    if (freshRunning) return;
    setFreshRunning(true);
    setFreshError(null);
    try {
      await api.startFresh();
      // The account reset clears metadata.tours_seen server-side, so the
      // first-run tours (agent-pane + conversation) replay after the reload —
      // no client-side FTUE bookkeeping needed (the flags roam via /me now).
      // The wipe invalidates essentially every client store (conversations,
      // agents, presence, joined channels). Reload to re-bootstrap from the
      // fresh backend state; the onboarding cards reappear because the
      // account has no agents.
      window.location.reload();
    } catch (e) {
      setFreshError(
        e instanceof Error ? e.message : t("privacy.updateFailed")
      );
      setFreshRunning(false);
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
    <div className="space-y-4">
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

      {/* Usage analytics (product analytics consent) */}
      <div className="rounded-xl border border-border bg-card p-4 flex items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("privacy.usageAnalytics")}</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            {t("privacy.usageAnalyticsDesc")}
          </p>
          {analyticsError && (
            <p className="text-xs text-destructive mt-1 flex items-center gap-1.5">
              <AlertCircle className="w-3.5 h-3.5" />
              {t("privacy.updateFailed")}
            </p>
          )}
        </div>
        <Switch
          checked={participant?.analyticsOptIn === true}
          disabled={savingAnalytics}
          onCheckedChange={(v) => void handleToggleAnalytics(v)}
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

      {/* Start Fresh — wipes agents/conversations/settings via
          /api/account/reset; nothing is re-provisioned, the first-run setup
          cards reappear after the reload. */}
      <div className="rounded-xl border border-border bg-card p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium">{t("advanced.startFresh")}</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {t("advanced.startFreshDescription")}
            </p>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              setFreshError(null);
              setFreshOpen(true);
            }}
            className="flex-shrink-0"
          >
            <Sparkles className="w-3.5 h-3.5" />
            {t("advanced.startFreshConfirmCta")}
          </Button>
        </div>
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

      {/* Start Fresh confirmation dialog */}
      <Dialog
        open={freshOpen}
        onOpenChange={(open) => {
          if (!open && !freshRunning) setFreshOpen(false);
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("advanced.startFreshConfirmTitle")}</DialogTitle>
            <DialogDescription>
              {t("advanced.startFreshConfirmMessage")}
            </DialogDescription>
          </DialogHeader>
          {freshError && (
            <p className="text-xs text-destructive">{freshError}</p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setFreshOpen(false)}
              disabled={freshRunning}
            >
              {t("privacy.cancel")}
            </Button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => void handleStartFresh()}
              disabled={freshRunning}
            >
              {freshRunning ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                t("advanced.startFreshConfirmCta")
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

// ---------------------------------------------------------------------------
// Report a Bug (#81) — user-facing bug report form.
// ---------------------------------------------------------------------------

type BugSeverity = "critical" | "high" | "medium" | "low" | "info";

const BUG_SEVERITIES: { value: BugSeverity; labelKey: string }[] = [
  { value: "critical", labelKey: "bugReport.severityCritical" },
  { value: "high", labelKey: "bugReport.severityHigh" },
  { value: "medium", labelKey: "bugReport.severityMedium" },
  { value: "low", labelKey: "bugReport.severityLow" },
  { value: "info", labelKey: "bugReport.severityInfo" },
];

/**
 * Report-a-Bug form (desktop slice of #63). Submits to the async
 * POST /api/bug-reports (202) via api.reportBug; client metadata
 * (platform / app_version / screen / timestamp) is attached
 * automatically. Optimistic "filed!" feedback on 2xx.
 */
function BugReportSection() {
  const { t } = useTranslation("settings");
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [severity, setSeverity] = useState<BugSeverity>("medium");
  const [status, setStatus] = useState<
    "idle" | "sending" | "sent" | "error" | "rate_limited"
  >("idle");
  const [titleError, setTitleError] = useState(false);

  const reset = useCallback(() => {
    setTitle("");
    setDetails("");
    setSeverity("medium");
    setStatus("idle");
    setTitleError(false);
  }, []);

  const submit = useCallback(async () => {
    const trimmed = title.trim();
    if (!trimmed) {
      setTitleError(true);
      return;
    }
    setTitleError(false);
    setStatus("sending");
    try {
      const appVersion = await getVersion().catch(() => "unknown");
      await api.reportBug({
        title: trimmed,
        description: details.trim() || undefined,
        severity,
        platform: "desktop",
        app_version: appVersion,
        screen: window.location.hash || window.location.pathname,
        client_timestamp: new Date().toISOString(),
      });
      setStatus("sent");
    } catch (err) {
      const httpStatus = (err as { status?: number })?.status;
      setStatus(httpStatus === 429 ? "rate_limited" : "error");
    }
  }, [title, details, severity]);

  if (status === "sent") {
    return (
      <div className="space-y-3">
        <SectionHeader title={t("bugReport.title")} />
        <div className="flex items-start gap-2 rounded-lg border border-primary/30 bg-primary/5 p-4">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
          <div className="space-y-1">
            <p className="text-sm font-medium">{t("bugReport.sentTitle")}</p>
            <p className="text-xs text-muted-foreground">
              {t("bugReport.sentMessage")}
            </p>
          </div>
        </div>
        <Button variant="outline" size="sm" onClick={reset}>
          {t("bugReport.title")}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-4 max-w-lg">
      <SectionHeader
        title={t("bugReport.title")}
        subtitle={t("bugReport.subtitle")}
      />

      <div className="space-y-1.5">
        <Label htmlFor="bug-title">{t("bugReport.titleLabel")}</Label>
        <Input
          id="bug-title"
          value={title}
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError) setTitleError(false);
          }}
          placeholder={t("bugReport.titlePlaceholder")}
          maxLength={200}
        />
        {titleError && (
          <p className="flex items-center gap-1 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            {t("bugReport.titleRequired")}
          </p>
        )}
      </div>

      <div className="space-y-1.5">
        <Label htmlFor="bug-details">{t("bugReport.detailsLabel")}</Label>
        <Textarea
          id="bug-details"
          value={details}
          onChange={(e) => setDetails(e.target.value)}
          placeholder={t("bugReport.detailsPlaceholder")}
          rows={4}
        />
      </div>

      <div className="space-y-1.5">
        <Label>{t("bugReport.severityLabel")}</Label>
        <div className="flex flex-wrap gap-2">
          {BUG_SEVERITIES.map(({ value, labelKey }) => (
            <button
              key={value}
              type="button"
              onClick={() => setSeverity(value)}
              className={cn(
                "rounded-md border px-3 py-1.5 text-xs font-medium transition-colors",
                severity === value
                  ? "border-primary bg-primary/5 text-primary"
                  : "border-border hover:bg-accent"
              )}
            >
              {t(labelKey)}
            </button>
          ))}
        </div>
      </div>

      {status === "error" && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {t("bugReport.errorMessage")}
        </p>
      )}
      {status === "rate_limited" && (
        <p className="flex items-center gap-1 text-xs text-destructive">
          <AlertCircle className="h-3 w-3" />
          {t("bugReport.rateLimited")}
        </p>
      )}

      <Button size="sm" onClick={submit} disabled={status === "sending"}>
        {status === "sending" ? (
          <>
            <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            {t("bugReport.submitting")}
          </>
        ) : (
          <>
            <Send className="mr-1.5 h-3 w-3" />
            {t("bugReport.submit")}
          </>
        )}
      </Button>
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

// Reusable "All agents / Select agents…" selector plus an agent checkbox list.
// Per-agent scoping for connected accounts (issue #66).
function ScopeSelector({
  scope,
  onScope,
  agentIds,
  onToggleAgent,
  agents,
}: {
  scope: api.CredentialGrantScope;
  onScope: (s: api.CredentialGrantScope) => void;
  agentIds: string[];
  onToggleAgent: (id: string) => void;
  agents: api.Agent[];
}) {
  const { t } = useTranslation("settings");

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button
          type="button"
          variant={scope === "family" ? "default" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => onScope("family")}
        >
          {t("integrations.access.allAgents")}
        </Button>
        <Button
          type="button"
          variant={scope === "agents" ? "default" : "outline"}
          size="sm"
          className="flex-1"
          onClick={() => onScope("agents")}
        >
          {t("integrations.access.selectAgents")}
        </Button>
      </div>

      {scope === "agents" &&
        (agents.length === 0 ? (
          <p className="text-xs text-muted-foreground">
            {t("integrations.access.noAgents")}
          </p>
        ) : (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
            {agents.map((a) => {
              const on = agentIds.includes(a.id);
              return (
                <button
                  key={a.id}
                  type="button"
                  onClick={() => onToggleAgent(a.id)}
                  className="flex w-full items-center gap-2.5 px-3 py-2 text-left hover:bg-muted/50"
                >
                  <span
                    className={cn(
                      "flex h-4 w-4 flex-shrink-0 items-center justify-center rounded border",
                      on
                        ? "bg-primary border-primary text-primary-foreground"
                        : "border-border"
                    )}
                  >
                    {on && <Check className="h-3 w-3" />}
                  </span>
                  <span className="truncate text-sm">{a.displayName}</span>
                </button>
              );
            })}
          </div>
        ))}
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
  onEditAccess,
  onDisconnect,
}: {
  provider: api.ProviderInfo;
  credential?: api.UserCredential;
  icon: React.ElementType;
  isConnecting: boolean;
  onConnectOAuth: () => void;
  onConnectToken: () => void;
  onEditAccess: () => void;
  onDisconnect: () => void;
}) {
  const { t } = useTranslation("settings");
  const isConnected = !!credential;
  const status = credential?.status;
  const statusConfig = status ? STATUS_CONFIG[status] : null;
  const accessSummary =
    credential?.grantScope === "agents"
      ? t("integrations.access.someAgents", {
          count: credential.grantedAgentIds?.length ?? 0,
        })
      : t("integrations.access.allAgents");

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
              {provider.description
                ? t(`integrations.providers.${provider.name}`, {
                    defaultValue: provider.description,
                  })
                : t("integrations.notConnected")}
            </p>
          )}
        </div>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          {isConnecting ? (
            <Button variant="outline" size="sm" disabled>
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("integrations.waiting")}
            </Button>
          ) : isConnected ? (
            <>
              <Button
                variant="ghost"
                size="sm"
                onClick={onEditAccess}
                className="text-muted-foreground hover:text-foreground"
              >
                <Users className="w-3.5 h-3.5" />
                {t("integrations.access.button")}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={onDisconnect}
                className="text-muted-foreground hover:text-destructive"
              >
                {t("common:disconnect")}
              </Button>
            </>
          ) : provider.type === "oauth2" ? (
            <Button variant="outline" size="sm" onClick={onConnectOAuth}>
              <ExternalLink className="w-3.5 h-3.5" />
              {t("common:connect")}
            </Button>
          ) : (
            <Button variant="outline" size="sm" onClick={onConnectToken}>
              <Key className="w-3.5 h-3.5" />
              {t("common:connect")}
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

      {/* Per-agent access summary (issue #66) */}
      {credential && (
        <p className="ml-11 mt-1 flex items-center gap-1 text-[11px] text-muted-foreground truncate">
          <Users className="w-3 h-3 flex-shrink-0" />
          {accessSummary}
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
  const { t } = useTranslation("settings");
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
          {t("connections.reconnectAll")}
        </button>
      )}
    </div>
  );
}
