import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useChatStore } from "../../stores/chatStore";
import { usePresenceStore } from "../../stores/presenceStore";
import { useAgentStore } from "../../stores/agentStore";
// useAgentStore is needed for the "add member" picker which lists this user's
// own agents.
import { useMemoryStore } from "../../stores/memoryStore";
import { uploadAvatar } from "../../lib/imageProcessor";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { AgentActivityIndicator } from "../AgentActivityIndicator";
import {
  X,
  Bot,
  UserMinus,
  UserPlus,
  Pencil,
  Check,
  Crown,
  Trash2,
  LogOut,
  Eraser,
  Brain,
  FileText,
  Info,
  CheckSquare,
  HelpCircle,
  Users,
  ChevronDown,
  ChevronRight,
  Loader2,
  Camera,
} from "lucide-react";
import { GroupAvatar } from "./GroupAvatar";
import { cn, getInitials } from "../../lib/utils";
import type {
  Conversation,
  ConversationMember,
  ConversationMemory,
  ParticipantContextEntry,
} from "../../lib/api";

interface Props {
  conversation: Conversation;
  currentUserId?: string;
  onClose: () => void;
  onAfterLeave?: () => void;
}

export function ConversationDetailsPanel({
  conversation,
  currentUserId,
  onClose,
  onAfterLeave,
}: Props) {
  const { t } = useTranslation("chat");
  const online = usePresenceStore((s) => s.online);
  const updateTitle = useChatStore((s) => s.updateConversationTitle);
  const updateAvatar = useChatStore((s) => s.updateConversationAvatar);
  const addMember = useChatStore((s) => s.addMember);
  const removeMember = useChatStore((s) => s.removeMember);
  const deleteConversation = useChatStore((s) => s.deleteConversation);
  const leaveConversation = useChatStore((s) => s.leaveConversation);
  const clearChatLocal = useChatStore((s) => s.clearChatLocal);

  // Avatar upload — same /api/storage/presign flow the Profile page uses.
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [avatarError, setAvatarError] = useState<string | null>(null);

  const handleAvatarFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      setAvatarError(null);
      setUploadingAvatar(true);
      try {
        // Desktop's group-photo path doesn't have a crop UI like agent
        // avatars do — but uploadAvatar handles policy fetch + the PUT, and
        // the canvas-based square crop lives one layer deeper if we ever
        // add a cropper here. Until then, the raw file resizes via the
        // imageProcessor pipeline before upload.
        const newUrl = await uploadAvatar(file as Blob, `conversations/${conversation.id}`);
        await updateAvatar(conversation.id, newUrl);
      } catch (err) {
        setAvatarError(
          err instanceof Error ? err.message : t("details.uploadPhotoFailed")
        );
      } finally {
        setUploadingAvatar(false);
      }
    },
    [conversation.id, updateAvatar, t]
  );

  const handleAvatarRemove = useCallback(async () => {
    setAvatarError(null);
    try {
      await updateAvatar(conversation.id, null);
    } catch (err) {
      setAvatarError(
        err instanceof Error ? err.message : t("details.removePhotoFailed")
      );
    }
  }, [conversation.id, updateAvatar, t]);

  // Conversation memory — the summary agents see on entry + the periodic
  // MemoryAutoSummaryWorker output. Fetched on open; WS `memory_updated`
  // keeps it live afterwards (wired in memoryStore.initWsListeners).
  const memoryEntry = useMemoryStore((s) => s.memories[conversation.id]);
  const memoryLoading = useMemoryStore(
    (s) => s.loading[conversation.id] ?? false
  );
  const fetchMemory = useMemoryStore((s) => s.fetchMemory);
  useEffect(() => {
    if (!memoryEntry) fetchMemory(conversation.id);
  }, [conversation.id, memoryEntry, fetchMemory]);

  // Desktop's agent store is a Record<id, ManagedAgent>. Memoize the
  // flattened list so the selector returns a stable reference until the
  // record itself changes — avoids the Zustand `?? []` re-render trap.
  // Used by the "add member" picker below.
  const agentsMap = useAgentStore((s) => s.agents);
  const agents = useMemo(
    () => Object.values(agentsMap).map((m) => m.agent),
    [agentsMap]
  );
  const presenceFor = (id: string): "online_local" | "offline" =>
    online.has(id) ? "online_local" : "offline";

  const isAdmin = conversation.createdBy === currentUserId;
  const rawMembers = conversation.members ?? [];

  // Stable, predictable member order, matched across web/desktop/mobile:
  //   self → online humans → online agents → offline humans → offline agents
  // Alphabetical by displayName within each tier. Keeps offline members
  // from hogging the top of long lists.
  const members = useMemo(() => {
    const score = (m: ConversationMember): number => {
      if (m.participantId === currentUserId) return 0;
      const isOnline = online.has(m.participantId);
      const isAgent = m.participant?.type === "agent";
      // 1-2: online (human=1, agent=2); 3-4: offline (human=3, agent=4)
      return (isOnline ? 0 : 2) + (isAgent ? 2 : 1);
    };
    return [...rawMembers].sort((a, b) => {
      const sa = score(a);
      const sb = score(b);
      if (sa !== sb) return sa - sb;
      const na = a.participant?.displayName ?? "";
      const nb = b.participant?.displayName ?? "";
      return na.localeCompare(nb);
    });
  }, [rawMembers, currentUserId, online]);

  const [editing, setEditing] = useState(false);
  const [titleDraft, setTitleDraft] = useState(conversation.title ?? "");
  const [showAddMembers, setShowAddMembers] = useState(false);
  const [addingIds, setAddingIds] = useState<Set<string>>(new Set());
  const [actionError, setActionError] = useState<string | null>(null);
  const [danger, setDanger] = useState<"leave" | "delete" | null>(null);

  const handleRename = useCallback(async () => {
    const trimmed = titleDraft.trim();
    if (!trimmed || trimmed === conversation.title) {
      setEditing(false);
      return;
    }
    try {
      await updateTitle(conversation.id, trimmed);
      setEditing(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("details.renameFailed"));
    }
  }, [titleDraft, conversation.id, conversation.title, updateTitle, t]);

  const handleRemove = useCallback(
    async (participantId: string, name: string) => {
      if (!confirm(t("details.removeMemberConfirm", { name }))) return;
      try {
        await removeMember(conversation.id, participantId);
      } catch (e) {
        setActionError(e instanceof Error ? e.message : t("details.removeFailed"));
      }
    },
    [conversation.id, removeMember, t]
  );

  const handleAddSelected = useCallback(async () => {
    setActionError(null);
    try {
      for (const id of addingIds) {
        await addMember(conversation.id, id);
      }
      setAddingIds(new Set());
      setShowAddMembers(false);
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("details.addFailed"));
    }
  }, [addingIds, conversation.id, addMember, t]);

  const toggleAddId = useCallback((id: string) => {
    setAddingIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const handleDangerConfirm = useCallback(async () => {
    if (!danger) return;
    setActionError(null);
    try {
      if (danger === "delete") {
        await deleteConversation(conversation.id);
      } else if (danger === "leave" && currentUserId) {
        await leaveConversation(conversation.id, currentUserId);
      }
      setDanger(null);
      onAfterLeave?.();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : t("details.actionFailed"));
    }
  }, [
    danger,
    conversation.id,
    currentUserId,
    deleteConversation,
    leaveConversation,
    onAfterLeave,
    t,
  ]);

  const memberIds = new Set(members.map((m) => m.participantId));
  const availableAgents = agents.filter(
    (a) => a.status === "active" && !memberIds.has(a.id)
  );

  return (
    <aside className="surface-panel-strong relative z-20 -ml-3 flex h-full w-80 shrink-0 flex-col overflow-hidden rounded-l-lg bg-card">
      {/* Header — h-14 to line up with the sidebar's Messages header and the
          conversation header across the three vertical columns. */}
      <div className="relative flex h-14 items-center justify-between px-4 shrink-0 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-border">
        <h3 className="text-sm font-semibold">{t("details.title")}</h3>
        <button
          onClick={onClose}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          aria-label={t("details.close")}
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* Avatar block — group / channel only; admins can change or
            remove the custom photo. Falls back to GroupAvatar when there
            isn't one set. Matches web + mobile treatments. */}
        {conversation.type !== "direct" && (
          <AvatarBlock
            conversation={conversation}
            otherMembers={members.filter(
              (m) => m.participantId !== currentUserId
            )}
            canEdit={isAdmin}
            uploading={uploadingAvatar}
            avatarError={avatarError}
            avatarInputRef={avatarInputRef}
            onFile={handleAvatarFile}
            onRemove={handleAvatarRemove}
          />
        )}

        {/* Title section — a DM has no title of its own (it's just the two
            participants), so the editable title/rename block is group- and
            channel-only. DMs show just the type + member count below. */}
        <div className="relative px-4 py-4 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-border">
          {conversation.type !== "direct" &&
            (editing ? (
              <div className="flex items-center gap-2">
                <input
                  autoFocus
                  className="flex-1 rounded border border-input bg-background px-2 py-1 text-sm outline-none focus:ring-2 focus:ring-ring"
                  value={titleDraft}
                  onChange={(e) => setTitleDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleRename();
                    if (e.key === "Escape") setEditing(false);
                  }}
                />
                <button
                  onClick={handleRename}
                  className="rounded p-1 text-primary hover:bg-muted"
                  title={t("common:save")}
                >
                  <Check className="h-4 w-4" />
                </button>
              </div>
            ) : (
              <div className="flex items-center gap-2">
                <h2 className="flex-1 truncate text-base font-semibold">
                  {conversation.title || t("untitledConversation")}
                </h2>
                {isAdmin && (
                  <button
                    onClick={() => {
                      setTitleDraft(conversation.title ?? "");
                      setEditing(true);
                    }}
                    className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    title={t("common:rename")}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
            ))}
          <p className="mt-1 text-xs text-muted-foreground">
            {t(`type.${conversation.type}`, { defaultValue: conversation.type })} ·{" "}
            {t("members", { count: members.length })}
          </p>
        </div>

        {/* Members — capped to ~5 rows so a long roster doesn't push Memory
            and the danger-zone buttons off-screen. Scrolls internally when
            overflowing. */}
        <div className="px-4 py-3">
          <h4 className="mb-2 text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
            {t("nav:members")}
          </h4>
          <ul className="max-h-60 overflow-y-auto space-y-0.5 pr-1">
            {members.map((m) => (
              <MemberRow
                key={m.participantId}
                member={m}
                presence={presenceFor(m.participantId)}
                isSelf={m.participantId === currentUserId}
                isAdmin={isAdmin}
                isConversationCreator={m.participantId === conversation.createdBy}
                onRemove={() =>
                  handleRemove(
                    m.participantId,
                    m.participant?.displayName ?? t("details.thisMember")
                  )
                }
              />
            ))}
          </ul>

          {isAdmin && (
            <div className="mt-2">
              {!showAddMembers ? (
                <button
                  onClick={() => setShowAddMembers(true)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <UserPlus className="h-4 w-4" />
                  {t("details.addMembers")}
                </button>
              ) : (
                <div className="rounded-lg border border-border p-2">
                  <p className="mb-2 text-[11px] font-medium text-muted-foreground">
                    {t("details.selectAgentsToAdd")}
                  </p>
                  {availableAgents.length === 0 ? (
                    <p className="text-xs text-muted-foreground px-1 py-0.5">
                      {t("noAgentsAvailable")}
                    </p>
                  ) : (
                    <ul className="max-h-48 space-y-0.5 overflow-y-auto">
                      {availableAgents.map((agent) => (
                        <li key={agent.id}>
                          <label className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                            <input
                              type="checkbox"
                              checked={addingIds.has(agent.id)}
                              onChange={() => toggleAddId(agent.id)}
                            />
                            <Avatar className="h-6 w-6">
                              {agent.avatarUrl && <AvatarImage src={agent.avatarUrl} />}
                              <AvatarFallback className="bg-primary/10 text-primary">
                                <Bot className="h-3 w-3" />
                              </AvatarFallback>
                            </Avatar>
                            <span className="truncate text-sm">{agent.displayName}</span>
                          </label>
                        </li>
                      ))}
                    </ul>
                  )}
                  <div className="mt-2 flex justify-end gap-2">
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setShowAddMembers(false);
                        setAddingIds(new Set());
                      }}
                    >
                      {t("common:cancel")}
                    </Button>
                    {addingIds.size > 0 && (
                      <Button size="sm" onClick={handleAddSelected}>
                        {t("details.addCount", { count: addingIds.size })}
                      </Button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Memory — same summary agents see on entry; auto-refreshed by the
            MemoryAutoSummaryWorker on the backend. */}
        <MemorySection
          entry={memoryEntry}
          loading={memoryLoading}
        />

        {/* Clear chat — local-only (server history stays) */}
        <div className="relative px-4 py-3 before:absolute before:top-0 before:left-4 before:right-4 before:h-px before:bg-border">
          <button
            onClick={() => {
              if (confirm(t("menu.clearChatConfirm"))) {
                clearChatLocal(conversation.id);
              }
            }}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Eraser className="h-4 w-4" />
            {t("menu.clearChatLocal")}
          </button>
        </div>

        {/* Danger zone */}
        <div className="relative px-4 py-3 before:absolute before:top-0 before:left-4 before:right-4 before:h-px before:bg-border">
          {danger ? (
            <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3">
              <p className="text-sm font-medium">
                {danger === "delete"
                  ? t("details.deleteConfirmTitle")
                  : t("details.leaveConfirmTitle")}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {danger === "delete"
                  ? t("details.deleteConfirmBody")
                  : t("details.leaveConfirmBody")}
              </p>
              <div className="mt-2 flex justify-end gap-2">
                <Button size="sm" variant="ghost" onClick={() => setDanger(null)}>
                  {t("common:cancel")}
                </Button>
                <Button
                  size="sm"
                  variant="destructive"
                  onClick={handleDangerConfirm}
                >
                  {danger === "delete" ? t("common:delete") : t("details.leave")}
                </Button>
              </div>
            </div>
          ) : isAdmin ? (
            <button
              onClick={() => setDanger("delete")}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
            >
              <Trash2 className="h-4 w-4" />
              {t("menu.deleteConversation")}
            </button>
          ) : (
            <button
              onClick={() => setDanger("leave")}
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-destructive hover:bg-destructive/10"
            >
              <LogOut className="h-4 w-4" />
              {t("menu.leaveConversation")}
            </button>
          )}
        </div>

        {actionError && (
          <p className="px-4 pb-3 text-[11px] text-destructive">{actionError}</p>
        )}
      </div>
    </aside>
  );
}

function MemberRow({
  member,
  presence,
  isSelf,
  isAdmin,
  isConversationCreator,
  onRemove,
}: {
  member: ConversationMember;
  presence: "online_local" | "offline";
  isSelf: boolean;
  isAdmin: boolean;
  isConversationCreator: boolean;
  onRemove: () => void;
}) {
  const { t } = useTranslation("chat");
  const p = member.participant;
  const name = p?.displayName ?? t("common:unknown");
  const isAgent = p?.type === "agent";
  const isOnline = presence !== "offline";
  // Live activity (thinking / working / writing) read reactively per row so
  // the members list reflects what an agent is doing right now, even when
  // that work is happening in a different conversation.
  const activity = usePresenceStore((s) =>
    isAgent ? s.agentActivity[member.participantId] : undefined
  );

  return (
    <li className="group flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/50">
      <div className="relative shrink-0">
        <Avatar className="h-8 w-8">
          {p?.avatarUrl && <AvatarImage src={p.avatarUrl} alt={name} />}
          <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
            {isAgent ? <Bot className="h-3.5 w-3.5" /> : getInitials(name)}
          </AvatarFallback>
        </Avatar>
        <span
          className={cn(
            "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-card",
            activity
              ? "bg-primary animate-pulse"
              : isOnline
              ? "bg-success"
              : "bg-muted-foreground/40"
          )}
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="truncate text-sm font-medium">{name}</span>
          {isSelf && <span className="text-[10px] text-muted-foreground">({t("common:you")})</span>}
          {isConversationCreator && (
            <Crown className="h-3 w-3 text-warning shrink-0" />
          )}
        </div>
        {activity ? (
          <AgentActivityIndicator activity={activity} />
        ) : (
          <p className="text-[11px] text-muted-foreground">
            {isAgent ? t("common:agent") : t("common:human")} ·{" "}
            {isOnline ? t("common:online") : t("common:offline")}
          </p>
        )}
      </div>

      {isAdmin && !isSelf && (
        <button
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground opacity-0 hover:bg-destructive/10 hover:text-destructive/90 group-hover:opacity-100 transition-opacity"
          title={t("details.removeMember")}
        >
          <UserMinus className="h-3.5 w-3.5" />
        </button>
      )}
    </li>
  );
}

function MemorySection({
  entry,
  loading,
}: {
  entry: { memory: ConversationMemory; version: number } | undefined;
  loading: boolean;
}) {
  const { t } = useTranslation("memory");
  const memory = entry?.memory;
  const hasAnything =
    !!memory &&
    (!!memory.summary ||
      !!memory.currentState ||
      (memory.keyDecisions?.length ?? 0) > 0 ||
      (memory.openQuestions?.length ?? 0) > 0 ||
      (memory.completedWork?.length ?? 0) > 0 ||
      Object.keys(memory.participantsContext ?? {}).length > 0);

  return (
    <div className="relative before:absolute before:top-0 before:left-4 before:right-4 before:h-px before:bg-border">
      <div className="flex items-center gap-2 px-4 pt-3 pb-2">
        <Brain className="h-3.5 w-3.5 text-primary" />
        <h4 className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {t("title")}
        </h4>
      </div>

      {loading && !memory ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        </div>
      ) : !hasAnything ? (
        <p className="px-4 pb-4 text-xs text-muted-foreground">
          {t("empty")}
        </p>
      ) : (
        <div>
          {memory!.summary && (
            <MemorySubsection title={t("sections.summary")} icon={FileText} defaultOpen>
              <p className="leading-relaxed">{memory!.summary}</p>
            </MemorySubsection>
          )}
          {memory!.currentState && (
            <MemorySubsection title={t("sections.currentState")} icon={Info}>
              <p className="leading-relaxed">{memory!.currentState}</p>
            </MemorySubsection>
          )}
          {memory!.keyDecisions && memory!.keyDecisions.length > 0 && (
            <MemorySubsection
              title={t("sections.keyDecisions")}
              icon={CheckSquare}
              count={memory!.keyDecisions.length}
            >
              <ul className="space-y-2">
                {memory!.keyDecisions.map((d, i) => (
                  <li key={i}>
                    <p className="font-medium text-foreground">{d.decision}</p>
                    {d.context && (
                      <p className="mt-0.5 text-muted-foreground">{d.context}</p>
                    )}
                  </li>
                ))}
              </ul>
            </MemorySubsection>
          )}
          {memory!.openQuestions && memory!.openQuestions.length > 0 && (
            <MemorySubsection
              title={t("sections.openQuestions")}
              icon={HelpCircle}
              count={memory!.openQuestions.length}
            >
              <ul className="list-disc space-y-1 pl-4">
                {memory!.openQuestions.map((q, i) => (
                  <li key={i}>{q}</li>
                ))}
              </ul>
            </MemorySubsection>
          )}
          {memory!.completedWork && memory!.completedWork.length > 0 && (
            <MemorySubsection
              title={t("sections.completedWork")}
              icon={CheckSquare}
              count={memory!.completedWork.length}
            >
              <ul className="list-disc space-y-1 pl-4">
                {memory!.completedWork.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </MemorySubsection>
          )}
          {memory!.participantsContext &&
            Object.keys(memory!.participantsContext).length > 0 && (
              <MemorySubsection
                title={t("sections.participants")}
                icon={Users}
                count={Object.keys(memory!.participantsContext).length}
              >
                <dl className="space-y-3">
                  {Object.entries(memory!.participantsContext).map(
                    ([id, entry]) => (
                      <ParticipantContextRow
                        key={id}
                        participantId={id}
                        entry={entry}
                      />
                    )
                  )}
                </dl>
              </MemorySubsection>
            )}
          {memory!.updatedAt && (
            <p className="px-4 py-2 text-[10px] text-muted-foreground">
              {t("updatedAt", { date: new Date(memory!.updatedAt).toLocaleString() })}
            </p>
          )}
        </div>
      )}
    </div>
  );
}

function MemorySubsection({
  title,
  icon: Icon,
  count,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: typeof Brain;
  count?: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="relative before:absolute before:top-0 before:left-4 before:right-4 before:h-px before:bg-border/50">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-2 text-left hover:bg-accent/50"
      >
        <Icon className="h-3.5 w-3.5 text-muted-foreground" />
        <span className="flex-1 text-xs font-medium">{title}</span>
        {count !== undefined && (
          <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
            {count}
          </span>
        )}
        {open ? (
          <ChevronDown className="h-3 w-3 text-muted-foreground" />
        ) : (
          <ChevronRight className="h-3 w-3 text-muted-foreground" />
        )}
      </button>
      {open && (
        <div className="px-4 pb-3 text-xs text-muted-foreground">
          {children}
        </div>
      )}
    </div>
  );
}

/**
 * Render a single entry from `memory.participantsContext`. The backend packs
 * this as a rich object per participant (name, type, role, message_count,
 * plus agent-only fields like capabilities / model / tools / trust_level),
 * so we can't just `{entry}` — React would blow up. Lay out as a titled
 * block with a meta line and a pill row for the list-valued fields.
 */
function ParticipantContextRow({
  participantId,
  entry,
}: {
  participantId: string;
  entry: ParticipantContextEntry;
}) {
  const { t } = useTranslation("memory");
  const isAgent = entry.type === "agent";
  const meta = [
    entry.role,
    entry.message_count != null
      ? t("messageCount", { count: entry.message_count })
      : null,
    isAgent && entry.model ? entry.model : null,
    isAgent && entry.trust_level ? t("trustLevel", { level: entry.trust_level }) : null,
  ].filter(Boolean) as string[];

  const pillGroups: Array<{ label: string; items: string[] }> = [];
  if (entry.capabilities?.length)
    pillGroups.push({ label: t("capabilities"), items: entry.capabilities });
  if (entry.roles?.length) pillGroups.push({ label: t("roles"), items: entry.roles });
  if (entry.tools?.length) pillGroups.push({ label: t("tools"), items: entry.tools });

  return (
    <div>
      <dt className="flex items-center gap-1.5 text-foreground">
        <span className="font-medium">{entry.name ?? participantId}</span>
        {isAgent && (
          <span className="rounded bg-bubble-agent-accent/10 px-1 py-0.5 text-[9px] font-semibold uppercase text-bubble-agent-accent">
            {t("common:agent")}
          </span>
        )}
      </dt>
      {meta.length > 0 && (
        <dd className="mt-0.5 text-[11px] text-muted-foreground">
          {meta.join(" · ")}
        </dd>
      )}
      {entry.description && (
        <dd className="mt-0.5 text-[11px] leading-relaxed text-muted-foreground">
          {entry.description}
        </dd>
      )}
      {pillGroups.map((g) => (
        <dd key={g.label} className="mt-1 flex flex-wrap gap-1">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground/70">
            {g.label}:
          </span>
          {g.items.map((item) => (
            <span
              key={item}
              className="rounded-full border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted-foreground"
            >
              {item}
            </span>
          ))}
        </dd>
      ))}
    </div>
  );
}

/** Large avatar + upload control for the top of the details panel.
 *  Falls back to the composed GroupAvatar when there's no custom photo;
 *  admins get a camera button + remove-photo affordance. */
function AvatarBlock({
  conversation,
  otherMembers,
  canEdit,
  uploading,
  avatarError,
  avatarInputRef,
  onFile,
  onRemove,
}: {
  conversation: Conversation;
  otherMembers: ConversationMember[];
  canEdit: boolean;
  uploading: boolean;
  avatarError: string | null;
  avatarInputRef: React.RefObject<HTMLInputElement | null>;
  onFile: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onRemove: () => void;
}) {
  const { t } = useTranslation("chat");
  const hasCustomAvatar = !!conversation.avatarUrl;
  const title = conversation.title || t("group");

  return (
    <div className="relative flex flex-col items-center py-5 after:absolute after:bottom-0 after:left-4 after:right-4 after:h-px after:bg-border">
      <div className="relative">
        {hasCustomAvatar ? (
          <Avatar className="h-20 w-20">
            <AvatarImage src={conversation.avatarUrl ?? undefined} alt={title} />
            <AvatarFallback>{getInitials(title)}</AvatarFallback>
          </Avatar>
        ) : (
          <GroupAvatar members={otherMembers} size={80} />
        )}
        {canEdit && (
          <>
            <input
              ref={avatarInputRef}
              type="file"
              accept="image/*"
              onChange={onFile}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => avatarInputRef.current?.click()}
              disabled={uploading}
              title={hasCustomAvatar ? t("details.changePhoto") : t("details.uploadPhoto")}
              // Poke outside the avatar bounding box and stack above the
              // GroupAvatar's overflow tile (which uses z-30 on web +
              // desktop). z-40 on the camera is enough to beat it.
              className="absolute -bottom-1 -right-1 z-40 flex h-6 w-6 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-md ring-2 ring-background hover:bg-primary/90 disabled:opacity-60"
            >
              {uploading ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Camera className="h-3 w-3" />
              )}
            </button>
          </>
        )}
      </div>
      {canEdit && hasCustomAvatar && (
        <button
          type="button"
          onClick={onRemove}
          className="mt-3 text-[11px] text-muted-foreground hover:text-destructive"
        >
          {t("details.removePhoto")}
        </button>
      )}
      {avatarError && (
        <p className="mt-2 text-[11px] text-destructive">{avatarError}</p>
      )}
    </div>
  );
}
