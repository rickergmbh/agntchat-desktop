import { useCallback, useEffect, useMemo, useState } from "react";
import {
  MessageCircle,
  Bot,
  User,
  ListTodo,
  LayoutTemplate,
  Server,
  Shapes,
  FolderOpen,
  ShieldHalf,
  Users,
  Sun,
  Moon,
  Monitor,
  PanelLeftClose,
  PanelLeftOpen,
  AlertTriangle,
} from "lucide-react";
import { useTranslation } from "react-i18next";
import { cn, unreadTier, type UnreadTier } from "../lib/utils";
import { useWebSocket } from "../hooks/useWebSocket";
import { useWorkspaceHotkeys } from "../hooks/useWorkspaceHotkeys";
import { useRailHotkey } from "../hooks/useRailHotkey";
import { useChatStore } from "../stores/chatStore";
import { useAuthStore } from "../stores/authStore";
import { useAgentStore } from "../stores/agentStore";
import { useTaskStore, countActiveTasks } from "../stores/taskStore";
import { useNavStore } from "../stores/navStore";
import { useRailStore, useRailExpanded } from "../stores/railStore";
import { trackScreen } from "../lib/analytics";
import { usePresenceStore } from "../stores/presenceStore";
import { isAgentOnline } from "../lib/agentOnline";
import { hasKeyProblem } from "../lib/agentKeyProblem";
import { useThemeStore } from "../stores/themeStore";
import { useFriendStore } from "../stores/friendStore";
import {
  useActiveWorkspace,
  useWorkspaceMembers,
  useWorkspacesEnabled,
  useWorkspaceStore,
} from "../stores/workspaceStore";
import { AgentBusyToast } from "./AgentBusyToast";
import { ReminderToast } from "./ReminderToast";
import { MemorySavedToast } from "./MemorySavedToast";
import { PermissionToast } from "./PermissionToast";
import { CredentialPrompt } from "./CredentialPrompt";
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

  // Cmd/Ctrl+B expands/collapses the left rail.
  useRailHotkey();

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
      <MemorySavedToast />
      <PermissionToast />
      <CredentialPrompt />
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

  // Icon-only (w-14) vs labelled (w-56). Persisted in railStore; also
  // toggled by Cmd/Ctrl+B. Every rail child reads the flag from the store
  // itself rather than taking it as a prop.
  const expanded = useRailExpanded();
  const toggleRail = useRailStore((s) => s.toggle);

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

  // Agents whose stored API key was rejected (or never made it to this
  // computer). They can't be restarted — only a fresh key fixes them — so the
  // rail carries a warning marker, letting the user see something is wrong
  // from any view instead of only after opening the Agents tab.
  const keyProblemCount = useMemo(
    () => Object.values(agentsMap).filter(hasKeyProblem).length,
    [agentsMap]
  );

  // Crash kind lives in the local Rust ProcessManager, and Dashboard's poll
  // for it dies with the Agents view. The rail outlives every view, so it
  // keeps its own beat — `get_all_statuses` is a local Tauri invoke with no
  // backend cost, unlike the health fetch Dashboard bundles it with.
  const refreshProcessStatuses = useAgentStore((s) => s.refreshProcessStatuses);
  useEffect(() => {
    const id = setInterval(() => void refreshProcessStatuses(), 60000);
    return () => clearInterval(id);
  }, [refreshProcessStatuses]);

  // Same N/M treatment under the Members button in a shared workspace.
  // The rail loads the roster itself — the chip has to read right from
  // every view, not just once MembersView has mounted — and MembersView
  // renders the same store entry, so the two can't disagree.
  const fetchMembers = useWorkspaceStore((s) => s.fetchMembers);
  const workspaceMembers = useWorkspaceMembers(activeWorkspace?.id);
  useEffect(() => {
    if (!isWorkspaceMode || !activeWorkspace) return;
    fetchMembers(activeWorkspace.id).catch(() => {});
  }, [isWorkspaceMode, activeWorkspace?.id, fetchMembers]);
  const memberStats = useMemo(() => {
    const all = workspaceMembers ?? [];
    return {
      online: all.filter((m) => presenceOnline.has(m.participantId)).length,
      total: all.length,
    };
  }, [workspaceMembers, presenceOnline]);

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

  const connectionLabel = connected ? t("common:connected") : t("common:disconnected");

  return (
    <nav
      className={cn(
        "flex flex-col shrink-0 rounded-xl bg-rail shadow-md py-3 justify-between",
        // Only the width animates. Labels are mounted/unmounted rather than
        // faded so a mid-animation frame never shows text clipped against
        // the rail edge.
        "transition-[width] duration-200 ease-out",
        expanded ? "w-56 px-2 items-stretch" : "w-14 items-center"
      )}
      style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      {/* Top: workspace tile + main nav */}
      <div
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className={cn(
          "flex flex-col gap-1 min-w-0",
          expanded ? "items-stretch" : "items-center"
        )}
      >
        {/* Workspaces gated off: render nothing in the tile slot — the
            static branding just clutters the rail. The interactive switcher
            (dropdown, create, settings gear, pending-invites banner) returns
            when the workspaces feature flag is enabled. */}
        {workspacesEnabled && (
          <>
            <WorkspaceSwitcher expanded={expanded} />
            <RailDivider />
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
          icon={ListTodo}
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
            // Like Agents: the expanded row shows the plain label with the
            // N/M chip beside it, so the online count lives in the tooltip.
            tooltip={
              isWorkspaceMode && memberStats.total > 0
                ? t("membersOnline", {
                    online: memberStats.online,
                    total: memberStats.total,
                  })
                : undefined
            }
            active={view === "friends"}
            onClick={() => onChange("friends")}
            badge={!isWorkspaceMode && pendingFriends > 0 ? pendingFriends : undefined}
            textBadge={
              isWorkspaceMode && memberStats.total > 0 ? (
                <>
                  <span>{memberStats.online}</span>
                  <span className="opacity-50">/</span>
                  <span>{memberStats.total}</span>
                </>
              ) : undefined
            }
          />
        )}
        <RailButton
          icon={Bot}
          label={t("agents")}
          // Expanded shows the plain "Agents" label with the N/M chip beside
          // it, so the online count lives in the tooltip only — spelling it
          // out twice in one row reads as a glitch. A key problem outranks
          // the ratio there: it's the one state the user has to act on, and
          // the ratio is already on screen as the chip.
          tooltip={
            keyProblemCount > 0
              ? t("agentsKeyProblem", { count: keyProblemCount })
              : agentStats.total > 0
                ? t("agentsOnline", {
                    online: agentStats.online,
                    total: agentStats.total,
                  })
                : undefined
          }
          alert={keyProblemCount > 0}
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
        {participant?.platformAdmin && <RailDivider />}
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

      {/* Bottom: connectivity + utilities + profile */}
      <div
        style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
        className={cn(
          "flex flex-col gap-1 min-w-0",
          expanded ? "items-stretch" : "items-center"
        )}
      >
        {/* Online/offline dot. Expanded it gets the word next to it —
            the dot alone is only legible once you know the code. */}
        <div
          className={cn(
            "flex items-center",
            // Same px-2.5/gap-3 rhythm as the rail rows, with the dot centred
            // in a 20px icon slot, so the label lines up with theirs.
            expanded ? "gap-3 px-2.5 py-1.5" : "justify-center"
          )}
          title={connectionLabel}
          aria-label={connectionLabel}
        >
          <span
            className={cn(
              "flex shrink-0 items-center justify-center",
              expanded ? "h-5 w-5" : "my-1"
            )}
          >
            <span
              className={cn(
                "h-2 w-2 rounded-full",
                connected ? "bg-success" : "bg-muted-foreground/50"
              )}
            />
          </span>
          {expanded && (
            <span className="truncate text-xs text-rail-foreground">
              {connectionLabel}
            </span>
          )}
        </div>

        <RailButton
          icon={ThemeIcon}
          label={t("settings:theme.label")}
          tooltip={t("settings:theme.railTooltip", {
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
          aria-label={t("settings:title")}
          className={cn(
            "flex h-10 items-center rounded-lg text-rail-foreground hover:bg-rail-hover hover:text-foreground transition-colors",
            expanded ? "w-full gap-3 px-2.5" : "w-10 justify-center"
          )}
        >
          {/* Expanded, the avatar drops to the rail's 20px icon slot so the
              name starts on the same x as every other row's label. Collapsed
              there is nothing to align to, so it keeps its fuller size. */}
          <Avatar className={cn("shrink-0", expanded ? "h-5 w-5" : "h-7 w-7")}>
            {participant?.avatarUrl ? (
              <AvatarImage
                src={participant.avatarUrl}
                alt={participant.displayName}
                displaySize={expanded ? 20 : 28}
              />
            ) : null}
            <AvatarFallback>
              <User className={expanded ? "w-3 h-3" : "w-3.5 h-3.5"} />
            </AvatarFallback>
          </Avatar>
          {expanded && (
            // The user's own name, not UI copy — never translated.
            <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
              {participant?.displayName ?? t("settings:title")}
            </span>
          )}
        </button>

        <RailDivider />

        {/* Expand / collapse. Last item in the rail so it reads as chrome
            for the rail itself rather than one more destination. */}
        <RailButton
          icon={expanded ? PanelLeftClose : PanelLeftOpen}
          label={expanded ? t("collapseSidebar") : t("expandSidebar")}
          active={false}
          onClick={toggleRail}
        />
      </div>
    </nav>
  );
}

/** Hairline between rail groups — full-bleed when expanded, a short
 *  centred tick when the rail is icon-only. */
function RailDivider() {
  const expanded = useRailExpanded();
  return (
    <div
      className={cn("my-1 h-px shrink-0 bg-rail-border", expanded ? "w-full" : "w-8 self-center")}
    />
  );
}

function RailButton({
  icon: Icon,
  label,
  tooltip,
  active,
  onClick,
  badge,
  badgeColor = "primary",
  badgeTier,
  badgeTierLabel,
  textBadge,
  alert,
}: {
  icon: React.ElementType;
  /** Visible text when the rail is expanded; also the default tooltip. */
  label: string;
  /** Overrides the tooltip/aria-label when it should say more than the
   *  visible label does (e.g. the Agents button's online count). */
  tooltip?: string;
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
   *  Ignored when `badge` is set. Collapsed it's a small chip pinned to the
   *  bottom-centre of the icon so the rail's vertical rhythm is preserved;
   *  expanded it sits at the end of the row. */
  textBadge?: React.ReactNode;
  /** Something behind this button needs the user's attention (e.g. an agent
   *  whose API key was rejected). Renders a warning triangle over the icon,
   *  independent of `badge`/`textBadge` so a count and a warning can coexist.
   *  `tooltip` carries the words — the triangle is never the only signal. */
  alert?: boolean;
}) {
  const expanded = useRailExpanded();
  const badgeClass =
    badgeColor === "destructive"
      ? "bg-destructive text-destructive-foreground"
      : "bg-primary text-primary-foreground";
  const showBadge = badge !== undefined && badge > 0 && !badgeTier;
  const showTextBadge = badge === undefined && !badgeTier && textBadge;
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip ?? label}
      aria-label={tooltip ?? label}
      aria-pressed={active}
      className={cn(
        "relative flex h-10 items-center rounded-lg transition-all",
        expanded ? "w-full gap-3 px-2.5" : "w-10 justify-center",
        active
          ? "bg-rail-accent text-rail-accent-foreground shadow-sm"
          : "text-rail-foreground hover:bg-rail-hover hover:text-foreground"
      )}
    >
      <Icon className="w-5 h-5 shrink-0" />
      {expanded && (
        <span className="min-w-0 flex-1 truncate text-left text-sm font-medium">
          {label}
        </span>
      )}
      {badgeTier ? (
        <span
          aria-label={badgeTierLabel}
          className={cn(
            "rounded-full",
            // On the active row `bg-primary` is primary-on-primary and
            // vanishes — fall back to the row's own foreground.
            active ? "bg-rail-accent-foreground" : "bg-primary",
            expanded ? "shrink-0" : "absolute top-0.5 right-0.5",
            badgeTier === "few" && "h-2 w-2",
            badgeTier === "some" && "h-2.5 w-2.5",
            badgeTier === "many" && "h-3 w-3"
          )}
        />
      ) : (
        showBadge && (
          <span
            className={cn(
              "min-w-[16px] h-4 px-1 rounded-full text-[9px] font-semibold flex items-center justify-center",
              expanded ? "shrink-0" : "absolute top-0.5 right-0.5",
              badgeClass
            )}
          >
            {badge! > 99 ? "99+" : badge}
          </span>
        )
      )}
      {showTextBadge && (
        <span
          className={cn(
            "font-semibold tabular-nums leading-none flex items-center justify-center",
            expanded
              ? "shrink-0 text-[11px] opacity-80"
              : "absolute bottom-0.5 left-1/2 -translate-x-1/2 px-1 text-[8px] h-3"
          )}
        >
          {textBadge}
        </span>
      )}
      {/* Last child so the expanded row reads icon · label · count · warning.
          Collapsed it's absolute, so DOM order doesn't matter — it sits in
          the icon's top-right corner, the slot `badge` would use (the Agents
          button passes a textBadge, which lives bottom-centre, so the two
          never collide). */}
      {alert && (
        <AlertTriangle
          aria-hidden
          className={cn(
            // Solid fill with the glyph knocked out — at 12px lucide's outline
            // triangle is a smudge. `destructive` (not `warning`) because the
            // rail sits on white in light theme, where amber all but
            // disappears; it also matches the crash banner this leads to.
            "h-3 w-3 shrink-0 fill-destructive text-destructive-foreground",
            expanded ? "ml-1" : "absolute top-0.5 right-0.5"
          )}
        />
      )}
    </button>
  );
}
