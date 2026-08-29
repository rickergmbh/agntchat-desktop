import { useState, useRef, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  Building2,
  Check,
  ChevronsUpDown,
  ListChecks,
  Loader2,
  User,
  Settings,
  Plus,
} from "lucide-react";
import {
  useWorkspaceStore,
  useWorkspaces,
  useActiveWorkspace,
} from "../stores/workspaceStore";
import { IS_MACOS } from "../hooks/useWorkspaceHotkeys";
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
 *
 * `expanded` follows the rail: collapsed is the bare tile with the
 * workspace name in the tooltip, expanded puts the name inline (the
 * whole point of expanding) and drops the menu below instead of flying
 * it out to the right.
 */
export function WorkspaceSwitcher({ expanded = false }: { expanded?: boolean }) {
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
        className={cn(
          "flex h-9 items-center justify-center rounded-md bg-muted text-muted-foreground",
          expanded ? "w-full" : "w-9"
        )}
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
      className={cn("relative", expanded && "w-full")}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "relative flex shrink-0 items-center rounded-md border-2 transition-colors",
          expanded ? "w-full gap-2.5 px-1 py-1" : "h-9 w-9 justify-center",
          open
            ? "border-primary"
            : "border-transparent hover:border-border focus-visible:border-primary"
        )}
        aria-haspopup="listbox"
        aria-expanded={open}
        title={switching ? (pendingWorkspace?.name ?? activeName) : activeName}
      >
        {/* Fixed tile so the avatar keeps its square clip in both
            widths — the button itself stretches when expanded. */}
        <span
          className={cn(
            "flex shrink-0 items-center justify-center overflow-hidden rounded-md",
            expanded ? "h-7 w-7" : "h-full w-full"
          )}
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
        </span>
        {expanded && (
          <>
            <span className="min-w-0 flex-1 truncate text-left text-sm font-semibold text-foreground">
              {switching ? (pendingWorkspace?.name ?? activeName) : activeName}
            </span>
            <ChevronsUpDown className="h-3.5 w-3.5 shrink-0 text-rail-foreground" />
          </>
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
          className={cn(
            "absolute z-40 max-h-[28rem] overflow-y-auto rounded-lg border border-border bg-popover py-1 shadow-lg",
            // Expanded, the rail is wide enough to drop the menu straight
            // down under the trigger; collapsed it has to fly out past the
            // 56px rail.
            expanded
              ? "left-0 top-full mt-2 w-full min-w-72"
              : "left-full top-0 ml-2 w-72"
          )}
          role="listbox"
        >
          <ErrorBanner />
          <PendingInvitesBanner />

          <div className="px-2 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            {t("workspace.workspaces")}
          </div>

          {workspaces.map((w, i) => {
            const isActive = w.id === active?.id;
            const isPending = pendingId === w.id;
            // Cmd/Ctrl+1..9 hotkey hint — key names, not translatable copy.
            const hotkey =
              workspaces.length > 1 && i < 9
                ? `${IS_MACOS ? "⌘" : "Ctrl+"}${i + 1}`
                : null;
            return (
              <div
                key={w.id}
                className={cn(
                  // Inset rounded highlight rather than a full-bleed band —
                  // matches the app's card language (and the mobile sidebar).
                  "group mx-1 flex items-center gap-1 rounded-md px-1 transition-colors",
                  isActive ? "bg-accent" : "hover:bg-accent/50"
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
                    // min-h keeps the Personal row (no role subtitle) the
                    // same height as the rest, so the active pill doesn't
                    // render visibly squatter than its neighbours.
                    "flex min-h-11 min-w-0 flex-1 items-center gap-2.5 py-1.5 text-left text-sm",
                    isActive ? "cursor-default" : "disabled:opacity-50"
                  )}
                  role="option"
                  aria-selected={isActive}
                >
                  {/* One 28px slot for avatar and icon-fallback alike, so
                      rows align whether or not a workspace has an image. */}
                  <div className="h-7 w-7 shrink-0 overflow-hidden rounded-md">
                    <WorkspaceAvatar
                      name={w.name}
                      avatarUrl={w.avatarUrl}
                      isPersonal={w.isPersonal}
                    />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <span
                      className={cn(
                        "truncate",
                        isActive
                          ? "font-semibold text-accent-foreground"
                          : "font-medium"
                      )}
                    >
                      {w.name}
                    </span>
                    {!w.isPersonal && (
                      <span className="text-[10px] leading-tight text-muted-foreground">
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
                  {hotkey && (
                    <kbd className="shrink-0 font-sans text-[10px] tracking-wide text-muted-foreground/70">
                      {hotkey}
                    </kbd>
                  )}
                  {/* Fixed-width slot so the hotkey column doesn't shift
                      between the active row (check) and the rest (empty). */}
                  <span className="flex h-3.5 w-3.5 shrink-0 items-center justify-center">
                    {isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                    ) : isActive ? (
                      <Check className="h-3.5 w-3.5 text-primary" />
                    ) : null}
                  </span>
                </button>

                {!w.isPersonal ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setSettingsTargetId(w.id);
                      setOpen(false);
                    }}
                    className="shrink-0 rounded-md p-1.5 text-muted-foreground opacity-0 transition hover:bg-muted hover:text-foreground group-hover:opacity-100 focus:opacity-100"
                    aria-label={t("workspace.settingsFor", { name: w.name })}
                    title={t("workspace.title")}
                  >
                    <Settings className="h-3.5 w-3.5" />
                  </button>
                ) : (
                  // Same footprint as the gear so the Personal row's
                  // hotkey/check column lines up with the rest.
                  <span aria-hidden className="h-[26px] w-[26px] shrink-0" />
                )}
              </div>
            );
          })}

          <div className="mt-1 px-1">
            <button
              type="button"
              onClick={() => {
                setShowCreate(true);
                setOpen(false);
              }}
              className="group flex w-full items-center gap-2.5 rounded-md px-1 py-1.5 text-left text-sm transition-colors hover:bg-accent/50"
            >
              {/* Dashed peer of the workspace tiles — reads as "a workspace
                  that isn't there yet" rather than a stray menu item. */}
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-dashed border-muted-foreground/40 text-muted-foreground transition-colors group-hover:border-muted-foreground/70 group-hover:text-foreground">
                <Plus className="h-3.5 w-3.5" />
              </span>
              <span className="font-medium">{t("workspace.create")}</span>
            </button>
          </div>
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
 * wins; otherwise renders a generic icon — user for Personal, building for
 * shared workspaces — matching the mobile app's fallback.
 *
 * Exported so anything picking a workspace (agent Visibility, …) shows the
 * same tile the switcher does.
 */
export function WorkspaceAvatar({
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
    <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
      {isPersonal ? <User className="h-4 w-4" /> : <Building2 className="h-4 w-4" />}
    </div>
  );
}
