import { useState, useRef, useEffect } from "react";
import { Check, Loader2, User, Building2, Settings, Plus } from "lucide-react";
import {
  useWorkspaceStore,
  useWorkspaces,
  useActiveWorkspace,
} from "../stores/workspaceStore";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";
import { PendingInvitesBanner } from "./PendingInvitesBanner";
import { cn } from "../lib/utils";

/**
 * Compact rounded-square tile (Slack-style) showing the active
 * workspace's avatar or initials. Mounted at the top of the LeftRail;
 * clicking opens a dropdown that flies out to the right with the full
 * workspaces list, pending invites, error banner, and "Create
 * workspace".
 *
 * Mirrors `web/src/components/WorkspaceSwitcher.tsx`.
 */
export function WorkspaceSwitcher() {
  const workspaces = useWorkspaces();
  const active = useActiveWorkspace();
  const switchWorkspace = useWorkspaceStore((s) => s.switch);
  const switching = useWorkspaceStore((s) => s.switching);
  const pendingId = useWorkspaceStore((s) => s.pendingId);

  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  // Track only the workspace id; the modal looks up the live workspace
  // via the store so it auto-closes if the workspace disappears from
  // `participant.organizations` (deleted, left, etc.).
  const [settingsTargetId, setSettingsTargetId] = useState<string | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (workspaces.length === 0) {
    return (
      <div
        className="flex h-9 w-9 items-center justify-center rounded-md bg-muted text-muted-foreground"
        title="Loading workspace…"
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  const activeName = active?.name ?? "Workspace";
  const activeIsPersonal = active?.isPersonal ?? false;

  const otherWorkspaceAgents = workspaces
    .filter((w) => w.id !== active?.id)
    .reduce((sum, w) => sum + (w.agentCount ?? 0), 0);

  return (
    <div
      ref={containerRef}
      className="relative"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-md border-2 transition-colors",
          open
            ? "border-primary"
            : "border-transparent hover:border-border focus-visible:border-primary"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={activeName}
      >
        <WorkspaceAvatar
          name={activeName}
          avatarUrl={active?.avatarUrl}
          isPersonal={activeIsPersonal}
        />
        {otherWorkspaceAgents > 0 && (
          <span
            className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-primary ring-2 ring-sidebar"
            title={`${otherWorkspaceAgents} agent${
              otherWorkspaceAgents === 1 ? "" : "s"
            } in other workspace${otherWorkspaceAgents === 1 ? "" : "s"}`}
          />
        )}
      </button>

      {open && (
        <div
          className="absolute left-full top-0 z-40 ml-2 max-h-[28rem] w-72 overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
          role="listbox"
        >
          <ErrorBanner />
          <PendingInvitesBanner />

          {workspaces.map((w) => {
            const isActive = w.id === active?.id;
            const isPending = pendingId === w.id;
            return (
              <div
                key={w.id}
                className={cn(
                  "group flex items-center gap-1 px-1 py-0.5",
                  isActive ? "bg-accent/40" : "hover:bg-accent/30"
                )}
              >
                <button
                  type="button"
                  disabled={switching || isActive}
                  onClick={async () => {
                    if (!isActive) {
                      await switchWorkspace(w.id);
                    }
                    setOpen(false);
                  }}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left text-sm transition-colors",
                    isActive ? "cursor-default" : "disabled:opacity-50"
                  )}
                  role="option"
                  aria-selected={isActive}
                >
                  {w.isPersonal ? (
                    <User className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Building2 className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{w.name}</span>
                    {!w.isPersonal && (
                      <span className="text-[10px] text-muted-foreground capitalize">
                        {w.role}
                      </span>
                    )}
                  </div>
                  {(w.agentCount ?? 0) > 0 && !isActive && (
                    <span
                      className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      title={`${w.agentCount} agent${w.agentCount === 1 ? "" : "s"}`}
                    >
                      {w.agentCount}
                    </span>
                  )}
                  {isPending ? (
                    <Loader2 className="h-3 w-3 shrink-0 animate-spin text-muted-foreground" />
                  ) : isActive ? (
                    <Check className="h-3 w-3 shrink-0 text-primary" />
                  ) : null}
                </button>

                {!w.isPersonal && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSettingsTargetId(w.id);
                      setOpen(false);
                    }}
                    className="shrink-0 rounded-sm p-1 text-muted-foreground opacity-0 transition-opacity hover:bg-accent hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                    aria-label={`${w.name} settings`}
                    title="Workspace settings"
                  >
                    <Settings className="h-3 w-3" />
                  </button>
                )}
              </div>
            );
          })}

          <div className="my-1 border-t border-border" />

          <button
            type="button"
            onClick={() => {
              setShowCreate(true);
              setOpen(false);
            }}
            className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-sm text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Plus className="h-3.5 w-3.5 shrink-0" />
            <span>Create workspace</span>
          </button>
        </div>
      )}

      {showCreate && <CreateWorkspaceDialog onClose={() => setShowCreate(false)} />}
      {settingsTargetId && (
        <WorkspaceSettingsModal
          workspaceId={settingsTargetId}
          onClose={() => setSettingsTargetId(null)}
        />
      )}
    </div>
  );
}

/**
 * Surfaces workspaceStore.lastError inline at the top of the switcher
 * dropdown. Without this, errors from `applyRemoteSwitch` (cross-device
 * switch failed mid-fetch) and `refresh` were written but never read.
 */
function ErrorBanner() {
  const lastError = useWorkspaceStore((s) => s.lastError);
  if (!lastError) return null;

  return (
    <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <span className="flex-1">{lastError}</span>
      <button
        type="button"
        onClick={() => useWorkspaceStore.setState({ lastError: null })}
        aria-label="Dismiss error"
        className="shrink-0 hover:opacity-70"
      >
        ×
      </button>
    </div>
  );
}

/**
 * 36px rounded-square avatar tile. Avatar URL wins; otherwise renders
 * 1–2 initial characters derived from the workspace name. Personal
 * workspaces get a subtle user-icon corner so they're recognizable
 * when the user has multiple workspaces with similar names.
 */
function WorkspaceAvatar({
  name,
  avatarUrl,
  isPersonal,
}: {
  name: string;
  avatarUrl?: string | null;
  isPersonal: boolean;
}) {
  if (avatarUrl) {
    return (
      <img
        src={avatarUrl}
        alt=""
        className="h-full w-full object-cover"
        draggable={false}
      />
    );
  }
  return (
    <div
      className={cn(
        "flex h-full w-full items-center justify-center text-xs font-semibold",
        isPersonal ? "bg-muted text-muted-foreground" : "bg-primary/15 text-primary"
      )}
    >
      {isPersonal ? <User className="h-4 w-4" /> : workspaceInitials(name)}
    </div>
  );
}

function workspaceInitials(name: string): string {
  const trimmed = (name ?? "").trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/);
  const first = words[0] ?? "";
  const second = words[1];
  if (second && first) {
    return (first.charAt(0) + second.charAt(0)).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}
