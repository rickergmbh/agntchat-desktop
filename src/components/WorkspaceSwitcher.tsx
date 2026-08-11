import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Check, ListChecks, Loader2, User, Settings, Plus } from "lucide-react";
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
 * Mirrors `web/src/components/WorkspaceSwitcher.tsx`. Selecting a
 * workspace closes the dropdown immediately; the rail tile spins until
 * the switch lands (the dropdown reopens with the error banner if it
 * fails).
 */
export function WorkspaceSwitcher() {
  const { t } = useTranslation("settings");
  const workspaces = useWorkspaces();
  const active = useActiveWorkspace();
  const switchWorkspace = useWorkspaceStore((s) => s.switch);
  const switching = useWorkspaceStore((s) => s.switching);
  const pendingId = useWorkspaceStore((s) => s.pendingId);
  const attentionByOrg = useWorkspaceStore((s) => s.attentionByOrg);
  const tasksByOrg = useWorkspaceStore((s) => s.tasksByOrg);

  // Seed the cross-workspace attention counts; WS events keep them
  // fresh from here (see workspaceStore.initWsListeners).
  useEffect(() => {
    void useWorkspaceStore.getState().fetchWorkspaceAttention();
  }, []);

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
        title={t("workspace.loadingWorkspace")}
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
      >
        <Loader2 className="h-3 w-3 animate-spin" />
      </div>
    );
  }

  const activeName = active?.name ?? t("workspace.workspace");
  const activeIsPersonal = active?.isPersonal ?? false;

  // While a switch is in flight the dropdown is already closed — the
  // rail tile is the loading surface: spinner + target's name in the
  // tooltip.
  const pendingWorkspace = pendingId
    ? workspaces.find((w) => w.id === pendingId)
    : undefined;

  // Sum items needing the user (unread messages + pending permission
  // approvals) across workspaces OTHER than the active one — the badge
  // that keeps a backgrounded workspace from silently accumulating
  // things that need them.
  const otherWorkspaceAttention = workspaces
    .filter((w) => w.id !== active?.id)
    .reduce((sum, w) => sum + (attentionByOrg[w.id] ?? 0), 0);

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
        title={switching ? (pendingWorkspace?.name ?? activeName) : activeName}
      >
        {switching ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : (
          <WorkspaceAvatar
            name={activeName}
            avatarUrl={active?.avatarUrl}
            isPersonal={activeIsPersonal}
          />
        )}
      </button>
      {/* Outside the button — its overflow-hidden would clip the badge. */}
      {otherWorkspaceAttention > 0 && (
        <span
          className="pointer-events-none absolute -right-1 -top-1 z-10 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[9px] font-semibold leading-none text-primary-foreground ring-2 ring-rail"
          title={t("workspace.attentionInOtherWorkspaces", {
            count: otherWorkspaceAttention,
          })}
        >
          {otherWorkspaceAttention > 99 ? "99+" : otherWorkspaceAttention}
        </span>
      )}

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
                  onClick={() => {
                    // Close immediately — the rail tile spins while
                    // the switch runs. Reopen on failure so the
                    // ErrorBanner is actually seen.
                    setOpen(false);
                    if (!isActive) {
                      switchWorkspace(w.id).catch(() => setOpen(true));
                    }
                  }}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-sm px-1 py-1 text-left text-sm transition-colors",
                    isActive ? "cursor-default" : "disabled:opacity-50"
                  )}
                  role="option"
                  aria-selected={isActive}
                >
                  <div className="h-5 w-5 shrink-0 overflow-hidden rounded">
                    <WorkspaceAvatar
                      name={w.name}
                      avatarUrl={w.avatarUrl}
                      isPersonal={w.isPersonal}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span className="truncate font-medium">{w.name}</span>
                    {!w.isPersonal && (
                      <span className="text-[10px] text-muted-foreground">
                        {t(`workspace.roles.${w.role}`)}
                      </span>
                    )}
                  </div>
                  {(attentionByOrg[w.id] ?? 0) > 0 && !isActive && (
                    <span className="flex h-4 min-w-4 shrink-0 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-semibold leading-none text-primary-foreground">
                      {(attentionByOrg[w.id] ?? 0) > 99
                        ? "99+"
                        : attentionByOrg[w.id]}
                    </span>
                  )}
                  {(tasksByOrg[w.id] ?? 0) > 0 && (
                    <span
                      className="flex shrink-0 items-center gap-1 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      title={t("tasks:activeCount", {
                        count: tasksByOrg[w.id],
                      })}
                    >
                      <ListChecks className="h-2.5 w-2.5" />
                      {(tasksByOrg[w.id] ?? 0) > 99 ? "99+" : tasksByOrg[w.id]}
                    </span>
                  )}
                  {(w.agentCount ?? 0) > 0 && !isActive && (
                    <span
                      className="shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground"
                      title={t("agents:count", { count: w.agentCount })}
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
                    aria-label={t("workspace.settingsFor", { name: w.name })}
                    title={t("workspace.title")}
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
            <span>{t("workspace.create")}</span>
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
  const { t } = useTranslation("common");
  const lastError = useWorkspaceStore((s) => s.lastError);
  if (!lastError) return null;

  return (
    <div className="flex items-start gap-2 border-b border-border bg-destructive/10 px-3 py-2 text-xs text-destructive">
      <span className="flex-1">{lastError}</span>
      <button
        type="button"
        onClick={() => useWorkspaceStore.setState({ lastError: null })}
        aria-label={t("dismiss")}
        className="shrink-0 hover:opacity-70"
      >
        ×
      </button>
    </div>
  );
}

/**
 * Fills its parent (which owns the size and the rounded clip). Avatar URL
 * wins; otherwise renders 1–2 initial characters derived from the workspace
 * name. Personal workspaces get a user icon instead so they're recognizable
 * when the user has multiple workspaces with similar names.
 *
 * Exported so anything picking a workspace (agent Visibility, …) shows the
 * same tile the switcher does.
 */
export function WorkspaceAvatar({
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
