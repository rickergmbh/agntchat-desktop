import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageCircle,
  Bot,
  User,
  Zap,
  LayoutTemplate,
  Server,
  Shapes,
  FolderOpen,
  ShieldHalf,
  Users,
  Sun,
  Moon,
  Monitor,
  LogOut,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, unreadTier, type UnreadTier } from "../lib/utils";
import { useWebSocket } from "../hooks/useWebSocket";
import { useWorkspaceHotkeys } from "../hooks/useWorkspaceHotkeys";
import { useChatStore } from "../stores/chatStore";
import { useAuthStore } from "../stores/authStore";
import { useAgentStore } from "../stores/agentStore";
import { useTaskStore, countActiveTasks } from "../stores/taskStore";
import { useNavStore } from "../stores/navStore";
import { trackScreen } from "../lib/analytics";
import { usePresenceStore } from "../stores/presenceStore";
import { isAgentOnline } from "../lib/agentOnline";
import { useThemeStore } from "../stores/themeStore";
import { useFriendStore } from "../stores/friendStore";
import { useActiveWorkspace, useWorkspacesEnabled } from "../stores/workspaceStore";
import { AgentBusyToast } from "./AgentBusyToast";
import { ReminderToast } from "./ReminderToast";
import { PermissionToast } from "./PermissionToast";
import { RenameToGroupModal } from "./RenameToGroupModal";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dashboard } from "./Dashboard";
import { MessagesView } from "./messages/MessagesView";
import { TasksView } from "./tasks/TasksView";
import { TemplatesView } from "./templates/TemplatesView";
import { PreviewsView } from "./previews/PreviewsView";
import { FilesView } from "./files/FilesView";
import { CanvasView } from "./canvas/CanvasView";
import { Profile } from "./Profile";
import { FriendsView } from "./FriendsView";
import { FleetView } from "./FleetView";
import { PlatformView } from "./PlatformView";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";

type View =
  | "chat"
  | "tasks"
  | "agents"
  | "friends"
  | "files"
  | "hosts"
  | "templates"
  | "previews"
  | "canvas"
  | "fleet"
  | "platform";

export function AppShell() {
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const participant = useAuthStore((s) => s.participant);
  const [showProfile, setShowProfile] = useState(false);

  // Mirrors LeftRail's isWorkspaceMode — the "friends" view doubles as the
  // Members view in a shared workspace, so the view gate below must match
  // the rail gate exactly.
  const shellWorkspacesEnabled = useWorkspacesEnabled();
  const shellActiveWorkspace = useActiveWorkspace();
  const shellWorkspaceMembersMode =
    shellWorkspacesEnabled &&
    shellActiveWorkspace !== null &&
    !shellActiveWorkspace.isPersonal;

  // Connect socket + wire store listeners once we have auth
  useWebSocket();

  // Cmd/Ctrl+1..9 switches workspaces (Slack-style, switcher order).
  useWorkspaceHotkeys();

  // The default view is never set via setView, so emit its $screen here —
  // otherwise a session spent entirely in the initial view has no screen
  // event. Queued by the analytics module until a consented identify.
  useEffect(() => {
    trackScreen(useNavStore.getState().view);
  }, []);

  // Esc closes the Profile drawer
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && showProfile) setShowProfile(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [showProfile]);

  const setActiveConversation = useChatStore((s) => s.setActiveConversation);
  const handleOpenConversation = useCallback(
    (conversationId: string, messageId?: string) => {
      setActiveConversation(
        conversationId,
        messageId ? { scrollToMessageId: messageId } : undefined
      );
      setView("chat");
    },
    [setActiveConversation, setView]
  );

  return (
    // macOS-style inset: the whole app floats on a neutral "desk" with a thin
    // gutter all around, so nothing runs hard to the window edges. The dark
    // rail and the content area are separate rounded panels resting on the
    // desk; the gap between them lets the desk show through.
    <div className="flex h-screen w-screen gap-1.5 bg-desk p-1.5">
      <LeftRail
        view={view}
        onChange={setView}
        onOpenProfile={() => setShowProfile(true)}
      />
      {/* WorkspaceSwitcher is mounted at the top of LeftRail (Slack-
          style tile). The global header is gone — the routed views
          claim the full vertical space again. The content area is a
          single rounded panel that clips whatever view is mounted. */}
      <main className="relative flex flex-1 overflow-hidden rounded-xl bg-background shadow-sm">
        {view === "chat" ? (
          <MessagesView />
        ) : view === "tasks" ? (
          <TasksView onOpenConversation={handleOpenConversation} />
        ) : view === "friends" ? (
          // Friends is behind a runtime feature flag (resolved per-user on /me).
          // A stale persisted "friends" view falls back to the dashboard when
          // the flag is off for this user — EXCEPT in workspace mode, where
          // this same view is the org-scoped "Members" view (the rail slot
          // flips its label) and must mount with friends off. Without the
          // workspace-mode arm, the Members button silently rendered the
          // agents dashboard.
          participant?.features?.friends || shellWorkspaceMembersMode ? (
            <FriendsView />
          ) : (
            <Dashboard />
          )
        ) : view === "files" ? (
          <FilesView onOpenConversation={handleOpenConversation} />
        ) : view === "hosts" ? (
          // Self-hosting (org hosts) is behind the org_hosts runtime flag —
          // the backend 404s every host route without it, so a stale
          // persisted "hosts" view falls back to the dashboard rather than
          // rendering a surface that can only error.
          participant?.features?.org_hosts ? <FleetView /> : <Dashboard />
        ) : view === "templates" ? (
          // Response templates are an admin-only area now (matches the rail,
          // which hides the button for non-admins).
          participant?.platformAdmin ? <TemplatesView /> : <Dashboard />
        ) : view === "previews" ? (
          // Component previews are an admin-only debug gallery (matches the
          // rail, which hides the button for non-admins).
          participant?.platformAdmin ? <PreviewsView /> : <Dashboard />
        ) : view === "canvas" ? (
          <CanvasView />
        ) : view === "fleet" || view === "platform" ? (
          // Fleet folded into Platform — host management now lives under the
          // admin-only Platform area. A stale persisted "fleet" view (the tab
          // is gone) falls back to the dashboard for non-admins.
          participant?.platformAdmin ? <PlatformView /> : <Dashboard />
        ) : (
          <Dashboard />
        )}
      </main>

      {/* Profile drawer — lifted to shell so it's reachable from any view */}
      <div
        className={cn(
          // Scrim is deliberately heavy: the drawer is a full settings
          // surface with its own rail, so a light dim read as "another
          // panel of the app" rather than a layer above it.
          "fixed inset-0 bg-black/50 z-40 transition-opacity duration-200",
          // Blur as well as dim — the same separation cue the app's dialog
          // overlay uses, and it survives themes where a flat dim doesn't.
          "supports-backdrop-filter:backdrop-blur-xs",
          showProfile ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setShowProfile(false)}
      />
      <div
        className={cn(
          // 800px gives the settings forms room next to the 224px rail;
          // max-w keeps a strip of the app visible so it still reads as a
          // layer over the product, not a new screen.
          "fixed top-0 right-0 h-full w-[800px] max-w-[85vw] bg-card border-l border-border shadow-2xl z-50 overflow-hidden",
          "transition-transform duration-300 ease-out",
          showProfile ? "translate-x-0" : "translate-x-full"
        )}
      >
        {showProfile && <Profile onClose={() => setShowProfile(false)} />}
      </div>

      <AgentBusyToast />
      <ReminderToast />
      <PermissionToast />
      <RenameToGroupModal />
    </div>
  );
}

function LeftRail({
  view,
  onChange,
  onOpenProfile,
}: {
  view: View;
  onChange: (v: View) => void;
  onOpenProfile: () => void;
}) {
  const { t } = useTranslation("nav");
  const { t: tChat } = useTranslation("chat");
  const unread = useChatStore((s) => s.unreadCounts);
  const personalConversations = useChatStore((s) => s.conversations);
  // Only count unread against conversations in the personal "Chats" list —
  // the server's /unread-counts endpoint returns entries for every
  // conversation the user can see, including hidden agent threads, which
  // would otherwise inflate the badge on the Chat tab.
  const totalUnread = useMemo(() => {
    const personalIds = new Set(personalConversations.map((c) => c.id));
    let sum = 0;
    for (const [id, n] of Object.entries(unread)) {
      if (personalIds.has(id)) sum += typeof n === "number" ? n : 0;
    }
    return sum;
  }, [unread, personalConversations]);
  const tasks = useTaskStore((s) => s.tasks);
  const activeTaskCount = countActiveTasks(tasks);
  const participant = useAuthStore((s) => s.participant);
  const logout = useAuthStore((s) => s.logout);
  const connected = usePresenceStore((s) => s.connected);
  const pendingFriends = useFriendStore((s) => s.pendingCount);
  // Same nav slot, label flips: "Friends" in Personal, "Members" in
  // a shared workspace. The friend-request badge is hidden in
  // workspace mode since friend connections are personal-graph only.
  const activeWorkspace = useActiveWorkspace();
  // With the workspaces flag off every user is in their Personal workspace,
  // so this stays false and the Friends rail slot never flips to "Members".
  const workspacesEnabled = useWorkspacesEnabled();
  const isWorkspaceMode =
    workspacesEnabled && activeWorkspace !== null && !activeWorkspace.isPersonal;
  // Friends is behind a per-user runtime flag (resolved on /me). The rail slot
  // still shows in workspace mode, where it's the "Members" view (org-scoped,
  // not the personal friend graph).
  const friendsEnabled = participant?.features?.friends === true;
  const showFriendsRail = friendsEnabled || isWorkspaceMode;

  // Agent online/total — "running" is the only fully-up state; "starting"
  // and "stalled" keep a process alive but it's not actually serving, so
  // we exclude them from the "online" count. Shown on the Agents rail
  // button as a muted "N/M" ratio; hidden when there are no agents.
  const agentsMap = useAgentStore((s) => s.agents);
  const presenceOnline = usePresenceStore((s) => s.online);
  const agentStats = useMemo(() => {
    const all = Object.values(agentsMap);
    // "Online" via the canonical `isAgentOnline` helper — the SAME rule the
    // Agents-tab header count and per-row dots use, so the rail's N/M can
    // never drift from the Agents tab (issue #64). Live WS presence (the
    // signal every client counts) OR a local subprocess in its pre-heartbeat
    // window; org-host agents are presence-only.
    const online = all.filter((m) => isAgentOnline(m, presenceOnline)).length;
    return { online, total: all.length };
  }, [agentsMap, presenceOnline]);

  // Theme quick-toggle. Cycles system → light → dark → system so the
  // rail matches web's three-state ThemeToggle.
  const themePreference = useThemeStore((s) => s.preference);
  const resolvedTheme = useThemeStore((s) => s.resolved);
  const setPreference = useThemeStore((s) => s.setPreference);
  const ThemeIcon =
    themePreference === "system" ? Monitor : themePreference === "dark" ? Moon : Sun;
  const cycleTheme = () => {
    if (themePreference === "system") setPreference("light");
    else if (themePreference === "light") setPreference("dark");
    else setPreference("system");
  };

  return (
    <nav
      className="flex flex-col w-14 shrink-0 rounded-xl bg-rail shadow-md py-3 items-center justify-between"
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Top: workspace tile + main nav */}
      <div
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className="flex flex-col gap-1 items-center"
      >
        {/* Workspaces gated off: render nothing in the tile slot — the
            static branding just clutters the rail. The interactive switcher
            (dropdown, create, settings gear, pending-invites banner) returns
            when the workspaces feature flag is enabled. */}
        {workspacesEnabled && (
          <>
            <WorkspaceSwitcher />
            <div className="my-1 h-px w-8 bg-rail-border" />
          </>
        )}

        <RailButton
          icon={MessageCircle}
          label={t("chats")}
          active={view === "chat"}
          onClick={() => onChange("chat")}
          badgeTier={unreadTier(totalUnread)}
          badgeTierLabel={tChat("newMessages")}
        />
        <RailButton
          icon={Zap}
          label={t("tasks")}
          active={view === "tasks"}
          onClick={() => onChange("tasks")}
          badge={activeTaskCount > 0 ? activeTaskCount : undefined}
          badgeColor="destructive"
        />
        {showFriendsRail && (
          <RailButton
            icon={Users}
            label={isWorkspaceMode ? t("members") : t("friends")}
            active={view === "friends"}
            onClick={() => onChange("friends")}
            badge={!isWorkspaceMode && pendingFriends > 0 ? pendingFriends : undefined}
          />
        )}
        <RailButton
          icon={Bot}
          label={
            agentStats.total > 0
              ? t("agentsOnline", {
                  online: agentStats.online,
                  total: agentStats.total,
                })
              : t("agents")
          }
          active={view === "agents"}
          onClick={() => onChange("agents")}
          textBadge={
            agentStats.total > 0 ? (
              <>
                <span>{agentStats.online}</span>
                <span className="opacity-50">/</span>
                <span>{agentStats.total}</span>
              </>
            ) : undefined
          }
        />
        <RailButton
          icon={FolderOpen}
          label={t("files")}
          active={view === "files"}
          onClick={() => onChange("files")}
        />
        {/* Self-hosting: run your agents on your own VM. Behind the
            org_hosts runtime flag (resolved per-user on /me) — the backend
            404s every host route when it's off, so the button hides
            entirely rather than opening a dead surface. */}
        {participant?.features?.org_hosts === true && (
          <RailButton
            icon={Server}
            label={t("hosts")}
            active={view === "hosts"}
            onClick={() => onChange("hosts")}
          />
        )}
        {/* Divider separating the everyone-buttons above from the admin-only
            buttons (Templates, Platform) below. */}
        {participant?.platformAdmin && (
          <div className="my-1 h-px w-8 bg-rail-border" />
        )}
        {participant?.platformAdmin && (
          <RailButton
            icon={LayoutTemplate}
            label={t("templates")}
            active={view === "templates"}
            onClick={() => onChange("templates")}
          />
        )}
        {participant?.platformAdmin && (
          <RailButton
            icon={Shapes}
            label={t("previews")}
            active={view === "previews"}
            onClick={() => onChange("previews")}
          />
        )}
        {participant?.platformAdmin && (
          <RailButton
            icon={ShieldHalf}
            label={t("platform")}
            active={view === "platform" || view === "fleet"}
            onClick={() => onChange("platform")}
          />
        )}
      </div>

      {/* Bottom: connectivity + utilities + profile + logout */}
      <div
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className="flex flex-col gap-1 items-center"
      >
        {/* Online/offline dot */}
        <div
          className={cn(
            "h-2 w-2 rounded-full my-1",
            connected ? "bg-success" : "bg-muted-foreground/50"
          )}
          title={connected ? t("common:connected") : t("common:disconnected")}
          aria-label={connected ? t("common:connected") : t("common:disconnected")}
        />

        <RailButton
          icon={ThemeIcon}
          label={t("settings:theme.railTooltip", {
            preference: t(`settings:theme.${themePreference}`),
            resolved: t(`settings:theme.${resolvedTheme}`),
          })}
          active={false}
          onClick={cycleTheme}
        />

        {/* Profile avatar */}
        <button
          type="button"
          onClick={onOpenProfile}
          title={t("settings:title")}
          className="flex items-center justify-center w-10 h-10 rounded-lg text-rail-foreground hover:bg-rail-hover hover:text-rail-accent-foreground transition-colors"
        >
          <Avatar className="h-7 w-7">
            {participant?.avatarUrl ? (
              <AvatarImage src={participant.avatarUrl} alt={participant.displayName} displaySize={28} />
            ) : null}
            <AvatarFallback>
              <User className="w-3.5 h-3.5" />
            </AvatarFallback>
          </Avatar>
        </button>

        {/* Logout */}
        <button
          type="button"
          onClick={logout}
          title={t("signOut")}
          aria-label={t("signOut")}
          className="flex items-center justify-center w-10 h-10 rounded-lg text-rail-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </nav>
  );
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
  badgeColor = "primary",
  badgeTier,
  badgeTierLabel,
  textBadge,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  badgeColor?: "primary" | "destructive";
  /** Issue #122: coarse unread indicator — a size-tiered dot instead of an
   *  exact digit. Takes priority over `badge` when set (Chats rail item only;
   *  task/friend-request badges stay exact counts, they're action-needed
   *  signals, not "there are new messages"). */
  badgeTier?: UnreadTier | null;
  /** Accessible label for `badgeTier`'s dot, since it renders no visible text. */
  badgeTierLabel?: string;
  /** Free-form badge content (e.g. coloured "3/10" for agent online count).
   *  Ignored when `badge` is set. Rendered as a small chip pinned to the
   *  bottom-center of the icon so vertical rhythm of the rail is preserved. */
  textBadge?: React.ReactNode;
}) {
  const badgeClass =
    badgeColor === "destructive"
      ? "bg-destructive text-destructive-foreground"
      : "bg-primary text-primary-foreground";
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "relative flex items-center justify-center w-10 h-10 rounded-lg transition-all",
        active
          ? "bg-rail-accent text-rail-accent-foreground shadow-sm"
          : "text-rail-foreground hover:bg-rail-hover hover:text-foreground"
      )}
    >
      <Icon className="w-5 h-5" />
      {badgeTier ? (
        <span
          aria-label={badgeTierLabel}
          className={cn(
            "absolute top-0.5 right-0.5 rounded-full bg-primary",
            badgeTier === "few" && "h-2 w-2",
            badgeTier === "some" && "h-2.5 w-2.5",
            badgeTier === "many" && "h-3 w-3"
          )}
        />
      ) : (
        badge !== undefined &&
        badge > 0 && (
          <span
            className={cn(
              "absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center",
              badgeClass
            )}
          >
            {badge > 99 ? "99+" : badge}
          </span>
        )
      )}
      {badge === undefined && !badgeTier && textBadge && (
        <span className="absolute bottom-0.5 left-1/2 -translate-x-1/2 px-1 text-[8px] font-semibold tabular-nums leading-none flex items-center justify-center h-3">
          {textBadge}
        </span>
      )}
    </button>
  );
}
