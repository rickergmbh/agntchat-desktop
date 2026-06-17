const DEFAULT_API_URL = "https://agentchat-backend.fly.dev";

export function getApiUrl(): string {
  return localStorage.getItem("apiUrl") || DEFAULT_API_URL;
}

function getToken(): string | null {
  return localStorage.getItem("authToken");
}

export async function request<T>(
  path: string,
  options: RequestInit = {},
  _attempt = 0
): Promise<T> {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(options.headers as Record<string, string>),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`${getApiUrl()}${path}`, {
    ...options,
    headers,
  });

  if (res.status === 401) {
    localStorage.removeItem("authToken");
    localStorage.removeItem("participant");
    window.dispatchEvent(new Event("auth:expired"));
    const err = new Error("Authentication expired") as Error & { status?: number };
    err.status = 401;
    throw err;
  }

  // Retry on 429 with exponential backoff (up to 3 attempts)
  if (res.status === 429 && _attempt < 3) {
    const delay = Math.min(1000 * Math.pow(2, _attempt), 8000);
    await new Promise((r) => setTimeout(r, delay));
    return request<T>(path, options, _attempt + 1);
  }

  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    const message =
      body?.error?.message ||
      (typeof body?.error === "string" ? body.error : null) ||
      `Request failed: ${res.status}`;
    const err = new Error(message) as Error & {
      status?: number;
      code?: string;
    };
    err.status = res.status;
    if (body?.error?.code) err.code = body.error.code;
    throw err;
  }

  // 204 No Content (and rare 205) carries no body — calling res.json()
  // throws SyntaxError, which used to surface as a spurious "request
  // failed" in callers that just await void DELETEs. Return undefined
  // and let TypeScript callers treat it as Promise<void>.
  if (res.status === 204 || res.status === 205) {
    return undefined as T;
  }

  return res.json();
}

// Reminders
/** Re-arm a fired date reminder `minutes` from now (human owner action). */
export async function snoozeReminder(
  reminderId: string,
  minutes = 60
): Promise<void> {
  await request(`/api/reminders/${reminderId}/snooze`, {
    method: "POST",
    body: JSON.stringify({ minutes }),
  });
}

// Agents
/**
 * Ask the backend to bring an offline agent back online.
 *
 * The backend picks the mechanism by runtime: for an org-host agent it
 * forces a clean restart of the bridge on its host (recovering even a
 * wedged, alive-but-disconnected bridge); for a webhook agent it POSTs the
 * wake_url. Mirrors the mobile "tap to wake" affordance.
 */
export async function wakeAgent(
  agentId: string
): Promise<{ woken: boolean; status?: string; reason?: string }> {
  return request(`/api/agents/${agentId}/wake`, { method: "POST" });
}

/**
 * Bulk "bring my hosted agents online" — owner-scoped restart of the caller's
 * own org-host agents (e.g. after a host restart left a fleet offline). Pass the
 * ids the UI shows as offline; the server re-checks ownership/runtime.
 */
export async function restartHostedAgents(
  agentIds: string[]
): Promise<{ restarted: number; total: number }> {
  return request(`/api/agents/restart-hosted`, {
    method: "POST",
    body: JSON.stringify({ agentIds }),
  });
}

// Auth
export async function login(
  email: string,
  password: string
): Promise<{ token: string; participant: Participant }> {
  return request("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
}

export async function signup(
  email: string,
  password: string,
  displayName?: string
): Promise<{ token: string; participant: Participant }> {
  return request("/api/auth/signup", {
    method: "POST",
    body: JSON.stringify({ email, password, displayName }),
  });
}

// Profile
export async function getProfile(): Promise<Participant> {
  return request("/api/me");
}

// Backend returns the serialized participant directly (participant_self),
// not wrapped in { participant }. `tagline` lives in metadata (140-char cap
// server-side); `description` is the longer free-form bio.
export async function updateProfile(data: {
  displayName?: string;
  description?: string;
  tagline?: string;
  avatarUrl?: string;
}): Promise<Participant> {
  return request("/api/me", {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function setActiveOrganization(orgId: string): Promise<Participant> {
  return request("/api/me/active-organization", {
    method: "PATCH",
    body: JSON.stringify({ organizationId: orgId }),
  });
}

// --- Workspace management (stage 3) ---

export interface PendingWorkspaceInvite {
  id: string;
  organizationId: string;
  organizationName?: string;
  role: "admin" | "member";
  expiresAt?: string;
}

export async function listPendingWorkspaceInvites(): Promise<PendingWorkspaceInvite[]> {
  const res = await request<{ invites: PendingWorkspaceInvite[] }>(
    "/api/me/pending-invites"
  );
  return res.invites;
}

export async function acceptPendingWorkspaceInvite(inviteId: string): Promise<void> {
  await request(`/api/me/pending-invites/${inviteId}/accept`, { method: "POST" });
}

export async function renameOrganization(orgId: string, name: string): Promise<void> {
  await request(`/api/organizations/${orgId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** Set or clear the workspace avatar URL. Pass null to remove. */
export async function setOrganizationAvatar(
  orgId: string,
  avatarUrl: string | null
): Promise<void> {
  await request(`/api/organizations/${orgId}`, {
    method: "PATCH",
    body: JSON.stringify({ avatarUrl }),
  });
}

export async function deleteOrganization(orgId: string): Promise<void> {
  await request(`/api/organizations/${orgId}`, { method: "DELETE" });
}

export async function removeOrganizationMember(
  orgId: string,
  participantId: string
): Promise<void> {
  await request(`/api/organizations/${orgId}/members/${participantId}`, {
    method: "DELETE",
  });
}

export async function updateOrganizationMemberRole(
  orgId: string,
  participantId: string,
  role: "owner" | "admin" | "member"
): Promise<void> {
  await request(`/api/organizations/${orgId}/members/${participantId}`, {
    method: "PATCH",
    body: JSON.stringify({ role }),
  });
}

// Agents
export async function listAgents(): Promise<{ agents: Agent[] }> {
  return request("/api/agents");
}

export async function getAgent(id: string): Promise<Agent> {
  return request(`/api/agents/${id}`);
}

export async function createAgent(data: {
  displayName: string;
  description?: string;
  agentType?: string;
  capabilities?: string[];
  avatarUrl?: string;
  requiresLocation?: boolean;
  soulMd?: string;
  modelConfig?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
  organizationId?: string | null;
}): Promise<{ agent: Agent; apiKey: string }> {
  // Backend returns flat: { id, displayName, ..., apiKey }
  const resp = await request<Agent & { apiKey: string }>("/api/agents", {
    method: "POST",
    body: JSON.stringify(data),
  });
  const { apiKey, ...agentFields } = resp;
  return { agent: agentFields as Agent, apiKey };
}

export async function updateAgent(
  id: string,
  data: Record<string, unknown>
): Promise<{ agent: Agent }> {
  return request(`/api/agents/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteAgent(id: string): Promise<void> {
  await request(`/api/agents/${id}`, { method: "DELETE" });
}

export async function deleteAgentPermanently(
  id: string,
  confirmName: string
): Promise<void> {
  await request(`/api/agents/${id}/delete-permanent`, {
    method: "POST",
    body: JSON.stringify({ confirmName }),
  });
}

// Connections
export async function listConnections(): Promise<{ connections: Connection[] }> {
  return request("/api/connections");
}

export async function revokeConnection(id: string): Promise<void> {
  await request(`/api/connections/${id}`, { method: "DELETE" });
}

export interface Connection {
  id: string;
  requesterId: string;
  agentId: string;
  ownerId: string;
  status: string;
  requesterName?: string;
  agentName?: string;
  insertedAt: string;
}

export async function presignAvatarUpload(
  filename: string,
  contentType: string,
  fileSize: number
): Promise<{ url: string; publicUrl: string }> {
  return request("/api/storage/presign", {
    method: "POST",
    body: JSON.stringify({ filename, contentType, fileSize }),
  });
}

export interface AvatarPolicy {
  maxBytes: number;
  targetSize: number;
  format: string;
  quality: number;
}

export async function fetchAvatarPolicy(): Promise<AvatarPolicy> {
  return request("/api/storage/avatar-policy");
}

export async function regenerateApiKey(
  id: string
): Promise<{ agent: Agent; apiKey: string }> {
  // Backend returns flat: { id, displayName, ..., apiKey }
  const data = await request<Agent & { apiKey: string }>(`/api/agents/${id}/regenerate-key`, { method: "POST" });
  const { apiKey, ...agentFields } = data;
  return { agent: agentFields as Agent, apiKey };
}

export async function updateModelConfig(
  id: string,
  config: Record<string, unknown>
): Promise<void> {
  await request(`/api/agents/${id}/model-config`, {
    method: "PATCH",
    body: JSON.stringify({ model_config: config }),
  });
}

export async function updateSoulMd(
  id: string,
  soulMd: string
): Promise<void> {
  await request(`/api/agents/${id}/soul`, {
    method: "PATCH",
    body: JSON.stringify({ soul_md: soulMd }),
  });
}

export async function revertSoulMd(id: string): Promise<Agent> {
  return request<Agent>(`/api/agents/${id}/soul/revert`, { method: "POST" });
}

/**
 * Ask the backend to rewrite the agent's soul.md from a natural-language
 * description of the changes. Returns the proposed markdown — it is NOT saved;
 * the caller reviews it and persists via `updateSoulMd`.
 */
export async function reviseSoulMd(
  id: string,
  instruction: string
): Promise<{ soulMd: string }> {
  return request(`/api/agents/${id}/soul/revise`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

export interface AgentRuntimeUpdate {
  runtime: "local" | "org_host";
  presenceMode?: "always_on" | "wake_on_demand" | "manual";
  idleTimeoutSeconds?: number | null;
  organizationId?: string | null;
  assignedHostId?: string | null;
}

export async function updateAgentRuntime(
  id: string,
  update: AgentRuntimeUpdate
): Promise<Agent> {
  const body = {
    runtime: update.runtime,
    presence_mode: update.presenceMode,
    idle_timeout_seconds: update.idleTimeoutSeconds,
    organization_id: update.organizationId,
    assigned_host_id: update.assignedHostId,
  };

  const res = await request<{ agent: Agent }>(`/api/agents/${id}/runtime`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
  return res.agent;
}

/** The LLM backend a hosted agent inherits from its assigned host. Hosted
 *  agents don't pick their own auth — they run under the host's seat, so the
 *  config UI locks the provider/connection to this and filters models to it. */
export interface AgentRuntimeOptions {
  runtime: "local" | "org_host";
  host?: { id: string; name: string; status: string } | null;
  /** Null for local agents. For hosted agents, the host's backend setup. */
  backend?: {
    /** Catalog provider id hosted agents run under (e.g. "claude_cli"). */
    backend: string;
    /** CLI connection the host's seat resolves to (e.g. "anthropic"). */
    connection: string;
    /** Whether the host confirmed a usable Claude seat. Null = host predates
     *  runtime reporting (assumed-default), so don't warn. */
    claudeSeat?: boolean | null;
    seatSource?: string | null;
  } | null;
}

/** Fetch what provider/connection/models a hosted agent's host can serve.
 *  Only meaningful for runtime="org_host" agents. */
export async function getAgentRuntimeOptions(
  id: string
): Promise<AgentRuntimeOptions> {
  return request<AgentRuntimeOptions>(`/api/agents/${id}/runtime-options`);
}

// Organizations

export interface Organization {
  id: string;
  name: string;
  slug: string;
  avatarUrl?: string | null;
  isPersonal?: boolean;
  ownerHumanId: string;
  settings?: Record<string, unknown>;
  insertedAt?: string;
  updatedAt?: string;
}

export interface OrganizationHost {
  id: string;
  organizationId: string;
  name: string;
  status: "registered" | "online" | "offline" | "disabled";
  lastSeenAt?: string | null;
  hostname?: string | null;
  version?: string | null;
  /** Number of agent bridges the host reported running in its last heartbeat. */
  agentCount?: number;
  /** Agent ids currently running on the host (from the last heartbeat). */
  runningAgentIds?: string[];
  /** Short git sha of the repo checkout the host is running. */
  hostGitSha?: string | null;
  capabilities?: Record<string, unknown>;
  /** SSH management-plane connection details. */
  sshHost?: string | null;
  sshPort?: number | null;
  sshUser?: string | null;
  bootstrappedAt?: string | null;
  provider?: string | null;
  /** Provider VM id this host runs on (e.g. the Hostinger VM). */
  providerVmId?: string | null;
  datacenter?: string | null;
  /** Shared (multi-tenant) host: accepts agents pinned from any org. */
  shared?: boolean;
  /**
   * Resident counts, present on the platform-admin host list
   * (`/api/admin/hosts`). `assignedAgentCount` = agents pinned here;
   * `onlineAgentCount` = how many of those the host reports running;
   * `userCount` = distinct human owners those agents roll up to.
   */
  assignedAgentCount?: number;
  onlineAgentCount?: number;
  userCount?: number;
}

/** An existing provider (Hostinger) VM the operator can register a host on. */
export interface ProviderVm {
  id: string;
  hostname?: string | null;
  ipv4?: string | null;
  state?: string | null;
  plan?: string | null;
  datacenter?: string | null;
}

/** One agent that runs on a host, with its resolved human owner. */
export interface HostAgent {
  id: string;
  display_name: string;
  presence_mode: string;
  assigned_host_id: string | null;
  running: boolean;
  owner: { id: string; display_name: string; type: string } | null;
}

export type HostOpKind =
  | "bootstrap"
  | "update"
  | "restart"
  | "set_token"
  | "probe";

/** One SSH management operation against a host. */
export interface HostOperation {
  id: string;
  hostId: string;
  kind: HostOpKind;
  status: "pending" | "running" | "ok" | "failed";
  output?: string | null;
  insertedAt: string;
  finishedAt?: string | null;
}

export interface OrganizationMembership {
  id: string;
  organizationId: string;
  participantId: string;
  role: "owner" | "admin" | "member";
  joinedAt: string;
  insertedAt: string;
  updatedAt?: string;
  participant?: {
    id: string;
    type: string;
    displayName?: string;
    avatarUrl?: string;
    status?: string;
  };
}

export async function listOrganizations(): Promise<Organization[]> {
  const res = await request<{ organizations: Organization[] }>(
    "/api/organizations"
  );
  return res.organizations;
}

export async function createOrganization(
  name: string,
  slug: string
): Promise<Organization> {
  const res = await request<{ organization: Organization }>(
    "/api/organizations",
    {
      method: "POST",
      body: JSON.stringify({ name, slug }),
    }
  );
  return res.organization;
}

export async function listOrganizationHosts(
  orgId: string
): Promise<OrganizationHost[]> {
  const res = await request<{ hosts: OrganizationHost[] }>(
    `/api/organizations/${orgId}/hosts`
  );
  return res.hosts;
}

export interface CreateHostResult {
  host: OrganizationHost;
  /** Plaintext API key — shown ONCE on creation. Server only persists the hash. */
  apiKey: string;
}

export async function createOrganizationHost(
  orgId: string,
  name: string
): Promise<CreateHostResult> {
  return request<CreateHostResult>(`/api/organizations/${orgId}/hosts`, {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/**
 * Mint a fresh API key for an existing host. UUID stays the same;
 * the old plaintext is invalidated immediately. Caller must hand the
 * new plaintext to the host operator (re-run enroll.sh / update host.env).
 */
export async function regenerateOrganizationHostApiKey(
  orgId: string,
  hostId: string
): Promise<CreateHostResult> {
  return request<CreateHostResult>(
    `/api/organizations/${orgId}/hosts/${hostId}/regenerate-key`,
    { method: "POST" }
  );
}

export async function deleteOrganizationHost(
  orgId: string,
  hostId: string
): Promise<void> {
  await request(`/api/organizations/${orgId}/hosts/${hostId}`, {
    method: "DELETE",
  });
}

/**
 * Fleet snapshot for an org: every host plus whether the org has a Claude
 * CLI subscription seat configured (drives the "Connect Anthropic" badge).
 */
export async function listOrganizationHostFleet(
  orgId: string
): Promise<{ hosts: OrganizationHost[]; anthropicConnected: boolean }> {
  const res = await request<{
    hosts: OrganizationHost[];
    anthropicConnected: boolean;
  }>(`/api/organizations/${orgId}/hosts`);
  return { hosts: res.hosts, anthropicConnected: !!res.anthropicConnected };
}

/** Agents running on a host, each with its resolved human owner. */
export async function listHostAgents(
  orgId: string,
  hostId: string
): Promise<HostAgent[]> {
  const res = await request<{ agents: HostAgent[] }>(
    `/api/organizations/${orgId}/hosts/${hostId}/agents`
  );
  return res.agents;
}

/**
 * Register a bring-your-own host the backend reaches over SSH. Mints a managed
 * keypair; returns the host + the public key to authorize on the machine.
 */
export async function connectHost(
  orgId: string,
  params: {
    name: string;
    sshHost: string;
    sshPort?: number;
    sshUser?: string;
    // Set when the operator picked an existing provider VM (carries provenance).
    provider?: string;
    providerVmId?: string;
    datacenter?: string | null;
  }
): Promise<{ host: OrganizationHost; publicKey: string }> {
  return request<{ host: OrganizationHost; publicKey: string }>(
    `/api/organizations/${orgId}/hosts/connect`,
    { method: "POST", body: JSON.stringify(params) }
  );
}

/** Existing provider (Hostinger) VMs the operator can register a host on. */
export async function listProviderVms(orgId: string): Promise<ProviderVm[]> {
  const res = await request<{ vms: ProviderVm[] }>(
    `/api/organizations/${orgId}/provisioning/vms`
  );
  return res.vms ?? [];
}

/** The host's authorized_keys public line (to install on the machine). */
export async function getHostPublicKey(
  orgId: string,
  hostId: string
): Promise<string> {
  const res = await request<{ publicKey: string }>(
    `/api/organizations/${orgId}/hosts/${hostId}/public-key`
  );
  return res.publicKey;
}

/** Run an SSH management op (bootstrap/update/restart/set_token/probe). */
export async function runHostOp(
  orgId: string,
  hostId: string,
  kind: HostOpKind
): Promise<HostOperation> {
  const res = await request<{ operation: HostOperation }>(
    `/api/organizations/${orgId}/hosts/${hostId}/operations`,
    { method: "POST", body: JSON.stringify({ kind }) }
  );
  return res.operation;
}

/** Recent SSH ops for a host, newest first. */
export async function listHostOperations(
  orgId: string,
  hostId: string
): Promise<HostOperation[]> {
  const res = await request<{ operations: HostOperation[] }>(
    `/api/organizations/${orgId}/hosts/${hostId}/operations`
  );
  return res.operations;
}

/** Update a host's SSH connection details. */
export async function updateHostConnection(
  orgId: string,
  hostId: string,
  params: { name?: string; sshHost?: string; sshPort?: number; sshUser?: string }
): Promise<OrganizationHost> {
  const res = await request<{ host: OrganizationHost }>(
    `/api/organizations/${orgId}/hosts/${hostId}`,
    { method: "PATCH", body: JSON.stringify(params) }
  );
  return res.host;
}

/** Convenience: enqueue an `update` op (git-pull + restart over SSH). */
export async function updateOrganizationHost(
  orgId: string,
  hostId: string
): Promise<HostOperation> {
  return runHostOp(orgId, hostId, "update");
}

/** Convenience: enqueue a `restart` op. */
export async function restartOrganizationHost(
  orgId: string,
  hostId: string
): Promise<HostOperation> {
  return runHostOp(orgId, hostId, "restart");
}

/**
 * Store the org-wide Claude CLI subscription token (from `claude
 * setup-token`). The backend encrypts it and pushes it to every host so
 * their `claude_cli` agents authenticate without a manual `claude /login`.
 */
export async function setOrganizationAnthropicToken(
  orgId: string,
  token: string
): Promise<void> {
  await request(`/api/organizations/${orgId}/anthropic-token`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

// --- Host auto-provisioning (Hostinger) ---

export interface ProvisioningOption {
  id: number | string;
  name?: string;
  [key: string]: unknown;
}

export interface ProvisioningCatalog {
  available: boolean;
  dataCenters: ProvisioningOption[];
  templates: ProvisioningOption[];
  plans: ProvisioningOption[];
}

/** Fetch data centers / OS templates / VPS plans to drive the provision wizard. */
export async function getProvisioningCatalog(
  orgId: string
): Promise<ProvisioningCatalog> {
  return request<ProvisioningCatalog>(
    `/api/organizations/${orgId}/provisioning/catalog`
  );
}

// --- Platform admin (operator console) ---

export interface RevenueTier {
  /** Human label (Stripe price nickname), falling back to the price id. */
  tier: string | null;
  /** Stripe price id. */
  plan: string | null;
  /** Active subscriptions on this tier. */
  count: number;
  /** Monthly-normalized revenue for this tier, in cents. */
  mrrCents: number;
}

export interface PlatformStats {
  users: number;
  /** Distinct humans currently WS-connected. */
  usersOnline: number;
  payingUsers: number;
  agents: number;
  /** Distinct agents with an online executor. */
  agentsOnline: number;
  /** Agent counts keyed by runtime, e.g. { org_host: 12, local: 40 }. */
  agentsByRuntime: Record<string, number>;
  organizations: number;
  hostsByStatus: Record<string, number>;
  revenue: {
    currency: string | null;
    /** Total monthly recurring revenue across tiers, in cents. */
    mrrCents: number;
    /** Active subs with no stored amount yet (backfill pending). */
    unpricedCount: number;
    tiers: RevenueTier[];
  };
  /** Each workspace with how many agents are pinned to it (busiest first). */
  workspaces: Array<{ id: string; name: string | null; agentCount: number }>;
}

/** Per-model token totals + estimated cost (costUsd null when unpriced). */
export interface ModelTokenTotals {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requests: number;
  totalTokens: number;
  costUsd: number | null;
}

/** Trailing-30-day token totals (camelCase, summed server-side). */
export interface TokenTotals {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
  requests: number;
  totalTokens: number;
  costUsd: number | null;
  byModel: ModelTokenTotals[];
}

export interface AdminUser {
  id: string;
  displayName: string;
  email?: string | null;
  /** Profile image URL (null when unset → render initials). */
  avatarUrl?: string | null;
  /** ISO8601 account creation time, for "member for N" display. */
  memberSince?: string | null;
  orgName?: string | null;
  agentCount: number;
  allocatedHostIds: string[];
  subscription?: { plan?: string; status?: string } | null;
  tokens?: TokenTotals;
}

export interface AdminAgent {
  id: string;
  displayName: string;
  status?: string;
  runtime: string;
  presenceMode?: string;
  assignedHostId?: string | null;
  organizationId?: string | null;
  model?: string | null;
  modelConfig?: Record<string, unknown>;
  tokens?: TokenTotals;
  /** Daily total-token series (oldest→newest) for a sparkline. */
  series?: number[];
}

export interface AdminUserDetail {
  id: string;
  displayName: string;
  email?: string | null;
  subscription?: { plan?: string; status?: string } | null;
  agents: AdminAgent[];
}

/** One host's residents (agents pinned to it + their owners), with token totals. */
export interface AdminHostDetail {
  host: OrganizationHost & { orgName?: string | null };
  agents: Array<{
    id: string;
    displayName: string;
    status?: string;
    runtime: string;
    presenceMode?: string;
    model?: string | null;
    ownerId: string;
    ownerName?: string | null;
    ownerEmail?: string | null;
    running: boolean;
    tokens?: TokenTotals;
    series?: number[];
  }>;
  users: Array<{
    id: string;
    displayName?: string | null;
    email?: string | null;
    agentCount: number;
    tokens?: TokenTotals;
    series?: number[];
  }>;
}

export async function getAdminStats(): Promise<PlatformStats> {
  const res = await request<{ stats: PlatformStats }>("/api/admin/stats");
  return res.stats;
}

export async function listAdminHosts(): Promise<
  Array<OrganizationHost & { orgName?: string | null }>
> {
  const res = await request<{ hosts: Array<OrganizationHost & { orgName?: string | null }> }>(
    "/api/admin/hosts"
  );
  return res.hosts;
}

export async function listAdminUsers(search?: string): Promise<AdminUser[]> {
  const qs = search ? `?search=${encodeURIComponent(search)}` : "";
  const res = await request<{ users: AdminUser[] }>(`/api/admin/users${qs}`);
  return res.users;
}

export async function getAdminUser(userId: string): Promise<AdminUserDetail> {
  const res = await request<{ user: AdminUserDetail }>(`/api/admin/users/${userId}`);
  return res.user;
}

export async function allocateUserToHost(
  userId: string,
  hostId: string
): Promise<{ allocated: number; total: number }> {
  return request(`/api/admin/users/${userId}/allocate`, {
    method: "POST",
    body: JSON.stringify({ hostId }),
  });
}

export async function deallocateUser(
  userId: string
): Promise<{ deallocated: number }> {
  return request(`/api/admin/users/${userId}/deallocate`, { method: "POST" });
}

/** Manually grant/update a user's plan (no Stripe needed). */
export async function setUserPlan(
  userId: string,
  plan: string,
  status = "active"
): Promise<void> {
  await request(`/api/admin/users/${userId}/subscription`, {
    method: "POST",
    body: JSON.stringify({ plan, status }),
  });
}

/** Remove a user's manual plan. */
export async function clearUserPlan(userId: string): Promise<void> {
  await request(`/api/admin/users/${userId}/subscription`, { method: "DELETE" });
}

export async function setHostShared(
  hostId: string,
  shared: boolean
): Promise<OrganizationHost> {
  const res = await request<{ host: OrganizationHost }>(
    `/api/admin/hosts/${hostId}/shared`,
    { method: "PATCH", body: JSON.stringify({ shared }) }
  );
  return res.host;
}

/** Rename (or otherwise update) a host as a platform admin. */
export async function updateAdminHost(
  hostId: string,
  attrs: { name?: string; shared?: boolean }
): Promise<OrganizationHost> {
  const res = await request<{ host: OrganizationHost }>(
    `/api/admin/hosts/${hostId}`,
    { method: "PATCH", body: JSON.stringify(attrs) }
  );
  return res.host;
}

/** One host's residents: agents pinned to it + their owners + token totals. */
export async function getAdminHost(hostId: string): Promise<AdminHostDetail> {
  return request(`/api/admin/hosts/${hostId}`);
}

/** Move one agent to a host (rebalance), or pass null/"local" to unpin it. */
export async function reassignAgent(
  agentId: string,
  hostId: string | null
): Promise<{ agent: Participant }> {
  return request(`/api/admin/agents/${agentId}/reassign`, {
    method: "POST",
    body: JSON.stringify({ hostId }),
  });
}

/** Adjust an agent's model config (model/backend/connection). */
export async function updateAdminAgent(
  agentId: string,
  modelConfig: Record<string, unknown>
): Promise<{ agent: Participant }> {
  return request(`/api/admin/agents/${agentId}`, {
    method: "PATCH",
    body: JSON.stringify({ modelConfig }),
  });
}

/** Move several agents at once (rebalance off an overloaded host). */
export async function bulkReassignAgents(
  agentIds: string[],
  hostId: string | null
): Promise<{ moved: number; total: number }> {
  return request(`/api/admin/agents/bulk-reassign`, {
    method: "POST",
    body: JSON.stringify({ agentIds, hostId }),
  });
}

/** Reset a stuck agent (stop+respawn on its host for hosted agents). */
export async function resetAgent(
  agentId: string
): Promise<{ reset: boolean; via?: string; reason?: string; hostId?: string }> {
  return request(`/api/admin/agents/${agentId}/reset`, { method: "POST" });
}

/** Reset several agents at once (admin) — bring a host's offline agents back. */
export async function bulkResetAgents(
  agentIds: string[]
): Promise<{ reset: number; total: number }> {
  return request(`/api/admin/agents/bulk-reset`, {
    method: "POST",
    body: JSON.stringify({ agentIds }),
  });
}

export async function getAdminProvisioningCatalog(): Promise<{
  dataCenters: ProvisioningOption[];
  templates: ProvisioningOption[];
  plans: ProvisioningOption[];
}> {
  return request("/api/admin/provisioning/catalog");
}

/**
 * List the VMs that already exist on the Hostinger account (the operator's
 * real inventory), so the Provisioning tab can show what we have vs. what we
 * might create. Cross-reference each VM `id` against hosts' `providerVmId` to
 * tell which are already managed by AgentGram.
 */
export async function adminListProviderVms(): Promise<ProviderVm[]> {
  const res = await request<{ vms: ProviderVm[] }>("/api/admin/provisioning/vms");
  return res.vms;
}

export async function adminProvision(params: {
  name: string;
  itemId: string;
  dataCenterId: number | string;
  templateId: number | string;
}): Promise<{ host: OrganizationHost }> {
  return request("/api/admin/provision", {
    method: "POST",
    body: JSON.stringify({
      name: params.name,
      itemId: params.itemId,
      dataCenterId: params.dataCenterId,
      templateId: params.templateId,
    }),
  });
}

/**
 * Spin up a brand-new Hostinger VM. Returns immediately with the host record;
 * the VM provisions, self-bootstraps over SSH, and comes online asynchronously.
 */
export async function provisionHost(
  orgId: string,
  params: {
    name: string;
    itemId: string;
    dataCenterId: number | string;
    templateId: number | string;
  }
): Promise<{ host: OrganizationHost }> {
  return request<{ host: OrganizationHost }>(
    `/api/organizations/${orgId}/hosts/provision`,
    {
      method: "POST",
      body: JSON.stringify({
        name: params.name,
        itemId: params.itemId,
        dataCenterId: params.dataCenterId,
        templateId: params.templateId,
      }),
    }
  );
}

export async function listOrganizationMembers(
  orgId: string
): Promise<OrganizationMembership[]> {
  const res = await request<{ memberships: OrganizationMembership[] }>(
    `/api/organizations/${orgId}/members`
  );
  return res.memberships;
}

// --- Org email invites ---

export interface OrganizationInvite {
  id: string;
  organizationId: string;
  email: string;
  role: "admin" | "member";
  expiresAt: string;
  redeemedAt: string | null;
  createdByParticipantId: string;
  insertedAt: string;
}

export async function listOrganizationInvites(
  orgId: string
): Promise<OrganizationInvite[]> {
  const res = await request<{ invites: OrganizationInvite[] }>(
    `/api/organizations/${orgId}/invites`
  );
  return res.invites;
}

export async function createOrganizationInvite(
  orgId: string,
  email: string,
  role: "member" | "admin" = "member"
): Promise<OrganizationInvite> {
  const res = await request<{ invite: OrganizationInvite }>(
    `/api/organizations/${orgId}/invites`,
    {
      method: "POST",
      body: JSON.stringify({ email, role }),
    }
  );
  return res.invite;
}

export async function deleteOrganizationInvite(
  orgId: string,
  inviteId: string
): Promise<void> {
  await request(`/api/organizations/${orgId}/invites/${inviteId}`, {
    method: "DELETE",
  });
}

// --- Org provider configs (model catalog override) ---

export interface OrganizationProviderConfig {
  id: string;
  organizationId: string;
  providerId: string;
  enabled: boolean;
  models: string[];
  cliConnection?: "anthropic" | "bedrock" | "vertex" | null;
  insertedAt: string;
  updatedAt: string;
}

export async function listOrganizationProviderConfigs(
  orgId: string
): Promise<OrganizationProviderConfig[]> {
  const res = await request<{ configs: OrganizationProviderConfig[] }>(
    `/api/organizations/${orgId}/provider-configs`
  );
  return res.configs;
}

export async function upsertOrganizationProviderConfig(
  orgId: string,
  providerId: string,
  patch: {
    enabled?: boolean;
    models?: string[];
    cliConnection?: "anthropic" | "bedrock" | "vertex" | null;
  }
): Promise<OrganizationProviderConfig> {
  const res = await request<{ config: OrganizationProviderConfig }>(
    `/api/organizations/${orgId}/provider-configs/${providerId}`,
    {
      method: "PUT",
      body: JSON.stringify(patch),
    }
  );
  return res.config;
}

export async function deleteOrganizationProviderConfig(
  orgId: string,
  providerId: string
): Promise<void> {
  await request(`/api/organizations/${orgId}/provider-configs/${providerId}`, {
    method: "DELETE",
  });
}

// Health
export async function getAgentHealth(): Promise<{ agents: AgentHealth[] }> {
  return request("/api/agents/health");
}

export async function getAgentHealthDetail(
  id: string
): Promise<AgentHealthDetail> {
  return request(`/api/agents/${id}/health`);
}

export async function forceResetAgent(
  id: string
): Promise<{ message: string; disabledExecutors: number; unclaimedTasks: number; unclaimedMessages: number }> {
  return request(`/api/agents/${id}/health/reset`, { method: "POST" });
}

export async function clearAgentMessages(
  id: string
): Promise<{ message: string; expired: number; unclaimed: number }> {
  return request(`/api/agents/${id}/health/clear-messages`, { method: "POST" });
}

export async function clearAgentTasks(
  id: string
): Promise<{ message: string; expired: number; unclaimed: number }> {
  return request(`/api/agents/${id}/health/clear-tasks`, { method: "POST" });
}

export async function killExecutor(
  agentId: string,
  executorId: string
): Promise<{ message: string }> {
  return request(`/api/agents/${agentId}/executors/${executorId}/kill`, { method: "POST" });
}

export async function unstickAgent(id: string): Promise<{ message: string; executorsReset: number; tasksExpired: number; messagesRequeued: number }> {
  return request(`/api/agents/${id}/health/unstick`, { method: "POST" });
}

export async function markAgentOffline(id: string): Promise<{ message: string }> {
  return request(`/api/agents/${id}/health/offline`, { method: "POST" });
}

// Pulse
export interface PulseConfig {
  enabled?: boolean;
  intervalMinutes?: number;
  activeHours?: { start: number; end: number };
  timezone?: string;
  model?: string | null;
  // Workspace the pulse posts into. null/absent → the owner's Personal
  // workspace (backend default). Set to pin pulses to a shared workspace.
  organizationId?: string | null;
  status?: string;
  lastRunAt?: string | null;
  nextRunAt?: string | null;
  runCount?: number;
  consecutiveFailures?: number;
}

export interface PulseData {
  pulseMd: string | null;
  pulseConfig: PulseConfig | null;
}

export async function getAgentPulse(id: string): Promise<PulseData> {
  return request(`/api/agents/${id}/pulse`);
}

export async function updateAgentPulse(
  id: string,
  data: { pulse_md?: string; interval_minutes?: number; active_hours?: { start: number; end: number }; timezone?: string; model?: string | null; organization_id?: string | null }
): Promise<PulseData> {
  return request(`/api/agents/${id}/pulse`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function enableAgentPulse(id: string): Promise<{ pulseConfig: PulseConfig }> {
  return request(`/api/agents/${id}/pulse/enable`, { method: "POST" });
}

export async function disableAgentPulse(id: string): Promise<{ pulseConfig: PulseConfig }> {
  return request(`/api/agents/${id}/pulse/disable`, { method: "POST" });
}

export async function triggerAgentPulse(id: string): Promise<{ message: string }> {
  return request(`/api/agents/${id}/pulse/trigger`, { method: "POST" });
}

/**
 * Ask the backend to author/reassess the agent's pulse checklist from a
 * natural-language idea. Returns the proposed pulse_md — it is NOT saved; the
 * caller reviews it and persists via `updateAgentPulse`.
 */
export async function revisePulseMd(
  id: string,
  instruction: string
): Promise<{ pulseMd: string }> {
  return request(`/api/agents/${id}/pulse/revise`, {
    method: "POST",
    body: JSON.stringify({ instruction }),
  });
}

// Invites
export async function getInviteInfo(
  code: string
): Promise<InviteInfo> {
  return request(`/api/invites/${code}/info`);
}

export async function claimInvite(
  code: string
): Promise<{ agent: Agent; apiKey: string; agentId: string; gatewayUrl: string }> {
  return request(`/api/invites/${code}/claim`, { method: "POST" });
}

// Skills
export async function listSkills(): Promise<{ skills: Skill[] }> {
  return request("/api/skills");
}

export async function getAgentSkills(agentId: string): Promise<{ skills: Skill[] }> {
  return request(`/api/agents/${agentId}/skills`);
}

export async function createSkill(data: {
  name: string;
  description: string;
  displayName: string;
  promptContent: string;
  scope?: string;
  category?: string;
  tags?: string[];
  alwaysInject?: boolean;
  priority?: number;
  activationRules?: Record<string, unknown>;
  visibility?: "private" | "public" | "unlisted";
  authorName?: string;
}): Promise<{ skill: Skill }> {
  return request("/api/skills", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateSkill(
  id: string,
  data: Record<string, unknown>
): Promise<{ skill: Skill }> {
  return request(`/api/skills/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteSkill(id: string): Promise<void> {
  await request(`/api/skills/${id}`, { method: "DELETE" });
}

// Memories
//
// Two scopes: per-agent ("what this agent remembers", owner-scoped via the
// agent id) and per-family ("shared across all of the user's agents"; the
// logged-in human is the family root, so no id is needed). Both are keyed by
// (category, key) — POSTing an existing pair returns 409 unless `force: true`
// is sent. The agent scope has a real PATCH; the family scope has none, so a
// family "edit" is just a forced POST of the same category+key.

export type MemoryCategory =
  | "fact"
  | "preference"
  | "learning"
  | "relationship"
  | "skill";

export interface Memory {
  id: string;
  category: MemoryCategory;
  key: string;
  content: string;
  confidence: number;
  description?: string | null;
  tags: string[];
  metadata?: Record<string, unknown>;
  relatedIds?: string[];
  sourceConversationId?: string | null;
  insertedAt: string;
  updatedAt: string;
}

export interface FamilyMemory {
  id: string;
  familyRootId: string;
  category: MemoryCategory;
  key: string;
  content: string;
  confidence: number;
  description?: string | null;
  tags: string[];
  metadata?: Record<string, unknown>;
  lastWrittenById?: string | null;
  sourceConversationId?: string | null;
  insertedAt: string;
  updatedAt: string;
}

export interface MemoryInput {
  category: MemoryCategory;
  key: string;
  content: string;
  confidence?: number;
  description?: string;
  tags?: string[];
  force?: boolean;
  reason?: string;
}

export async function getAgentMemories(
  agentId: string
): Promise<{ memories: Memory[] }> {
  return request(`/api/agents/${agentId}/memories`);
}

export async function createAgentMemory(
  agentId: string,
  body: MemoryInput
): Promise<{ memory: Memory }> {
  return request(`/api/agents/${agentId}/memories`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function updateAgentMemory(
  agentId: string,
  id: string,
  body: {
    content?: string;
    confidence?: number;
    description?: string;
    tags?: string[];
  }
): Promise<{ memory: Memory }> {
  return request(`/api/agents/${agentId}/memories/${id}`, {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

export async function deleteAgentMemory(
  agentId: string,
  id: string
): Promise<{ memoryPrompt: string }> {
  return request(`/api/agents/${agentId}/memories/${id}`, {
    method: "DELETE",
  });
}

export async function getFamilyMemories(): Promise<{
  familyRootId: string;
  memories: FamilyMemory[];
}> {
  return request("/api/family/memories");
}

/**
 * Create or overwrite a family memory. Family memories have no PATCH route —
 * editing an existing (category, key) is a POST with `force: true`. A brand-new
 * (category, key) collision surfaces as a 409 so the caller can warn the user.
 */
export async function saveFamilyMemory(
  body: MemoryInput
): Promise<{ memory: FamilyMemory }> {
  return request("/api/family/memories", {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function deleteFamilyMemory(
  id: string
): Promise<{ deleted: boolean }> {
  return request(`/api/family/memories/${id}`, { method: "DELETE" });
}

export async function assignSkill(
  skillId: string,
  agentId: string
): Promise<{ assignment: SkillAssignment }> {
  return request(`/api/skills/${skillId}/assign`, {
    method: "POST",
    body: JSON.stringify({ agentId }),
  });
}

export async function unassignSkill(
  skillId: string,
  agentId: string
): Promise<void> {
  await request(`/api/skills/${skillId}/assign/${agentId}`, {
    method: "DELETE",
  });
}

export async function toggleSkillAssignment(
  assignmentId: string,
  enabled: boolean
): Promise<{ assignment: SkillAssignment }> {
  return request(`/api/skills/assignments/${assignmentId}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export async function importSkill(data: {
  url?: string;
  content?: string;
  sourceUrl?: string;
}): Promise<{ skill: Skill }> {
  return request("/api/skills/import", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

// Skill Marketplace
export async function browseMarketplace(params?: {
  search?: string;
  category?: string;
  tags?: string;
  sort?: "rating" | "installs" | "recent";
  limit?: number;
}): Promise<{ skills: Skill[] }> {
  const query = new URLSearchParams();
  if (params?.search) query.set("search", params.search);
  if (params?.category) query.set("category", params.category);
  if (params?.tags) query.set("tags", params.tags);
  if (params?.sort) query.set("sort", params.sort);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request(`/api/skills/marketplace${qs ? `?${qs}` : ""}`);
}

export async function getMarketplaceSkill(
  id: string
): Promise<{ skill: Skill; ratings: SkillRating[] }> {
  return request(`/api/skills/marketplace/${id}`);
}

export async function installMarketplaceSkill(
  id: string
): Promise<{ skill: Skill }> {
  return request(`/api/skills/marketplace/${id}/install`, { method: "POST" });
}

export async function rateMarketplaceSkill(
  id: string,
  score: number,
  review?: string
): Promise<{ rating: SkillRating }> {
  return request(`/api/skills/marketplace/${id}/rate`, {
    method: "POST",
    body: JSON.stringify({ score, review }),
  });
}

// Routines
export async function listRoutines(agentId?: string): Promise<{ routines: Routine[] }> {
  const params = agentId ? `?agent_id=${agentId}` : "";
  return request(`/api/routines${params}`);
}

export async function createRoutine(data: {
  agent_id: string;
  name: string;
  instructions: string;
  schedule_type: string;
  schedule_config: Record<string, unknown>;
  description?: string;
  report_to?: string;
  max_runs?: number;
}): Promise<{ routine: Routine }> {
  return request("/api/routines", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateRoutine(id: string, data: Record<string, unknown>): Promise<{ routine: Routine }> {
  return request(`/api/routines/${id}`, {
    method: "PATCH",
    body: JSON.stringify(data),
  });
}

export async function deleteRoutine(id: string): Promise<void> {
  await request(`/api/routines/${id}`, { method: "DELETE" });
}

export async function pauseRoutine(id: string): Promise<{ routine: Routine }> {
  return request(`/api/routines/${id}/pause`, { method: "POST" });
}

export async function resumeRoutine(id: string): Promise<{ routine: Routine }> {
  return request(`/api/routines/${id}/resume`, { method: "POST" });
}

// Connected Accounts / Integrations
export interface UserCredential {
  id: string;
  provider: string;
  credentialType: "oauth2" | "api_token";
  status: "active" | "expired" | "revoked" | "refresh_failed";
  scopes: string[];
  providerUid?: string;
  lastUsedAt?: string;
  tokenExpiresAt?: string;
  insertedAt: string;
  updatedAt: string;
}

export interface ProviderInfo {
  name: string;
  type: "oauth2" | "api_token";
  displayName: string;
  description?: string;
  scopes?: string[];
}

export async function listCredentials(): Promise<{ credentials: UserCredential[] }> {
  return request("/api/integrations");
}

export async function listProviders(): Promise<{ providers: ProviderInfo[] }> {
  return request("/api/integrations/providers");
}

export async function authorizeProvider(provider: string): Promise<{ authorizeUrl: string }> {
  return request(`/api/integrations/${provider}/authorize`);
}

export async function storeProviderToken(provider: string, token: string): Promise<{ credential: UserCredential }> {
  return request(`/api/integrations/${provider}/token`, {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

export async function disconnectProvider(provider: string): Promise<void> {
  await request(`/api/integrations/${provider}`, { method: "DELETE" });
}

export async function getProviderStatus(provider: string): Promise<{
  connected: boolean;
  provider: string;
  status?: string;
  lastUsedAt?: string;
}> {
  return request(`/api/integrations/${provider}/status`);
}

// --- Payments: Stripe Link "wallet for agents" (OAuth device flow) ---

export async function paymentConnectStart(): Promise<{
  userCode: string;
  verificationUri: string;
  verificationUriComplete: string;
  expiresIn: number;
  interval: number;
}> {
  return request("/api/payments/connect/start", { method: "POST" });
}

export async function paymentConnectPoll(): Promise<{ status: string }> {
  return request("/api/payments/connect/poll", { method: "POST" });
}

export async function paymentWalletStatus(): Promise<{
  connected: boolean;
  status: string | null;
  hasPaymentMethod: boolean;
  connectedAt: string | null;
}> {
  return request("/api/payments/status");
}

export async function paymentDisconnect(): Promise<void> {
  await request("/api/payments/disconnect", { method: "POST" });
}

// Resolves the raw token for a provider via the backend. Walks the
// ownership chain server-side, so an agent's auth resolves its owner's
// key. Used as a fallback when the local LLM Keys store doesn't have
// an entry — lets a user paste an Anthropic key once in "Connections"
// and have the local bridge pick it up too.
export async function resolveProviderToken(
  provider: string,
  opts?: { keyId?: string | null }
): Promise<{ provider: string; token: string }> {
  // Pass `key_id` so multi-key providers can resolve the agent's
  // preferred key instead of the user's default. Omitted when null/
  // undefined, in which case the backend picks the default.
  const keyId = opts?.keyId;
  const path = keyId
    ? `/api/integrations/${provider}/resolve?key_id=${encodeURIComponent(keyId)}`
    : `/api/integrations/${provider}/resolve`;
  return request(path);
}

// Annotations
export async function listAnnotations(params?: {
  topic?: string;
  limit?: number;
}): Promise<{ annotations: Annotation[] }> {
  const query = new URLSearchParams();
  if (params?.topic) query.set("topic", params.topic);
  if (params?.limit) query.set("limit", String(params.limit));
  const qs = query.toString();
  return request(`/api/annotations${qs ? `?${qs}` : ""}`);
}

export async function listAnnotationTopics(): Promise<{ topics: string[] }> {
  return request("/api/annotations/topics");
}

export async function createAnnotation(data: {
  topic: string;
  content: string;
  source?: string;
}): Promise<{ annotation: Annotation }> {
  return request("/api/annotations", {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function deleteAnnotation(id: string): Promise<void> {
  await request(`/api/annotations/${id}`, { method: "DELETE" });
}

// Response Templates
export async function listResponseTemplates(): Promise<{ templates: ResponseTemplate[] }> {
  return request("/api/response-templates");
}

export async function createResponseTemplate(
  attrs: Partial<ResponseTemplate>
): Promise<{ template: ResponseTemplate }> {
  return request("/api/response-templates", {
    method: "POST",
    body: JSON.stringify(attrs),
  });
}

export async function updateResponseTemplate(
  id: string,
  attrs: Partial<ResponseTemplate>
): Promise<{ template: ResponseTemplate }> {
  return request(`/api/response-templates/${id}`, {
    method: "PATCH",
    body: JSON.stringify(attrs),
  });
}

export async function deleteResponseTemplate(id: string): Promise<void> {
  await request(`/api/response-templates/${id}`, { method: "DELETE" });
}

export async function previewResponseTemplate(
  attrs: Partial<ResponseTemplate>
): Promise<{ html: string; css: string; valid: boolean; errors: string[] }> {
  return request("/api/response-templates/preview", {
    method: "POST",
    body: JSON.stringify(attrs),
  });
}

// Canvas Definitions
export async function listCanvasDefinitions(): Promise<{ definitions: CanvasDefinitionSummary[] }> {
  return request("/api/canvas-definitions");
}

export async function getCanvasDefinition(id: string): Promise<CanvasDefinitionSummary> {
  // Backend wraps the record as `{ definition: <record> }` — unwrap here so
  // callers get the same shape as entries in `listCanvasDefinitions()`, with
  // the inner JSON body reachable as `.definition`.
  const { definition } = await request<{ definition: CanvasDefinitionSummary }>(
    `/api/canvas-definitions/${id}`
  );
  return definition;
}

export async function createCanvasDefinition(attrs: {
  name: string;
  description?: string;
  definition: Record<string, unknown>;
  isPublished?: boolean;
}): Promise<{ definition: CanvasDefinitionSummary }> {
  return request("/api/canvas-definitions", {
    method: "POST",
    body: JSON.stringify(attrs),
  });
}

export async function updateCanvasDefinition(
  id: string,
  attrs: Partial<{
    name: string;
    description: string;
    definition: Record<string, unknown>;
    isPublished: boolean;
  }>
): Promise<{ definition: CanvasDefinitionSummary }> {
  return request(`/api/canvas-definitions/${id}`, {
    method: "PATCH",
    body: JSON.stringify(attrs),
  });
}

export async function deleteCanvasDefinition(id: string): Promise<void> {
  await request(`/api/canvas-definitions/${id}`, { method: "DELETE" });
}

export async function validateCanvasDefinition(
  definition: Record<string, unknown>
): Promise<{ valid: boolean; errors: string[] }> {
  return request("/api/canvas-definitions/validate", {
    method: "POST",
    body: JSON.stringify({ definition }),
  });
}

// Types

export interface CanvasDefinitionSummary {
  id: string;
  ownerId?: string;
  name: string;
  description?: string;
  version: number;
  isBuiltin: boolean;
  isPublished: boolean;
  insertedAt: string;
  updatedAt: string;
  /** Full JSON definition — only populated on `getCanvasDefinition(id)`,
   *  omitted from the list endpoint's payload. */
  definition?: Record<string, unknown>;
}
export interface Skill {
  id: string;
  name: string;
  displayName: string;
  description: string;
  scope: "global" | "owner" | "agent";
  ownerId?: string;
  promptContent: string;
  alwaysInject: boolean;
  license?: string;
  compatibility?: string;
  skillMetadata?: Record<string, unknown>;
  category?: string;
  tags?: string[];
  priority: number;
  activationRules?: Record<string, unknown>;
  sourceUrl?: string;
  importedAt?: string;
  version: number;
  enabled: boolean;
  // Marketplace fields
  visibility?: "private" | "public" | "unlisted";
  installCount?: number;
  ratingAvg?: number;
  ratingCount?: number;
  authorName?: string;
  insertedAt: string;
  updatedAt: string;
}

export interface SkillRating {
  id: string;
  skillId: string;
  raterId: string;
  raterName?: string;
  score: number;
  review?: string;
  insertedAt: string;
  updatedAt: string;
}

export interface Annotation {
  id: string;
  agentId: string;
  ownerId: string;
  agentName?: string;
  topic: string;
  content: string;
  source: string;
  sourceTaskId?: string;
  metadata?: Record<string, unknown>;
  insertedAt: string;
  updatedAt: string;
}

export interface SkillAssignment {
  id: string;
  skillId: string;
  agentId: string;
  sourceAgentId?: string;
  enabled: boolean;
  configOverrides?: Record<string, unknown>;
  skill?: Skill;
  insertedAt: string;
  updatedAt: string;
}

export type UserConnectionStatus = "none" | "pending" | "accepted" | "rejected" | "revoked" | "blocked";

export interface Participant {
  id: string;
  displayName: string;
  email?: string;
  maskedEmail?: string;
  connectionId?: string;
  connectionStatus?: UserConnectionStatus;
  canRequest?: boolean;
  type: "human" | "agent";
  avatarUrl?: string;
  online?: boolean;
  timezone?: string;
  description?: string;
  location?: unknown;
  insertedAt?: string;
  metadata?: Record<string, unknown>;
  /** Agent-only: list of capability tags. Backend serializer always
   *  includes the field for agents — humans get nothing. */
  capabilities?: string[];
  /** Slack-style multi-workspace fields. Always present for humans
   *  after the personal-orgs migration; agents leave them undefined. */
  organizationId?: string | null;
  activeOrganizationId?: string | null;
  organizations?: WorkspaceMembership[];
  /** True when this human is a platform super-admin (env allowlist). Gates the
   *  desktop operator console; the backend enforces every /api/admin call. */
  platformAdmin?: boolean;
  /** Stripe Billing subscription summary, or null when not subscribed. */
  subscription?: { plan?: string; status?: string } | null;
  /** For paying users: the host new agents should default to running on
   *  ("hosted" runtime). Null when the user has no host available. */
  hostedHostId?: string | null;
}

/** Start a Stripe subscription Checkout; returns a URL to open in a browser. */
export async function startBillingCheckout(): Promise<string> {
  const res = await request<{ url: string }>("/api/billing/checkout", { method: "POST" });
  return res.url;
}

/** Open the Stripe Billing Portal (manage/cancel); returns a URL. */
export async function openBillingPortal(): Promise<string> {
  const res = await request<{ url: string }>("/api/billing/portal", { method: "POST" });
  return res.url;
}

export interface WorkspaceMembership {
  id: string;
  name: string;
  slug: string;
  /** Optional workspace avatar — sidebar tile renders it when set;
   *  falls back to initials of the name otherwise. */
  avatarUrl?: string | null;
  isPersonal: boolean;
  role: "owner" | "admin" | "member";
  /** Count of agents the caller owns in this workspace. Drives the
   *  "you have N agents working in other workspaces" affordance. */
  agentCount?: number;
}

// --- Messaging types + endpoints ---

export interface MessageSender {
  id: string;
  type: "human" | "agent";
  displayName: string;
  avatarUrl?: string;
}

export interface TaskSnapshot {
  id?: string;
  status?: string;
  title?: string;
}

export interface MessageContentStructured {
  /** Structured payload — servers send as `data` or `payload` depending on
   *  the message type. `getMessagePayload` helper normalizes both. */
  data?: Record<string, unknown>;
  payload?: Record<string, unknown>;
  result_type?: string;
  items?: unknown[];
}

export interface FileAttachment {
  id: string;
  filename?: string;
  contentType?: string;
  sizeBytes?: number;
  downloadUrl?: string;
}

export interface Message {
  id: string;
  conversationId: string;
  senderId: string;
  sender?: MessageSender;
  content: string;
  contentType?: string;
  messageType?: string;
  metadata?: Record<string, unknown>;
  contentStructured?: MessageContentStructured;
  taskSnapshot?: TaskSnapshot;
  parentMessageId?: string;
  fileAttachments?: FileAttachment[];
  insertedAt: string;
  updatedAt: string;
  pending?: boolean;
  nonce?: string;
}

/** Normalize `contentStructured.data` / `.payload` into a single accessor. */
export function getMessagePayload<T = Record<string, unknown>>(
  message: Message
): T {
  return (message.contentStructured?.data ??
    message.contentStructured?.payload ??
    {}) as T;
}

// --- Tasks ---

export type TaskStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "in_progress"
  | "blocked"
  | "complete"
  | "cancelled"
  | "exhausted";

export interface Task {
  id: string;
  conversationId: string;
  /** Workspace this task lives in. Used to drop WS events whose
   *  payload doesn't match the user's active workspace. */
  organizationId?: string | null;
  title: string;
  description?: string;
  status: TaskStatus;
  createdBy?: string;
  assignedTo: string[];
  assignees?: Participant[];
  dependsOn?: string[];
  deadline?: string;
  metadata?: Record<string, unknown>;
  completionDetails?: Record<string, unknown>;
  resultData?: Record<string, unknown>;
  creator?: Participant;
  insertedAt: string;
  updatedAt: string;
}

export async function fetchTasksRest(
  status?: TaskStatus
): Promise<{ tasks: Task[] }> {
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const data = await request<Task[] | { tasks: Task[] }>(`/api/tasks${qs}`);
  return Array.isArray(data) ? { tasks: data } : data;
}

export async function fetchTaskRest(taskId: string): Promise<Task> {
  return request<Task>(`/api/tasks/${taskId}`);
}

export async function updateTaskStatusRest(
  taskId: string,
  status: TaskStatus
): Promise<Task> {
  return request(`/api/tasks/${taskId}/status`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

export async function requestTaskRevisionRest(
  taskId: string,
  feedback: string
): Promise<Task> {
  return request(`/api/tasks/${taskId}/revision`, {
    method: "POST",
    body: JSON.stringify({ feedback }),
  });
}

// --- Streaming ---

export type StreamPhase =
  | "thinking"
  | "tool_call"
  | "writing"
  | "analyzing"
  | "queued"
  | "waiting";

export interface ActiveStream {
  streamId: string;
  senderId: string;
  senderName: string;
  content: string;
  phase: StreamPhase;
  phaseDetail?: string;
  recentSteps: string[];
  /**
   * Prose the agent emitted during prior `writing` bursts in this same
   * stream. Snapshotted on phase transitions away from `writing` so the
   * user can read what the agent thought before pivoting to a tool call.
   */
  thoughts: string[];
  /**
   * Cumulative bridge-emitted content already committed into `thoughts`.
   * The bridge sends `content` as a running transcript (each writing event
   * is the full text-so-far), so without stripping this prefix each
   * snapshot would contain every prior thought.
   */
  thoughtPrefix: string;
  lastUpdateAt: number;
}

/** Per-member entry inside `ConversationMemory.participantsContext`.
 *  Populated by `MemoryAutoSummaryWorker.build_participants_context/2` on the
 *  backend — snake_case keys are preserved over the wire (not a typo, not
 *  camelCased by the serializer). */
export interface ParticipantContextEntry {
  name?: string;
  type?: "human" | "agent";
  role?: string;
  message_count?: number;
  // Agents only
  capabilities?: string[];
  roles?: string[];
  tools?: string[];
  trust_level?: string;
  description?: string;
  model?: string;
}

export interface ConversationMemory {
  summary?: string;
  currentState?: string;
  keyDecisions?: Array<{ decision: string; context?: string }>;
  openQuestions?: string[];
  completedWork?: string[];
  importantContext?: Record<string, unknown>;
  participantsContext?: Record<string, ParticipantContextEntry>;
  updatedAt?: string;
  updatedBy?: string;
}

export async function getConversationMemory(
  conversationId: string
): Promise<{ memory: ConversationMemory; version: number }> {
  return request(`/api/conversations/${conversationId}/memory`);
}

export interface ConversationMember {
  participantId: string;
  role?: string;
  participant?: Participant;
}

export interface Conversation {
  id: string;
  title?: string;
  /** Custom group photo URL; when set, overrides GroupAvatar in list +
   *  header. `null` / missing falls back to the composed avatar. */
  avatarUrl?: string | null;
  type: "direct" | "group" | "task" | "channel";
  createdBy?: string;
  metadata?: Record<string, unknown>;
  insertedAt: string;
  updatedAt: string;
  lastMessage?: Message;
  members?: ConversationMember[];
  pinned?: boolean;
  parentConversationId?: string;
}

export async function listConversations(
  scope: "personal" | "agents" = "personal",
  opts: { sourceConversationId?: string; limit?: number } = {}
): Promise<Conversation[]> {
  const params = new URLSearchParams({ scope });
  if (opts.limit) params.set("limit", String(opts.limit));
  if (opts.sourceConversationId) {
    params.set("sourceConversationId", opts.sourceConversationId);
  }

  const data = await request<Conversation[] | { conversations: Conversation[] }>(
    `/api/conversations?${params.toString()}`
  );
  return Array.isArray(data) ? data : data.conversations;
}

export async function getConversation(id: string): Promise<Conversation> {
  return request(`/api/conversations/${id}`);
}

export async function fetchMessages(
  conversationId: string,
  before?: string
): Promise<{ messages: Message[] }> {
  const params = new URLSearchParams({ limit: "30" });
  if (before) params.set("before", before);
  return request(`/api/conversations/${conversationId}/messages?${params}`);
}

export async function fetchUnreadCounts(): Promise<{ unreadCounts: Record<string, number> }> {
  return request("/api/unread-counts");
}

export async function markConversationReadRest(conversationId: string): Promise<void> {
  await request(`/api/conversations/${conversationId}/read`, { method: "POST" });
}

export async function updateConversationTitleRest(
  conversationId: string,
  title: string
): Promise<Conversation> {
  return request(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

/** Set or clear the custom group photo. `null` removes the photo and the
 *  UI falls back to the composed GroupAvatar. Server-side admin check
 *  lives in `Messaging.update_conversation/3`. */
export async function updateConversationAvatarRest(
  conversationId: string,
  avatarUrl: string | null
): Promise<Conversation> {
  return request(`/api/conversations/${conversationId}`, {
    method: "PATCH",
    body: JSON.stringify({ avatarUrl }),
  });
}

export async function addConversationMember(
  conversationId: string,
  participantId: string
): Promise<void> {
  await request(`/api/conversations/${conversationId}/members`, {
    method: "POST",
    body: JSON.stringify({ participantId }),
  });
}

export async function removeConversationMember(
  conversationId: string,
  participantId: string
): Promise<void> {
  await request(`/api/conversations/${conversationId}/members/${participantId}`, {
    method: "DELETE",
  });
}

export async function deleteConversationRest(conversationId: string): Promise<void> {
  await request(`/api/conversations/${conversationId}`, { method: "DELETE" });
}

/** Halt any in-flight agent turns in this conversation. Used by the chat
 *  header menu's "Stop Agents" action. */
export async function stopConversationAgents(conversationId: string): Promise<void> {
  await request(`/api/conversations/${conversationId}/stop-agents`, {
    method: "POST",
  });
}

export async function createConversationRest(attrs: {
  type: "direct" | "group" | "channel";
  title?: string;
  memberIds: string[];
}): Promise<Conversation> {
  return request(`/api/conversations`, {
    method: "POST",
    body: JSON.stringify(attrs),
  });
}

export async function searchPeople(query: string): Promise<{ people: Participant[] }> {
  return request(`/api/people/search?q=${encodeURIComponent(query)}`);
}

export interface UserConnection {
  id: string;
  requesterId: string;
  addresseeId: string;
  status: Exclude<UserConnectionStatus, "none">;
  message?: string;
  requestedAt?: string;
  respondedAt?: string;
  connectedAt?: string;
  blockedById?: string;
  requester?: Participant;
  addressee?: Participant;
  blockedBy?: { id: string; displayName: string; avatarUrl?: string };
  insertedAt: string;
  updatedAt: string;
}

export async function listFriends(): Promise<{ connections: UserConnection[] }> {
  return request("/api/friends");
}

export async function fetchFriendPendingCount(): Promise<{ count: number }> {
  return request("/api/friends/pending-count");
}

export async function requestFriend(participantId: string, message?: string): Promise<{ connection: UserConnection }> {
  return request("/api/friends", {
    method: "POST",
    body: JSON.stringify({ participantId, ...(message?.trim() ? { message: message.trim() } : {}) }),
  });
}

export async function respondFriend(
  id: string,
  decision: "accepted" | "rejected"
): Promise<{ connection: UserConnection }> {
  return request(`/api/friends/${id}/respond`, {
    method: "POST",
    body: JSON.stringify({ decision }),
  });
}

export async function revokeFriend(id: string): Promise<{ connection: UserConnection }> {
  return request(`/api/friends/${id}`, { method: "DELETE" });
}

export async function blockFriend(id: string): Promise<{ connection: UserConnection }> {
  return request(`/api/friends/${id}/block`, { method: "POST" });
}

export async function listFriendAgents(friendId: string): Promise<{ listings: DirectoryListing[] }> {
  return request(`/api/friends/${friendId}/agents`);
}

export async function getFriendMutuals(
  friendId: string
): Promise<{ count: number; mutuals: Participant[] }> {
  return request(`/api/friends/${friendId}/mutuals`);
}

// --- File attachments ---

export interface UploadUrlResponse {
  uploadUrl: string;
  storageKey: string;
}

export async function requestUploadUrl(
  conversationId: string,
  file: { filename: string; contentType: string; sizeBytes: number }
): Promise<UploadUrlResponse> {
  return request(`/api/conversations/${conversationId}/upload-url`, {
    method: "POST",
    body: JSON.stringify(file),
  });
}

export async function confirmUpload(
  conversationId: string,
  body: {
    storageKey: string;
    filename: string;
    contentType: string;
    sizeBytes: number;
    caption?: string;
  }
): Promise<void> {
  await request(`/api/conversations/${conversationId}/files/confirm`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

export async function getFileDownloadUrl(
  attachmentId: string
): Promise<{ url: string }> {
  return request(`/api/files/${attachmentId}/download-url`);
}

export interface ConversationFile {
  id: string;
  messageId: string;
  conversationId: string;
  uploadedBy: string;
  filename: string;
  contentType: string;
  sizeBytes: number;
  extractionStatus: string;
  insertedAt: string;
  uploader: {
    id: string;
    displayName: string;
    type: string;
    avatarUrl: string | null;
  } | null;
}

export async function listConversationFiles(
  conversationId: string,
  opts: { limit?: number; before?: string } = {}
): Promise<ConversationFile[]> {
  const query: string[] = [];
  if (typeof opts.limit === "number") query.push(`limit=${opts.limit}`);
  if (opts.before) query.push(`before=${encodeURIComponent(opts.before)}`);
  const qs = query.length > 0 ? `?${query.join("&")}` : "";

  const { files } = await request<{ files: ConversationFile[] }>(
    `/api/conversations/${conversationId}/files${qs}`
  );
  return files;
}

/**
 * A file in the global "Files" view: a conversation file plus a summary of
 * the conversation it lives in (so the UI can show and link to its source).
 */
export interface OwnerFile extends ConversationFile {
  conversation: { id: string; title: string | null; type: string } | null;
  /** Set when the file was produced as part of a task (message.task_id). */
  task: { id: string; title: string } | null;
}

/**
 * Every file the signed-in account produced — the user's own uploads plus
 * any created by agents they own — across all conversations, newest first.
 * Ownership-scoped server-side; the human only ever sees their own family's
 * files, never other members' uploads.
 */
export async function listOwnerFiles(
  opts: { limit?: number; before?: string } = {}
): Promise<OwnerFile[]> {
  const query: string[] = [];
  if (typeof opts.limit === "number") query.push(`limit=${opts.limit}`);
  if (opts.before) query.push(`before=${encodeURIComponent(opts.before)}`);
  const qs = query.length > 0 ? `?${query.join("&")}` : "";

  const { files } = await request<{ files: OwnerFile[] }>(`/api/files${qs}`);
  return files;
}

/** Forward (copy) a file into another conversation the caller belongs to. */
export async function forwardFile(
  attachmentId: string,
  conversationId: string
): Promise<void> {
  await request(`/api/files/${attachmentId}/forward`, {
    method: "POST",
    body: JSON.stringify({ conversationId }),
  });
}

/** Delete a file the caller owns — removes it from every list + storage. */
export async function deleteOwnerFile(attachmentId: string): Promise<void> {
  await request(`/api/files/${attachmentId}`, { method: "DELETE" });
}

export type DisplayType = "row" | "chip" | "highlight" | "body" | "change" | "sparkline";
export type HighlightColor = "success" | "warning" | "destructive" | "primary";
export type ResultType =
  | "hotel"
  | "flight"
  | "restaurant"
  | "event"
  | "product"
  | "email"
  | "finance"
  | "contact"
  | "generic";

export interface DetailField {
  key: string;
  label?: string;
  display: DisplayType;
  icon?: string;
  color?: HighlightColor | string;
  format?: string;
  hidden?: boolean;
}

export interface ResponseTemplate {
  id: string;
  ownerId?: string;
  name: string;
  description?: string;
  resultType: ResultType;
  fields: DetailField[];
  sampleData?: Record<string, unknown>;
  flowTemplate?: Record<string, unknown>;
  isBuiltin: boolean;
  insertedAt: string;
  updatedAt: string;
}

export interface Agent {
  id: string;
  displayName: string;
  description?: string;
  status: string;
  agentType?: string;
  avatarUrl?: string;
  ownerId?: string;
  insertedAt?: string;
  capabilities?: string[];
  structuredCapabilities?: {
    detail_templates?: Record<string, DetailField[]>;
    tools?: Array<{ name: string; description?: string }>;
    [key: string]: unknown;
  };
  modelConfig?: Record<string, unknown>;
  online?: boolean;
  metadata?: Record<string, unknown>;
  soulMd?: string;
  soulMdInherited?: boolean;
  soulMdSourceName?: string;
  soulMdSourceId?: string;
  presence?: "online_local" | "offline";
  /** Org-host runtime routing. `"local"` (default) → desktop spawns
   *  agent_bridge.py as a subprocess. `"org_host"` → a registered Linux
   *  host VM runs the bridge; process_manager skips local spawn and
   *  returns AgentStatus::Remote. Set via PATCH /api/agents/:id/runtime. */
  runtime?: "local" | "org_host";
  presenceMode?: "always_on" | "wake_on_demand" | "manual";
  idleTimeoutSeconds?: number | null;
  organizationId?: string | null;
  assignedHostId?: string | null;
  /** Present only on ephemeral spawned sub-agents. They are started and
   *  retired by their parent agent's bridge — not run from the desktop app —
   *  so the desktop never holds their API key locally. */
  spawn?: {
    purpose?: string;
    runtime?: "local";
    spawned_at?: string;
    last_used_at?: string;
    expires_at?: string;
  };
}

// LLM API keys — multi-key, encrypted server-side. Replaces the legacy
// localStorage-backed flow; see desktop/src/stores/llmKeyStore.ts for
// the migration shim.
export interface LlmApiKey {
  id: string;
  provider: string;
  label: string;
  isDefault: boolean;
  status: string;
  insertedAt: string;
  updatedAt: string;
  /** Last validated timestamp from the upstream provider, when known. */
  lastValidatedAt?: string;
}

export async function listLlmKeys(): Promise<{ keys: LlmApiKey[] }> {
  return request("/api/me/llm-keys");
}

export async function createLlmKey(args: {
  provider: string;
  token: string;
  label?: string;
  makeDefault?: boolean;
}): Promise<{ key: LlmApiKey }> {
  return request("/api/me/llm-keys", {
    method: "POST",
    body: JSON.stringify(args),
  });
}

export async function updateLlmKey(
  id: string,
  attrs: { label?: string; token?: string }
): Promise<{ key: LlmApiKey }> {
  return request(`/api/me/llm-keys/${id}`, {
    method: "PATCH",
    body: JSON.stringify(attrs),
  });
}

export async function setDefaultLlmKey(
  id: string
): Promise<{ key: LlmApiKey }> {
  return request(`/api/me/llm-keys/${id}/default`, { method: "POST" });
}

export async function deleteLlmKey(id: string): Promise<void> {
  await request(`/api/me/llm-keys/${id}`, { method: "DELETE" });
}

// Fleet-summary row — comes from the multi-agent /api/agents/health
// list endpoint, which enriches each row with displayName/avatarUrl
// for direct rendering in a list.
export interface AgentHealth {
  agentId: string;
  displayName: string;
  avatarUrl?: string;
  healthStatus: "healthy" | "degraded" | "stuck" | "offline";
  executorCount: number;
  onlineExecutorCount: number;
  stuckCount: number;
  queuedTasks: number;
  queuedMessages: number;
}

// Per-agent detail — comes from /api/agents/:id/health/detail. The
// detail endpoint does NOT emit displayName / avatarUrl (the caller
// already knows which agent it asked about), so we deliberately
// don't extend AgentHealth — that would make TS think those fields
// are present when they're actually undefined at runtime.
export interface AgentHealthDetail {
  agentId: string;
  healthStatus: "healthy" | "degraded" | "stuck" | "offline";
  executorCount: number;
  onlineExecutorCount: number;
  stuckCount: number;
  queuedTasks: number;
  queuedMessages: number;
  executors: Array<{
    id: string;
    displayName?: string;
    executorKey: string;
    status: string;
    lastPollAt?: string;
    secondsSincePoll?: number;
    activeTaskCount: number;
    processMetrics?: Record<string, unknown>;
    pendingCommand?: {
      type: string;
      reason: string;
      issuedAt: string;
    } | null;
  }>;
  stuckTasks: Array<{
    id: string;
    taskId: string;
    title?: string;
    claimedAt: string;
    status: string;
    elapsedSeconds: number;
  }>;
  unackedMessages: Array<{
    id: string;
    messageId: string;
    conversationId: string;
    claimedAt: string;
    elapsedSeconds: number;
  }>;
}

export interface InviteInfo {
  displayName: string;
  description?: string;
  capabilities?: string[];
  creator?: { displayName: string };
}

export interface Routine {
  id: string;
  participantId: string;
  ownerId: string;
  name: string;
  description?: string;
  instructions: string;
  status: "active" | "paused" | "disabled" | "expired";
  scheduleType: "interval" | "cron";
  scheduleConfig: Record<string, unknown>;
  reportTo?: string;
  state: Record<string, unknown>;
  lastRunAt?: string;
  nextRunAt?: string;
  runCount: number;
  maxRuns?: number;
  expiresAt?: string;
  consecutiveFailures: number;
  responseTemplate?: string;
  insertedAt: string;
  updatedAt: string;
}

// --- Directory ---

export type ConnectionMode = "direct" | "proxy";
export type ListingConnectionMode = ConnectionMode | "either";

export interface DirectoryListing {
  id: string;
  agentId: string;
  visibility: "public" | "friends_only" | "unlisted";
  listingName: string;
  listingDescription?: string;
  categories: string[];
  tags: string[];
  featured: boolean;
  ratingAvg: number;
  ratingCount: number;
  monthlyTasksCompleted: number;
  avgResponseTimeMs?: number;
  verified: boolean;
  connectionMode?: ListingConnectionMode;
  agent?: Participant;
  listedAt?: string;
  insertedAt: string;
  updatedAt: string;
}

export interface AgentConnection {
  id: string;
  requesterId: string;
  agentId: string;
  ownerId: string;
  status: "pending" | "accepted" | "rejected" | "revoked";
  permissions: string[];
  connectedAt?: string;
  trustOverride?: number;
  connectionMode?: ConnectionMode;
  requester?: Participant;
  agent?: Participant;
  owner?: { id: string; displayName: string; avatarUrl?: string };
  insertedAt: string;
  updatedAt: string;
}

export interface AgentRating {
  id: string;
  raterId: string;
  agentId: string;
  rating: number;
  review?: string;
  rater?: Participant;
  insertedAt: string;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function getListingByAgent(
  agentId: string
): Promise<DirectoryListing | null> {
  if (!UUID_RE.test(agentId)) return null;
  try {
    const res = await request<{ listing: DirectoryListing }>(
      `/api/directory/${agentId}`
    );
    return res.listing;
  } catch (e) {
    if ((e as { status?: number })?.status === 404) return null;
    throw e;
  }
}

export async function createDirectoryListing(data: {
  agentId: string;
  listingName: string;
  listingDescription?: string;
  visibility?: "public" | "friends_only" | "unlisted";
  categories?: string[];
  tags?: string[];
  connectionMode?: ListingConnectionMode;
}): Promise<DirectoryListing> {
  const res = await request<{ listing: DirectoryListing }>("/api/directory", {
    method: "POST",
    body: JSON.stringify(data),
  });
  return res.listing;
}

export async function deleteDirectoryListing(id: string): Promise<void> {
  await request(`/api/directory/${id}`, { method: "DELETE" });
}
