import { useState, useRef, useEffect } from "react";
import { ChevronDown, Check, Loader2, User, Building2, Settings, Plus } from "lucide-react";
import {
  useWorkspaceStore,
  useWorkspaces,
  useActiveWorkspace,
} from "../stores/workspaceStore";
import { CreateWorkspaceDialog } from "./CreateWorkspaceDialog";
import { WorkspaceSettingsModal } from "./WorkspaceSettingsModal";
import { PendingInvitesBanner } from "./PendingInvitesBanner";
import { cn } from "../lib/utils";
import type { WorkspaceMembership } from "../lib/api";

/**
 * Top-bar dropdown showing the user's active workspace + a list of all
 * workspaces they're a member of. Click an entry to switch — fires
 * PATCH /api/me/active-organization, wipes and refetches org-scoped
 * stores. Personal is always pinned at the top with a distinct icon.
 *
 * Mirrors `web/src/components/WorkspaceSwitcher.tsx` so the two
 * clients render identically.
 */
export function WorkspaceSwitcher() {
  const workspaces = useWorkspaces();
  const active = useActiveWorkspace();
  const switchWorkspace = useWorkspaceStore((s) => s.switch);
  const switching = useWorkspaceStore((s) => s.switching);
  const pendingId = useWorkspaceStore((s) => s.pendingId);

  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [settingsTarget, setSettingsTarget] = useState<WorkspaceMembership | null>(null);
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
      <div className="flex items-center gap-2 px-2 py-1.5 text-sm text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        <span>Loading workspace…</span>
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
          "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-accent",
          open && "bg-accent"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={activeName}
      >
        <span className="relative shrink-0">
          {activeIsPersonal ? (
            <User className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <Building2 className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {otherWorkspaceAgents > 0 && (
            <span
              className="absolute -right-0.5 -top-0.5 h-1.5 w-1.5 rounded-full bg-primary"
              title={`${otherWorkspaceAgents} agent${otherWorkspaceAgents === 1 ? "" : "s"} in other workspace${otherWorkspaceAgents === 1 ? "" : "s"}`}
            />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate font-semibold">
          {activeName}
        </span>
        <ChevronDown
          className={cn(
            "h-3 w-3 shrink-0 text-muted-foreground transition-transform",
            open && "rotate-180"
          )}
        />
      </button>

      {open && (
        <div
          className="absolute left-0 right-0 top-full z-40 mt-1 max-h-[28rem] overflow-y-auto rounded-md border border-border bg-popover py-1 shadow-md"
          role="listbox"
        >
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
                      setSettingsTarget(w);
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
      {settingsTarget && (
        <WorkspaceSettingsModal
          workspace={settingsTarget}
          onClose={() => setSettingsTarget(null)}
        />
      )}
    </div>
  );
}
