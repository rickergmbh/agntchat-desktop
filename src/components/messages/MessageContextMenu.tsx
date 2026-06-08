import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { Reply, Copy, Hash, Trash2 } from "lucide-react";
import { cn } from "../../lib/utils";
import type { Message } from "../../lib/api";

interface Props {
  message: Message;
  x: number;
  y: number;
  /** Whether the current user can delete this message (own messages). */
  canDelete: boolean;
  onReply: (message: Message) => void;
  onCopy: (message: Message) => void;
  onCopyId: (message: Message) => void;
  onDelete: (message: Message) => void;
  onClose: () => void;
}

export function MessageContextMenu({
  message,
  x,
  y,
  canDelete,
  onReply,
  onCopy,
  onCopyId,
  onDelete,
  onClose,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    }
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("mousedown", handleClick);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handleClick);
      document.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  // Clamp to viewport
  const menuWidth = 160;
  const menuHeight = 180;
  const clampedX = Math.min(x, window.innerWidth - menuWidth - 8);
  const clampedY = Math.min(y, window.innerHeight - menuHeight - 8);

  type Action = {
    icon: typeof Reply;
    label: string;
    onClick: () => void;
    destructive?: boolean;
  };
  const actions: Action[] = [
    { icon: Reply, label: "Reply", onClick: () => { onReply(message); onClose(); } },
    { icon: Copy, label: "Copy", onClick: () => { onCopy(message); onClose(); } },
    { icon: Hash, label: "Copy ID", onClick: () => { onCopyId(message); onClose(); } },
  ];
  if (canDelete) {
    actions.push({
      icon: Trash2,
      label: "Delete",
      onClick: () => { onDelete(message); onClose(); },
      destructive: true,
    });
  }

  // Portaled to <body> so its `fixed` coordinates resolve against the
  // viewport. The conversation panel now uses `filter` (drop-shadow), which
  // would otherwise make this menu's fixed position relative to the panel and
  // shift it ~one column to the right.
  return createPortal(
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] rounded-lg border border-border bg-popover p-1 shadow-lg"
      style={{ left: clampedX, top: clampedY }}
      role="menu"
    >
      {actions.map(({ icon: Icon, label, onClick, destructive }) => (
        <button
          key={label}
          onClick={onClick}
          role="menuitem"
          className={cn(
            "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-muted",
            destructive ? "text-destructive" : "text-popover-foreground"
          )}
        >
          <Icon className="h-3.5 w-3.5" />
          {label}
        </button>
      ))}
    </div>,
    document.body
  );
}
