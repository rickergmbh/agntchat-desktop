import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { KeyRound, Loader2 } from "lucide-react";

import { ws } from "../services/websocket";
import {
  listPendingCredentialRequests,
  fulfillCredentialRequest,
  denyCredentialRequest,
  type CredentialRequest,
} from "../lib/api";

/** Host the credential will be pinned to, for the "usable only for…" line. */
function endpointHost(endpoint?: string | null): string | null {
  if (!endpoint) return null;
  try {
    return new URL(endpoint).host;
  } catch {
    return null;
  }
}

/**
 * Masked prompt for an agent's credential request.
 *
 * The point is what it avoids: without this, an agent needing an API key has
 * to ask in the conversation, which writes the secret into the transcript and
 * the model's context permanently. Here the value goes straight to the
 * backend's encrypted store — never echoed back, never rendered, and dropped
 * from component state the moment the prompt closes.
 *
 * Mounted once in AppShell, alongside PermissionToast.
 */
export function CredentialPrompt() {
  const { t } = useTranslation("chat");
  const [requests, setRequests] = useState<CredentialRequest[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<Set<string>>(new Set());
  const [failed, setFailed] = useState<Set<string>>(new Set());
  const [declineFailed, setDeclineFailed] = useState<Set<string>>(new Set());

  /** Drop the request and, critically, the typed secret along with it. */
  const dismiss = useCallback((id: string) => {
    setRequests((rs) => rs.filter((r) => r.id !== id));
    setValues((v) => {
      const next = { ...v };
      delete next[id];
      return next;
    });
    setBusy((b) => {
      const next = new Set(b);
      next.delete(id);
      return next;
    });
  }, []);

  // Hydrate on mount + on (re)connect so a reload doesn't drop live asks.
  useEffect(() => {
    const hydrate = () => {
      void listPendingCredentialRequests()
        .then(setRequests)
        .catch(() => {});
    };
    hydrate();

    const unsubJoin = ws.on("user_channel_joined", hydrate);
    const unsubReq = ws.on("credential_request", (payload) => {
      const req = payload as unknown as CredentialRequest;
      setRequests((rs) => (rs.some((r) => r.id === req.id) ? rs : [...rs, req]));
    });
    const unsubResolved = ws.on("credential_request_resolved", (payload) => {
      dismiss((payload as unknown as CredentialRequest).id);
    });

    return () => {
      unsubJoin();
      unsubReq();
      unsubResolved();
    };
  }, [dismiss]);

  const provide = useCallback(
    async (id: string) => {
      const value = values[id]?.trim();
      if (!value) return;
      setBusy((b) => new Set(b).add(id));
      setFailed((f) => {
        const next = new Set(f);
        next.delete(id);
        return next;
      });
      try {
        await fulfillCredentialRequest(id, value);
        dismiss(id);
      } catch {
        setFailed((f) => new Set(f).add(id));
        setBusy((b) => {
          const next = new Set(b);
          next.delete(id);
          return next;
        });
      }
    },
    [values, dismiss]
  );

  // Dismiss only AFTER the server confirms: an optimistic dismiss on a
  // failed DELETE left the ask pending server-side (and on other devices)
  // for its whole TTL while the owner believed they had declined — and the
  // agent kept polling "still waiting on your owner".
  const decline = useCallback(
    async (id: string) => {
      setBusy((b) => new Set(b).add(id));
      setDeclineFailed((f) => {
        const next = new Set(f);
        next.delete(id);
        return next;
      });
      try {
        await denyCredentialRequest(id);
        dismiss(id);
      } catch {
        setDeclineFailed((f) => new Set(f).add(id));
        setBusy((b) => {
          const next = new Set(b);
          next.delete(id);
          return next;
        });
      }
    },
    [dismiss]
  );

  if (requests.length === 0) return null;

  return (
    <div className="pointer-events-none fixed bottom-6 right-6 z-50 flex max-w-sm flex-col gap-3">
      {requests.map((req) => {
        const host = endpointHost(req.endpoint);
        const value = values[req.id] ?? "";
        return (
          <div
            key={req.id}
            className="pointer-events-auto rounded-lg border border-border bg-card p-4 shadow-lg"
          >
            <div className="flex items-start gap-3">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted">
                <KeyRound size={16} className="text-warning" />
              </div>
              <div className="min-w-0">
                <p className="text-sm font-medium">{t("credentialPrompt.title")}</p>
                {req.agentName && (
                  <p className="mt-0.5 break-words text-xs text-muted-foreground">
                    {t("credentialPrompt.askedBy", { agent: req.agentName })}
                  </p>
                )}
                <p className="mt-1 break-words text-xs">{req.label}</p>
                {req.reason && (
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {req.reason}
                  </p>
                )}
                {host && (
                  <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">
                    {t("credentialPrompt.forHost", { host })}
                  </p>
                )}
              </div>
            </div>

            <input
              type="password"
              autoComplete="off"
              spellCheck={false}
              value={value}
              onChange={(e) =>
                setValues((v) => ({ ...v, [req.id]: e.target.value }))
              }
              onKeyDown={(e) => {
                if (e.key === "Enter") void provide(req.id);
              }}
              placeholder={t("credentialPrompt.placeholder")}
              className="mt-3 w-full rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs outline-none focus:border-primary"
            />

            <p className="mt-1.5 text-[11px] text-muted-foreground">
              {t("credentialPrompt.neverShown")}
            </p>

            {failed.has(req.id) && (
              <p className="mt-1.5 text-[11px] text-destructive" role="alert">
                {t("credentialPrompt.failed")}
              </p>
            )}

            {declineFailed.has(req.id) && (
              <p className="mt-1.5 text-[11px] text-destructive" role="alert">
                {t("credentialPrompt.declineFailed")}
              </p>
            )}

            <div className="mt-3 flex flex-wrap justify-end gap-2">
              <button
                disabled={busy.has(req.id)}
                onClick={() => void decline(req.id)}
                className="rounded-md px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-accent disabled:opacity-50"
              >
                {t("credentialPrompt.decline")}
              </button>
              <button
                disabled={busy.has(req.id) || !value.trim()}
                onClick={() => void provide(req.id)}
                className="inline-flex items-center rounded-md bg-primary px-3 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              >
                {busy.has(req.id) && (
                  <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                )}
                {t("credentialPrompt.provide")}
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
