import {
  File as FileIcon,
  FileAudio,
  FileImage,
  FileText,
  FileVideo,
  FolderOpen,
  Forward,
  Link2,
  ListTodo,
  Loader2,
  MessageSquare,
  MoreVertical,
  Search,
  SquareArrowOutUpRight,
  Trash2,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  deleteOwnerFile,
  forwardFile,
  getFileDownloadUrl,
  listOwnerFiles,
  type Conversation,
  type OwnerFile,
} from "../../lib/api";
import { cn, formatExactDateTime, getConversationTitle } from "../../lib/utils";
import { formatFileSize } from "../../services/fileUpload";
import { useChatStore } from "../../stores/chatStore";
import { useAuthStore } from "../../stores/authStore";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";

const PAGE_SIZE = 100;

type Category = "all" | "documents" | "images" | "media";

const FILTERS: { key: Category; label: string }[] = [
  { key: "all", label: "All" },
  { key: "documents", label: "Documents" },
  { key: "images", label: "Images" },
  { key: "media", label: "Media" },
];

/** Coarse bucket used by both the type-filter pills and the row icon. */
function categoryOf(contentType: string): Exclude<Category, "all"> {
  if (contentType.startsWith("image/")) return "images";
  if (contentType.startsWith("audio/") || contentType.startsWith("video/"))
    return "media";
  return "documents";
}

function iconFor(contentType: string) {
  if (contentType.startsWith("image/")) return <FileImage className="h-5 w-5" />;
  if (contentType.startsWith("audio/")) return <FileAudio className="h-5 w-5" />;
  if (contentType.startsWith("video/")) return <FileVideo className="h-5 w-5" />;
  if (
    contentType.startsWith("text/") ||
    contentType === "application/pdf" ||
    contentType === "application/json"
  )
    return <FileText className="h-5 w-5" />;
  return <FileIcon className="h-5 w-5" />;
}

type Toast = { kind: "success" | "error"; message: string };

interface Props {
  /** Jump to the conversation a file was added in, at the exact message. */
  onOpenConversation: (conversationId: string, messageId?: string) => void;
}

/**
 * Global "Files" view — a single home for every file the signed-in user and
 * their agents have created, no matter which conversation or task it lives in.
 * Files scatter across many threads; this gathers them in one searchable place
 * with per-file actions (open, copy link, forward, delete).
 */
export function FilesView({ onOpenConversation }: Props) {
  const [files, setFiles] = useState<OwnerFile[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reachedEnd, setReachedEnd] = useState(false);
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<Category>("all");
  const [opening, setOpening] = useState<string | null>(null);
  const [forwardFor, setForwardFor] = useState<OwnerFile | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  const flash = useCallback((t: Toast) => {
    setToast(t);
    window.setTimeout(() => setToast(null), 2600);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listOwnerFiles({ limit: PAGE_SIZE });
      setFiles(page);
      setReachedEnd(page.length < PAGE_SIZE);
    } catch {
      setError("Couldn't load your files. Check your connection and try again.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const loadMore = useCallback(async () => {
    const last = files[files.length - 1];
    if (!last || loadingMore) return;
    setLoadingMore(true);
    try {
      const page = await listOwnerFiles({
        limit: PAGE_SIZE,
        before: last.insertedAt,
      });
      setFiles((prev) => {
        const seen = new Set(prev.map((f) => f.id));
        return [...prev, ...page.filter((f) => !seen.has(f.id))];
      });
      setReachedEnd(page.length < PAGE_SIZE);
    } catch {
      flash({ kind: "error", message: "Couldn't load more files." });
    } finally {
      setLoadingMore(false);
    }
  }, [files, loadingMore, flash]);

  const counts = useMemo(() => {
    const c = { all: files.length, documents: 0, images: 0, media: 0 };
    for (const f of files) c[categoryOf(f.contentType)] += 1;
    return c;
  }, [files]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return files.filter((f) => {
      if (category !== "all" && categoryOf(f.contentType) !== category)
        return false;
      if (q && !f.filename.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [files, query, category]);

  const openFile = useCallback(
    async (file: OwnerFile) => {
      setOpening(file.id);
      try {
        const { url } = await getFileDownloadUrl(file.id);
        // Synthesized anchor click — Tauri's webview doesn't reliably forward
        // window.open to the OS browser. Mirrors FilesPanel / FileMessage.
        const a = document.createElement("a");
        a.href = url;
        a.target = "_blank";
        a.rel = "noopener noreferrer";
        document.body.appendChild(a);
        a.click();
        a.remove();
      } catch {
        flash({ kind: "error", message: "Couldn't open the file." });
      } finally {
        setOpening(null);
      }
    },
    [flash]
  );

  const copyLink = useCallback(
    async (file: OwnerFile) => {
      try {
        const { url } = await getFileDownloadUrl(file.id);
        await navigator.clipboard?.writeText(url);
        // The only link the private bucket exposes is a short-lived signed URL.
        flash({ kind: "success", message: "Link copied — opens for 5 minutes." });
      } catch {
        flash({ kind: "error", message: "Couldn't copy the link." });
      }
    },
    [flash]
  );

  const removeFile = useCallback(
    async (file: OwnerFile) => {
      if (!confirm(`Delete "${file.filename}"? This can't be undone.`)) return;
      try {
        await deleteOwnerFile(file.id);
        setFiles((prev) => prev.filter((f) => f.id !== file.id));
        flash({ kind: "success", message: "File deleted." });
      } catch {
        flash({ kind: "error", message: "Couldn't delete the file." });
      }
    },
    [flash]
  );

  const openSource = useCallback(
    (file: OwnerFile) => {
      if (file.conversation) onOpenConversation(file.conversation.id, file.messageId);
    },
    [onOpenConversation]
  );

  return (
    <div className="flex h-full w-full flex-col">
      {/* Header */}
      <div className="shrink-0 border-b border-border px-6 pt-5 pb-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-lg font-semibold text-foreground">
              <FolderOpen className="h-5 w-5 text-primary" />
              Files
            </h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Everything you and your agents have created, across every chat and task.
            </p>
          </div>
          <div className="relative w-64 max-w-[40%] shrink-0">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search files…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>

        {/* Type filter pills */}
        <div className="mt-3 flex items-center gap-1.5">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              type="button"
              onClick={() => setCategory(f.key)}
              className={cn(
                "rounded-full px-3 py-1 text-xs font-medium transition-colors",
                category === f.key
                  ? "bg-primary text-primary-foreground"
                  : "bg-muted text-muted-foreground hover:bg-accent hover:text-foreground"
              )}
            >
              {f.label}
              <span className="ml-1.5 opacity-60 tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
      </div>

      {/* Column header */}
      {!loading && !error && files.length > 0 && (
        <div className="flex shrink-0 items-center gap-3 border-b border-border px-6 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          <span className="min-w-0 flex-1">Name</span>
          <span className="hidden w-56 shrink-0 md:block">Location</span>
          <span className="hidden w-40 shrink-0 lg:block">Added by</span>
          <span className="hidden w-44 shrink-0 sm:block">Added</span>
          <span className="w-8 shrink-0" />
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex h-full items-center justify-center">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm text-muted-foreground">{error}</p>
            <button
              type="button"
              onClick={load}
              className="rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              Retry
            </button>
          </div>
        ) : files.length === 0 ? (
          <EmptyState
            title="No files yet"
            subtitle="Files you or your agents add to any chat or task will collect here."
          />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No matching files"
            subtitle="Try a different search or filter."
          />
        ) : (
          <div className="px-3 py-1.5">
            {visible.map((file) => (
              <FileRow
                key={file.id}
                file={file}
                opening={opening === file.id}
                onOpen={() => openFile(file)}
                onCopyLink={() => copyLink(file)}
                onForward={() => setForwardFor(file)}
                onDelete={() => removeFile(file)}
                onOpenSource={() => openSource(file)}
              />
            ))}

            {/* Load more — only without an active search/filter, since the
                cursor paginates the full set, not the filtered view. */}
            {!reachedEnd && category === "all" && query.trim() === "" && (
              <div className="flex justify-center py-4">
                <button
                  type="button"
                  onClick={loadMore}
                  disabled={loadingMore}
                  className="flex items-center gap-2 rounded-lg border border-border px-4 py-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-50"
                >
                  {loadingMore && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Load more
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {forwardFor && (
        <ForwardDialog
          file={forwardFor}
          onClose={() => setForwardFor(null)}
          onDone={(conv) => {
            setForwardFor(null);
            flash({
              kind: "success",
              message: `Forwarded to ${conv}.`,
            });
          }}
          onError={() => {
            setForwardFor(null);
            flash({ kind: "error", message: "Couldn't forward the file." });
          }}
        />
      )}

      {toast && (
        <div className="pointer-events-none fixed bottom-6 right-6 z-50">
          <div
            className={cn(
              "pointer-events-auto rounded-lg border px-4 py-2.5 text-sm shadow-lg",
              toast.kind === "error"
                ? "border-destructive/30 bg-destructive/10 text-destructive"
                : "border-border bg-card text-foreground"
            )}
          >
            {toast.message}
          </div>
        </div>
      )}
    </div>
  );
}

function FileRow({
  file,
  opening,
  onOpen,
  onCopyLink,
  onForward,
  onDelete,
  onOpenSource,
}: {
  file: OwnerFile;
  opening: boolean;
  onOpen: () => void;
  onCopyLink: () => void;
  onForward: () => void;
  onDelete: () => void;
  onOpenSource: () => void;
}) {
  const isTask = !!file.task;
  const sourceLabel = isTask
    ? file.task!.title || "Untitled task"
    : file.conversation?.title || "Untitled chat";

  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-accent">
      {/* Name */}
      <button
        type="button"
        onClick={onOpen}
        disabled={opening}
        title="Open file"
        className="flex min-w-0 flex-1 items-center gap-3 text-left disabled:opacity-50"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-md bg-muted text-primary">
          {opening ? <Loader2 className="h-4 w-4 animate-spin" /> : iconFor(file.contentType)}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-foreground">
            {file.filename}
          </span>
          <span className="block truncate text-xs text-muted-foreground">
            {formatFileSize(file.sizeBytes)}
          </span>
        </span>
      </button>

      {/* Location (task or conversation) — click to deep-link to the message */}
      <div className="hidden w-56 shrink-0 md:block">
        {file.conversation ? (
          <button
            type="button"
            onClick={onOpenSource}
            title={`Open ${isTask ? "task" : "chat"}: ${sourceLabel}`}
            className="flex max-w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground hover:bg-background hover:text-foreground"
          >
            {isTask ? (
              <ListTodo className="h-3.5 w-3.5 shrink-0 text-primary" />
            ) : (
              <MessageSquare className="h-3.5 w-3.5 shrink-0" />
            )}
            <span className="truncate">{sourceLabel}</span>
          </button>
        ) : (
          <span className="px-2 text-xs text-muted-foreground/60">—</span>
        )}
      </div>

      {/* Added by */}
      <div className="hidden w-40 shrink-0 items-center gap-2 lg:flex">
        <Avatar className="h-5 w-5">
          {file.uploader?.avatarUrl ? (
            <AvatarImage
              src={file.uploader.avatarUrl}
              alt={file.uploader.displayName}
              displaySize={20}
            />
          ) : null}
          <AvatarFallback className="text-[9px]">
            {(file.uploader?.displayName ?? "?").charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <span className="truncate text-xs text-muted-foreground">
          {file.uploader?.displayName ?? "Unknown"}
        </span>
      </div>

      {/* Added (absolute date + time) */}
      <div
        className="hidden w-44 shrink-0 truncate text-xs text-muted-foreground sm:block"
        title={new Date(file.insertedAt).toLocaleString()}
      >
        {formatExactDateTime(file.insertedAt)}
      </div>

      {/* Row actions */}
      <RowActionsMenu
        onOpen={onOpen}
        onCopyLink={onCopyLink}
        onForward={onForward}
        onDelete={onDelete}
      />
    </div>
  );
}

function RowActionsMenu({
  onOpen,
  onCopyLink,
  onForward,
  onDelete,
}: {
  onOpen: () => void;
  onCopyLink: () => void;
  onForward: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ x: 0, y: 0 });
  const btnRef = useRef<HTMLButtonElement>(null);

  const toggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    const r = btnRef.current?.getBoundingClientRect();
    if (r) setPos({ x: r.right, y: r.bottom });
    setOpen((v) => !v);
  };

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
    };
  }, [open]);

  const run = (fn: () => void) => () => {
    setOpen(false);
    fn();
  };

  return (
    <>
      <button
        ref={btnRef}
        type="button"
        onClick={toggle}
        title="More"
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground",
          open ? "bg-background text-foreground" : "opacity-0 group-hover:opacity-100"
        )}
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {open &&
        createPortal(
          <div
            role="menu"
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-50 min-w-[180px] rounded-lg border border-border bg-popover p-1 text-popover-foreground shadow-lg"
            style={{ left: pos.x - 180, top: pos.y + 4 }}
          >
            <MenuItem icon={SquareArrowOutUpRight} label="Open" onClick={run(onOpen)} />
            <MenuItem icon={Link2} label="Copy link" onClick={run(onCopyLink)} />
            <MenuItem icon={Forward} label="Forward…" onClick={run(onForward)} />
            <div className="my-1 h-px bg-border" />
            <MenuItem icon={Trash2} label="Delete" destructive onClick={run(onDelete)} />
          </div>,
          document.body
        )}
    </>
  );
}

function MenuItem({
  icon: Icon,
  label,
  onClick,
  destructive,
}: {
  icon: React.ElementType;
  label: string;
  onClick: () => void;
  destructive?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex w-full items-center gap-2 rounded-md px-3 py-1.5 text-sm transition-colors",
        destructive
          ? "text-destructive hover:bg-destructive/10"
          : "text-popover-foreground hover:bg-accent"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
      {label}
    </button>
  );
}

/** Pick an existing conversation to copy a file into. */
function ForwardDialog({
  file,
  onClose,
  onDone,
  onError,
}: {
  file: OwnerFile;
  onClose: () => void;
  onDone: (conversationLabel: string) => void;
  onError: () => void;
}) {
  const conversations = useChatStore((s) => s.conversations);
  const myId = useAuthStore((s) => s.participant?.id);
  const [query, setQuery] = useState("");
  const [busyId, setBusyId] = useState<string | null>(null);

  const list = useMemo(() => {
    const q = query.trim().toLowerCase();
    return conversations
      .map((c) => ({ conv: c, label: getConversationTitle(c, myId) }))
      .filter(({ label }) => !q || label.toLowerCase().includes(q));
  }, [conversations, query, myId]);

  const submit = async (conv: Conversation, label: string) => {
    setBusyId(conv.id);
    try {
      await forwardFile(file.id, conv.id);
      onDone(label);
    } catch {
      onError();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-[70vh] w-[440px] flex-col overflow-hidden rounded-xl border border-border bg-card shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-border px-4 py-3">
          <p className="text-sm font-semibold text-foreground">Forward file</p>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">{file.filename}</p>
        </div>
        <div className="border-b border-border p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              autoFocus
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search chats…"
              className="h-9 w-full rounded-lg border border-border bg-background pl-8 pr-3 text-sm outline-none placeholder:text-muted-foreground focus:ring-2 focus:ring-ring"
            />
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-1">
          {list.length === 0 ? (
            <p className="px-3 py-6 text-center text-xs text-muted-foreground">
              No chats found.
            </p>
          ) : (
            list.map(({ conv, label }) => (
              <button
                key={conv.id}
                type="button"
                disabled={busyId !== null}
                onClick={() => submit(conv, label)}
                className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent disabled:opacity-50"
              >
                <Avatar className="h-7 w-7">
                  {conv.avatarUrl ? (
                    <AvatarImage src={conv.avatarUrl} alt={label} displaySize={28} />
                  ) : null}
                  <AvatarFallback className="text-[10px]">
                    {label.charAt(0).toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <span className="min-w-0 flex-1 truncate text-sm text-foreground">
                  {label}
                </span>
                {busyId === conv.id && (
                  <Loader2 className="h-4 w-4 shrink-0 animate-spin text-muted-foreground" />
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}

function EmptyState({ title, subtitle }: { title: string; subtitle: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <FolderOpen className="h-10 w-10 text-muted-foreground/40" />
      <p className="text-sm font-medium text-foreground">{title}</p>
      <p className="max-w-xs text-xs text-muted-foreground">{subtitle}</p>
    </div>
  );
}
