import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
import i18n from "../i18n"
import type { Conversation } from "./api"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Display title for a conversation: the explicit title if set, otherwise the
 * comma-joined list of other members' display names.
 */
export function getConversationTitle(
  conversation: Conversation,
  currentUserId?: string
): string {
  if (conversation.title) return conversation.title;
  const others = (conversation.members ?? [])
    .filter((m) => m.participantId !== currentUserId)
    .map((m) => m.participant?.displayName ?? i18n.t("common:unknown"));
  if (others.length > 0) return others.join(", ");
  // ConversationMember rows cascade-delete when a participant is hard-
  // deleted, so a DM/group can be left with only the current user as a
  // member. Surface that as "Deleted Agent(s)" rather than a generic
  // "Conversation".
  if (conversation.type === "direct") return i18n.t("chat:deletedAgent");
  if (conversation.type === "group") return i18n.t("chat:deletedAgents");
  return i18n.t("chat:conversation");
}

/**
 * Compact timestamp for conversation list rows: "14:32" (today),
 * "Mon" (<7d), "Jan 15" (older).
 */
export function formatConversationTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const now = new Date();
  const diff = now.getTime() - d.getTime();
  const oneDay = 86400000;

  if (diff < oneDay && d.getDate() === now.getDate()) {
    return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  if (diff < 7 * oneDay) {
    return d.toLocaleDateString([], { weekday: "short" });
  }
  return d.toLocaleDateString([], { month: "short", day: "numeric" });
}

export function formatUptime(seconds: number): string {
  const s = (count: number) => i18n.t("common:time.secondsShort", { count });
  const m = (count: number) => i18n.t("common:time.minutesShort", { count });
  const h = (count: number) => i18n.t("common:time.hoursShort", { count });
  const d = (count: number) => i18n.t("common:time.daysShort", { count });
  if (seconds < 60) return s(seconds);
  if (seconds < 3600) return m(Math.floor(seconds / 60));
  if (seconds < 86400)
    return `${h(Math.floor(seconds / 3600))} ${m(Math.floor((seconds % 3600) / 60))}`;
  return `${d(Math.floor(seconds / 86400))} ${h(Math.floor((seconds % 86400) / 3600))}`;
}

/**
 * Compact relative timestamp — "now", "5m", "2h", "3d", then date.
 * Used in conversation list previews and message timestamps.
 */
export function formatRelativeShort(iso: string | undefined): string {
  if (!iso) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSec = Math.max(0, (Date.now() - then) / 1000);
  if (diffSec < 45) return i18n.t("common:time.nowShort");
  if (diffSec < 3600)
    return i18n.t("common:time.minutesShort", { count: Math.floor(diffSec / 60) });
  if (diffSec < 86400)
    return i18n.t("common:time.hoursShort", { count: Math.floor(diffSec / 3600) });
  if (diffSec < 86400 * 7)
    return i18n.t("common:time.daysShort", { count: Math.floor(diffSec / 86400) });
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

/** Render a timestamp as a full clock time for message bubbles: "14:32". */
export function formatClockTime(iso: string | undefined): string {
  if (!iso) return "";
  return new Date(iso).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Absolute date + time, e.g. "Jun 14, 2026, 3:42 PM". Used where the exact
 * moment matters (the Files view "Added" column) rather than a relative or
 * day-only label — so an old file shows the time it landed, not just the day.
 * The year is dropped for the current year to keep it compact.
 */
export function formatExactDateTime(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
    hour: "numeric",
    minute: "2-digit",
  });
}

/** Two-letter initials from a display name — "James Ricker" → "JR". */
export function getInitials(name: string | undefined): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p.charAt(0).toUpperCase()).join("") || "?";
}

/** Key for a timestamp's calendar day (YYYY-MM-DD), used to detect day
 * boundaries between messages. */
export function dayKey(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

// Issue #122: unread badges (conversation rows, sidebar rail) show THAT
// there's something new and a coarse sense of scale via size, never an
// exact count — which read as daunting and, pre-turn-grouping, could
// over-count a single agent reply split into many rows. The in-conversation
// "New messages" divider is what actually identifies what's new.
export type UnreadTier = "few" | "some" | "many";

export function unreadTier(count: number): UnreadTier | null {
  if (count <= 0) return null;
  if (count === 1) return "few";
  if (count <= 4) return "some";
  return "many";
}

/** Human-readable day label for separator rows: "Today" / "Yesterday" / full
 * date for older. */
export function formatDayLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yday = new Date();
  yday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return i18n.t("common:today");
  if (dayKey(iso) === dayKey(yday.toISOString())) return i18n.t("common:yesterday");
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
