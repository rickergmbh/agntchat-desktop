import { sanitizeHtml } from "../../lib/sanitizeHtml";

type ScreenplayBlockKind =
  | "scene"
  | "action"
  | "character"
  | "parenthetical"
  | "dialogue"
  | "transition";

interface ScreenplayBlock {
  kind: ScreenplayBlockKind;
  text: string;
}

const SCENE_PREFIXES = [
  "INT./EXT.",
  "INT/EXT.",
  "I/E.",
  "INT.",
  "EXT.",
  "EST.",
  "INT ",
  "EXT ",
];

export function isScreenplayTemplate(
  ...values: Array<string | undefined>
): boolean {
  return values.some((value) => value === "screenplay_page");
}

function unwrapMarkdown(line: string): string {
  let text = line.trim();
  text = text.replace(/^#{1,6}\s+/, "").trim();

  const wrappers = [
    [/^\*\*(.+)\*\*$/, "$1"],
    [/^__(.+)__$/, "$1"],
    [/^\*(.+)\*$/, "$1"],
    [/^_(.+)_$/, "$1"],
  ] as const;

  for (const [pattern, replacement] of wrappers) {
    text = text.replace(pattern, replacement).trim();
  }

  return text;
}

function isSceneHeading(raw: string, text: string): boolean {
  if (/^#{1,6}\s+/.test(raw.trim())) return true;
  const upper = text.toUpperCase();
  return SCENE_PREFIXES.some((prefix) => upper.startsWith(prefix));
}

function isTransition(text: string): boolean {
  const upper = text.toUpperCase();
  return (
    upper === text &&
    (upper.endsWith(" TO:") ||
      upper.endsWith(" TO.") ||
      upper === "FADE OUT." ||
      upper === "FADE TO BLACK.")
  );
}

function isParenthetical(text: string): boolean {
  return text.startsWith("(") && text.endsWith(")");
}

function isCharacterCue(raw: string, text: string): boolean {
  const trimmedRaw = raw.trim();
  const explicitlyBold = /^(\*\*|__).+\1$/.test(trimmedRaw);
  const upper = text.toUpperCase();
  const words = text.split(/\s+/).filter(Boolean);

  return (
    text === upper &&
    /[A-Z]/.test(text) &&
    text.length <= 32 &&
    words.length <= 4 &&
    !/[.!?:]$/.test(text) &&
    (explicitlyBold || words.length <= 3)
  );
}

function parseScreenplay(content: string): ScreenplayBlock[] {
  const blocks: ScreenplayBlock[] = [];
  let inDialogue = false;

  for (const rawLine of content.replace(/\r\n/g, "\n").split("\n")) {
    if (rawLine.trim() === "") {
      inDialogue = false;
      continue;
    }

    const text = unwrapMarkdown(rawLine);
    if (!text) continue;

    if (isSceneHeading(rawLine, text)) {
      blocks.push({ kind: "scene", text });
      inDialogue = false;
    } else if (isTransition(text)) {
      blocks.push({ kind: "transition", text });
      inDialogue = false;
    } else if (isParenthetical(text)) {
      blocks.push({ kind: "parenthetical", text });
      inDialogue = true;
    } else if (isCharacterCue(rawLine, text)) {
      blocks.push({ kind: "character", text });
      inDialogue = true;
    } else if (inDialogue) {
      blocks.push({ kind: "dialogue", text });
    } else {
      blocks.push({ kind: "action", text });
    }
  }

  return blocks;
}

function isHtml(content: string): boolean {
  return /<[a-z][\s\S]*>/i.test(content);
}

function blockClass(kind: ScreenplayBlockKind): string {
  switch (kind) {
    case "scene":
      return "mb-3 mt-1 text-left font-bold uppercase tracking-wide";
    case "character":
      return "mb-0 mt-5 text-center font-bold uppercase tracking-wide";
    case "parenthetical":
      return "mx-auto mb-0 mt-0 max-w-[20rem] pl-8 text-left italic";
    case "dialogue":
      return "mx-auto mb-2 mt-0 max-w-[28rem] text-left";
    case "transition":
      return "my-4 text-right font-bold uppercase";
    case "action":
    default:
      return "my-3 text-left";
  }
}

export function ScreenplayBody({ content }: { content: string }) {
  if (isHtml(content)) {
    return (
      <div
        className="mx-auto max-w-[46rem] font-mono text-[13px] leading-[1.6] text-foreground [&_p]:my-3"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    );
  }

  const blocks = parseScreenplay(content);

  return (
    <div className="mx-auto max-w-[46rem] font-mono text-[13px] leading-[1.6] text-foreground">
      {blocks.map((block, index) => (
        <p key={`${block.kind}-${index}`} className={blockClass(block.kind)}>
          {block.text}
        </p>
      ))}
    </div>
  );
}
