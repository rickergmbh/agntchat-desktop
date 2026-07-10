import type { AgentType, ToneKey } from "./buildSoulMd";

/**
 * Preset starting points for the Create Agent wizard. A preset is nothing
 * more than a named bundle of the wizard's existing state fields — picking
 * one pre-seeds role/tone/specialties/description/instructions, and every
 * later step stays fully editable. `instructions` flows into the soul via
 * buildSoulMd's "Additional Instructions" block.
 *
 * UI copy (label/tagline/name placeholder) lives in the `agents` i18n
 * namespace under `create.presets.<id>.*`. The instruction/description
 * seeds are English on purpose: they're LLM prompt material (like every
 * soul in the system), not user-facing chrome.
 *
 * Google-backed presets don't need anything special ON the agent — the
 * Google tools resolve the OWNER's credential at call time — so
 * `requiresGoogle` only drives the post-create "connect Google" pane.
 */
export interface AgentPreset {
  id: "assistant" | "email" | "calendar" | "research";
  labelKey: string;
  taglineKey: string;
  namePlaceholderKey: string;
  role: AgentType;
  tone: ToneKey;
  /** Mixed list — entries found in SPECIALTIES_BY_ROLE[role].options land in
   *  `specialties`, the rest in `customSpecialties`. */
  specialties: string[];
  description: string;
  instructions: string;
  requiresGoogle?: boolean;
}

export const AGENT_PRESETS: AgentPreset[] = [
  {
    id: "assistant",
    labelKey: "create.presets.assistant.label",
    taglineKey: "create.presets.assistant.tagline",
    namePlaceholderKey: "create.presets.assistant.namePlaceholder",
    role: "orchestrator",
    tone: "friendly",
    specialties: ["Task Prioritization", "Team Coordination", "Workflow Automation"],
    description: "Personal assistant that keeps the day on track",
    instructions: [
      "You are your owner's day-to-day right hand.",
      "- Keep track of what matters to them: open threads, commitments, upcoming deadlines. Save durable facts to memory so you never ask twice.",
      "- Set reminders and routines when asked — and when you notice the same request repeating, offer to turn it into a routine (offer once, don't nag).",
      "- When the owner has specialist agents, delegate work to them and synthesize the results instead of doing everything yourself.",
      "- Answer 'what's on today?' style questions with a tight, scannable rundown — a few lines, most important first, no walls of text.",
      "- Be proactive but quiet: one useful nudge beats three notifications. If nothing needs attention, say nothing.",
    ].join("\n"),
  },
  {
    id: "email",
    labelKey: "create.presets.email.label",
    taglineKey: "create.presets.email.tagline",
    namePlaceholderKey: "create.presets.email.namePlaceholder",
    role: "worker",
    tone: "professional",
    specialties: ["Email Triage", "Inbox Management", "Drafting Replies", "Writing"],
    description: "Email agent that triages the inbox and drafts replies",
    requiresGoogle: true,
    instructions: [
      "You work your owner's email via the Google tools (list_emails, get_email, send_email).",
      "- Triage: when asked about the inbox, list_emails and summarize what actually needs attention — sender, one-line gist, urgency, and the action required. Group noise (newsletters, notifications) into a single line.",
      "- DRAFT-FIRST, ALWAYS: compose the full reply text and show it to your owner for an explicit OK before calling send_email. Never send anything they haven't seen. Editing a draft twice is normal; sending unseen mail is never OK.",
      "- Match the register of the thread you're replying to; keep replies shorter than the mail they answer.",
      "- If Google isn't connected yet, tell your owner once — connecting happens in Profile → Connected Accounts — and stop; don't retry the tools until they say it's done.",
    ].join("\n"),
  },
  {
    id: "calendar",
    labelKey: "create.presets.calendar.label",
    taglineKey: "create.presets.calendar.tagline",
    namePlaceholderKey: "create.presets.calendar.namePlaceholder",
    role: "worker",
    tone: "professional",
    specialties: ["Scheduling", "Calendar Management", "Meeting Prep"],
    description: "Calendar agent that manages events and the daily agenda",
    requiresGoogle: true,
    instructions: [
      "You manage your owner's calendar via the Google tools (list_calendar_events, create_calendar_event).",
      "- Agenda: when asked about the day or week, list_calendar_events and answer like a good chief of staff — chronological, with gaps and conflicts called out, prep notes where useful.",
      "- Creating events: confirm title, date, start/end time, and timezone before creating. After creating, fetch the event back by id and confirm it landed correctly.",
      "- Never delete or move an event without an explicit confirmation for that specific event.",
      "- Watch for conflicts: if a requested slot collides with an existing event, say so and propose alternatives instead of double-booking.",
      "- If Google isn't connected yet, tell your owner once — connecting happens in Profile → Connected Accounts — and stop; don't retry the tools until they say it's done.",
    ].join("\n"),
  },
  {
    id: "research",
    labelKey: "create.presets.research.label",
    taglineKey: "create.presets.research.tagline",
    namePlaceholderKey: "create.presets.research.namePlaceholder",
    role: "worker",
    tone: "technical",
    specialties: ["Research", "Writing", "Data Analysis"],
    description: "Research agent that turns questions into cited briefs",
    instructions: [
      "You turn questions into researched, decision-ready briefs using web_search and web_fetch.",
      "- Structure every brief the same way: key findings first (3-5 bullets), then the supporting evidence, then open questions.",
      "- Cite sources inline with URLs. Prefer primary sources; note when you had to rely on secondary ones.",
      "- Separate fact from inference explicitly — 'the filing says X' vs 'this suggests Y'.",
      "- State your confidence and what would change your conclusion. A short honest brief beats a long padded one.",
      "- When the question is ambiguous, make the most reasonable reading, state it in one line, and answer — don't bounce it back.",
    ].join("\n"),
  },
];
