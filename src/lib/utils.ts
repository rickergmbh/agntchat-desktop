import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"
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
    .map((m) => m.participant?.displayName ?? "Unknown");
  if (others.length > 0) return others.join(", ");
  // ConversationMember rows cascade-delete when a participant is hard-
  // deleted, so a DM/group can be left with only the current user as a
  // member. Surface that as "Deleted Agent(s)" rather than a generic
  // "Conversation".
  if (conversation.type === "direct") return "Deleted Agent";
  if (conversation.type === "group") return "Deleted Agents";
  return "Conversation";
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
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
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
  if (diffSec < 45) return "now";
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  if (diffSec < 86400 * 7) return `${Math.floor(diffSec / 86400)}d`;
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

/** Human-readable day label for separator rows: "Today" / "Yesterday" / full
 * date for older. */
export function formatDayLabel(iso: string | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const yday = new Date();
  yday.setDate(today.getDate() - 1);
  if (dayKey(iso) === dayKey(today.toISOString())) return "Today";
  if (dayKey(iso) === dayKey(yday.toISOString())) return "Yesterday";
  const sameYear = d.getFullYear() === today.getFullYear();
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    ...(sameYear ? {} : { year: "numeric" }),
  });
}
