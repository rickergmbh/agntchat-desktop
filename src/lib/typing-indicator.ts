import type { TFunction } from "i18next";

export interface TypingEntry {
  name: string;
  type: string; // "human" | "agent"
}

// Semantic typing verb, shared across web / desktop / mobile so the indicator
// reads identically everywhere (same chat:typingIndicator.* catalog keys):
// - a lone human "is typing", a lone agent "is processing"
// - all agents "are processing"; a mix that includes an agent "are responding";
//   all humans "are typing".
// Returns "" for an empty list (callers treat that as "nothing to show").
export function buildTypingText(entries: TypingEntry[], t: TFunction): string {
  if (entries.length === 0) return "";

  if (entries.length === 1) {
    const [only] = entries;
    return only.type === "agent"
      ? t("chat:typingIndicator.oneProcessing", { name: only.name })
      : t("chat:typingIndicator.oneTyping", { name: only.name });
  }

  const hasAgent = entries.some((e) => e.type === "agent");
  const allAgents = entries.every((e) => e.type === "agent");
  const names = entries.map((e) => e.name).join(", ");

  if (allAgents) return t("chat:typingIndicator.manyProcessing", { names });
  if (hasAgent) return t("chat:typingIndicator.manyResponding", { names });
  return t("chat:typingIndicator.manyTyping", { names });
}
