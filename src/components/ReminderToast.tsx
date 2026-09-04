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
import * as api from "../lib/api";

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

/** Raise a native OS notification when the app window isn't focused.
 *  Respects the user's "reminders" notification preference — the setting
 *  had no client-side effect on desktop/web since Expo push (what the
 *  preference otherwise gates, server-side) only reaches mobile devices. */
async function maybeNativeNotify(reminder: ReminderFired) {
  try {
    if (await getCurrentWindow().isFocused()) return;

    const remindersEnabled = await api
      .request<{ notificationPreferences: { reminders?: boolean } }>(
        "/api/me/notification-preferences"
      )
      .then((data) => data.notificationPreferences.reminders !== false)
      .catch(() => true);
    if (!remindersEnabled) return;

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
      <ReminderToastCard
        title={reminder.agentName ?? "Reminder"}
        summary={reminder.summary}
        avatarUrl={reminder.agentAvatarUrl}
        onSnooze={snooze}
        onOpen={reminder.dmConversationId ? open : undefined}
        onDismiss={() => setReminder(null)}
      />
    </div>
  );
}

/** Presentational card for {@link ReminderToast} — split out so the component
 *  preview gallery can render it with sample data. `onOpen` omitted → no Open
 *  button (a reminder with no DM conversation to jump to). */
export function ReminderToastCard({
  title,
  summary,
  avatarUrl,
  onSnooze,
  onOpen,
  onDismiss,
}: {
  title: string;
  summary: string;
  avatarUrl?: string | null;
  onSnooze: () => void;
  onOpen?: () => void;
  onDismiss: () => void;
}) {
  return (
    <div className="pointer-events-auto rounded-lg border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        {avatarUrl ? (
          <img
            src={avatarUrl}
            alt=""
            className="h-9 w-9 shrink-0 rounded-full object-cover"
          />
        ) : (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Bell size={16} />
          </div>
        )}
        <div className="min-w-0">
          <p className="text-sm font-medium">{title}</p>
          <p className="mt-1 text-xs text-muted-foreground">{summary}</p>
        </div>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <button
          onClick={onSnooze}
          className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent"
        >
          Snooze 1h
        </button>
        {onOpen ? (
          <button
            onClick={onOpen}
            className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
          >
            Open
          </button>
        ) : null}
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
