// Desktop's `Agent.agentType` is just `string`. Pin to the canonical
// changeset values here so `SPECIALTIES_BY_ROLE` is keyed on the same
// set as web/mobile.
export type AgentType = "worker" | "orchestrator" | "reviewer" | "observer";

// Mirrors web/src/lib/buildSoulMd.ts and mobile's create-agent.tsx so an
// agent created from the desktop wizard ends up with the same soul.md as
// one created on web or mobile. If you change the prose/structure here,
// update the other two too.

export const TONES = [
  { key: "professional" as const, label: "Professional" },
  { key: "friendly" as const, label: "Friendly" },
  { key: "casual" as const, label: "Casual" },
  { key: "formal" as const, label: "Formal" },
  { key: "witty" as const, label: "Witty" },
  { key: "technical" as const, label: "Technical" },
];

export type ToneKey = (typeof TONES)[number]["key"];

export const SPECIALTIES_BY_ROLE: Record<
  AgentType,
  { label: string; options: string[] }
> = {
  worker: {
    label: "What are they good at?",
    options: [
      "Coding",
      "Research",
      "Writing",
      "Data Analysis",
      "Travel Planning",
      "Customer Support",
      "Design",
      "DevOps",
      "QA & Testing",
      "General",
    ],
  },
  orchestrator: {
    label: "What will they manage?",
    options: [
      "Project Management",
      "Team Coordination",
      "Workflow Automation",
      "Task Prioritization",
      "Quality Oversight",
      "Resource Allocation",
    ],
  },
  reviewer: {
    label: "What do they review?",
    options: [
      "Code Review",
      "Content Review",
      "QA & Testing",
      "Compliance",
      "Design Review",
      "Data Validation",
    ],
  },
  observer: {
    label: "What do they monitor?",
    options: [
      "System Health",
      "Performance Metrics",
      "Security",
      "Compliance",
      "Logs & Events",
      "User Activity",
    ],
  },
};

const TONE_MAP: Record<ToneKey, { personality: string; style: string }> = {
  professional: {
    personality: "Professional yet approachable",
    style: "Use precise, professional language",
  },
  friendly: {
    personality: "Warm, friendly, and approachable",
    style: "Use conversational, welcoming language",
  },
  casual: {
    personality: "Relaxed and easy-going",
    style: "Use casual, everyday language",
  },
  formal: {
    personality: "Polished and respectful",
    style: "Use formal, structured language",
  },
  witty: {
    personality: "Clever and entertaining",
    style: "Use sharp, humorous language while staying helpful",
  },
  technical: {
    personality: "Analytical and detail-oriented",
    style: "Use technical, precise language with domain expertise",
  },
};

export function buildSoulMd(
  name: string,
  tone: ToneKey | null,
  customTone: string | null,
  specialties: string[],
  desc: string,
  extra: string
): string {
  let md = `# Soul\n\nYou are ${name}, an AI agent on AgentGram.\n\n`;

  md += `## Personality\n`;
  if (tone) md += `- ${TONE_MAP[tone].personality}\n`;
  else if (customTone) md += `- ${customTone}\n`;
  md += `- Clear and concise in communication\n`;
  md += `- Bias toward action — deliver results, not questions\n\n`;

  if (specialties.length > 0) {
    md += `## Expertise\n`;
    md += specialties.map((s) => `- ${s}`).join("\n") + "\n\n";
  }

  md += `## Communication Style\n`;
  if (tone) md += `- ${TONE_MAP[tone].style}\n`;
  else if (customTone) md += `- Communicate in a ${customTone.toLowerCase()} manner\n`;
  md += `- Adapt tone to match the context\n`;
  md += `- Be direct — avoid filler phrases\n\n`;

  if (desc.trim()) {
    md += `## Purpose\n- ${desc.trim()}\n\n`;
  }

  md += `## Task Approach\n`;
  md += `- Break complex tasks into clear steps and just do them\n`;
  md += `- Make reasonable assumptions from context and state them, rather than stopping to ask\n`;
  md += `- Take the obvious next step — do the implied follow-on work and report what you did\n`;
  md += `- When work would be stronger with another agent, bring them in instead of deferring to the human\n`;
  md += `- Report progress at meaningful milestones\n`;
  md += `- ACT on low-risk/reversible steps; confirm first only before high-risk or irreversible ones\n\n`;

  md += `## Boundaries\n`;
  md += `- Be transparent about limitations\n`;
  md += `- Don't hallucinate — say "I don't know" when uncertain\n`;
  md += `- When stuck, explain what's blocking and suggest a path forward\n`;

  if (extra.trim()) {
    md += `\n## Additional Instructions\n${extra.trim()}\n`;
  }

  return md;
}

/** Slugify a specialty into the kebab-case form used as a `capability`. */
export function specialtyToCapability(s: string): string {
  return s
    .toLowerCase()
    .replace(/&/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}
