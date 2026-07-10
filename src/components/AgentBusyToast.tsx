import { useEffect, useState } from "react";
import { ws } from "../services/websocket";
import { useChatStore } from "../stores/chatStore";

interface BusyNotice {
  agentId: string;
  agentName?: string;
  parentConversationId: string;
  workConversationId: string;
  taskId: string;
  taskTitle?: string;
}

/**
 * Shows when the user sends into a parent DM while the target agent
 * is busy on a subtask. The backend silently redirects the message
 * to the work room; this surfaces that redirect so the user can
 * actually find their thread.
 */
export function AgentBusyToast() {
  const [notice, setNotice] = useState<BusyNotice | null>(null);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  useEffect(() => {
    const unsub = ws.on("agent_busy_redirect", (payload) => {
      setNotice(payload as unknown as BusyNotice);
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = window.setTimeout(() => setNotice(null), 7_000);
    return () => window.clearTimeout(t);
  }, [notice]);

  if (!notice) return null;

  const open = () => {
    setActiveConversation(notice.workConversationId);
    setNotice(null);
  };

  const name = notice.agentName ?? "This agent";
  const taskLabel = notice.taskTitle ? `“${notice.taskTitle}”` : "a task";

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 max-w-sm">
      <AgentBusyToastCard
        name={name}
        taskLabel={taskLabel}
        onOpen={open}
        onDismiss={() => setNotice(null)}
      />
    </div>
  );
}

/** Presentational card for {@link AgentBusyToast} — split out so the component
 *  preview gallery can render it with sample data. */
export function AgentBusyToastCard({
  name,
  taskLabel,
  onOpen,
  onDismiss,
}: {
  name: string;
  taskLabel: string;
  onOpen: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-auto rounded-lg border border-border bg-card p-4 shadow-lg">
      <p className="text-sm font-medium">{name} is busy</p>
      <p className="mt-1 text-xs text-muted-foreground">
        They&apos;re working on {taskLabel}. Your message went to the work room — open it to continue the thread.
      </p>
      <div className="mt-3 flex gap-2">
        <button
          onClick={onOpen}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Open work room
        </button>
        <button
          onClick={onDismiss}
          className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}
