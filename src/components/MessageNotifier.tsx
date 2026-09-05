import { useEffect } from "react";

import { ws } from "../services/websocket";
import { useAuthStore } from "../stores/authStore";
import { notifyIfEnabled } from "../lib/nativeNotify";
import i18n from "../i18n";

interface ConversationUpdatedPayload {
  conversationId: string;
  lastMessage: {
    senderId: string | null;
    sender?: { displayName?: string };
    readableText?: string;
    notificationCategory?: string;
  };
}

// `reminders` is the one category that isn't a chat message — it rides its
// own `reminder_fired` event and is handled by ReminderToast instead. Every
// other category (task_assigned, task_completed, task_reminders,
// agent_activity, mentions, invites, pulse, messages) is a real message and
// therefore arrives here — notify for any of them rather than hardcoding
// the list, so a future category needs no client change to get coverage.
const REMINDER_CATEGORY = "reminders";

/** Headless listener: raises a native OS notification for any new chat
 *  message (task events, mentions, invites, pulse reports, plain messages,
 *  ...) when the window is unfocused, gated on the matching notification
 *  preference. Mirrors ReminderToast's native-notify flow — these
 *  categories previously had no desktop-side effect at all since Expo push
 *  only reaches mobile devices (#138). Mounted once in AppShell. */
export function MessageNotifier() {
  const myId = useAuthStore((s) => s.participant?.id);

  useEffect(() => {
    const unsub = ws.on("conversation_updated", (payload) => {
      const { lastMessage } = payload as unknown as ConversationUpdatedPayload;
      if (!lastMessage || lastMessage.senderId === null || lastMessage.senderId === myId) {
        return;
      }

      const category = lastMessage.notificationCategory;
      if (!category || category === REMINDER_CATEGORY) return;

      const body = lastMessage.readableText?.trim();
      if (!body) return;

      void notifyIfEnabled(category, {
        title:
          lastMessage.sender?.displayName ?? i18n.t("chat:messageNotification.fallbackTitle"),
        body: body.length > 100 ? `${body.slice(0, 97)}...` : body,
      });
    });
    return unsub;
  }, [myId]);

  return null;
}
