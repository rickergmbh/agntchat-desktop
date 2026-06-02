import { useEffect, useState, useCallback } from "react";
import { X, Loader2, Trash2, LogOut, Mail, Crown, Shield, User, Send, Copy as CopyIcon, Camera } from "lucide-react";
import * as api from "../lib/api";
import { uploadAvatar } from "../lib/imageProcessor";
import { cn, getInitials } from "../lib/utils";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";
import { useAuthStore } from "../stores/authStore";
import { useWorkspaceStore, useWorkspaces } from "../stores/workspaceStore";
import type { WorkspaceMembership, OrganizationMembership, OrganizationInvite } from "../lib/api";
import { HostsManagement } from "./HostsManagement";
import { ProvidersManagement } from "./ProvidersManagement";

type Tab = "general" | "members" | "hosts" | "models" | "invites";

interface Props {
  workspaceId: string;
  onClose: () => void;
}

/**
 * Workspace settings modal — opened from the gear icon next to a
 * non-personal workspace row in the switcher dropdown. Mirrors the
 * web component (`web/src/components/WorkspaceSettingsModal.tsx`)
 * tab-for-tab so behavior stays consistent across clients.
 *
 * Subscribes to the live workspace list so the modal auto-closes if
 * the workspace it's editing disappears (deleted on another device,
 * caller leaves, etc.). Without that, the modal stays bound to a
 * stale snapshot and clicking actions runs them against a workspace
 * the user is no longer in.
 */
export function WorkspaceSettingsModal({ workspaceId, onClose }: Props) {
  const [tab, setTab] = useState<Tab>("general");
  const workspace = useWorkspaces().find((w) => w.id === workspaceId);

  // Auto-close if the workspace disappears from the user's
  // memberships. useEffect runs after render so the modal will
  // briefly render the previous snapshot before unmounting — we
  // tolerate that flicker rather than render undefined state.
  useEffect(() => {
    if (!workspace) onClose();
  }, [workspace, onClose]);

  if (!workspace) return null;

  const isOwner = workspace.role === "owner";
  const isAdminOrOwner = workspace.role === "owner" || workspace.role === "admin";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className="flex h-[600px] w-full max-w-2xl flex-col overflow-hidden rounded-lg border border-border bg-popover shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-5 py-3">
          <div className="min-w-0">
            <h2 className="truncate text-base font-semibold">{workspace.name}</h2>
            <p className="truncate text-xs text-muted-foreground">Workspace settings</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tab nav */}
        <div className="flex shrink-0 gap-1 border-b border-border px-3 pt-2">
          <TabButton active={tab === "general"} onClick={() => setTab("general")}>
            General
          </TabButton>
          <TabButton active={tab === "members"} onClick={() => setTab("members")}>
            Members
          </TabButton>
          {isAdminOrOwner && (
            <TabButton active={tab === "hosts"} onClick={() => setTab("hosts")}>
              Hosts
            </TabButton>
          )}
          {isAdminOrOwner && (
            <TabButton active={tab === "models"} onClick={() => setTab("models")}>
              Models
            </TabButton>
          )}
          {isAdminOrOwner && (
            <TabButton active={tab === "invites"} onClick={() => setTab("invites")}>
              Invites
            </TabButton>
          )}
        </div>

        <div className="flex-1 overflow-y-auto px-5 py-4">
          {tab === "general" && (
            <GeneralTab
              workspace={workspace}
              isOwner={isOwner}
              isAdminOrOwner={isAdminOrOwner}
              onClose={onClose}
            />
          )}
          {tab === "members" && (
            <MembersTab workspace={workspace} isOwner={isOwner} isAdminOrOwner={isAdminOrOwner} />
          )}
          {tab === "hosts" && isAdminOrOwner && (
            <HostsManagement
              orgId={workspace.id}
              subtitle="Run agents on a dedicated Linux VM. Setup currently requires access to the Agentgram private host repo — reach out to opt in."
            />
          )}
          {tab === "models" && isAdminOrOwner && (
            <ProvidersManagement
              orgId={workspace.id}
              subtitle="Choose which LLM providers and models this workspace's members can use. Leave a provider unconfigured to allow the global default list."
            />
          )}
          {tab === "invites" && isAdminOrOwner && <InvitesTab workspace={workspace} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm transition-colors",
        active
          ? "bg-accent text-accent-foreground"
          : "text-muted-foreground hover:bg-accent/40 hover:text-foreground"
      )}
    >
      {children}
    </button>
  );
}

// --- General tab -------------------------------------------------------

function GeneralTab({
  workspace,
  isOwner,
  isAdminOrOwner,
  onClose,
}: {
  workspace: WorkspaceMembership;
  isOwner: boolean;
  isAdminOrOwner: boolean;
  onClose: () => void;
}) {
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const setWorkspaceAvatar = useWorkspaceStore((s) => s.setWorkspaceAvatar);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const leaveWorkspace = useWorkspaceStore((s) => s.leaveWorkspace);

  const [name, setName] = useState(workspace.name);
  const [saving, setSaving] = useState(false);
  const [destroying, setDestroying] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);

  async function handleAvatarChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    setError(null);
    try {
      const url = await uploadAvatar(file, `workspace-avatars/${workspace.id}.jpg`);
      await setWorkspaceAvatar(workspace.id, url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not upload avatar");
    } finally {
      setUploadingAvatar(false);
      e.target.value = "";
    }
  }

  async function handleAvatarRemove() {
    setUploadingAvatar(true);
    setError(null);
    try {
      await setWorkspaceAvatar(workspace.id, null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not remove avatar");
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSave() {
    if (!name.trim() || name.trim() === workspace.name) return;
    setSaving(true);
    setError(null);
    try {
      await renameWorkspace(workspace.id, name.trim());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not rename");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (
      !confirm(
        `Delete "${workspace.name}"? This removes all conversations, agents, and members in this workspace. This cannot be undone.`
      )
    )
      return;
    setDestroying(true);
    setError(null);
    try {
      await deleteWorkspace(workspace.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete");
      setDestroying(false);
    }
  }

  async function handleLeave() {
    if (!confirm(`Leave "${workspace.name}"?`)) return;
    setLeaving(true);
    setError(null);
    try {
      await leaveWorkspace(workspace.id);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not leave");
      setLeaving(false);
    }
  }

  return (
    <div className="space-y-6">
      {/* Avatar — only shown to admins/owners who can change it */}
      {isAdminOrOwner && (
        <section>
          <label className="text-xs font-medium">Workspace avatar</label>
          <div className="mt-1.5 flex items-center gap-3">
            <div className="relative">
              <Avatar className="h-14 w-14 rounded-md">
                {workspace.avatarUrl ? (
                  <AvatarImage src={workspace.avatarUrl} alt="" className="rounded-md" />
                ) : (
                  <AvatarFallback className="rounded-md text-sm font-semibold">
                    {workspace.name?.slice(0, 2).toUpperCase() || "?"}
                  </AvatarFallback>
                )}
              </Avatar>
              <label
                className={cn(
                  "absolute inset-0 flex cursor-pointer items-center justify-center rounded-md bg-black/50 text-white opacity-0 transition-opacity hover:opacity-100",
                  uploadingAvatar && "opacity-100"
                )}
              >
                {uploadingAvatar ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="hidden"
                  onChange={handleAvatarChange}
                  disabled={uploadingAvatar}
                />
              </label>
            </div>
            <div className="flex flex-col gap-1">
              <p className="text-[11px] text-muted-foreground">
                Renders in the sidebar tile. JPEG, PNG, or WebP — square crop recommended.
              </p>
              {workspace.avatarUrl && (
                <button
                  type="button"
                  onClick={() => void handleAvatarRemove()}
                  disabled={uploadingAvatar}
                  className="text-left text-[11px] text-destructive hover:underline disabled:opacity-50"
                >
                  Remove avatar
                </button>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Name — editable for admins/owners only; members don't need the field */}
      {isAdminOrOwner && (
        <section>
          <label htmlFor="ws-rename" className="text-xs font-medium">
            Workspace name
          </label>
          <div className="mt-1.5 flex gap-2">
            <input
              id="ws-rename"
              value={name}
              onChange={(e) => setName(e.target.value)}
              maxLength={100}
              className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
            />
            <button
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim() || name.trim() === workspace.name}
              className="flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
            >
              {saving && <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />}
              Save
            </button>
          </div>
        </section>
      )}

      {/* Workspace identifiers — developer info, only relevant to admins/owners */}
      {isAdminOrOwner && (
        <section className="space-y-2">
          <label className="text-xs font-medium">Workspace identifiers</label>
          <ReadOnlyField label="ID" value={workspace.id} />
          <ReadOnlyField label="Slug" value={workspace.slug} />
          <p className="text-[11px] text-muted-foreground">
            The workspace ID is what backend resources reference (agents, hosts,
            conversations). Slug appears in URLs.
          </p>
        </section>
      )}

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      {!isOwner && (
        <section className="rounded-md border border-border p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">Leave workspace</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                You'll lose access to all conversations and agents here.
              </p>
            </div>
            <button
              type="button"
              onClick={handleLeave}
              disabled={leaving}
              className="flex shrink-0 items-center rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {leaving ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <LogOut className="mr-1.5 h-3 w-3" />
              )}
              Leave
            </button>
          </div>
        </section>
      )}

      {isOwner && (
        <section className="rounded-md border border-destructive/30 p-3">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-destructive">Delete workspace</h3>
              <p className="mt-0.5 text-xs text-muted-foreground">
                Permanently removes the workspace, its conversations, agents, hosts, and credentials.
              </p>
            </div>
            <button
              type="button"
              onClick={handleDelete}
              disabled={destroying}
              className="flex shrink-0 items-center rounded-md px-3 py-1.5 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
            >
              {destroying ? (
                <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
              ) : (
                <Trash2 className="mr-1.5 h-3 w-3" />
              )}
              Delete
            </button>
          </div>
        </section>
      )}
    </div>
  );
}

// --- Members tab -------------------------------------------------------

function MembersTab({
  workspace,
  isOwner,
  isAdminOrOwner,
}: {
  workspace: WorkspaceMembership;
  isOwner: boolean;
  isAdminOrOwner: boolean;
}) {
  const [members, setMembers] = useState<OrganizationMembership[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const removeMember = useWorkspaceStore((s) => s.removeMember);
  const updateMemberRole = useWorkspaceStore((s) => s.updateMemberRole);
  const currentUserId = useAuthStore((s) => s.participant?.id);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await api.listOrganizationMembers(workspace.id);
      setMembers(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load members");
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleRoleChange(member: OrganizationMembership, role: "admin" | "member") {
    try {
      await updateMemberRole(workspace.id, member.participantId, role);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not update role");
    }
  }

  async function handleRemove(member: OrganizationMembership) {
    const name = member.participant?.displayName ?? "this member";
    if (!confirm(`Remove ${name} from ${workspace.name}?`)) return;
    try {
      await removeMember(workspace.id, member.participantId);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not remove");
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-8">
        <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <p className="text-xs text-destructive" role="alert">
        {error}
      </p>
    );
  }

  return (
    <div className="space-y-2">
      {members?.map((m) => {
        const isSelf = m.participantId === currentUserId;
        return (
          <div
            key={m.participantId}
            className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
          >
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-[11px] font-medium">
              {getInitials(m.participant?.displayName ?? "?")}
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5">
                <span className="truncate text-sm font-medium">
                  {m.participant?.displayName ?? "Unknown"}
                </span>
                {isSelf && <span className="text-[10px] text-muted-foreground">(you)</span>}
              </div>
            </div>
            <RoleBadge role={m.role} />
            {isOwner && m.role !== "owner" && (
              <select
                value={m.role}
                onChange={(e) => handleRoleChange(m, e.target.value as "admin" | "member")}
                className="h-7 rounded-md border border-border bg-background px-2 text-xs"
                aria-label="Role"
              >
                <option value="member">Member</option>
                <option value="admin">Admin</option>
              </select>
            )}
            {isAdminOrOwner && m.role !== "owner" && !isSelf && (
              <button
                type="button"
                onClick={() => handleRemove(m)}
                className="shrink-0 rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
              >
                Remove
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center gap-2 rounded-md border border-border bg-muted/40 px-2.5 py-1.5 font-mono text-xs">
      <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      <span className="flex-1 truncate select-all">{value}</span>
      <button
        type="button"
        onClick={() => void navigator.clipboard.writeText(value)}
        aria-label={`Copy ${label}`}
        className="rounded-sm p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
      >
        <CopyIcon className="h-3 w-3" />
      </button>
    </div>
  );
}

function RoleBadge({ role }: { role: "owner" | "admin" | "member" }) {
  const config = {
    owner: { Icon: Crown, label: "Owner", cls: "text-amber-500" },
    admin: { Icon: Shield, label: "Admin", cls: "text-primary" },
    member: { Icon: User, label: "Member", cls: "text-muted-foreground" },
  }[role];
  const { Icon, label, cls } = config;
  return (
    <span className={cn("flex items-center gap-1 text-[11px]", cls)}>
      <Icon className="h-3 w-3" />
      {label}
    </span>
  );
}

// --- Invites tab -------------------------------------------------------

function InvitesTab({ workspace }: { workspace: WorkspaceMembership }) {
  const [invites, setInvites] = useState<OrganizationInvite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<"admin" | "member">("member");
  const [sending, setSending] = useState(false);

  const sendInvite = useWorkspaceStore((s) => s.sendInvite);
  const revokeInvite = useWorkspaceStore((s) => s.revokeInvite);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const list = await api.listOrganizationInvites(workspace.id);
      setInvites(list.filter((i) => !i.redeemedAt));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not load invites");
    } finally {
      setLoading(false);
    }
  }, [workspace.id]);

  useEffect(() => {
    load();
  }, [load]);

  async function handleSend(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    setError(null);
    try {
      await sendInvite(workspace.id, email.trim(), role);
      setEmail("");
      setRole("member");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not send invite");
    } finally {
      setSending(false);
    }
  }

  async function handleRevoke(invite: OrganizationInvite) {
    if (!confirm(`Revoke invitation to ${invite.email}?`)) return;
    try {
      await revokeInvite(workspace.id, invite.id);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke");
    }
  }

  return (
    <div className="space-y-5">
      <form onSubmit={handleSend} className="space-y-2">
        <label className="text-xs font-medium">Invite by email</label>
        <div className="flex gap-2">
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="teammate@example.com"
            className="h-9 flex-1 rounded-md border border-border bg-background px-3 text-sm"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as "admin" | "member")}
            className="h-9 rounded-md border border-border bg-background px-2 text-sm"
            aria-label="Role"
          >
            <option value="member">Member</option>
            <option value="admin">Admin</option>
          </select>
          <button
            type="submit"
            disabled={!email.trim() || sending}
            className="flex items-center rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {sending ? (
              <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
            ) : (
              <Send className="mr-1.5 h-3 w-3" />
            )}
            Send
          </button>
        </div>
      </form>

      {error && (
        <p className="text-xs text-destructive" role="alert">
          {error}
        </p>
      )}

      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Pending invitations
        </h3>
        {loading ? (
          <div className="flex justify-center py-6">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : (invites ?? []).length === 0 ? (
          <p className="py-4 text-center text-xs text-muted-foreground">
            No pending invitations.
          </p>
        ) : (
          <div className="space-y-1">
            {invites!.map((invite) => (
              <div
                key={invite.id}
                className="flex items-center gap-3 rounded-md border border-border px-3 py-2"
              >
                <Mail className="h-4 w-4 shrink-0 text-muted-foreground" />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm">{invite.email}</p>
                  <p className="text-[11px] text-muted-foreground">{invite.role}</p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRevoke(invite)}
                  className="rounded-md px-2 py-1 text-xs text-destructive hover:bg-destructive/10"
                >
                  Revoke
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
