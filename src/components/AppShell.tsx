import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageCircle,
  Bot,
  User,
  Zap,
  FileText,
  LayoutDashboard,
  Server,
  Users,
  Sun,
  Moon,
  Monitor,
  LogOut,
} from "lucide-react";
import { cn } from "../lib/utils";
import { useWebSocket } from "../hooks/useWebSocket";
import { useChatStore } from "../stores/chatStore";
import { useAuthStore } from "../stores/authStore";
import { useAgentStore } from "../stores/agentStore";
import { useTaskStore, countActiveTasks } from "../stores/taskStore";
import { useNavStore } from "../stores/navStore";
import { usePresenceStore } from "../stores/presenceStore";
import { useThemeStore } from "../stores/themeStore";
import { useFriendStore } from "../stores/friendStore";
import { useActiveWorkspace } from "../stores/workspaceStore";
import { AgentBusyToast } from "./AgentBusyToast";
import { ReminderToast } from "./ReminderToast";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dashboard } from "./Dashboard";
import { MessagesView } from "./messages/MessagesView";
import { TasksView } from "./tasks/TasksView";
import { TemplatesView } from "./templates/TemplatesView";
import { CanvasView } from "./canvas/CanvasView";
import { Profile } from "./Profile";
import { FriendsView } from "./FriendsView";
import { FleetView } from "./FleetView";
import { WorkspaceSwitcher } from "./WorkspaceSwitcher";
import { WORKSPACES_ENABLED } from "../lib/featureFlags";

type View =
  | "chat"
  | "tasks"
  | "agents"
  | "friends"
  | "templates"
  | "canvas"
  | "fleet";

export function AppShell() {
  const view = useNavStore((s) => s.view);
  const setView = useNavStore((s) => s.setView);
  const [showProfile, setShowProfile] = useState(false);

  // Connect socket + wire store listeners once we have auth
  useWebSocket();

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
    (conversationId: string) => {
      setActiveConversation(conversationId);
      setView("chat");
    },
    [setActiveConversation]
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
          <FriendsView />
        ) : view === "templates" ? (
          <TemplatesView />
        ) : view === "canvas" ? (
          <CanvasView />
        ) : view === "fleet" ? (
          <FleetView />
        ) : (
          <Dashboard />
        )}
      </main>

      {/* Profile drawer — lifted to shell so it's reachable from any view */}
      <div
        className={cn(
          "fixed inset-0 bg-black/20 z-40 transition-opacity duration-200",
          showProfile ? "opacity-100" : "opacity-0 pointer-events-none"
        )}
        onClick={() => setShowProfile(false)}
      />
      <div
        className={cn(
          "fixed top-0 right-0 h-full w-[640px] max-w-[85vw] bg-card border-l border-border shadow-2xl z-50 overflow-hidden",
          "transition-transform duration-300 ease-out",
          showProfile ? "translate-x-0" : "translate-x-full"
        )}
      >
        {showProfile && <Profile onClose={() => setShowProfile(false)} />}
      </div>

      <AgentBusyToast />
      <ReminderToast />
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
  // Workspaces are gated off for now (see featureFlags). With the flag off
  // every user is in their Personal workspace, so this stays false and the
  // Friends rail slot never flips to "Members".
  const isWorkspaceMode =
    WORKSPACES_ENABLED && activeWorkspace !== null && !activeWorkspace.isPersonal;

  // Agent online/total — "running" is the only fully-up state; "starting"
  // and "stalled" keep a process alive but it's not actually serving, so
  // we exclude them from the "online" count. Shown on the Agents rail
  // button as a muted "N/M" ratio; hidden when there are no agents.
  const agentsMap = useAgentStore((s) => s.agents);
  const agentStats = useMemo(() => {
    const all = Object.values(agentsMap);
    const online = all.filter((m) => {
      // Local-runtime agents are "online" when the local subprocess is
      // running. Org-host agents have no local process — they're
      // online when the server-side presence says a bridge (on the VM)
      // is connected. Without this branch, every org-hosted agent
      // would silently undercount in the rail's N/M badge.
      if (m.agent.runtime === "org_host") {
        return m.agent.presence != null && m.agent.presence !== "offline";
      }
      return m.processStatus === "running";
    }).length;
    return { online, total: all.length };
  }, [agentsMap]);

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

  const handleLogout = () => {
    if (confirm("Sign out?")) logout();
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
        {/* Workspaces gated off: render static app branding in the tile
            slot instead of the interactive switcher (which owns the
            dropdown, create, settings gear, and pending-invites banner).
            Flip WORKSPACES_ENABLED to bring the switcher back. */}
        {WORKSPACES_ENABLED ? <WorkspaceSwitcher /> : <BrandingTile />}
        <div className="my-1 h-px w-8 bg-rail-border" />

        <RailButton
          icon={MessageCircle}
          label="Chat"
          active={view === "chat"}
          onClick={() => onChange("chat")}
          badge={totalUnread > 0 ? totalUnread : undefined}
        />
        <RailButton
          icon={Zap}
          label="Tasks"
          active={view === "tasks"}
          onClick={() => onChange("tasks")}
          badge={activeTaskCount > 0 ? activeTaskCount : undefined}
          badgeColor="destructive"
        />
        <RailButton
          icon={Users}
          label={isWorkspaceMode ? "Members" : "Friends"}
          active={view === "friends"}
          onClick={() => onChange("friends")}
          badge={!isWorkspaceMode && pendingFriends > 0 ? pendingFriends : undefined}
        />
        <RailButton
          icon={Bot}
          label={
            agentStats.total > 0
              ? `Agents (${agentStats.online}/${agentStats.total} online)`
              : "Agents"
          }
          active={view === "agents"}
          onClick={() => onChange("agents")}
          textBadge={
            agentStats.total > 0 ? (
              <>
                <span className="text-success">{agentStats.online}</span>
                <span className="opacity-50">/</span>
                <span>{agentStats.total}</span>
              </>
            ) : undefined
          }
        />
        <RailButton
          icon={FileText}
          label="Templates"
          active={view === "templates"}
          onClick={() => onChange("templates")}
        />
        <RailButton
          icon={LayoutDashboard}
          label="Canvas"
          active={view === "canvas"}
          onClick={() => onChange("canvas")}
        />
        <RailButton
          icon={Server}
          label="Fleet"
          active={view === "fleet"}
          onClick={() => onChange("fleet")}
        />
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
          title={connected ? "Connected" : "Disconnected"}
          aria-label={connected ? "Connected" : "Disconnected"}
        />

        <RailButton
          icon={ThemeIcon}
          label={`Theme: ${themePreference} (now ${resolvedTheme})`}
          active={false}
          onClick={cycleTheme}
        />

        {/* Profile avatar */}
        <button
          type="button"
          onClick={onOpenProfile}
          title="Profile & Settings"
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
          onClick={handleLogout}
          title="Sign out"
          aria-label="Sign out"
          className="flex items-center justify-center w-10 h-10 rounded-lg text-rail-foreground hover:bg-destructive/10 hover:text-destructive transition-colors"
        >
          <LogOut className="w-4 h-4" />
        </button>
      </div>
    </nav>
  );
}

/**
 * Static branding tile shown at the top of the rail while workspaces are
 * gated off — a non-interactive stand-in for the WorkspaceSwitcher so the
 * rail keeps its visual anchor without hinting at multiple workspaces.
 */
function BrandingTile() {
  return (
    <div
      className="flex h-9 w-9 items-center justify-center rounded-md bg-primary"
      title="Agentgram"
    >
      <Bot className="h-5 w-5 text-primary-foreground" />
    </div>
  );
}

function RailButton({
  icon: Icon,
  label,
  active,
  onClick,
  badge,
  badgeColor = "primary",
  textBadge,
}: {
  icon: React.ElementType;
  label: string;
  active: boolean;
  onClick: () => void;
  badge?: number;
  badgeColor?: "primary" | "destructive";
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
          : "text-rail-foreground hover:bg-rail-hover hover:text-rail-accent-foreground"
      )}
    >
      <Icon className="w-5 h-5" />
      {badge !== undefined && badge > 0 && (
        <span
          className={cn(
            "absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center",
            badgeClass
          )}
        >
          {badge > 99 ? "99+" : badge}
        </span>
      )}
      {badge === undefined && textBadge && (
        <span
          className={cn(
            "absolute bottom-0.5 left-1/2 -translate-x-1/2 px-1 rounded-full text-[8px] font-semibold tabular-nums leading-none flex items-center justify-center h-3 bg-rail-accent ring-1 ring-rail-border",
            active ? "text-rail-accent-foreground" : "text-rail-foreground"
          )}
        >
          {textBadge}
        </span>
      )}
    </button>
  );
}
