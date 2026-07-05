import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import * as api from "../lib/api";
import { track, ANALYTICS_EVENTS } from "../lib/analytics";
import { providerRequiresLlmKey } from "../lib/models";
import { ws } from "../services/websocket";
import { useAuthStore } from "./authStore";

interface AgentConfig {
  backend: string;
  model: string;
  llmApiKey: string | null;
  /** Reference to a named key in llmKeyStore — takes precedence over provider default */
  llmApiKeyId: string | null;
  maxTokens: number;
  historyLimit: number;
  executionMode: string;
  effort: string | null;
  dangerouslySkipPermissions: boolean;
  autoRestart: boolean;
  autoStart: boolean;
  /** Directories for CLI tools access — also enables CLI tools (Bash, Read, etc.) */
  addDirs: string[];
  /**
   * CLI connection (auth/runtime) for local Claude Code / Codex agents:
   * "subscription" (the machine's `claude login`, default), "anthropic"
   * (Anthropic-direct API key), "bedrock" (AWS Bedrock), "vertex" (GCP
   * Vertex), "openai" (Codex direct). null = subscription. Only meaningful
   * for CLI backends; the Tauri shell maps it to CLAUDE_CODE_USE_* env.
   */
  cliConnection: string | null;
  /** AWS region for the "bedrock" connection (Claude Code needs it explicitly). */
  awsRegion: string | null;
  /** GCP region + project for the "vertex" connection. */
  vertexRegion: string | null;
  vertexProject: string | null;
}

export type ActivityType =
  | "idle"
  | "thinking"
  | "streaming"
  | "tool"
  | "sending"
  | "error";

export interface AgentActivity {
  label: string;
  type: ActivityType;
}

/**
 * Runtime validator for server-sent modelConfig. Backend sends a loose
 * Record<string, unknown>; validate field shapes before merging into local
 * state so a typo ("max_toks") becomes a console warning instead of silently
 * falling back to defaults.
 */
function parseServerModelConfig(
  raw: unknown,
  agentId: string
): Partial<AgentConfig> {
  if (!raw || typeof raw !== "object") return {};
  const mc = raw as Record<string, unknown>;
  const out: Partial<AgentConfig> = {};
  const knownKeys = new Set([
    "backend",
    "model",
    "max_tokens",
    "execution_mode",
    "history_limit",
    "effort",
    "cli_connection",
    "aws_region",
    "vertex_region",
    "vertex_project",
    // Server-injected for CLI cloud connections; consumed by the bridge via
    // the agent profile, not the local --model arg, so we don't surface it
    // in AgentConfig — but list it as "known" so it doesn't warn.
    "runtime_api_id",
  ]);

  const takeString = (key: string, target: keyof AgentConfig) => {
    if (mc[key] == null) return;
    if (typeof mc[key] === "string") {
      (out as Record<string, unknown>)[target] = mc[key];
    } else {
      console.warn(
        `[agentStore] agent ${agentId} modelConfig.${key} expected string, got ${typeof mc[key]}`
      );
    }
  };
  const takeNumber = (key: string, target: keyof AgentConfig) => {
    if (mc[key] == null) return;
    if (typeof mc[key] === "number" && Number.isFinite(mc[key])) {
      (out as Record<string, unknown>)[target] = mc[key];
    } else {
      console.warn(
        `[agentStore] agent ${agentId} modelConfig.${key} expected number, got ${typeof mc[key]}`
      );
    }
  };

  takeString("backend", "backend");
  takeString("model", "model");
  takeNumber("max_tokens", "maxTokens");
  takeString("execution_mode", "executionMode");
  takeNumber("history_limit", "historyLimit");
  takeString("effort", "effort");
  takeString("cli_connection", "cliConnection");
  takeString("aws_region", "awsRegion");
  takeString("vertex_region", "vertexRegion");
  takeString("vertex_project", "vertexProject");

  for (const key of Object.keys(mc)) {
    if (!knownKeys.has(key)) {
      console.warn(
        `[agentStore] agent ${agentId} modelConfig has unknown key "${key}" — ignoring`
      );
    }
  }

  return out;
}

// Parse bridge log tail into a human-readable activity label. Shared across
// UI components via the agent store — each running agent is polled once per
// tick, not once per component.
function parseActivity(lines: string[]): AgentActivity | null {
  if (lines.length === 0) return null;

  for (let i = lines.length - 1; i >= Math.max(0, lines.length - 8); i--) {
    const raw = lines[i];
    const line = raw.toLowerCase();

    if (line.includes("error") || line.includes("traceback")) {
      const clean = raw.replace(/^\[.*?\]\s*/, "").slice(0, 60);
      return { label: clean, type: "error" };
    }
    if (
      line.includes("executing tool") ||
      line.includes("tool_use") ||
      line.includes("tool_call")
    ) {
      const match = raw.match(/(?:executing tool|tool_use|tool_call)[:\s]*(\w+)/i);
      return {
        label: match ? `Tool: ${match[1]}` : "Executing tool...",
        type: "tool",
      };
    }
    if (
      line.includes("text_delta") ||
      line.includes("content_block") ||
      line.includes("streaming")
    ) {
      return { label: "Streaming response...", type: "streaming" };
    }
    if (line.includes("sending message") || line.includes("send_message")) {
      return { label: "Sending message...", type: "sending" };
    }
    if (line.includes("claimed task")) {
      const match = raw.match(/claimed task.*?[:\s]+(.*)/i);
      return {
        label: match ? `Task: ${match[1].slice(0, 40)}` : "Processing task...",
        type: "thinking",
      };
    }
    if (line.includes("new message") || line.includes("processing message")) {
      return { label: "Reading message...", type: "thinking" };
    }
    if (line.includes("thinking") || line.includes("processing")) {
      return { label: "Thinking...", type: "thinking" };
    }
  }

  return null;
}

export interface ManagedAgent {
  agent: api.Agent;
  apiKey: string | null;
  config: AgentConfig;
  processStatus: "running" | "stopped" | "crashed" | "starting" | "stalled";
  uptimeSecs: number | null;
  crashReason: string | null;
  /** Machine-readable category for crashReason. "auth" = the agent's
   *  AgentGram API key was rejected (regenerated elsewhere / deactivated);
   *  "no_key" = no key stored on this computer (agent was set up on another
   *  device). Both are fixed by generating a new key here — the UI renders
   *  a one-click fix instead of a dead-end error string. */
  crashKind: string | null;
  health: api.AgentHealth | null;
  /** Timestamp (ms) when activity was last detected via health delta */
  lastActivityAt: number | null;
  /** Previous health snapshot for delta detection */
  prevHealth: api.AgentHealth | null;
  /** Timestamp (ms) of last auto-restart attempt for stall recovery */
  stallRestartAttemptAt: number | null;
  /** Timestamp (ms) when the process was started — used for startup grace period */
  startedAt: number | null;
  /** Number of consecutive health polls that returned offline/stuck */
  consecutiveBadPolls: number;
}

/** Status of the optional pyobjc/Pillow deps for computer-use safety
 *  features. Lives at the store root (not per-agent) because it's a
 *  machine-wide install. Mirrored from the Rust side; the install runs
 *  in a background thread and the frontend polls via
 *  `refreshComputerUseDepsStatus()`. */
export interface ComputerUseDepsStatus {
  state: "unknown" | "not_installed" | "installing" | "installed" | "failed";
  error?: string;
  logTail?: string[];
}

interface AgentState {
  agents: Record<string, ManagedAgent>;
  /** Per-agent activity parsed from bridge logs, keyed by agentId. */
  activities: Record<string, AgentActivity | null>;
  selectedAgentId: string | null;
  loading: boolean;
  error: string | null;
  /** Per-agent error from the last model_config sync to the backend, keyed by
   *  agentId. The connection/model lives in two places that must agree — the
   *  local config drives the spawn env, the backend-persisted config drives the
   *  resolved model id. A silently-dropped sync split those (the original
   *  Bedrock bug), so surface failures instead of swallowing them. `null` =
   *  last sync succeeded (or none attempted). */
  configSyncError: Record<string, string | null>;
  /** Machine-wide install status of pyobjc + Pillow. */
  computerUseDeps: ComputerUseDepsStatus;

  fetchAgents: () => Promise<void>;
  /** Ask Rust to recheck whether pyobjc + Pillow are importable in the
   *  bridge venv, then refresh local state. Cheap (~50ms). */
  refreshComputerUseDepsStatus: () => Promise<void>;
  /** Kick off a background `pip install` of pyobjc + Pillow in the
   *  bridge venv. Returns immediately; the UI polls until done. */
  installComputerUseDeps: () => Promise<void>;
  fetchHealth: () => Promise<void>;
  /** Poll bridge logs for every running agent and update `activities`. */
  fetchActivities: () => Promise<void>;
  selectAgent: (id: string | null) => Promise<void>;
  startAgent: (id: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  updateConfig: (id: string, config: Partial<AgentConfig>) => void;
  setApiKey: (id: string, key: string) => void;
  createAgent: (data: {
    displayName: string;
    description?: string;
    agentType?: string;
    capabilities?: string[];
    avatarUrl?: string;
    requiresLocation?: boolean;
    soulMd?: string;
    backend?: string;
    model?: string;
    executionMode?: string;
    effort?: string;
    dangerouslySkipPermissions?: boolean;
    /** Initial agent.metadata to set on creation. The backend stores it
     *  shallowly and other code reads from there (e.g. AgentConfig's
     *  computer-use toggle), so passing it here at create time avoids a
     *  follow-up PATCH. Use snake_case keys to match the backend. */
    metadata?: Record<string, unknown>;
    /** Pin the agent to a specific saved LLM key. Omit to resolve to the
     *  user's default for the provider at runtime. */
    llmApiKeyId?: string | null;
    /** Workspace pin. Omit/`null` for personal (cross-workspace, the
     *  default). A UUID pins to that workspace; backend rejects any
     *  value other than the caller's currently-active workspace. */
    organizationId?: string | null;
  }) => Promise<string>;
  regenerateKey: (id: string) => Promise<string>;
  refreshProcessStatuses: () => Promise<boolean>;
  /** Subscribe to WS events that mutate agent state (online toggle,
   *  health updates). Returns an unsub. */
  initWsListeners: () => () => void;
  /** On fresh desktop boot, mark any own-agent offline whose bridge isn't
   *  running locally but which the backend still thinks is online — a
   *  stale executor entry from a prior session. */
  reconcileStaleExecutors: () => Promise<void>;
}

const DEFAULT_CONFIG: AgentConfig = {
  backend: "anthropic",
  model: "claude-sonnet-4-5-20250929",
  llmApiKey: null,
  llmApiKeyId: null,
  maxTokens: 16384,
  historyLimit: 20,
  executionMode: "tool_use",
  effort: null,
  dangerouslySkipPermissions: false,
  autoRestart: true,
  autoStart: false,
  addDirs: [],
  cliConnection: null,
  awsRegion: null,
  vertexRegion: null,
  vertexProject: null,
};

// Keys that may exist in older localStorage blobs but are no longer part
// of AgentConfig. Filtered out at load time so they stop being persisted
// by the next saveLocalConfig. Add to this list when a field is removed.
const ORPHAN_LOCAL_CONFIG_KEYS = ["computerUseEnabled"] as const;

// Config fields the BACKEND owns — they're synced to model_config on every
// edit (see updateConfig) and resolved server-side for both local and hosted
// runs. The backend is the single source of truth for these, so a stale
// localStorage blob must NEVER shadow the server value (that produced a
// split-brain where the desktop showed an old model while the server / web
// showed the real one). They're stripped from the local override at load
// time; the merge then always takes the server's value. Genuinely
// device-local fields (raw llmApiKey, dangerouslySkipPermissions, autoRestart,
// autoStart, addDirs, maxTokens, historyLimit) are left untouched.
const SERVER_OWNED_CONFIG_KEYS: readonly (keyof AgentConfig)[] = [
  "backend",
  "model",
  "executionMode",
  "effort",
  "llmApiKeyId",
  "cliConnection",
  "awsRegion",
  "vertexRegion",
  "vertexProject",
];

function loadLocalConfig(agentId: string): Partial<AgentConfig> {
  const raw = localStorage.getItem(`agent:config:${agentId}`);
  if (raw) {
    try {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      for (const k of ORPHAN_LOCAL_CONFIG_KEYS) {
        delete parsed[k];
      }
      // Backend-owned fields never come from localStorage — the server value
      // wins so the model shown here matches the server (and the web app).
      for (const k of SERVER_OWNED_CONFIG_KEYS) {
        delete parsed[k];
      }
      return parsed as Partial<AgentConfig>;
    } catch {
      return {};
    }
  }
  return {};
}

function saveLocalConfig(agentId: string, config: AgentConfig) {
  localStorage.setItem(`agent:config:${agentId}`, JSON.stringify(config));
}

function loadApiKey(agentId: string): string | null {
  return localStorage.getItem(`agent:apikey:${agentId}`);
}

function saveApiKey(agentId: string, key: string) {
  localStorage.setItem(`agent:apikey:${agentId}`, key);
}

/** This machine's name, as Rust computes it (and passes to the bridge via
 *  AGENTGRAM_DEVICE_NAME) — so comparing against an agent's server-reported
 *  deviceName answers "is that bridge running on THIS device?". Cached after
 *  the first invoke; null when Tauri is unavailable (browser dev). */
let cachedDeviceName: string | null | undefined;
export async function getLocalDeviceName(): Promise<string | null> {
  if (cachedDeviceName !== undefined) return cachedDeviceName;
  try {
    const name = await invoke<string>("get_device_name");
    cachedDeviceName = name || null;
  } catch {
    cachedDeviceName = null;
  }
  return cachedDeviceName;
}

/**
 * Track consecutive health endpoint failures (network errors, 502s, etc.).
 * When the backend is deploying, the endpoint itself is unreachable — the first
 * successful poll after an outage often shows "offline" because ETS is empty.
 * We suppress stall detection for a grace period after endpoint recovery.
 */
let consecutiveHealthEndpointFailures = 0;
let lastHealthEndpointRecoveryAt = 0;

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: {},
  activities: {},
  selectedAgentId: null,
  loading: false,
  error: null,
  configSyncError: {},
  computerUseDeps: { state: "unknown" },

  refreshComputerUseDepsStatus: async () => {
    try {
      // `check_computer_use_deps` updates the Rust-side cache too, so
      // calling it first means a subsequent `get_*` reflects the recheck.
      await invoke<boolean>("check_computer_use_deps");
      const status = await invoke<ComputerUseDepsStatus>(
        "get_computer_use_deps_status",
      );
      set({ computerUseDeps: status });
    } catch (e) {
      // Tauri not available in dev/browser? Leave state as-is.
      console.warn("refreshComputerUseDepsStatus failed", e);
    }
  },

  installComputerUseDeps: async () => {
    try {
      await invoke<void>("install_computer_use_deps");
      // Optimistically mark as installing; the poll loop below will pick
      // up the real state when the background pip finishes.
      set({ computerUseDeps: { state: "installing" } });
      // Poll every 1.5s until terminal state (installed/failed). 15 min
      // cap so a hung pip can't poll forever.
      const start = Date.now();
      const tick = async () => {
        if (Date.now() - start > 15 * 60 * 1000) return;
        try {
          const s = await invoke<ComputerUseDepsStatus>(
            "get_computer_use_deps_status",
          );
          set({ computerUseDeps: s });
          if (s.state === "installing") {
            setTimeout(tick, 1500);
          }
        } catch (e) {
          console.warn("deps status poll failed", e);
        }
      };
      setTimeout(tick, 1500);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ computerUseDeps: { state: "failed", error: msg } });
    }
  },

  fetchAgents: async () => {
    set({ loading: true, error: null });
    try {
      const result = await api.listAgents();
      const current = get().agents;
      const updated: Record<string, ManagedAgent> = {};

      for (const agent of result.agents) {
        const existing = current[agent.id];
        const localConfig = loadLocalConfig(agent.id);
        const localKey = loadApiKey(agent.id);

        // Merge: defaults <- server modelConfig <- local overrides
        const serverConfig = parseServerModelConfig(agent.modelConfig, agent.id);

        updated[agent.id] = {
          agent,
          apiKey: existing?.apiKey || localKey,
          config: { ...DEFAULT_CONFIG, ...serverConfig, ...localConfig },
          processStatus: existing?.processStatus || "stopped",
          uptimeSecs: existing?.uptimeSecs || null,
          crashReason: existing?.crashReason || null,
          crashKind: existing?.crashKind || null,
          health: existing?.health || null,
          lastActivityAt: existing?.lastActivityAt || null,
          prevHealth: existing?.prevHealth || null,
          stallRestartAttemptAt: existing?.stallRestartAttemptAt || null,
          startedAt: existing?.startedAt || null,
          consecutiveBadPolls: existing?.consecutiveBadPolls || 0,
        };
      }

      set({ agents: updated, loading: false });

      // Don't seed presenceStore from `agent.online` here — that flag comes
      // from the backend's ExecutorRegistry, which can carry stale state
      // for ~60-90s after a bridge crash / ungraceful desktop quit. Let
      // the `agent_status_changed` WS stream drive the green dots. For our
      // *own* agents where the backend claims online=true but we know we
      // have no local bridge running, reconcileStaleExecutors (called from
      // useWebSocket after refreshProcessStatuses) proactively clears it.
    } catch (e) {
      console.error("fetchAgents failed:", e);
      set({
        loading: false,
        error: e instanceof Error ? e.message : "Failed to fetch agents",
      });
    }
  },

  fetchHealth: async () => {
    try {
      const result = await api.getAgentHealth();
      const current = get().agents;
      const now = Date.now();
      let changed = false;

      const agents = { ...current };
      for (const health of result.agents) {
        const managed = agents[health.agentId];
        if (managed) {
          // Detect activity by comparing with previous health snapshot
          let activityDetected = false;
          if (managed.prevHealth) {
            const prev = managed.prevHealth;
            activityDetected =
              health.queuedTasks !== prev.queuedTasks ||
              health.queuedMessages !== prev.queuedMessages ||
              health.stuckCount !== prev.stuckCount ||
              health.onlineExecutorCount !== prev.onlineExecutorCount;
          }
          if (health.queuedTasks > 0 || health.queuedMessages > 0) {
            activityDetected = true;
          }

          // Only update if health data actually changed
          const prevH = managed.health;
          const healthChanged =
            !prevH ||
            prevH.healthStatus !== health.healthStatus ||
            prevH.queuedTasks !== health.queuedTasks ||
            prevH.queuedMessages !== health.queuedMessages ||
            prevH.stuckCount !== health.stuckCount ||
            prevH.onlineExecutorCount !== health.onlineExecutorCount ||
            prevH.executorCount !== health.executorCount;
          const activityChanged =
            activityDetected && managed.lastActivityAt !== now;

          if (healthChanged || activityChanged) {
            agents[health.agentId] = {
              ...managed,
              health,
              prevHealth: health,
              lastActivityAt: activityDetected ? now : managed.lastActivityAt,
            };
            changed = true;
          }

          // --- Stall detection ---
          // Require CONSECUTIVE bad polls before declaring a stall.
          // "offline" needs more polls (often transient after deploys) than "stuck".
          const CONSECUTIVE_OFFLINE_THRESHOLD = 3; // 3 polls = ~30s
          const CONSECUTIVE_STUCK_THRESHOLD = 2;   // 2 polls = ~20s

          const backendOffline = health.healthStatus === "offline";
          const backendStuck = health.healthStatus === "stuck";
          const backendDead = backendOffline || backendStuck;
          const processAlive =
            managed.processStatus === "running" || managed.processStatus === "stalled";

          // Grace period: don't mark as stalled during bridge startup (warmup, executor registration)
          const STARTUP_GRACE_MS = 90_000;
          const inStartupGrace =
            managed.startedAt != null && now - managed.startedAt < STARTUP_GRACE_MS;

          // Deploy grace: after the health endpoint recovers from failures, suppress
          // stall detection for 2 minutes. The first polls after a backend restart
          // will show "offline" because ETS executors are gone — the bridge needs
          // time to re-register.
          const DEPLOY_RECOVERY_GRACE_MS = 120_000;
          const inDeployRecoveryGrace =
            lastHealthEndpointRecoveryAt > 0 &&
            now - lastHealthEndpointRecoveryAt < DEPLOY_RECOVERY_GRACE_MS;

          if (backendDead && processAlive && !inStartupGrace && !inDeployRecoveryGrace) {
            // Increment consecutive bad poll counter
            const prevBadPolls = agents[health.agentId].consecutiveBadPolls || 0;
            const newBadPolls = prevBadPolls + 1;
            const threshold = backendStuck
              ? CONSECUTIVE_STUCK_THRESHOLD
              : CONSECUTIVE_OFFLINE_THRESHOLD;

            agents[health.agentId] = {
              ...agents[health.agentId],
              consecutiveBadPolls: newBadPolls,
            };
            changed = true;

            if (newBadPolls >= threshold) {
              // Enough consecutive bad polls — mark as stalled
              if (managed.processStatus !== "stalled") {
                agents[health.agentId] = {
                  ...agents[health.agentId],
                  processStatus: "stalled",
                };
                changed = true;
                console.log(
                  `[StallDetector] Agent ${health.agentId} marked stalled ` +
                  `(backend: ${health.healthStatus}, consecutive: ${newBadPolls})`
                );
              }

              // Auto-restart with 60s cooldown (doubled from 30s to prevent rapid cycling)
              const STALL_COOLDOWN_MS = 60_000;
              const lastRestart = agents[health.agentId].stallRestartAttemptAt || 0;
              const current = agents[health.agentId];
              if (
                current.config.autoRestart &&
                current.processStatus === "stalled" &&
                now - lastRestart > STALL_COOLDOWN_MS
              ) {
                agents[health.agentId] = {
                  ...agents[health.agentId],
                  stallRestartAttemptAt: now,
                };
                changed = true;
                // Defer restart to avoid blocking the health poll
                const store = get();
                setTimeout(() => {
                  console.log(`[StallDetector] Auto-restarting stalled agent ${health.agentId}`);
                  store.stopAgent(health.agentId).then(() => {
                    store.startAgent(health.agentId).catch((err: unknown) => {
                      console.error(`[StallDetector] Failed to restart ${health.agentId}:`, err);
                    });
                  });
                }, 0);
              }
            } else {
              console.log(
                `[StallDetector] Agent ${health.agentId} backend=${health.healthStatus} ` +
                `(poll ${newBadPolls}/${threshold}, waiting for consecutive threshold)`
              );
            }
          } else if (!backendDead && managed.processStatus === "stalled") {
            // Backend recovered — clear stall status
            agents[health.agentId] = {
              ...agents[health.agentId],
              processStatus: "running",
              stallRestartAttemptAt: null,
              consecutiveBadPolls: 0,
            };
            changed = true;
            console.log(`[StallDetector] Agent ${health.agentId} recovered from stall`);
          } else if (!backendDead) {
            // Healthy/degraded — reset consecutive bad poll counter
            if (agents[health.agentId].consecutiveBadPolls > 0) {
              agents[health.agentId] = {
                ...agents[health.agentId],
                consecutiveBadPolls: 0,
              };
              changed = true;
            }
          }
        }
      }

      if (changed) set({ agents });

      // Successful health poll — track endpoint recovery
      if (consecutiveHealthEndpointFailures > 0) {
        console.log(
          `[StallDetector] Health endpoint recovered after ${consecutiveHealthEndpointFailures} failures`
        );
        lastHealthEndpointRecoveryAt = Date.now();
        consecutiveHealthEndpointFailures = 0;
      }
    } catch {
      // Health endpoint unreachable — likely a backend deploy in progress.
      // Track failures so we can suppress stall detection after recovery.
      consecutiveHealthEndpointFailures++;
      console.log(
        `[StallDetector] Health endpoint failure #${consecutiveHealthEndpointFailures} — ` +
        `backend may be deploying, suppressing stall detection`
      );
    }
  },

  fetchActivities: async () => {
    const running = Object.values(get().agents).filter(
      (m) => m.processStatus === "running"
    );
    if (running.length === 0) {
      if (Object.keys(get().activities).length > 0) set({ activities: {} });
      return;
    }

    const next: Record<string, AgentActivity | null> = {};
    await Promise.all(
      running.map(async (managed) => {
        try {
          const lines: string[] = await invoke("get_agent_logs", {
            agentId: managed.agent.id,
            tail: 8,
          });
          next[managed.agent.id] = parseActivity(lines);
        } catch {
          next[managed.agent.id] = null;
        }
      })
    );

    // Shallow-compare to avoid re-render churn when nothing changed
    const prev = get().activities;
    const prevIds = Object.keys(prev);
    const nextIds = Object.keys(next);
    if (prevIds.length === nextIds.length) {
      let identical = true;
      for (const id of nextIds) {
        const a = prev[id];
        const b = next[id];
        if (!a || !b) {
          if (a !== b) { identical = false; break; }
        } else if (a.label !== b.label || a.type !== b.type) {
          identical = false;
          break;
        }
      }
      if (identical) return;
    }
    set({ activities: next });
  },

  selectAgent: async (id) => {
    set({ selectedAgentId: id });

    // Refresh agent profile data (avatar, description, etc.) from server
    if (id) {
      try {
        const freshAgent = await api.getAgent(id);
        const agents = { ...get().agents };
        const managed = agents[id];
        if (managed) {
          agents[id] = { ...managed, agent: freshAgent };
          set({ agents });
        }
      } catch {
        // Non-fatal — stale data is better than no data
      }
    }
  },

  startAgent: async (id) => {
    const managed = get().agents[id];
    if (!managed) {
      throw new Error("Agent not found");
    }
    if (!managed.apiKey) {
      // The plaintext key is only ever handed out on the machine that
      // created (or last regenerated) it — an agent set up elsewhere has
      // nothing stored here. Surface that as an actionable "auth" state so
      // the UI offers the one-click "generate a new key" fix.
      const reason =
        "This agent's API key isn't on this computer — it was set up on " +
        "another device. Generate a new key here to run it on this machine.";
      set({
        agents: {
          ...get().agents,
          [id]: {
            ...managed,
            processStatus: "crashed",
            crashReason: reason,
            crashKind: "no_key",
          },
        },
      });
      throw new Error(reason);
    }

    const needsLlmKey = providerRequiresLlmKey(managed.config.backend);
    // Inline `llmApiKey` is the only local source — for one-off
    // overrides someone pasted into the agent's "Custom Key…" field.
    // The named multi-key store now lives on the backend (encrypted),
    // so for everything else we resolve through /api/integrations/:p/
    // resolve, optionally targeting a specific row via key_id.
    let llmApiKey: string | null = managed.config.llmApiKey ?? null;

    if (needsLlmKey && !llmApiKey) {
      try {
        const { token } = await api.resolveProviderToken(
          managed.config.backend,
          { keyId: managed.config.llmApiKeyId ?? null }
        );
        if (token) llmApiKey = token;
      } catch {
        // Backend has nothing — fall through to the error below.
      }
    }

    if (needsLlmKey && !llmApiKey) {
      throw new Error(
        `No LLM API key configured for ${managed.config.backend}. Set one in Profile → LLM API Keys.`
      );
    }

    // Org-host runtime: the bridge is owned by a remote Linux VM, not
    // this device. Nothing local to spawn — return early and let the
    // backend's wake dispatch + presence push handle the agent's
    // online state. We keep the local processStatus at "stopped" so
    // the UI doesn't pretend there's a live subprocess here.
    if (managed.agent.runtime === "org_host") {
      set({
        agents: {
          ...get().agents,
          [id]: { ...managed, processStatus: "stopped", crashReason: null, crashKind: null },
        },
      });
      return;
    }

    set({ agents: { ...get().agents, [id]: { ...managed, processStatus: "starting", crashReason: null, crashKind: null } } });

    try {
      await invoke("start_agent", {
        args: {
          agentId: id,
          agentName: managed.agent.displayName,
          apiKey: managed.apiKey,
          backend: managed.config.backend,
          model: managed.config.model,
          llmApiKey: llmApiKey,
          maxTokens: managed.config.maxTokens,
          historyLimit: managed.config.historyLimit,
          executionMode: managed.config.executionMode,
          dangerouslySkipPermissions: managed.config.dangerouslySkipPermissions,
          // Computer use is the source of truth in agent.metadata so the
          // setting follows the user across desktops (per-device toggle
          // was a v1 shortcut). Read it here and forward to Tauri so the
          // bridge spawn gets AGENTGRAM_COMPUTER_USE=local when on.
          // `Agent.metadata` is already typed `Record<string, unknown>`
          // in api.ts, so no cast is needed at the read sites.
          computerUseEnabled: managed.agent.metadata?.computer_use_enabled === true,
          computerUseAllowedApps:
            (managed.agent.metadata?.computer_use_allowed_apps as string[] | undefined) || [],
          effort: managed.config.effort || undefined,
          addDirs: managed.config.addDirs.length > 0 ? managed.config.addDirs : undefined,
          // CLI connection (auth/runtime) — the Tauri shell maps this to the
          // right CLAUDE_CODE_USE_* env (and unsets the others) so a local
          // Claude Code / Codex agent uses the connection the user picked,
          // not whatever the machine's ambient env defaults to.
          cliConnection: managed.config.cliConnection || undefined,
          awsRegion: managed.config.awsRegion || undefined,
          vertexRegion: managed.config.vertexRegion || undefined,
          vertexProject: managed.config.vertexProject || undefined,
          // Org-host agents are owned by a remote Linux VM; the Rust
          // process_manager short-circuits start_agent when this is
          // set and returns AgentStatus::Remote without spawning a
          // local subprocess. Passing the field unconditionally keeps
          // the wire shape predictable; the default `"local"` matches
          // today's behavior.
          runtime: managed.agent.runtime ?? "local",
        },
      });

      const current = get().agents[id];
      if (current) {
        set({ agents: { ...get().agents, [id]: { ...current, processStatus: "running", uptimeSecs: 0, startedAt: Date.now() } } });
      }
    } catch (e) {
      const current = get().agents[id];
      if (current) {
        const msg = e instanceof Error ? e.message : String(e);
        set({ agents: { ...get().agents, [id]: { ...current, processStatus: "crashed", crashReason: msg, crashKind: null } } });
      }
      throw e;
    }
  },

  stopAgent: async (id) => {
    const managed = get().agents[id];
    const isOrgHosted = managed?.agent.runtime === "org_host";

    try {
      await invoke("stop_agent", { agentId: id });
    } catch {
      // Process may already be dead — or, for an org-hosted agent,
      // never existed locally. Tauri returns "not found" which we
      // intentionally ignore.
    }

    if (!isOrgHosted) {
      // Mark executors offline immediately so web/mobile apps see the
      // change without waiting 45-105s for the cleanup worker. For
      // org-hosted agents the remote bridge is still alive and OWNS
      // its executor registration; force-marking it offline here would
      // lie about its state and the host's next heartbeat would just
      // re-register anyway.
      try {
        await api.markAgentOffline(id);
      } catch {
        // Non-fatal — cleanup worker will handle it eventually
      }
    }

    if (managed) {
      set({ agents: { ...get().agents, [id]: { ...managed, processStatus: "stopped", uptimeSecs: null, crashReason: null, crashKind: null, startedAt: null, consecutiveBadPolls: 0 } } });
    }
  },

  updateConfig: (id, partial) => {
    const managed = get().agents[id];
    if (managed) {
      const config = { ...managed.config, ...partial };
      set({ agents: { ...get().agents, [id]: { ...managed, config } } });
      saveLocalConfig(id, config);

      // Sync model_config fields to backend when changed. llm_api_key_id
      // is the per-agent override that the hosted executor reads at
      // resolve time — without persisting it server-side, hosted runs
      // silently use the user's default key regardless of what was
      // picked in the dropdown. `null` clears the override.
      const mcPatch: Record<string, unknown> = {};
      if (partial.backend) mcPatch.backend = partial.backend;
      if (partial.model) mcPatch.model = partial.model;
      if (partial.executionMode) mcPatch.execution_mode = partial.executionMode;
      if (partial.effort) mcPatch.effort = partial.effort;
      if ("llmApiKeyId" in partial) mcPatch.llm_api_key_id = partial.llmApiKeyId;
      // CLI connection (auth/runtime) + its cloud region/project. Must persist
      // server-side so the serializer can resolve runtime_api_id for the
      // bridge. `"in" partial` semantics so picking "subscription" / clearing
      // a region writes null rather than being dropped.
      if ("cliConnection" in partial) mcPatch.cli_connection = partial.cliConnection;
      if ("awsRegion" in partial) mcPatch.aws_region = partial.awsRegion;
      if ("vertexRegion" in partial) mcPatch.vertex_region = partial.vertexRegion;
      if ("vertexProject" in partial) mcPatch.vertex_project = partial.vertexProject;
      if (Object.keys(mcPatch).length > 0) {
        // Persist to the backend and TRACK the outcome. This sync is what
        // keeps the spawn env (local config) and the resolved model id
        // (backend config) in agreement — a silent failure here is exactly
        // what produced the Bedrock split-brain, so record it for the UI to
        // surface rather than swallowing it in a console.warn.
        api
          .updateModelConfig(id, mcPatch)
          .then(() => {
            if (get().configSyncError[id]) {
              set({ configSyncError: { ...get().configSyncError, [id]: null } });
            }
          })
          .catch((err) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.warn(`[agentStore] Failed to sync model_config to backend:`, err);
            set({ configSyncError: { ...get().configSyncError, [id]: msg } });
          });
      }
    }
  },

  setApiKey: (id, key) => {
    const managed = get().agents[id];
    if (managed) {
      set({ agents: { ...get().agents, [id]: { ...managed, apiKey: key } } });
      saveApiKey(id, key);
    }
  },

  createAgent: async (data) => {
    const {
      backend: selectedBackend,
      model: selectedModel,
      executionMode: selectedMode,
      effort: selectedEffort,
      dangerouslySkipPermissions: skipPerms,
      llmApiKeyId: selectedKeyId,
      ...apiData
    } = data;
    // `metadata` and `organizationId` (if present in apiData) flow
    // straight through to the API. Cross-device fields
    // (computer_use_enabled etc.) live in metadata; the modal composes
    // the right snake_case keys directly.
    const result = await api.createAgent(apiData);
    track(ANALYTICS_EVENTS.AGENT_CREATED, {
      agent_type: result.agent.agentType,
      runtime: result.agent.runtime,
    });
    const config = {
      ...DEFAULT_CONFIG,
      ...(selectedBackend ? { backend: selectedBackend } : {}),
      ...(selectedModel ? { model: selectedModel } : {}),
      ...(selectedMode ? { executionMode: selectedMode } : {}),
      ...(selectedEffort ? { effort: selectedEffort } : {}),
      ...(skipPerms ? { dangerouslySkipPermissions: true } : {}),
      ...(selectedKeyId ? { llmApiKeyId: selectedKeyId } : {}),
    };

    set({
      agents: {
        ...get().agents,
        [result.agent.id]: {
          agent: result.agent,
          apiKey: result.apiKey,
          config,
          processStatus: "stopped",
          uptimeSecs: null,
          crashReason: null,
          crashKind: null,
          health: null,
          lastActivityAt: null,
          prevHealth: null,
          stallRestartAttemptAt: null,
          startedAt: null,
          consecutiveBadPolls: 0,
        },
      },
    });

    saveApiKey(result.agent.id, result.apiKey);
    saveLocalConfig(result.agent.id, config);

    // Sync model_config to backend (backend, model, execution_mode, effort,
    // llm_api_key_id when the agent is pinned to a specific saved key)
    const modelConfigPatch: Record<string, unknown> = {};
    if (selectedBackend) modelConfigPatch.backend = selectedBackend;
    if (selectedModel) modelConfigPatch.model = selectedModel;
    if (selectedMode) modelConfigPatch.execution_mode = selectedMode;
    if (selectedEffort) modelConfigPatch.effort = selectedEffort;
    if (selectedKeyId) modelConfigPatch.llm_api_key_id = selectedKeyId;
    if (Object.keys(modelConfigPatch).length > 0) {
      const newId = result.agent.id;
      api.updateModelConfig(newId, modelConfigPatch).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(`[agentStore] Failed to sync model_config on create:`, err);
        set({ configSyncError: { ...get().configSyncError, [newId]: msg } });
      });
    }

    return result.agent.id;
  },

  regenerateKey: async (id) => {
    const result = await api.regenerateApiKey(id);
    const managed = get().agents[id];
    if (managed) {
      set({
        agents: {
          ...get().agents,
          [id]: { ...managed, agent: result.agent, apiKey: result.apiKey },
        },
      });
      saveApiKey(id, result.apiKey);
    }
    return result.apiKey;
  },

  initWsListeners: () => {
    const unsubs: Array<() => void> = [];

    // The health snapshot (`fetchHealth`) otherwise refreshes on a slow
    // poll (60s from Dashboard) — after a presence flip it lags behind the
    // instant WS status, leaving e.g. a stale "offline" hint under a badge
    // that already says the agent is online elsewhere. Re-fetch shortly
    // after any flip; debounced so a burst of flips costs one request.
    let healthRefreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleHealthRefresh = () => {
      if (healthRefreshTimer) clearTimeout(healthRefreshTimer);
      healthRefreshTimer = setTimeout(() => {
        healthRefreshTimer = null;
        get().fetchHealth();
      }, 1500);
    };

    // Backend pushes `agent_status_changed` on the user channel whenever an
    // agent's executor presence flips. Runtime presence lives ONLY in
    // presenceStore (which also handles this event) — mirroring it onto
    // Agent objects created a second, divergent source of truth. Here we
    // only refresh the health snapshot.
    unsubs.push(
      ws.on("agent_status_changed", (payload) => {
        if (!payload.agentId) return;
        scheduleHealthRefresh();
      })
    );

    // Cross-device sync — backend pushes the fresh agent payload here
    // whenever an agent is updated on any of the owner's clients.
    // Without this, a setting toggled in the web app stays invisible
    // in the desktop until the user refreshes.
    unsubs.push(
      ws.on("agent_updated", (payload) => {
        const incoming = payload as Partial<api.Agent> & {
          id?: string;
          organizationId?: string;
        };
        const agentId = incoming?.id;
        if (!agentId) return;

        // Slack-style: drop events for agents in a workspace the
        // user isn't currently active in.
        const activeOrg =
          useAuthStore.getState().participant?.activeOrganizationId;
        if (
          incoming.organizationId &&
          activeOrg &&
          incoming.organizationId !== activeOrg
        ) {
          return;
        }

        set((s) => {
          const managed = s.agents[agentId];
          if (!managed) return s;
          return {
            agents: {
              ...s.agents,
              [agentId]: {
                ...managed,
                agent: { ...managed.agent, ...incoming },
              },
            },
          };
        });
      })
    );

    return () => {
      if (healthRefreshTimer) clearTimeout(healthRefreshTimer);
      unsubs.forEach((u) => u());
    };
  },

  reconcileStaleExecutors: async () => {
    const managed = Object.values(get().agents);
    const myDevice = await getLocalDeviceName();
    // Deliberately reads the fetch-time REST `agent.online`/`deviceName`
    // snapshot (NOT presenceStore): this reconciles the SERVER's executor
    // rows against local reality at startup, before live presence has
    // necessarily arrived. UI liveness must never read these fields.
    const stale = managed.filter(
      (m) =>
        m.agent.online === true &&
        m.processStatus === "stopped" &&
        // Only reconcile agents this device is actually responsible for
        // running. An org_host agent's bridge lives on a remote Linux VM,
        // not here — its processStatus is *always* "stopped" locally (see
        // startAgent's org_host early-return). Marking it offline would be
        // wrong: it stomps a healthy VM-hosted agent, causing the mobile
        // app to flicker the agent offline → back online (next VM heartbeat
        // re-registers the executor) on every desktop launch.
        m.agent.runtime !== "org_host" &&
        // Same logic for an agent whose bridge is alive on ANOTHER of the
        // user's machines: its executor reports that machine's deviceName,
        // so "online but not running here" is the truth, not staleness.
        // Only reconcile executors this device plausibly owns — no reported
        // device (pre-device-reporting stale row) or our own name.
        (!m.agent.deviceName || m.agent.deviceName === myDevice)
    );
    if (stale.length === 0) return;
    console.log(
      `[agentStore] Reconciling ${stale.length} stale executor(s): ${stale
        .map((m) => m.agent.displayName)
        .join(", ")}`
    );
    await Promise.all(
      stale.map((m) =>
        api
          .markAgentOffline(m.agent.id)
          .catch((e) =>
            console.warn(
              `[agentStore] markAgentOffline(${m.agent.id}) failed`,
              e
            )
          )
      )
    );
  },

  refreshProcessStatuses: async () => {
    try {
      const statuses: Array<{
        agentId: string;
        status: string;
        uptimeSecs: number | null;
        crashReason: string | null;
        crashKind: string | null;
      }> = await invoke("get_all_statuses");

      const current = get().agents;
      const statusMap = new Map(statuses.map((s) => [s.agentId, s]));
      let changed = false;

      const agents = { ...current };
      for (const id of Object.keys(agents)) {
        const status = statusMap.get(id);
        if (status) {
          const managed = agents[id];
          let newStatus = status.status as ManagedAgent["processStatus"];
          const newCrash = status.crashReason || null;
          const newCrashKind = status.crashKind || null;

          // Preserve "stalled" status when OS process is still alive —
          // stall detection in fetchHealth sets this; only clear it when
          // the process actually dies or fetchHealth clears it on recovery.
          if (managed.processStatus === "stalled" && newStatus === "running") {
            newStatus = "stalled";
          }

          if (
            managed.processStatus !== newStatus ||
            managed.uptimeSecs !== status.uptimeSecs ||
            managed.crashReason !== newCrash ||
            managed.crashKind !== newCrashKind
          ) {
            agents[id] = {
              ...managed,
              processStatus: newStatus,
              uptimeSecs: status.uptimeSecs,
              crashReason: newCrash,
              crashKind: newCrashKind,
            };
            changed = true;
          }
        }
      }

      if (changed) set({ agents });
      return true;
    } catch {
      // Non-fatal
      return false;
    }
  },
}));
