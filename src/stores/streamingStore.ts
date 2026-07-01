import { create } from "zustand";
import { ws } from "../services/websocket";
import type { ActiveStream, StreamPhase } from "../lib/api";
import { useAuthStore } from "./authStore";

/**
 * `stream_text` feature flag — show the live token-by-token TEXT inside the
 * streaming bubble. When OFF, keep tracking the stream (so the phase indicator
 * still shows) but never populate `content`, so no streamed text renders.
 * Mirrors mobile/stores/streamingStore.ts.
 */
function streamTextEnabled(): boolean {
  return useAuthStore.getState().participant?.features?.stream_text === true;
}

/**
 * Ported from web/src/stores/streamingStore.ts.
 *
 * Tracks one active stream per conversation. Driven by the
 * `conv:message_streaming` WS event with a `status` of `started` |
 * `streaming` | `complete` | `cancelled`.
 *
 * Clears:
 *  - on `cancelled` status (if sender matches active stream)
 *  - on `complete` status after 3s (bridge between "done" signal and actual
 *    new_message arrival)
 *  - on `new_message` arrival with matching stream_id (via clearStreamByStreamId)
 *    or matching senderId (via clearStreamBySender) — wired in chatStore.
 *  - on stale (no update in 75s) — safety net if backend cancellation event
 *    was missed.
 */

const STALE_STREAM_MS = 75_000;
const MAX_STREAM_THOUGHTS = 6;
/** Don't preserve trivial fragments (single tokens, partial words). */
const MIN_THOUGHT_CHARS = 12;
const FINAL_DELIVERY_PHASE_DETAILS = new Set([
  "send message",
  "sending message",
  "complete task",
  "completing task",
  "fail task",
  "failing task",
]);

/**
 * Signal-originated "thinking" bubbles are purely speculative — the agent
 * hasn't started real work yet. Suppress them entirely and let the real
 * bridge/hosted stream provide the indicator when processing actually begins.
 * Signal "queued" and "waiting" phases still pass through (useful feedback
 * for offline/waiting agents).
 *
 * Previously we buffered signal "thinking" streams behind an 800ms grace
 * period, but agent triage routinely takes >800ms, so the bubble appeared
 * regardless — defeating the purpose. Dropping them entirely is cleaner.
 */

interface StreamEventInput {
  streamId: string;
  senderId: string;
  senderName?: string;
  status: string;
  phase?: StreamPhase;
  phaseDetail?: string;
  content?: string;
}

interface StreamingState {
  streams: Record<string, ActiveStream>;
  _lastUpdate: Record<string, number>;
  clearStream: (conversationId: string) => void;
  clearStreamBySender: (conversationId: string, senderId: string) => void;
  clearStreamByStreamId: (streamId: string) => void;
  /** Apply a streaming event (from WS or optimistic local send). */
  handleStreamEvent: (conversationId: string, input: StreamEventInput) => void;
  initWsListeners: () => () => void;
}

function phaseLabel(phase: StreamPhase, detail?: string): string {
  const labels: Record<StreamPhase, string> = {
    thinking: "Thinking",
    tool_call: detail ?? "Using tool",
    writing: "Writing",
    analyzing: "Analyzing",
    queued: "Message queued",
    waiting: "Waiting for turn",
  };
  return labels[phase] ?? phase;
}

function isFinalDeliveryToolPhase(phase: StreamPhase, detail?: string): boolean {
  if (phase !== "tool_call" || !detail) return false;
  const normalized = detail
    .trim()
    .toLowerCase()
    .replace(/[-_]/g, " ")
    .replace(/[.…]+$/g, "");
  return FINAL_DELIVERY_PHASE_DETAILS.has(normalized);
}

export const useStreamingStore = create<StreamingState>((set, get) => ({
  streams: {},
  _lastUpdate: {},

  clearStream: (conversationId) => {
    set((s) => {
      const next = { ...s.streams };
      const nextTs = { ...s._lastUpdate };
      delete next[conversationId];
      delete nextTs[conversationId];
      return { streams: next, _lastUpdate: nextTs };
    });
  },

  clearStreamBySender: (conversationId, senderId) => {
    const active = get().streams[conversationId];
    if (active && active.senderId === senderId) {
      get().clearStream(conversationId);
    }
  },

  clearStreamByStreamId: (streamId) => {
    set((s) => {
      for (const [convId, stream] of Object.entries(s.streams)) {
        if (stream.streamId === streamId) {
          const next = { ...s.streams };
          const nextTs = { ...s._lastUpdate };
          delete next[convId];
          delete nextTs[convId];
          return { streams: next, _lastUpdate: nextTs };
        }
      }
      return s;
    });
  },

  handleStreamEvent: (convId, input) => {
    const streamId = input.streamId;
    const status = input.status;
    const senderId = input.senderId;
    // Preserve the previously-known senderName if this event omits it — the
    // bridge typically only sets senderName on the first frame, and falling
    // back to "Agent" mid-stream causes a name flicker. Matches mobile.
    const existingForName = get().streams[convId];
    const senderName =
      input.senderName ?? existingForName?.senderName ?? "Agent";
    const content = input.content ?? "";
    const phase = input.phase ?? "thinking";
    const phaseDetail = input.phaseDetail;

    if (status === "cancelled") {
      // Only clear if sender matches — prevents cancelling agent A's stream
      // when agent B's (irrelevant) stream is cancelled.
      const active = get().streams[convId];
      if (!active || active.senderId === senderId) {
        get().clearStream(convId);
      }
      return;
    }

    if (status === "complete") {
      const existing = get().streams[convId];
      if (!existing) return;
      set((s) => ({
        streams: {
          ...s.streams,
          [convId]: { ...existing, lastUpdateAt: Date.now() },
        },
        _lastUpdate: { ...s._lastUpdate, [convId]: Date.now() },
      }));
      // Fallback: clear after 3s if new_message didn't land to clear it.
      setTimeout(() => {
        set((s) => {
          if (s.streams[convId]?.streamId === streamId) {
            const next = { ...s.streams };
            const nextTs = { ...s._lastUpdate };
            delete next[convId];
            delete nextTs[convId];
            return { streams: next, _lastUpdate: nextTs };
          }
          return s;
        });
      }, 3000);
      return;
    }

    // started or streaming

    // Signal-originated "thinking" bubbles are speculative — the agent hasn't
    // started real work yet. Suppress them entirely. The real bridge/hosted
    // stream will create the bubble when processing actually begins. Signal
    // "queued" and "waiting" phases still pass through.
    const isSignalStream = streamId.startsWith("signal:");
    if (isSignalStream && phase === "thinking") {
      return;
    }

    set((s) => {
      const existing = s.streams[convId];
      const passivePhases = new Set(["waiting", "queued"]);

      // Don't let a passive signal overwrite an active-working stream
      // (e.g. in a group, InstantAgentSignal fires for all agents).
      if (
        passivePhases.has(phase) &&
        existing &&
        !passivePhases.has(existing.phase)
      ) {
        return s;
      }

      const isNewStream = existing != null && existing.streamId !== streamId;
      let recentSteps = isNewStream ? [] : existing?.recentSteps ?? [];
      let thoughts = isNewStream ? [] : (existing?.thoughts ?? []);
      let thoughtPrefix = isNewStream ? "" : (existing?.thoughtPrefix ?? "");

      if (
        existing &&
        existing.phase !== phase &&
        !passivePhases.has(phase)
      ) {
        const label = phaseLabel(phase, phaseDetail);
        recentSteps = [...recentSteps, label].slice(-8);
      }

      // The bridge emits cumulative content (each writing event is the full
      // transcript-so-far). Reconstruct what it has emitted total: either
      // the incoming content if this event carries it, or `prefix + live
      // buffer` from the existing stream state.
      //
      // IMPORTANT: when a different stream replaces the current one, do NOT
      // inherit the old stream's content — that belongs to a different agent.
      const rawCurrent = input.content !== undefined
        ? content
        : isNewStream
          ? ""
          : existing
            ? (existing.thoughtPrefix ?? "") + (existing.content ?? "")
            : "";

      // When phase transitions away from `writing`, snapshot the new portion
      // of the buffer (everything past `thoughtPrefix`) onto thoughts, then
      // advance the prefix so future writing events strip it cleanly. This
      // preserves prose the agent emitted before pivoting to a tool call.
      //
      // Skip when isNewStream — a stream replacement is NOT a phase transition
      // within the same stream. Without this guard, Agent B's "thinking" stream
      // replacing Agent A's "writing" stream snapshots A's content into B's thoughts.
      const phaseChanged = !isNewStream && existing?.phase === "writing" && phase !== "writing";
      if (phaseChanged) {
        if (!isFinalDeliveryToolPhase(phase, phaseDetail)) {
          const newPortion = rawCurrent.startsWith(thoughtPrefix)
            ? rawCurrent.slice(thoughtPrefix.length)
            : rawCurrent;
          const trimmed = newPortion.trim();
          if (
            trimmed &&
            trimmed.length >= MIN_THOUGHT_CHARS &&
            trimmed !== thoughts[thoughts.length - 1]
          ) {
            thoughts = [...thoughts.slice(-(MAX_STREAM_THOUGHTS - 1)), trimmed];
          }
        }
        thoughtPrefix = rawCurrent;
      }

      // Live content buffer for display: only the post-prefix portion during
      // writing; empty in non-writing phases for a clean indicator. When the
      // `stream_text` flag is OFF we keep the stream (for the phase indicator)
      // but never surface text — so the bubble shows "Writing…" without the
      // clunky token-by-token transcript. Mirrors mobile.
      const updatedContent =
        phase === "writing" && streamTextEnabled()
          ? (rawCurrent.startsWith(thoughtPrefix) ? rawCurrent.slice(thoughtPrefix.length) : rawCurrent)
          : "";

      return {
        streams: {
          ...s.streams,
          [convId]: {
            streamId,
            senderId,
            senderName,
            content: updatedContent,
            phase,
            phaseDetail,
            recentSteps,
            thoughts,
            thoughtPrefix,
            lastUpdateAt: Date.now(),
          },
        },
        _lastUpdate: { ...s._lastUpdate, [convId]: Date.now() },
      };
    });
  },

  initWsListeners: () => {
    const unsub = ws.on("conv:message_streaming", (payload) => {
      const convId = payload._conversationId as string;
      get().handleStreamEvent(convId, {
        streamId: payload.streamId as string,
        senderId: payload.senderId as string,
        senderName: payload.senderName as string | undefined,
        status: payload.status as string,
        phase: payload.phase as StreamPhase | undefined,
        phaseDetail: payload.phaseDetail as string | undefined,
        content: payload.content as string | undefined,
      });
    });

    const staleTimer = setInterval(() => {
      const now = Date.now();
      const { streams, _lastUpdate } = get();
      const stale = Object.keys(streams).filter(
        (convId) => now - (_lastUpdate[convId] ?? 0) > STALE_STREAM_MS
      );
      if (stale.length > 0) {
        set((s) => {
          const next = { ...s.streams };
          const nextTs = { ...s._lastUpdate };
          for (const id of stale) {
            delete next[id];
            delete nextTs[id];
          }
          return { streams: next, _lastUpdate: nextTs };
        });
      }
    }, 10_000);

    return () => {
      unsub();
      clearInterval(staleTimer);
    };
  },
}));
