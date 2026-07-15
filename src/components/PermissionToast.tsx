import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ShieldQuestion } from "lucide-react";

import { ws } from "../services/websocket";
import {
  listPendingPermissions,
  resolvePermission,
  type PermissionRequest,
} from "../lib/api";

/**
 * In-app approve/deny prompts for gated agent actions (#67).
 *
 * When skip-permissions is OFF and an agent hits a tool that needs approval,
 * the backend broadcasts a `permission_request` on the user channel. This
 * renders an approve/deny toast (with "always allow this tool"); the waiting
 * agent runtime unblocks in the same turn once the owner decides.
 *
 * `permission_resolved` dismisses a prompt across every device — it fires on
 * approve/deny from another device and on server-side expiry. Mounted once in
 * AppShell.
 */
export function PermissionToast() {
  const [requests, setRequests] = useState<PermissionRequest[]>([]);
  // Ids we've locally acted on, so an in-flight resolve doesn't flash back.
  const [resolving, setResolving] = useState<Set<string>>(new Set());

  const remove = useCallback((id: string) => {
    setRequests((rs) => rs.filter((r) => r.id !== id));
  }, []);

  const upsert = useCallback((req: PermissionRequest) => {
    setRequests((rs) => {
      if (rs.some((r) => r.id === req.id)) return rs;
      return [...rs, req];
    });
  }, []);

  // Hydrate on mount + on (re)connect so a reload doesn't drop live prompts.
  useEffect(() => {
    const hydrate = () => {
      void listPendingPermissions()
        .then((pending) => setRequests(pending))
        .catch(() => {});
    };
    hydrate();

    const unsubJoin = ws.on("user_channel_joined", hydrate);
    const unsubReq = ws.on("permission_request", (payload) => {
      upsert(payload as unknown as PermissionRequest);
    });
    const unsubResolved = ws.on("permission_resolved", (payload) => {
      const r = payload as unknown as PermissionRequest;
      remove(r.id);
    });

    return () => {
      unsubJoin();
      unsubReq();
      unsubResolved();
    };
  }, [upsert, remove]);

  const decide = useCallback(
    (id: string, decision: "approve" | "deny", always = false) => {
      setResolving((s) => new Set(s).add(id));
      // Optimistically drop it — the runtime is already unblocking.
      remove(id);
      void resolvePermission(id, decision, always).catch(() => {});
    },
    [remove]
  );

  if (requests.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-3">
      {requests.map((req) => (
        <PermissionToastCard
          key={req.id}
          description={req.description}
          toolName={req.toolName}
          disabled={resolving.has(req.id)}
          onDeny={() => decide(req.id, "deny")}
          onAlways={() => decide(req.id, "approve", true)}
          onApprove={() => decide(req.id, "approve")}
        />
      ))}
    </div>
  );
}

/** Presentational card for a single {@link PermissionToast} prompt — split out
 *  so the component preview gallery can render it with sample data. */
export function PermissionToastCard({
  description,
  toolName,
  disabled,
  onDeny,
  onAlways,
  onApprove,
}: {
  description?: string | null;
  toolName: string;
  disabled?: boolean;
  onDeny: () => void;
  onAlways: () => void;
  onApprove: () => void;
}) {
  const { t } = useTranslation("chat");
  return (
    <div className="pointer-events-auto rounded-lg border border-border bg-card p-4 shadow-lg">
      <div className="flex items-start gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
          <ShieldQuestion size={16} className="text-warning" />
        </div>
        <div className="min-w-0">
          <p className="text-sm font-medium">{t("permissionToast.title")}</p>
          <p className="mt-1 break-words text-xs text-muted-foreground">
            {description || t("permissionToast.subtitle", { agent: toolName })}
          </p>
          <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
            {toolName}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap justify-end gap-2">
        <button
          onClick={onDeny}
          disabled={disabled}
          className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          {t("permissionToast.deny")}
        </button>
        <button
          onClick={onAlways}
          disabled={disabled}
          className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
        >
          {t("permissionToast.always")}
        </button>
        <button
          onClick={onApprove}
          disabled={disabled}
          className="rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
        >
          {t("permissionToast.approve")}
        </button>
      </div>
    </div>
  );
}
