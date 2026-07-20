const REGEX_SPECIALS = /[.*+?^${}()|[\]\\]/g;

/**
 * Render mentions prominently in message text before markdown parsing.
 *
 * - Bracket syntax `@[Name With Spaces]` (legacy wire format) ALWAYS displays
 *   as bold `@Name With Spaces` — users should never see the brackets.
 * - Resolved mentions (from message metadata) bold their plain `@Name`
 *   occurrences too, including multi-word names (`@Technical Director`).
 *   Longest name first so `@Sam Smith` isn't half-matched by a sibling `@Sam`.
 *
 * Single pass so an already-bolded bracket form can't be re-wrapped by the
 * plain-name alternation.
 */
export function boldMentions(
  content: string,
  mentions?: { displayName?: string }[] | null,
): string {
  const names = (mentions ?? [])
    .map((m) => m?.displayName)
    .filter((n): n is string => typeof n === "string" && n.length > 0)
    .sort((a, b) => b.length - a.length)
    .map((n) => n.replace(REGEX_SPECIALS, "\\$&"));

  const namesAlt = names.length ? `|@(${names.join("|")})(?![\\w])` : "";
  const re = new RegExp(`@\\[([^\\]]+)\\]${namesAlt}`, "gi");

  return content.replace(re, (_match, bracketName, plainName) => {
    return `**@${bracketName ?? plainName}**`;
  });
}
