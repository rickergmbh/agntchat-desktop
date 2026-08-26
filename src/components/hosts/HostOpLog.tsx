import { useEffect, useState } from "react";
import { Loader2, Terminal, X } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../../lib/api";
import { cn } from "../../lib/utils";
import { Button } from "@/components/ui/button";
import { relativeAge } from "./util";

/** Wall-clock length of an op: finished ops show their total, running ops
 *  show elapsed-so-far (the caller re-polls, so this advances on each render). */
function opDuration(o: api.HostOperation): string {
  const start = new Date(o.insertedAt).getTime();
  if (Number.isNaN(start)) return "";
  const end = o.finishedAt ? new Date(o.finishedAt).getTime() : Date.now();
  const secs = Math.max(0, Math.round((end - start) / 1000));
  if (secs < 60) return `${secs}s`;
  return `${Math.floor(secs / 60)}m ${secs % 60}s`;
}

export function HostOpLog({
  ops,
  onCancel,
}: {
  ops: api.HostOperation[];
  /** Cancel a stuck pending/running op. When omitted, no cancel control shows
   *  (e.g. for non-admins). Returns once the op is cleared so the row refreshes. */
  onCancel?: (operationId: string) => Promise<void> | void;
}) {
  const { t } = useTranslation("platform");
  // Auto-expand a running/pending op so its output streams without a click;
  // otherwise honour whatever the user last toggled open.
  const activeId =
    ops.find((o) => o.status === "pending" || o.status === "running")?.id ?? null;
  const [openId, setOpenId] = useState<string | null>(activeId);
  const [cancelingId, setCancelingId] = useState<string | null>(null);

  // Follow the active op as it changes (a freshly-kicked-off op becomes active).
  useEffect(() => {
    if (activeId) setOpenId(activeId);
  }, [activeId]);

  const cancel = async (id: string) => {
    if (!onCancel) return;
    if (!confirm(t("fleet.confirmCancelOp"))) return;
    setCancelingId(id);
    try {
      await onCancel(id);
    } finally {
      setCancelingId(null);
    }
  };

  if (ops.length === 0)
    return <p className="text-sm text-muted-foreground">{t("fleet.noOperations")}</p>;

  return (
    <div>
      <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        <Terminal className="h-3 w-3" /> {t("fleet.recentOperations")}
      </div>
      <ul className="space-y-1">
        {ops.map((o) => {
          const running = o.status === "pending" || o.status === "running";
          return (
            <li key={o.id} className="rounded-sm bg-muted/40 text-sm">
              <div className="flex w-full items-center gap-2 px-2.5 py-1.5">
                <button
                  type="button"
                  onClick={() => setOpenId((id) => (id === o.id ? null : o.id))}
                  className="flex flex-1 items-center justify-between gap-2 text-left"
                >
                  <span className="flex items-center gap-2">
                    <span
                      className={cn(
                        "h-2 w-2 rounded-full",
                        o.status === "ok" && "bg-success",
                        o.status === "failed" && "bg-destructive",
                        o.status === "canceled" && "bg-muted-foreground/50",
                        running && "bg-amber-500 animate-pulse"
                      )}
                    />
                    <span className="font-medium">
                      {t(`fleet.opKind.${o.kind}`, { defaultValue: o.kind })}
                    </span>
                    <span
                      className={cn(
                        "text-xs",
                        o.status === "failed" ? "text-destructive" : "text-muted-foreground"
                      )}
                    >
                      {t(`status.${o.status}`, { defaultValue: o.status })}
                    </span>
                  </span>
                  <span className="flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="tabular-nums">{opDuration(o)}</span>
                    <span>· {relativeAge(o.insertedAt)}</span>
                  </span>
                </button>
                {running && onCancel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 shrink-0 gap-1 px-1.5 text-xs text-muted-foreground hover:text-destructive"
                    disabled={cancelingId === o.id}
                    onClick={() => void cancel(o.id)}
                    title={t("fleet.cancelOpTitle")}
                  >
                    {cancelingId === o.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <X className="h-3 w-3" />
                    )}
                    {t("common:cancel")}
                  </Button>
                )}
              </div>
              {openId === o.id &&
                (o.output ? (
                  <pre className="max-h-60 overflow-auto whitespace-pre-wrap break-all border-t border-border px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
                    {o.output}
                  </pre>
                ) : running ? (
                  <div className="flex items-center gap-1.5 border-t border-border px-2.5 py-2 text-[11px] text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" /> {t("fleet.runningEllipsis")}
                  </div>
                ) : null)}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
