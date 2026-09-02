import type { LucideIcon } from "lucide-react";
import {
  Activity,
  Archive,
  Bell,
  FileCode2,
  GitBranch,
  LayoutGrid,
  ListChecks,
  MessageSquare,
  Paperclip,
  Radio,
  Waypoints,
  Wrench,
} from "lucide-react";
import { MessageBubble } from "../messages/MessageBubble";
import { TaskRequestCard } from "../messages/TaskMessages";
import { ArtifactCard } from "../messages/ArtifactCard";
import { AgentConversationCard } from "../messages/AgentConversationCard";
import { TaskActivity } from "../tasks/TaskActivity";
import { StreamingBubble } from "../messages/StreamingBubble";
import { AgentBusyToastCard } from "../AgentBusyToast";
import { ReminderToastCard } from "../ReminderToast";
import { MemorySavedToastCard } from "../MemorySavedToast";
import { PermissionToastCard } from "../PermissionToast";
import { cn } from "../../lib/utils";
import type {
  ActiveStream,
  Artifact,
  ArtifactKind,
  Conversation,
  ConversationMember,
  Message,
  MessageSender,
  Participant,
} from "../../lib/api";

/**
 * Sample data for the admin-only Component Previews gallery. Every entry
 * renders a real in-conversation card component (via MessageBubble or the
 * card component directly) with fabricated data, so the gallery reflects the
 * live components — change a card and its preview changes with it.
 *
 * These fixtures NEVER touch the network or mutate state:
 *   - Task / StatusUpdate cards use throwaway task ids that aren't in the
 *     task store, so they render from the fixture's own status (no live
 *     override, no progress ticker).
 *   - File / image cards carry an inline data-URI download URL, so the
 *     FileMessage never fetches a signed URL.
 *   - Result cards use link (`url`) CTAs only — never `send_email` — so a
 *     click can't fire a real Gmail send.
 *   - Cards whose primary click navigates or mutates (open artifact viewer,
 *     open a thread, stop a task) are flagged `interactive: false`; the
 *     gallery wraps those so a stray click is swallowed. Cards whose only
 *     interaction is a safe local toggle (expand/collapse, carousel) are
 *     flagged `interactive: true`.
 */

export interface PreviewItem {
  /** Short state label shown above the card, e.g. "Working" / "Completed". */
  label: string;
  /** Optional one-line note under the label. */
  caption?: string;
  /** Allow clicks through to the card (safe local toggles only). */
  interactive?: boolean;
  node: React.ReactNode;
}

export interface PreviewCategory {
  id: string;
  name: string;
  description: string;
  icon: LucideIcon;
  items: PreviewItem[];
}

// --- Constants -------------------------------------------------------------

const PREVIEW_CONV_ID = "preview-conversation";
const AGENT_ID = "preview-agent";
const AGENT2_ID = "preview-agent-2";
// Fixed, clearly-fake task ids: absent from the task store, so status/lifecycle
// cards render from the fixture payload rather than a live override.
const T = (n: number) => `preview-task-${n}`;

const AGENT_SENDER: MessageSender = {
  id: AGENT_ID,
  type: "agent",
  displayName: "Atlas",
};

const AGENT2_SENDER: MessageSender = {
  id: AGENT2_ID,
  type: "agent",
  displayName: "Scout",
};

// Deterministic timestamps (no Date.now — keeps previews stable across renders).
const NOW = "2026-07-10T15:04:00.000Z";
const EARLIER = "2026-07-10T14:30:00.000Z";

let seq = 0;
function mkMsg(over: Partial<Message>): Message {
  seq += 1;
  return {
    id: `preview-msg-${seq}`,
    conversationId: PREVIEW_CONV_ID,
    senderId: AGENT_ID,
    sender: AGENT_SENDER,
    content: "",
    insertedAt: NOW,
    updatedAt: NOW,
    ...over,
  };
}

/** Render a message through the real bubble dispatcher, first-in-run styling. */
function Bubble({ message }: { message: Message }) {
  return <MessageBubble message={message} showAvatar showSenderName />;
}

// Toast buttons wire to real callbacks in the app; in the gallery they're inert.
const noop = () => {};

/** Chrome for a toast preview — floats a card at toast width, matching the
 *  `fixed bottom-6 right-6 max-w-sm` overlay the real toasts render into. */
function ToastFrame({ children }: { children: React.ReactNode }) {
  return <div className="max-w-sm px-4">{children}</div>;
}

/** The lightweight success/error flash toast (FilesView `flash()`); it isn't an
 *  exported component, so the trivial markup is mirrored here. */
function FlashToast({
  kind,
  message,
}: {
  kind: "success" | "error";
  message: string;
}) {
  return (
    <div
      className={cn(
        "pointer-events-auto inline-block rounded-lg border px-4 py-2.5 text-sm shadow-lg",
        kind === "error"
          ? "border-destructive/30 bg-destructive/10 text-destructive"
          : "border-border bg-card text-foreground"
      )}
    >
      {message}
    </div>
  );
}

function member(
  id: string,
  displayName: string,
  type: "human" | "agent"
): ConversationMember {
  return {
    participantId: id,
    participant: { id, displayName, type } as unknown as Participant,
  };
}

// Tiny inline chart so the image FileMessage / hotel hero never hit the network.
const CHART_IMG =
  "data:image/svg+xml," +
  encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="160" viewBox="0 0 320 160">` +
      `<rect width="320" height="160" fill="#0f172a"/>` +
      `<rect x="24" y="90" width="40" height="50" fill="#38bdf8"/>` +
      `<rect x="84" y="60" width="40" height="80" fill="#38bdf8"/>` +
      `<rect x="144" y="40" width="40" height="100" fill="#818cf8"/>` +
      `<rect x="204" y="70" width="40" height="70" fill="#38bdf8"/>` +
      `<rect x="264" y="30" width="40" height="110" fill="#818cf8"/>` +
      `<text x="16" y="24" fill="#e2e8f0" font-family="sans-serif" font-size="14">Q3 revenue by region</text>` +
      `</svg>`
  );

// --- Builders --------------------------------------------------------------

export function buildPreviewCategories(
  myId: string | undefined
): PreviewCategory[] {
  const SELF: MessageSender = {
    id: myId ?? "preview-self",
    type: "human",
    displayName: "You",
  };
  const own = (over: Partial<Message>): Message =>
    mkMsg({ senderId: SELF.id, sender: SELF, ...over });

  return [
    // ---------------------------------------------------------------- text
    {
      id: "text",
      name: "Text messages",
      description: "Plain and rich-markdown bubbles",
      icon: MessageSquare,
      items: [
        {
          label: "Agent message",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                metadata: { model: "claude-opus-4-8", backend: "anthropic" },
                content:
                  "Here's a quick **summary** of what I found:\n\n" +
                  "- Flights are cheapest on Tuesday\n" +
                  "- Hotels near the venue start at €120\n" +
                  "- Weather looks clear all week\n\n" +
                  "Want me to book anything?",
              })}
            />
          ),
        },
        {
          label: "Your message",
          interactive: true,
          node: (
            <Bubble
              message={own({
                content: "Sounds great — book the Tuesday flight.",
              })}
            />
          ),
        },
        {
          label: "Rich markdown",
          caption: "headings, lists, code, blockquote",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                content:
                  "## Deployment steps\n\n" +
                  "1. Run `mix test`\n" +
                  "2. Deploy with `fly deploy`\n\n" +
                  "```elixir\ndef hello, do: :world\n```\n\n" +
                  "> Remember to bump the version first.",
              })}
            />
          ),
        },
        {
          label: "Pending (sending)",
          interactive: true,
          node: (
            <Bubble
              message={own({
                content: "One moment, drafting that now…",
                pending: true,
              })}
            />
          ),
        },
        {
          label: "Long message (collapsed)",
          caption: "clamped behind Read more — CollapsibleText",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                content:
                  "Right — I dug through the whole booking corridor and here is the full picture, end to end.\n\n" +
                  "The outbound leg is the constraint. Tuesday morning departures clear the connection window with about ninety minutes to spare, while every Wednesday option either routes through a second hub or lands after the venue check-in desk closes for the evening.\n\n" +
                  "On accommodation, the three properties inside walking distance all price between €120 and €165 a night. The cheapest has no late check-in, which matters if we take an evening flight back on the Friday.\n\n" +
                  "Weather is settled all week — no meaningful rain risk, highs in the low twenties, so nothing there forces an itinerary change.\n\n" +
                  "Costs land roughly €80 under the budget you gave me once the return leg is fixed, and that is before any corporate rate on the hotel side.\n\n" +
                  "My recommendation: take the Tuesday 07:40 outbound, book the mid-priced hotel for its late check-in, and leave the return open until the agenda is confirmed. Say the word and I will hold all three.",
              })}
            />
          ),
        },
      ],
    },

    // ---------------------------------------------------------------- task
    {
      id: "task",
      name: "Task cards",
      description: "TaskRequest lifecycle, decisions, progress & results",
      icon: ListChecks,
      items: [
        {
          label: "Assigned (pending)",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskRequest",
                content: "Book travel for the Berlin trip",
                taskSnapshot: {
                  id: T(1),
                  status: "pending",
                  title: "Book travel for the Berlin trip",
                },
              })}
            />
          ),
        },
        {
          label: "Working (in progress)",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskRequest",
                content: "Book travel for the Berlin trip",
                taskSnapshot: {
                  id: T(2),
                  status: "in_progress",
                  title: "Book travel for the Berlin trip",
                },
              })}
            />
          ),
        },
        {
          label: "Working (with live steps)",
          caption: "step ticker fed by taskProgress in the live app",
          interactive: false,
          node: (
            <div className="max-w-md px-4">
              <TaskRequestCard
                status="in_progress"
                title="Book travel for the Berlin trip"
                agentName="Atlas"
                taskId={T(8)}
                steps={{
                  past: [
                    "Compared flight options for Tuesday",
                    "Checked hotel availability near the venue",
                  ],
                  current: "Booking the 09:40 BER flight",
                }}
              />
            </div>
          ),
        },
        {
          label: "Complete",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskRequest",
                content: "Book travel for the Berlin trip",
                taskSnapshot: {
                  id: T(3),
                  status: "complete",
                  title: "Book travel for the Berlin trip",
                },
              })}
            />
          ),
        },
        {
          label: "Failed",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskRequest",
                content: "Book travel for the Berlin trip",
                taskSnapshot: {
                  id: T(4),
                  status: "failed",
                  title: "Book travel for the Berlin trip",
                },
              })}
            />
          ),
        },
        {
          label: "Declined",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskRequest",
                content: "Book travel for the Berlin trip",
                taskSnapshot: {
                  id: T(5),
                  status: "declined",
                  title: "Book travel for the Berlin trip",
                },
              })}
            />
          ),
        },
        {
          label: "Cancelled",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskRequest",
                content: "Book travel for the Berlin trip",
                taskSnapshot: {
                  id: T(6),
                  status: "cancelled",
                  title: "Book travel for the Berlin trip",
                },
              })}
            />
          ),
        },
        {
          label: "Exhausted (retries spent)",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskRequest",
                content: "Book travel for the Berlin trip",
                taskSnapshot: {
                  id: T(7),
                  status: "exhausted",
                  title: "Book travel for the Berlin trip",
                },
              })}
            />
          ),
        },
        {
          label: "Accepted (decision)",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskAccept",
                content: "Accepted",
                contentStructured: {
                  data: {
                    message: "On it — I'll have this done shortly.",
                    estimated_seconds: 600,
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Declined (decision)",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskReject",
                content: "Declined",
                contentStructured: {
                  data: {
                    reason: "This needs calendar access I don't have.",
                    suggestion: "Assign it to the scheduler agent instead.",
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Progress",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskProgress",
                content: "Working",
                contentStructured: {
                  data: {
                    status: "Researching",
                    current_step: "Comparing 12 hotels near the venue",
                    percent_complete: 45,
                    elapsed_ms: 42000,
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Result — completed",
          caption: "click to expand",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskComplete",
                content: "Trip booked",
                contentStructured: {
                  data: {
                    result: {
                      summary:
                        "Booked the Tuesday 9:40am flight and a room at Hotel Adler.\n\n" +
                        "Confirmation codes are in your email.",
                      criteria_met: {
                        "Flight booked": true,
                        "Hotel booked": true,
                        "Under budget": false,
                      },
                      artifacts: [{ type: "file", path: "itinerary.pdf" }],
                    },
                    duration_seconds: 320,
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Result — failed",
          caption: "click to expand",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "TaskFail",
                content: "Booking failed",
                contentStructured: {
                  data: {
                    error: {
                      code: "TOOL_ERROR",
                      message: "The booking site rejected the payment method.",
                    },
                    partial_result: { summary: "Flight was held but not paid." },
                    duration_seconds: 88,
                  },
                },
              })}
            />
          ),
        },
      ],
    },

    // -------------------------------------------------------------- status
    {
      id: "status",
      name: "Task status updates",
      description: "Lifecycle cards emitted as StatusUpdate messages",
      icon: Activity,
      items: [
        {
          label: "Working",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  task_id: T(10),
                  type: "task_in_progress",
                  title: "Compiling the quarterly report",
                  agent_name: "Atlas",
                }),
              })}
            />
          ),
        },
        {
          label: "Completion",
          caption: "click to expand",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  task_id: T(11),
                  type: "task_complete",
                  title: "Quarterly report compiled",
                  agent_name: "Atlas",
                  summary:
                    "Revenue up 12% QoQ. Full breakdown attached to the thread.",
                  duration_seconds: 540,
                }),
              })}
            />
          ),
        },
        {
          label: "Failure",
          caption: "click to expand",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  task_id: T(12),
                  type: "task_failed",
                  title: "Report compilation failed",
                  agent_name: "Atlas",
                  error: "The data source timed out after 3 retries.",
                }),
              })}
            />
          ),
        },
        {
          label: "Cancelled",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  task_id: T(13),
                  type: "task_cancelled",
                  title: "Report compilation",
                  agent_name: "Atlas",
                }),
              })}
            />
          ),
        },
        {
          label: "Delegated",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  task_id: T(14),
                  type: "task_delegated",
                  title: "Draft the launch email",
                  agent_name: "Scout",
                }),
              })}
            />
          ),
        },
        {
          label: "Self-assigned",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  task_id: T(15),
                  type: "task_self_assigned",
                  title: "Monitor the deploy",
                  agent_name: "Atlas",
                }),
              })}
            />
          ),
        },
        {
          label: "Accepted",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  task_id: T(16),
                  type: "task_accepted",
                  title: "Review the pull request",
                  agent_name: "Scout",
                }),
              })}
            />
          ),
        },
        {
          label: "Capability warning",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  type: "task_capability_warning",
                  kind: "missing_required_tools",
                  title: "Book the venue",
                  agent_name: "Scout",
                  required_tools: ["calendar", "payments"],
                  unresolved_mismatches: [
                    {
                      agent_id: "abcd1234efgh5678",
                      missing: ["calendar", "payments"],
                    },
                  ],
                }),
              })}
            />
          ),
        },
        {
          label: "Request failed",
          caption: "create_task rejected by the backend",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  type: "task_request_failed",
                  error_kind: "invalid_assignees_not_found",
                  agent_name: "Scout",
                  attempted_title: "Summarize the thread",
                  attempted_assignees: [
                    "00000000-0000-0000-0000-0000000000aa",
                  ],
                }),
              })}
            />
          ),
        },
        {
          label: "Generic status",
          caption: "unknown lifecycle, no task id",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "StatusUpdate",
                content: JSON.stringify({
                  status: "handshake_completed",
                  summary: "Capability handshake completed with 2 agents.",
                }),
              })}
            />
          ),
        },
      ],
    },

    // ---------------------------------------------------------------- tool
    {
      id: "tool",
      name: "Tool activity",
      description: "Tool call and tool result bubbles",
      icon: Wrench,
      items: [
        {
          label: "Tool call",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ToolCall",
                content: JSON.stringify({
                  tool: "web_search",
                  args: {
                    query: "best hotels near Messe Berlin",
                    max_results: 5,
                  },
                }),
              })}
            />
          ),
        },
        {
          label: "Tool result",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ToolResult",
                content:
                  "Found 5 results. Top match: Hotel Adler (4.6★, €128/night, 300m from venue).",
              })}
            />
          ),
        },
        {
          label: "Tool result — long",
          caption: "scrolls inside the bubble",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ToolResult",
                content: Array.from(
                  { length: 12 },
                  (_, i) =>
                    `[${i + 1}] hotel_result score=${(0.98 - i * 0.05).toFixed(
                      2
                    )} name="Hotel ${i + 1}" price=€${120 + i * 7}/night`
                ).join("\n"),
              })}
            />
          ),
        },
      ],
    },

    // ---------------------------------------------------------------- file
    {
      id: "file",
      name: "Files & attachments",
      description: "Image and document messages",
      icon: Paperclip,
      items: [
        {
          label: "Image with caption",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "file",
                content: JSON.stringify({
                  attachmentId: "preview-img",
                  filename: "q3-revenue.svg",
                  contentType: "image/svg+xml",
                  caption: "Q3 revenue by region",
                }),
                fileAttachments: [
                  {
                    id: "preview-img",
                    filename: "q3-revenue.svg",
                    contentType: "image/svg+xml",
                    downloadUrl: CHART_IMG,
                  },
                ],
              })}
            />
          ),
        },
        {
          label: "Document",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "file",
                content: JSON.stringify({
                  filename: "itinerary.pdf",
                  contentType: "application/pdf",
                  sizeBytes: 284000,
                }),
              })}
            />
          ),
        },
        {
          label: "Document with caption",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "file",
                content: JSON.stringify({
                  filename: "contract-draft.docx",
                  contentType:
                    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                  sizeBytes: 51200,
                  caption: "First draft — needs legal review",
                }),
              })}
            />
          ),
        },
      ],
    },

    // -------------------------------------------------------------- result
    {
      id: "result",
      name: "Result cards",
      description: "ResultPresentation cards by result type",
      icon: LayoutGrid,
      items: [
        {
          label: "Hotel",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ResultPresentation",
                content: "Hotel option",
                contentStructured: {
                  data: {
                    result_type: "hotel",
                    title: "Top hotel near the venue",
                    items: [
                      {
                        type: "hotel",
                        title: "Hotel Adler",
                        subtitle: "Mitte, Berlin · 300m from venue",
                        image_url: CHART_IMG,
                        rating: 4.6,
                        rating_count: 1284,
                        rating_source: "Google",
                        price: {
                          amount: 128,
                          currency: "EUR",
                          per: "night",
                          original_amount: 150,
                          discount_pct: 15,
                        },
                        amenities: [
                          "Free WiFi",
                          "Breakfast",
                          "Gym",
                          "Pool",
                          "Bar",
                          "Spa",
                          "Parking",
                        ],
                        highlights: ["Near venue", "Great reviews"],
                        cta: {
                          primary: {
                            label: "View deal",
                            url: "https://example.com",
                          },
                        },
                      },
                    ],
                    citations: [
                      { source_name: "booking.com", url: "https://example.com" },
                    ],
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Restaurant",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ResultPresentation",
                content: "Restaurant option",
                contentStructured: {
                  data: {
                    result_type: "restaurant",
                    items: [
                      {
                        type: "restaurant",
                        title: "Osteria Toscana",
                        subtitle: "Italian · $$",
                        rating: 4.4,
                        price: { amount: 35, currency: "EUR", per: "person" },
                        detail_schema: [
                          { key: "cuisine", display: "chip", label: "Cuisine" },
                          {
                            key: "hours",
                            display: "row",
                            icon: "clock",
                            label: "Open",
                          },
                        ],
                        details: { cuisine: "Italian", hours: "18:00–23:00" },
                        cta: {
                          primary: {
                            label: "Reserve",
                            url: "https://example.com",
                          },
                        },
                      },
                    ],
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Flight",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ResultPresentation",
                content: "Flight option",
                contentStructured: {
                  data: {
                    result_type: "flight",
                    items: [
                      {
                        type: "flight",
                        title: "BER → LHR",
                        price: { amount: 142, currency: "EUR" },
                        detail_schema: [
                          {
                            key: "depart",
                            display: "row",
                            icon: "plane",
                            label: "Depart",
                          },
                          {
                            key: "stops",
                            display: "row",
                            format: "stops",
                            label: "Stops",
                          },
                          {
                            key: "duration",
                            display: "chip",
                            label: "Duration",
                          },
                        ],
                        details: { depart: "09:40", stops: 0, duration: "2h 05m" },
                        cta: {
                          primary: {
                            label: "Select",
                            url: "https://example.com",
                          },
                        },
                      },
                    ],
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Product",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ResultPresentation",
                content: "Product option",
                contentStructured: {
                  data: {
                    result_type: "product",
                    items: [
                      {
                        type: "product",
                        title: "Wireless Headphones",
                        subtitle: "Acme Audio",
                        rating: 4.2,
                        rating_count: 512,
                        price: {
                          amount: 79,
                          currency: "USD",
                          original_amount: 129,
                          discount_pct: 39,
                        },
                        highlights: ["In stock", "Free returns"],
                        cta: {
                          primary: { label: "Buy", url: "https://example.com" },
                        },
                      },
                    ],
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Finance",
          caption: "sparkline + change chip",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ResultPresentation",
                content: "Quote",
                contentStructured: {
                  data: {
                    result_type: "finance",
                    items: [
                      {
                        type: "finance",
                        title: "ACME Corp",
                        subtitle: "NASDAQ: ACME",
                        detail_schema: [
                          {
                            key: "price",
                            display: "highlight",
                            icon: "dollar-sign",
                            color: "success",
                            label: "Price",
                          },
                          {
                            key: "change",
                            display: "change",
                            format: "percent",
                            label: "Today",
                          },
                          { key: "trend", display: "sparkline", label: "7d" },
                        ],
                        details: {
                          price: "$184.20",
                          change: 2.4,
                          trend: [180, 181, 179, 182, 183, 182, 184],
                        },
                      },
                    ],
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Email draft",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ResultPresentation",
                content: "Email",
                contentStructured: {
                  data: {
                    result_type: "email",
                    items: [
                      {
                        type: "email",
                        title: "Re: Q3 planning",
                        detail_template: "email_default",
                        detail_schema: [
                          {
                            key: "to",
                            display: "row",
                            icon: "mail",
                            label: "To",
                          },
                          { key: "body", display: "body" },
                        ],
                        details: {
                          to: "team@acme.com",
                          body:
                            "Hi team,\n\nHere's the agenda for Thursday's planning session:\n" +
                            "1. Q3 recap\n2. Roadmap\n3. Hiring\n\nBest,\nAtlas",
                        },
                        cta: {
                          primary: {
                            label: "Open in Gmail",
                            url: "https://mail.google.com",
                          },
                        },
                      },
                    ],
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Generic",
          interactive: false,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ResultPresentation",
                content: "Summary",
                contentStructured: {
                  data: {
                    result_type: "generic",
                    items: [
                      {
                        type: "generic",
                        title: "Release summary",
                        subtitle: "3 key points",
                        detail_schema: [{ key: "body", display: "body" }],
                        details: {
                          body:
                            "1. Shipped the component preview gallery.\n" +
                            "2. Localized all chrome copy.\n" +
                            "3. Deployed to production.",
                        },
                      },
                    ],
                  },
                },
              })}
            />
          ),
        },
        {
          label: "Carousel",
          caption: "multiple items · use Prev / Next",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "ResultPresentation",
                content: "Hotel options",
                contentStructured: {
                  data: {
                    result_type: "hotel",
                    title: "3 hotels near the venue",
                    items: [1, 2, 3].map((n) => ({
                      type: "hotel",
                      title: `Hotel ${["Adler", "Berg", "Central"][n - 1]}`,
                      subtitle: `${n * 300}m from venue`,
                      rating: 4.6 - n * 0.2,
                      rating_count: 1000 - n * 120,
                      price: {
                        amount: 110 + n * 15,
                        currency: "EUR",
                        per: "night",
                      },
                      amenities: ["Free WiFi", "Breakfast", "Gym"],
                      cta: {
                        primary: { label: "View deal", url: "https://example.com" },
                      },
                    })),
                  },
                },
              })}
            />
          ),
        },
      ],
    },

    // ------------------------------------------------------------ artifact
    {
      id: "artifact",
      name: "Artifacts",
      description: "Inline artifact cards by kind",
      icon: FileCode2,
      items: (
        [
          ["code", "deploy.sh", 3],
          ["html", "Landing page", 1],
          ["markdown", "Launch plan", 5],
          ["document", "Meeting notes", 2],
        ] as Array<[ArtifactKind, string, number]>
      ).map(([kind, title, version]) => ({
        label: `${kind} artifact`,
        interactive: false,
        node: (
          <ArtifactCard
            artifact={mkArtifact(kind, title, version)}
            members={[member(AGENT_ID, "Atlas", "agent")]}
          />
        ),
      })),
    },

    // -------------------------------------------------------------- thread
    {
      id: "thread",
      name: "Agent threads",
      description: "Inline sub-conversation pills",
      icon: GitBranch,
      items: [
        {
          label: "Open thread",
          interactive: false,
          node: (
            <AgentConversationCard
              conversation={mkThread("open", "Hotel booking")}
            />
          ),
        },
        {
          label: "Resolved thread",
          interactive: false,
          node: (
            <AgentConversationCard
              conversation={mkThread("resolved", "Flight comparison")}
            />
          ),
        },
        {
          label: "Abandoned thread",
          interactive: false,
          node: (
            <AgentConversationCard
              conversation={mkThread("abandoned", "Venue research")}
            />
          ),
        },
      ],
    },

    // -------------------------------------------------------------- stream
    {
      id: "stream",
      name: "Live streaming",
      description: "The in-flight agent streaming bubble",
      icon: Radio,
      items: [
        {
          label: "Writing",
          interactive: false,
          node: (
            <StreamingBubble
              stream={mkStream({
                phase: "writing",
                content:
                  "Looking at the options now — the Tuesday flight is cheapest and the Adler has availability, so I'd suggest booking both together.",
              })}
            />
          ),
        },
        {
          label: "Thinking",
          interactive: false,
          node: (
            <StreamingBubble
              stream={mkStream({
                phase: "thinking",
                thoughts: ["Let me check availability before I commit to dates."],
                recentSteps: ["Searching flights", "Comparing prices"],
              })}
            />
          ),
        },
        {
          label: "Tool call",
          interactive: false,
          node: (
            <StreamingBubble
              stream={mkStream({
                phase: "tool_call",
                recentSteps: ["web_search(hotels near venue)"],
              })}
            />
          ),
        },
      ],
    },

    // ------------------------------------------------------- task activity
    {
      id: "task-activity",
      name: "Live activity rail",
      description: "Step trail on an in-flight action (Actions → detail pane)",
      icon: Waypoints,
      items: [
        {
          label: "First step",
          caption: "no history yet — head only, no rail",
          node: <TaskActivity steps={["Reading the trip brief"]} />,
        },
        {
          label: "Short trail",
          node: (
            <TaskActivity
              steps={["Reading the trip brief", "Checking calendar availability", "Searching flights BER → LHR"]}
            />
          ),
        },
        {
          label: "Full trail",
          caption: "history caps at four; older steps recede",
          node: (
            <TaskActivity
              steps={[
                "Reading the trip brief",
                "Checking calendar availability",
                "Searching flights BER → LHR",
                "Comparing fares across carriers",
                "Checking hotels near the venue",
                "Drafting the itinerary",
              ]}
            />
          ),
        },
        {
          label: "Long step text",
          caption: "wrapping — text must clear the rail on every line",
          node: (
            <TaskActivity
              steps={[
                "Opened the shared Berlin planning sheet and read the constraints tab",
                "Cross-referencing the venue address against hotels within a 500m walk, filtering out anything without free cancellation before Friday",
              ]}
            />
          ),
        },
      ],
    },

    // ---------------------------------------------------------- compaction
    {
      id: "compaction",
      name: "System notices",
      description: "Conversation-level events",
      icon: Archive,
      items: [
        {
          label: "Compaction summary",
          caption: "click to expand",
          interactive: true,
          node: (
            <Bubble
              message={mkMsg({
                messageType: "CompactionSummary",
                content: "Summary",
                contentStructured: {
                  data: {
                    narrative:
                      "Earlier the team scoped the Berlin trip, compared flights and " +
                      "hotels, and agreed on a Tuesday departure. Atlas booked the flight; " +
                      "Scout is handling the hotel.",
                    messages_compacted: 24,
                  },
                },
              })}
            />
          ),
        },
      ],
    },

    // --------------------------------------------------------------- toasts
    {
      id: "toasts",
      name: "Toasts",
      description: "Corner notification toasts (rendered inline here)",
      icon: Bell,
      items: [
        {
          label: "Agent busy redirect",
          interactive: true,
          node: (
            <ToastFrame>
              <AgentBusyToastCard
                name="Atlas"
                taskLabel={"“Book travel for the Berlin trip”"}
                onOpen={noop}
                onDismiss={noop}
              />
            </ToastFrame>
          ),
        },
        {
          label: "Reminder — with open",
          interactive: true,
          node: (
            <ToastFrame>
              <ReminderToastCard
                title="Atlas"
                summary="Standup starts in 10 minutes."
                onSnooze={noop}
                onOpen={noop}
                onDismiss={noop}
              />
            </ToastFrame>
          ),
        },
        {
          label: "Reminder — no DM to open",
          interactive: true,
          node: (
            <ToastFrame>
              <ReminderToastCard
                title="Reminder"
                summary="Renew the domain before it expires on Friday."
                onSnooze={noop}
                onDismiss={noop}
              />
            </ToastFrame>
          ),
        },
        {
          label: "Memory island — agent save",
          node: (
            <ToastFrame>
              <MemorySavedToastCard
                title="Atlas saved a memory"
                content="You prefer window seats on long flights."
              />
            </ToastFrame>
          ),
        },
        {
          label: "Permission — with description",
          interactive: true,
          node: (
            <ToastFrame>
              <PermissionToastCard
                description="Atlas wants to send an email to team@acme.com."
                toolName="send_email"
                scopeKind="domain"
                scopeFacet="acme.com"
                onDeny={noop}
                onAlways={noop}
                onApprove={noop}
              />
            </ToastFrame>
          ),
        },
        {
          label: "Permission — tool fallback",
          caption: "no description → tool name subtitle; exact-input scope",
          interactive: true,
          node: (
            <ToastFrame>
              <PermissionToastCard
                toolName="run_shell_command"
                scopeKind="exact"
                onDeny={noop}
                onAlways={noop}
                onApprove={noop}
              />
            </ToastFrame>
          ),
        },
        {
          label: "Flash — success",
          interactive: true,
          node: (
            <ToastFrame>
              <FlashToast kind="success" message="Link copied to clipboard" />
            </ToastFrame>
          ),
        },
        {
          label: "Flash — error",
          interactive: true,
          node: (
            <ToastFrame>
              <FlashToast kind="error" message="Couldn't upload file" />
            </ToastFrame>
          ),
        },
      ],
    },
  ];
}

// --- Non-message fixtures --------------------------------------------------

function mkArtifact(
  kind: ArtifactKind,
  title: string,
  currentVersion: number
): Artifact {
  return {
    id: `preview-artifact-${kind}`,
    conversationId: PREVIEW_CONV_ID,
    authorId: AGENT_ID,
    title,
    kind,
    currentVersion,
    insertedAt: EARLIER,
    updatedAt: NOW,
  };
}

function mkThread(status: string, topic: string): Conversation {
  return {
    id: `preview-thread-${status}`,
    type: "group",
    title: topic,
    metadata: { thread_topic: topic, thread_status: status, agent_thread: true },
    insertedAt: EARLIER,
    updatedAt: NOW,
    members: [
      member("preview-self", "You", "human"),
      member(AGENT2_ID, "Scout", "agent"),
    ],
    lastMessage: mkMsg({
      sender: AGENT2_SENDER,
      senderId: AGENT2_ID,
      content: "Sounds good, I'll confirm the room.",
    }),
  };
}

function mkStream(over: Partial<ActiveStream>): ActiveStream {
  return {
    streamId: "preview-stream",
    senderId: AGENT_ID,
    senderName: "Atlas",
    content: "",
    phase: "writing",
    recentSteps: [],
    thoughts: [],
    thoughtPrefix: "",
    lastUpdateAt: 0,
    ...over,
  };
}
