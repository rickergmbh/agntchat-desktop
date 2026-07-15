import { Wrench, Terminal } from "lucide-react";
import { useTranslation } from "react-i18next";
import type { Message } from "../../lib/api";
import { cn } from "../../lib/utils";

interface ToolCallContent {
  tool?: string;
  name?: string;
  args?: Record<string, unknown>;
  input?: Record<string, unknown>;
}

function safeParseJson<T>(str: string, fallback: T): T {
  try {
    return JSON.parse(str) as T;
  } catch {
    return fallback;
  }
}

export function ToolCallMessage({ message }: { message: Message }) {
  const { t } = useTranslation("chat");
  const tool = safeParseJson<ToolCallContent>(message.content, {});
  const name = tool.tool ?? tool.name ?? t("toolCall");
  const args = tool.args ?? tool.input;

  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Wrench className="h-3 w-3" />
        <span>{name}</span>
      </div>
      {args && Object.keys(args).length > 0 && (
        <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 text-xs leading-snug text-muted-foreground">
          {JSON.stringify(args, null, 2)}
        </pre>
      )}
    </div>
  );
}

export function ToolResultMessage({ message }: { message: Message }) {
  const { t } = useTranslation("chat");
  const isLong = (message.content ?? "").length > 200;
  return (
    <div className="space-y-1">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Terminal className="h-3 w-3" />
        <span>{t("toolResult")}</span>
      </div>
      <pre
        className={cn(
          "overflow-x-auto rounded-md bg-muted/50 p-2 text-xs leading-snug text-muted-foreground",
          isLong && "max-h-40"
        )}
      >
        {message.content}
      </pre>
    </div>
  );
}

const TOOL_TYPES = new Set(["ToolCall", "tool_call", "ToolResult", "tool_result"]);

export function isToolMessage(message: Message): boolean {
  const type = message.messageType || message.contentType || "";
  return TOOL_TYPES.has(type);
}

export function ToolMessage({ message }: { message: Message }) {
  const type = message.messageType || message.contentType;
  if (type === "ToolCall" || type === "tool_call") {
    return <ToolCallMessage message={message} />;
  }
  if (type === "ToolResult" || type === "tool_result") {
    return <ToolResultMessage message={message} />;
  }
  return null;
}
