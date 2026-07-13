import { create } from "zustand";
import { ws } from "../services/websocket";
import type { AgentActivity } from "../lib/agent-activity";
import {
  TYPING_TIMEOUT_AGENT_MS,
  TYPING_TIMEOUT_HUMAN_MS,
  WAKING_TIMEOUT_MS,
} from "../lib/status-contract.generated";

interface PresenceState {
  connected: boolean;
  /** Reachable peers — humans currently WS-connected + agents whose bridge
   *  is online. */
  online: Set<string>;
  /** Per-agent presence. Populated for both our own agents and any external
   *  agent we share a conversation with — the backend pushes
   *  `agent_status_changed` to all conversation peers. */
  agentPresence: Record<string, "online_local">;
  /** Per-agent machine label to DISPLAY (local-runtime agents only): the
   *  owner's nickname for the machine when set, else the raw name the
   *  bridge reported. Key is dropped when the agent goes offline. */
  agentDevices: Record<string, string>;
  /** Per-agent RAW machine name (same lifecycle as agentDevices). Identity
   *  checks — "is that bridge running on THIS device?" — compare this
   *  against the local hostname; never the display label above. */
  agentDeviceHostnames: Record<string, string>;
  /** Per-agent live activity (thinking / working / writing / …). Broadcast
   *  globally via `agent_activity_changed`, so an agent reads as busy on
   *  every surface even when we're viewing another conversation. Absence =
   *  idle (fall back to the online/offline dot). */
  agentActivity: Record<string, AgentActivity>;
  /** Conversations each agent's activity originates in (live streams' +
   *  active tasks' conversations). The conversation LIST scopes its
   *  "Thinking…/Working…" line to these rows; agent-centric surfaces
   *  (rail, header, details panel) keep using the global agentActivity. */
  agentActivityConvs: Record<string, string[]>;
  /** convId → Set of participantIds currently typing */
  typing: Record<string, Set<string>>;
  /** participantId → display name (for rendering "X is typing...") */
  typingNames: Record<string, string>;
  /** participantId → "human" | "agent". Drives the semantic typing verb
   *  ("is typing" vs "is processing") so the indicator reads the same as
   *  web/mobile. */
  typingTypes: Record<string, string>;
  /** Hosted agents the user just asked to bring back online (a host restart
   *  is in flight). Drives the per-row "Bringing online…" spinner until the
   *  agent reports online via `agent_status_changed` or a safety timeout
   *  clears it — so the action doesn't look like it did nothing. */
  wakingAgents: Set<string>;

  /** Drop a participant's typing indicator immediately (e.g. when their
   * message arrives — don't wait for the per-participant TTL). */
  clearTyping: (convId: string, participantId: string) => void;

  /** Mark agents as "coming online" (after a restart request). Auto-clears
   *  each after a safety timeout if it never reports online. */
  markWaking: (agentIds: string[]) => void;
  /** Stop showing the waking spinner for an agent. */
  clearWaking: (agentId: string) => void;

  initWsListeners: () => () => void;
}

// How long a "Bringing online…" spinner persists if the agent never reports
// online (e.g. its host is down). Generous — a bulk "bring online" restarts a
// host's bridges staggered (~5s apart) so a large fleet's later agents respawn
// well after the click — but bounded so the row doesn't spin forever.

export const usePresenceStore = create<PresenceState>((set) => {
  // Per-key timer (keyed "convId:participantId") so we can cancel/refresh
  const typingTimers = new Map<string, ReturnType<typeof setTimeout>>();
  // Per-agent safety timers for the "Bringing online…" spinner.
  const wakingTimers = new Map<string, ReturnType<typeof setTimeout>>();

  function clearWaking(agentId: string) {
    const timer = wakingTimers.get(agentId);
    if (timer) {
      clearTimeout(timer);
      wakingTimers.delete(agentId);
    }
    set((s) => {
      if (!s.wakingAgents.has(agentId)) return s;
      const next = new Set(s.wakingAgents);
      next.delete(agentId);
      return { wakingAgents: next };
    });
  }

  function markWaking(agentIds: string[]) {
    if (agentIds.length === 0) return;
    for (const id of agentIds) {
      const prev = wakingTimers.get(id);
      if (prev) clearTimeout(prev);
      wakingTimers.set(id, setTimeout(() => clearWaking(id), WAKING_TIMEOUT_MS));
    }
    set((s) => {
      const next = new Set(s.wakingAgents);
      agentIds.forEach((id) => next.add(id));
      return { wakingAgents: next };
    });
  }

  function clearTyping(convId: string, participantId: string) {
    const key = `${convId}:${participantId}`;
    const timer = typingTimers.get(key);
    if (timer) {
      clearTimeout(timer);
      typingTimers.delete(key);
    }
    set((s) => {
      const current = s.typing[convId];
      if (!current || !current.has(participantId)) return s;
      const next = new Set(current);
      next.delete(participantId);
      return { typing: { ...s.typing, [convId]: next } };
    });
  }

  function setTyping(
    convId: string,
    participantId: string,
    displayName: string | undefined,
    isAgent: boolean
  ) {
    const key = `${convId}:${participantId}`;
    const prev = typingTimers.get(key);
    if (prev) clearTimeout(prev);
    const ttl = isAgent ? TYPING_TIMEOUT_AGENT_MS : TYPING_TIMEOUT_HUMAN_MS;
    typingTimers.set(
      key,
      setTimeout(() => clearTyping(convId, participantId), ttl)
    );

    const ptype = isAgent ? "agent" : "human";

    set((s) => {
      const current = s.typing[convId] ?? new Set();
      if (
        current.has(participantId) &&
        s.typingNames[participantId] === displayName &&
        s.typingTypes[participantId] === ptype
      ) {
        return s;
      }
      const next = new Set(current);
      next.add(participantId);
      return {
        typing: { ...s.typing, [convId]: next },
        typingNames: displayName
          ? { ...s.typingNames, [participantId]: displayName }
          : s.typingNames,
        typingTypes: { ...s.typingTypes, [participantId]: ptype },
      };
    });
  }

  return {
    connected: false,
    online: new Set(),
    agentPresence: {},
    agentDevices: {},
    agentDeviceHostnames: {},
    agentActivity: {},
    agentActivityConvs: {},
    typing: {},
    typingNames: {},
    typingTypes: {},
    wakingAgents: new Set(),

    clearTyping,
    markWaking,
    clearWaking,

    initWsListeners: () => {
      const unsubs: (() => void)[] = [];

      unsubs.push(
        ws.on("connection_change", (payload) => {
          set({ connected: Boolean(payload.connected) });
        })
      );

      unsubs.push(
        ws.on("conv:presence_state", (payload) => {
          const state = payload as Record<string, unknown>;
          const ids = Object.keys(state).filter(
            (k) => !k.startsWith("_") && typeof state[k] === "object"
          );
          set((s) => {
            const next = new Set(s.online);
            ids.forEach((id) => next.add(id));
            return { online: next };
          });
        })
      );

      unsubs.push(
        ws.on("conv:presence_diff", (payload) => {
          const joins = (payload.joins as Record<string, unknown>) ?? {};
          const leaves = (payload.leaves as Record<string, unknown>) ?? {};
          set((s) => {
            const next = new Set(s.online);
            Object.keys(joins).forEach((id) => next.add(id));
            Object.keys(leaves).forEach((id) => next.delete(id));
            return { online: next };
          });
        })
      );

      // Agents go online/offline via the user channel — they never show up in
      // a conversation's presence roster (bridge processes aren't Phoenix
      // sockets). Without this handler the Chats presence dot is frozen at
      // whatever state the conversation load initially reported.
      unsubs.push(
        ws.on("agent_status_changed", (payload) => {
          const agentId = payload.agentId as string | undefined;
          if (!agentId) return;
          // `presence` is the only online vocabulary on this event (no
          // boolean) — see Agentchat.StatusContract.presences/0.
          const effective = payload.presence as "online_local" | "offline";
          if (!effective) return;

          // The agent we were waiting on just came online — drop its spinner.
          if (effective === "online_local") clearWaking(agentId);

          // Raw hostname (identity) and display label (owner's nickname
          // when set, else the raw name) travel together.
          const hostname =
            typeof payload.deviceName === "string" && payload.deviceName
              ? payload.deviceName
              : undefined;
          const nickname =
            typeof payload.deviceNickname === "string" &&
            payload.deviceNickname
              ? payload.deviceNickname
              : undefined;
          const deviceLabel = nickname ?? hostname;

          set((s) => {
            const wasOnline = s.online.has(agentId);
            const wantOnline = effective === "online_local";
            const currentPresence = s.agentPresence[agentId];

            const onlineUnchanged = wasOnline === wantOnline;
            const presenceUnchanged =
              effective === "offline"
                ? currentPresence === undefined
                : currentPresence === effective;
            const deviceUnchanged =
              (effective === "offline" ? undefined : deviceLabel) ===
                s.agentDevices[agentId] &&
              (effective === "offline" ? undefined : hostname) ===
                s.agentDeviceHostnames[agentId];
            if (onlineUnchanged && presenceUnchanged && deviceUnchanged) return s;

            const nextOnline = onlineUnchanged ? s.online : new Set(s.online);
            if (!onlineUnchanged) {
              if (wantOnline) nextOnline.add(agentId);
              else nextOnline.delete(agentId);
            }

            const nextAgentPresence = presenceUnchanged
              ? s.agentPresence
              : { ...s.agentPresence };
            if (!presenceUnchanged) {
              if (effective === "offline") delete nextAgentPresence[agentId];
              else nextAgentPresence[agentId] = effective;
            }

            const nextAgentDevices = deviceUnchanged
              ? s.agentDevices
              : { ...s.agentDevices };
            const nextHostnames = deviceUnchanged
              ? s.agentDeviceHostnames
              : { ...s.agentDeviceHostnames };
            if (!deviceUnchanged) {
              if (effective === "offline" || !hostname) {
                delete nextAgentDevices[agentId];
                delete nextHostnames[agentId];
              } else {
                nextAgentDevices[agentId] = deviceLabel as string;
                nextHostnames[agentId] = hostname;
              }
            }

            return {
              online: nextOnline,
              agentPresence: nextAgentPresence,
              agentDevices: nextAgentDevices,
              agentDeviceHostnames: nextHostnames,
            };
          });
        })
      );

      // Global agent activity. `activity: null` means the agent went idle —
      // drop the key so surfaces fall back to the plain online/offline dot.
      // `conversationIds` scopes the conversation-list line to the rows the
      // work actually lives in.
      unsubs.push(
        ws.on("agent_activity_changed", (payload) => {
          const agentId = payload.agentId as string | undefined;
          if (!agentId) return;
          const activity = payload.activity as AgentActivity | null | undefined;
          const convs = (payload.conversationIds as string[] | undefined) ?? [];
          set((s) => {
            if (!activity) {
              if (s.agentActivity[agentId] === undefined) return s;
              const next = { ...s.agentActivity };
              delete next[agentId];
              const nextConvs = { ...s.agentActivityConvs };
              delete nextConvs[agentId];
              return { agentActivity: next, agentActivityConvs: nextConvs };
            }
            const currentConvs = s.agentActivityConvs[agentId] ?? [];
            const convsUnchanged =
              convs.length === currentConvs.length &&
              convs.every((id) => currentConvs.includes(id));
            if (s.agentActivity[agentId] === activity && convsUnchanged) return s;
            return {
              agentActivity: { ...s.agentActivity, [agentId]: activity },
              agentActivityConvs: { ...s.agentActivityConvs, [agentId]: convs },
            };
          });
        })
      );

      unsubs.push(
        ws.on("human_status_changed", (payload) => {
          const participantId = payload.participantId as string | undefined;
          if (!participantId) return;
          const isOnline = Boolean(payload.online);
          set((s) => {
            if (isOnline === s.online.has(participantId)) return s;
            const next = new Set(s.online);
            if (isOnline) next.add(participantId);
            else next.delete(participantId);
            return { online: next };
          });
        })
      );

      // Authoritative snapshot from server on user-channel join. Resets
      // the global online set so peers who went offline during our
      // disconnect are cleared. Subsequent transitions update from there.
      unsubs.push(
        ws.on("presence_snapshot", (payload) => {
          const ids = (payload.onlineParticipantIds as string[] | undefined) ?? [];
          const agentPresences =
            (payload.agentPresences as
              | Record<string, "online_local">
              | undefined) ?? {};
          const agentActivities =
            (payload.agentActivities as
              | Record<
                  string,
                  { activity: AgentActivity; conversationIds?: string[] }
                >
              | undefined) ?? {};
          const activity: Record<string, AgentActivity> = {};
          const activityConvs: Record<string, string[]> = {};
          for (const [agentId, entry] of Object.entries(agentActivities)) {
            activity[agentId] = entry.activity;
            activityConvs[agentId] = entry.conversationIds ?? [];
          }
          // Snapshot sends agent_id → {name, nickname}. Keep the display
          // label and the raw hostname in separate maps — identity checks
          // ("running on THIS device?") must never compare a nickname.
          const deviceEntries =
            (payload.agentDevices as
              | Record<string, { name: string; nickname?: string | null }>
              | undefined) ?? {};
          const agentDevices: Record<string, string> = {};
          const agentDeviceHostnames: Record<string, string> = {};
          for (const [agentId, device] of Object.entries(deviceEntries)) {
            agentDevices[agentId] = device.nickname || device.name;
            agentDeviceHostnames[agentId] = device.name;
          }
          set({
            online: new Set(ids),
            agentPresence: agentPresences,
            agentDevices,
            agentDeviceHostnames,
            agentActivity: activity,
            agentActivityConvs: activityConvs,
          });
          // Any agent now reported online is no longer "waking".
          Object.keys(agentPresences).forEach((id) => clearWaking(id));
        })
      );

      // ONE typing shape platform-wide: `typing_indicator` (camelCase) on
      // both the conversation channel (in-chat bubbles, forwarded as
      // "conv:typing_indicator") and the user channel (conversation-list
      // markers). No explicit "stopped typing" event in-conversation — the
      // per-participant TTL inside setTyping clears it (and chatStore also
      // clears it the moment the sender's message arrives).
      const onTypingIndicator = (payload: Record<string, unknown>) => {
        const convId = (payload.conversationId ?? payload._conversationId) as
          | string
          | undefined;
        const participantId = payload.participantId as string | undefined;
        const displayName = payload.participantName as string | undefined;
        const participantType = payload.participantType as string | undefined;
        const isTyping = Boolean(payload.isTyping);
        if (!convId || !participantId) return;
        if (isTyping) {
          setTyping(convId, participantId, displayName, participantType === "agent");
        } else {
          clearTyping(convId, participantId);
        }
      };
      unsubs.push(ws.on("conv:typing_indicator", onTypingIndicator));
      unsubs.push(ws.on("typing_indicator", onTypingIndicator));

      return () => {
        unsubs.forEach((u) => u());
        typingTimers.forEach((t) => clearTimeout(t));
        typingTimers.clear();
        wakingTimers.forEach((t) => clearTimeout(t));
        wakingTimers.clear();
      };
    },
  };
});
