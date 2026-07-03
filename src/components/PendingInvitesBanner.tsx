import { useEffect, useState, useCallback } from "react";
import { Mail, Loader2, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../lib/api";
import { useWorkspaceStore } from "../stores/workspaceStore";

interface Props {
  onAllResolved?: () => void;
}

/**
 * Renders inside the desktop workspace switcher dropdown when the
 * user has un-redeemed workspace invites whose email matches their
 * account. One-click accept calls
 * `POST /api/me/pending-invites/:id/accept`; on success the backend
 * has switched active workspace and broadcast
 * `active_organization_changed` (workspaceStore handles the cascade).
 */
export function PendingInvitesBanner({ onAllResolved }: Props) {
  const { t } = useTranslation("settings");
  const refresh = useWorkspaceStore((s) => s.refresh);
  const [invites, setInvites] = useState<api.PendingWorkspaceInvite[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [acceptingId, setAcceptingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const list = await api.listPendingWorkspaceInvites();
      setInvites(list);
    } catch {
      setInvites([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return null;
  if (!invites || invites.length === 0) return null;

  async function handleAccept(invite: api.PendingWorkspaceInvite) {
    setAcceptingId(invite.id);
    setError(null);
    try {
      await api.acceptPendingWorkspaceInvite(invite.id);
      await refresh();
      setInvites((prev) => (prev ?? []).filter((i) => i.id !== invite.id));
      if ((invites ?? []).length <= 1) onAllResolved?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("workspace.acceptFailed"));
    } finally {
      setAcceptingId(null);
    }
  }

  function handleDismiss() {
    setInvites([]);
    onAllResolved?.();
  }

  return (
    <div className="border-b border-border bg-primary/5 px-3 py-2">
      <div className="mb-2 flex items-center justify-between">
        <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-primary">
          <Mail className="h-3 w-3" />
          {t("workspace.pendingInvites")} ({invites.length})
        </div>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label={t("common:dismiss")}
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-3 w-3" />
        </button>
      </div>

      <div className="space-y-1">
        {invites.map((invite) => (
          <div
            key={invite.id}
            className="flex items-center gap-2 rounded-md bg-background/60 px-2 py-1.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs font-medium">
                {invite.organizationName ?? t("workspace.fallbackName")}
              </p>
              <p className="text-[10px] text-muted-foreground">
                {t(`workspace.roles.${invite.role}`, { defaultValue: invite.role })}
              </p>
            </div>
            <button
              type="button"
              onClick={() => handleAccept(invite)}
              disabled={acceptingId === invite.id}
              className="rounded-md px-2 py-0.5 text-xs hover:bg-accent disabled:opacity-50"
            >
              {acceptingId === invite.id ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                t("common:accept")
              )}
            </button>
          </div>
        ))}
      </div>

      {error && <p className="mt-2 text-[11px] text-muted-foreground">{error}</p>}
    </div>
  );
}
