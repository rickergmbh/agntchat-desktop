import { Socket, Channel } from "phoenix";
import { getApiUrl } from "../lib/api";

type EventHandler = (payload: Record<string, unknown>) => void;

/** Flip to `true` while diagnosing real-time-sync issues — logs every
 *  connect/disconnect/channel-join/event-receive with timestamps. Left as
 *  a const so it's easy to toggle without touching call sites. */
const DEBUG = true;
const log = (...args: unknown[]) =>
  DEBUG && console.log(`[ws ${new Date().toISOString().slice(11, 23)}]`, ...args);

/**
 * Ported from web/src/services/websocket.ts with one desktop-specific change:
 * the socket URL is derived from the configured API URL (DEFAULT_API_URL or
 * localStorage.apiUrl) rather than window.location — the desktop app isn't
 * served from the Phoenix host, it talks to it remotely.
 */
class WebSocketService {
  private socket: Socket | null = null;
  private conversationChannels = new Map<string, Channel>();
  private userChannel: Channel | null = null;
  private globalHandlers = new Map<string, Set<EventHandler>>();

  connect(token: string) {
    if (this.socket?.isConnected()) {
      log("connect() skipped — already connected");
      return;
    }

    const apiUrl = getApiUrl();
    const wsUrl = apiUrl.replace(/^http/, "ws") + "/socket";
    log("connect() →", wsUrl);

    this.socket = new Socket(wsUrl, {
      params: { token },
    });

    this.socket.onOpen(() => {
      log("socket open");
      this.emit("connection_change", { connected: true });
    });
    this.socket.onClose(() => {
      log("socket close");
      this.emit("connection_change", { connected: false });
    });
    this.socket.onError((e) => {
      log("socket error", e);
      this.emit("connection_change", { connected: false });
    });

    this.socket.connect();
  }

  disconnect() {
    this.conversationChannels.forEach((_, id) => this.leaveConversation(id));
    if (this.userChannel) {
      this.userChannel.leave();
      this.userChannel = null;
    }
    if (this.socket) {
      if (this.socket.connectionState() === "connecting") {
        // React StrictMode double-invokes useWebSocket's effect in dev:
        // connect() → disconnect() → connect() fire back-to-back before the
        // first socket ever finishes its handshake. Calling
        // Socket.disconnect() mid-CONNECTING makes the browser log "WebSocket
        // is closed before the connection is established" — harmless (the
        // second connect() succeeds normally) but noisy on every dev mount.
        // Defer the actual teardown to the handshake's own resolution so we
        // never race the raw WebSocket's readyState.
        const socket = this.socket;
        socket.onOpen(() => socket.disconnect());
        socket.onError(() => socket.disconnect());
      } else {
        this.socket.disconnect();
      }
    }
    this.socket = null;
  }

  // --- User channel ---

  joinUserChannel(participantId: string, deviceName?: string | null) {
    if (!this.socket) {
      log("joinUserChannel skipped — no socket");
      return;
    }
    if (this.userChannel) {
      log("joinUserChannel skipped — already joined");
      return;
    }
    log("joinUserChannel →", participantId);

    // Tag this connection as a desktop so the backend can target it for
    // remote-start (start_agent_request) — phones/web never receive those.
    // device_name (this machine's raw hostname, same value the bridge
    // reports) lets the backend take THIS device's local agents offline
    // the moment the app disconnects instead of waiting for the executor
    // sweep to age them out.
    const channel = this.socket.channel(`user:${participantId}`, {
      client: "desktop",
      ...(deviceName ? { device_name: deviceName } : {}),
    });
    this.userChannel = channel;

    const userEvents = [
      "conversation_updated",
      "conversation_type_changed",
      "conversation_title_changed",
      "conversation_rename_suggested",
      "conversation_rename_resolved",
      "conversation_avatar_changed",
      "new_conversation",
      "new_message",
      "typing_indicator",
      "agent_status_changed",
      "agent_activity_changed",
      "agent_updated",
      "agent_busy_redirect",
      "human_status_changed",
      "presence_snapshot",
      "agent_health_updated",
      "friend_request",
      "friend_request_responded",
      "friend_connection_removed",
      // Task lifecycle — drives live task card status + progress.
      "task_created",
      "task_updated",
      "task_assigned",
      "task_completed",
      "task_progress",
      // Shared family to-do list (todoStore listens).
      "todo_created",
      "todo_updated",
      "todo_deleted",
      // Date reminders — platform-elevated notification, not a chat message.
      // ReminderToast listens and raises a native OS notification.
      "reminder_fired",
      // Permission prompts (#67) — a gated agent action awaits the owner's
      // approve/deny. PermissionToast renders the prompt; permission_resolved
      // dismisses it across devices (also fires on expiry).
      "permission_request",
      "permission_resolved",
      // Slack-style multi-workspace cross-device sync. workspaceStore listens.
      "active_organization_changed",
      // Cross-device read sync: another of the user's devices marked a
      // conversation read. chatStore zeroes the local unread badge.
      "conversation_read",
      // Org-host fleet: a bridge changed state on a VM (running/stopped/
      // crashed/idled). FleetView listens to live-update agent counts.
      "host_agent_status",
      // Remote-start/-stop: phone/web asked to bring a local agent online
      // (or take it offline) and the backend routed it here (a signed-in
      // desktop). agentStore handles both.
      "start_agent_request",
      "stop_agent_request",
    ];

    for (const event of userEvents) {
      channel.on(event, (payload: Record<string, unknown>) => {
        this.emit(event, payload);
      });
    }

    channel
      .join()
      .receive("ok", () => {
        log("user channel joined ok");
        this.emit("user_channel_joined", {});
      })
      .receive("error", (resp) => log("user channel join error", resp))
      .receive("timeout", () => log("user channel join timeout"));
  }

  // --- Conversation channels ---

  joinConversation(conversationId: string) {
    if (!this.socket) {
      log("joinConversation skipped — no socket", conversationId);
      return;
    }
    if (this.conversationChannels.has(conversationId)) {
      log("joinConversation skipped — already joined", conversationId);
      return;
    }
    log("joinConversation →", conversationId);

    const channel = this.socket.channel(`conversation:${conversationId}`, {});
    this.conversationChannels.set(conversationId, channel);

    const convEvents = [
      "new_message",
      "typing_indicator",
      "presence_state",
      "presence_diff",
      "recent_messages",
      "member_added",
      "member_removed",
      "conversation_title_changed",
      "conversation_avatar_changed",
      "message_deleted",
      "reaction_added",
      "reaction_removed",
      "message_streaming",
      "task_progress",
      "conversation_memory",
      "memory_updated",
      "sub_conversation_created",
      "artifact_created",
      "artifact_updated",
      "artifact_comment_added",
    ];

    for (const event of convEvents) {
      channel.on(event, (payload: Record<string, unknown>) => {
        log(`conv:${conversationId.slice(0, 8)} ← ${event}`, payload);
        this.emit(`conv:${event}`, { ...payload, _conversationId: conversationId });
      });
    }

    channel
      .join()
      .receive("ok", () => {
        log(`conv channel joined ok → ${conversationId.slice(0, 8)}`);
        this.emit("conversation_joined", { conversationId });
      })
      .receive("error", (resp: Record<string, unknown>) => {
        console.warn(`[ws] Failed to join conversation:${conversationId}`, resp);
        // Retry once after a short delay — a failed initial join often means
        // the socket wasn't quite ready. Dropping the map entry ensures the
        // retry is treated as a fresh join.
        this.conversationChannels.delete(conversationId);
        setTimeout(() => {
          if (this.socket?.isConnected()) {
            log(`retry joinConversation → ${conversationId.slice(0, 8)}`);
            this.joinConversation(conversationId);
          }
        }, 1000);
      })
      .receive("timeout", () =>
        log(`conv channel join timeout → ${conversationId.slice(0, 8)}`)
      );
  }

  leaveConversation(conversationId: string) {
    const channel = this.conversationChannels.get(conversationId);
    if (!channel) return;
    channel.leave();
    this.conversationChannels.delete(conversationId);
  }

  /**
   * Leave every conversation channel currently joined. Called by
   * `workspaceStore.refetchOrgScoped` on workspace switch — without
   * this, channels for the previous workspace's conversations stay
   * subscribed and keep pushing new_message events into the wiped
   * stores (memory leak per switch).
   */
  leaveAllConversations() {
    for (const id of Array.from(this.conversationChannels.keys())) {
      this.leaveConversation(id);
    }
  }

  // --- Send actions ---

  sendMessage(
    conversationId: string,
    content: string,
    options?: {
      contentType?: string;
      metadata?: Record<string, unknown>;
      parentMessageId?: string;
      attachments?: Array<Record<string, unknown>>;
    }
  ): Promise<Record<string, unknown>> {
    return new Promise((resolve, reject) => {
      const channel = this.conversationChannels.get(conversationId);
      if (!channel) return reject(new Error("Not joined to conversation"));

      const payload: Record<string, unknown> = {
        content,
        content_type: options?.contentType ?? "text",
        metadata: options?.metadata ?? {},
        parent_message_id: options?.parentMessageId,
      };
      // Ride-along attachments (paste-to-attachment): pre-uploaded objects the
      // backend links to this text message in one transaction.
      if (options?.attachments && options.attachments.length > 0) {
        payload.attachments = options.attachments;
      }

      channel
        .push("new_message", payload)
        .receive("ok", resolve)
        .receive("error", reject)
        .receive("timeout", () => reject(new Error("Message send timeout")));
    });
  }

  // Structured card-button action (CTA without a URL): emits a UserAction
  // message the agent can react to. Mirrors web/mobile sendAction.
  sendAction(
    conversationId: string,
    action: string,
    opts?: { label?: string; result?: string; details?: Record<string, unknown> }
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const channel = this.conversationChannels.get(conversationId);
      if (!channel) return reject(new Error("Not joined to conversation"));

      const contentStructured: Record<string, unknown> = { action };
      if (opts?.label) contentStructured.label = opts.label;
      if (opts?.result) contentStructured.result = opts.result;
      if (opts?.details) contentStructured.details = opts.details;

      channel
        .push("new_message", {
          content: opts?.label || action,
          content_type: "structured",
          message_type: "UserAction",
          content_structured: contentStructured,
          metadata: { cta_action: action },
        })
        .receive("ok", () => resolve())
        .receive("error", reject)
        .receive("timeout", () => reject(new Error("Action send timeout")));
    });
  }

  deleteMessage(conversationId: string, messageId: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const channel = this.conversationChannels.get(conversationId);
      if (!channel) return reject(new Error("Not joined to conversation"));

      channel
        .push("delete_message", { message_id: messageId })
        .receive("ok", () => resolve())
        .receive("error", reject)
        .receive("timeout", () => reject(new Error("Delete message timeout")));
    });
  }

  addReaction(conversationId: string, messageId: string, emoji: string): Promise<void> {
    return this.pushReaction(conversationId, "add_reaction", messageId, emoji);
  }

  removeReaction(conversationId: string, messageId: string, emoji: string): Promise<void> {
    return this.pushReaction(conversationId, "remove_reaction", messageId, emoji);
  }

  private pushReaction(
    conversationId: string,
    event: "add_reaction" | "remove_reaction",
    messageId: string,
    emoji: string
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const channel = this.conversationChannels.get(conversationId);
      if (!channel) return reject(new Error("Not joined to conversation"));

      channel
        .push(event, { message_id: messageId, emoji })
        .receive("ok", () => resolve())
        .receive("error", reject)
        .receive("timeout", () => reject(new Error("Reaction timeout")));
    });
  }

  sendTyping(conversationId: string) {
    const channel = this.conversationChannels.get(conversationId);
    if (!channel) return;
    channel.push("typing", {});
  }

  markConversationRead(conversationId: string): boolean {
    const channel = this.conversationChannels.get(conversationId);
    if (!channel) return false;
    channel
      .push("mark_conversation_read", {})
      .receive("error", (resp) =>
        console.warn("[ws] mark_conversation_read error", { conversationId, resp })
      )
      .receive("timeout", () =>
        console.warn("[ws] mark_conversation_read timeout", { conversationId })
      );
    return true;
  }

  // --- Event bus ---

  on(event: string, handler: EventHandler) {
    if (!this.globalHandlers.has(event)) {
      this.globalHandlers.set(event, new Set());
    }
    this.globalHandlers.get(event)!.add(handler);
    return () => {
      this.globalHandlers.get(event)?.delete(handler);
    };
  }

  private emit(event: string, payload: Record<string, unknown>) {
    this.globalHandlers.get(event)?.forEach((handler) => handler(payload));
  }

  isConnected() {
    return this.socket?.isConnected() ?? false;
  }
}

export const ws = new WebSocketService();
