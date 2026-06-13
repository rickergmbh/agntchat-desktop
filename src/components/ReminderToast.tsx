import { useEffect, useState } from "react";
import { Bell } from "lucide-react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  isPermissionGranted,
  requestPermission,
  sendNotification,
} from "@tauri-apps/plugin-notification";

import { ws } from "../services/websocket";
import { useChatStore } from "../stores/chatStore";
import { snoozeReminder } from "../lib/api";

/** Payload pushed on the user channel when a date reminder fires (camelCase). */
interface ReminderFired {
  reminderId: string;
  eventLabel: string;
  eventDate: string;
  remindType: string;
  recurring: boolean;
  summary: string;
  agentId: string;
  agentName?: string;
  agentAvatarUrl?: string | null;
  dmConversationId?: string;
}

/** Raise a native OS notification when the app window isn't focused. */
async function maybeNativeNotify(reminder: ReminderFired) {
  try {
    if (await getCurrentWindow().isFocused()) return;

    let granted = await isPermissionGranted();
    if (!granted) {
      granted = (await requestPermission()) === "granted";
    }
    if (!granted) return;

    sendNotification({
      title: reminder.agentName ?? "Reminder",
      body: reminder.summary,
    });
  } catch {
    // Notification plugin unavailable (e.g. running in a plain browser dev
    // server) — the in-app toast still covers it.
  }
}

/**
 * Date reminders are platform-elevated notifications, not chat messages. This
 * renders the in-app toast (foreground) and raises a native OS notification
 * (background). Mounted once in AppShell.
 */
export function ReminderToast() {
  const [reminder, setReminder] = useState<ReminderFired | null>(null);
  const setActiveConversation = useChatStore((s) => s.setActiveConversation);

  useEffect(() => {
    const unsub = ws.on("reminder_fired", (payload) => {
      const r = payload as unknown as ReminderFired;
      setReminder(r);
      void maybeNativeNotify(r);
    });
    return unsub;
  }, []);

  if (!reminder) return null;

  const open = () => {
    if (reminder.dmConversationId) {
      setActiveConversation(reminder.dmConversationId);
    }
    setReminder(null);
  };

  const snooze = () => {
    void snoozeReminder(reminder.reminderId, 60).catch(() => {});
    setReminder(null);
  };

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 max-w-sm">
      <div className="pointer-events-auto rounded-lg border border-border bg-card p-4 shadow-lg">
        <div className="flex items-start gap-3">
          {reminder.agentAvatarUrl ? (
            <img
              src={reminder.agentAvatarUrl}
              alt=""
              className="h-9 w-9 shrink-0 rounded-full object-cover"
            />
          ) : (
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Bell size={16} />
            </div>
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium">{reminder.agentName ?? "Reminder"}</p>
            <p className="mt-1 text-xs text-muted-foreground">{reminder.summary}</p>
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          <button
            onClick={snooze}
            className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Snooze 1h
          </button>
          {reminder.dmConversationId ? (
            <button
              onClick={open}
              className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
            >
              Open
            </button>
          ) : null}
          <button
            onClick={() => setReminder(null)}
            className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
          >
            Dismiss
          </button>
        </div>
      </div>
    </div>
  );
}
