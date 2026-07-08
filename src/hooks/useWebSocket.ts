import { useEffect } from "react";
import { useAuthStore } from "../stores/authStore";
import { useChatStore } from "../stores/chatStore";
import { usePresenceStore } from "../stores/presenceStore";
import { useStreamingStore } from "../stores/streamingStore";
import { useTaskStore } from "../stores/taskStore";
import { useAgentStore } from "../stores/agentStore";
import { useMemoryStore } from "../stores/memoryStore";
import { useFriendStore } from "../stores/friendStore";
import { useWorkspaceStore } from "../stores/workspaceStore";
import { useArtifactStore } from "../stores/artifactStore";
import { ws } from "../services/websocket";

/**
 * Connects the Phoenix socket, joins the user channel, wires store listeners,
 * and kicks off the initial conversations + unread-count fetches. Mount once
 * near the top of the authenticated tree. Tears everything down on logout.
 *
 * Deps are *primitive* (`token`, `participantId`) rather than the full
 * participant object. authStore.restoreSession() sets a participant from
 * localStorage and then fetchProfile() overwrites it with a fresh API
 * response — same id, different object reference. If we depended on the
 * object, every profile refresh would disconnect + reconnect the socket,
 * opening a gap where pushed messages are missed. Depending on the id
 * keeps the socket stable across profile refreshes.
 */
export function useWebSocket() {
  const token = useAuthStore((s) => s.token);
  const participantId = useAuthStore((s) => s.participant?.id);

  useEffect(() => {
    if (!token || !participantId) return;

    const unsubChat = useChatStore.getState().initWsListeners();
    const unsubPresence = usePresenceStore.getState().initWsListeners();
    const unsubStreaming = useStreamingStore.getState().initWsListeners();
    const unsubTasks = useTaskStore.getState().initWsListeners();
    const unsubAgents = useAgentStore.getState().initWsListeners();
    const unsubMemory = useMemoryStore.getState().initWsListeners();
    const unsubFriends = useFriendStore.getState().initWsListeners();
    const unsubWorkspace = useWorkspaceStore.getState().initWsListeners();
    const unsubArtifacts = useArtifactStore.getState().initWsListeners();

    // Re-join whichever conversation is currently open whenever the socket
    // comes up. Fixes a missed-message bug where `disconnect()` clears the
    // conversation-channel map, and we only re-joined `user:{id}` on the
    // next connect — the active conversation's channel stayed dead until
    // the user navigated away and back. Now every connect also re-subscribes
    // to the active conv (joinConversation is a no-op if already joined).
    const joinActiveIfAny = () => {
      const activeId = useChatStore.getState().activeConversationId;
      if (activeId) ws.joinConversation(activeId);
    };

    // Agents bootstrap sequence:
    //   1. fetchAgents — create ManagedAgent rows from the backend payload.
    //   2. refreshProcessStatuses — overlay local Rust ProcessManager state.
    //      This must run *after* fetchAgents on desktop reload. The Rust side
    //      still knows about running bridge processes, but the fresh Zustand
    //      store starts empty; refreshing first has nowhere to apply statuses.
    //   3. reconcileStaleExecutors — only now mark backend-online agents
    //      offline when no local bridge is running.
    const syncAgents = async (reason: string) => {
      const agentStore = useAgentStore.getState();
      try {
        await agentStore.fetchAgents();
        const refreshed = await agentStore.refreshProcessStatuses();
        if (refreshed) {
          await agentStore.reconcileStaleExecutors();
        } else {
          console.warn(
            `[useWebSocket] skipped stale-executor reconciliation; local status refresh failed (${reason})`
          );
        }
        await agentStore.fetchHealth();
      } catch (e) {
        console.warn(`[useWebSocket] agent sync failed (${reason})`, e);
      }
    };

    // Resync on every reconnect. WS has an auto-rejoin under the hood, but
    // any events the server pushed during the gap (while the socket was
    // closed or before the channel's onJoin fired) are gone. A REST refetch
    // of the active conversation's recent messages + the conversation list
    // + unread counts makes state converge to the server's truth.
    let firstConnect = true;
    const unsubReconnect = ws.on("connection_change", (payload) => {
      if (!payload.connected) return;
      joinActiveIfAny();
      if (firstConnect) {
        // Skip resync on the very first connect — we just loaded everything
        // from REST above. Only run it on subsequent connects (true reconnects).
        firstConnect = false;
        return;
      }
      console.log("[ws] reconnected → resyncing");
      useChatStore.getState().fetchConversations();
      if (useChatStore.getState().agentConversationsLoaded) {
        useChatStore.getState().fetchAgentConversations();
      }
      useChatStore.getState().fetchUnreadCounts();
      if (useAuthStore.getState().participant?.features?.friends) {
        useFriendStore.getState().fetchPendingCount();
      }
      const activeId = useChatStore.getState().activeConversationId;
      if (activeId) useChatStore.getState().fetchMessages(activeId);
      syncAgents("reconnect");
    });

    ws.connect(token);
    ws.joinUserChannel(participantId);
    joinActiveIfAny();

    // Fire initial loads — UI renders loading states from the store.
    // fetchTasks() also seeds taskLifecycleMeta[id].effectiveStatus from
    // the server's authoritative task list, which is critical for task
    // cards to render the correct status when the completion message is
    // outside the conversation's recent_messages window. Without this
    // a completed task still appears as "assigned" until the user visits
    // the Tasks tab for the first time.
    useChatStore.getState().fetchConversations();
    useChatStore.getState().fetchUnreadCounts();
    useTaskStore.getState().fetchTasks();
    if (useAuthStore.getState().participant?.features?.friends) {
      useFriendStore.getState().fetchPendingCount();
    }
    syncAgents("initial");

    return () => {
      unsubReconnect();
      unsubChat();
      unsubPresence();
      unsubStreaming();
      unsubTasks();
      unsubAgents();
      unsubMemory();
      unsubFriends();
      unsubWorkspace();
      unsubArtifacts();
      ws.disconnect();
    };
  }, [token, participantId]);
}
