import { useState, type ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../../lib/api";
import { cn } from "../../lib/utils";
import { HostOpLog } from "./HostOpLog";
import type { HostRowDetailContext } from "./HostRow";

/**
 * Expanded panel for a host row, shared by the Hosts view and the Platform
 * admin tab: segmented switch between the residents breakdown (users + agents
 * on the host) and the SSH op log. Operations is one click away — no
 * scrolling to the bottom — and its tab flags a live op so you can jump
 * straight to progress. The residents content differs per surface (the admin
 * adds token usage + move/reset controls) and is injected via
 * `renderResidents`.
 */
export function HostPanels({
  host,
  ctx,
  renderResidents,
}: {
  host: api.OrganizationHost;
  ctx: HostRowDetailContext;
  renderResidents: () => ReactNode;
}) {
  const { t } = useTranslation("platform");
  const [panel, setPanel] = useState<"residents" | "operations">("residents");

  const users = host.userCount ?? 0;
  const assigned = host.assignedAgentCount ?? host.agentCount ?? 0;

  return (
    <div>
      <div className="mb-3 inline-flex rounded-md border border-border p-0.5 text-sm">
        <button
          type="button"
          onClick={() => setPanel("residents")}
          className={cn(
            "rounded-[5px] px-3 py-1 font-medium transition-colors",
            panel === "residents"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("hosts.residents")}
          <span className="ml-1.5 tabular-nums text-xs text-muted-foreground">
            {t("hosts.residentsSummary", { users, agents: assigned })}
          </span>
        </button>
        <button
          type="button"
          onClick={() => setPanel("operations")}
          className={cn(
            "flex items-center gap-1.5 rounded-[5px] px-3 py-1 font-medium transition-colors",
            panel === "operations"
              ? "bg-muted text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {t("hosts.operations")}
          {ctx.opRunning ? (
            <Loader2 className="h-3 w-3 animate-spin text-amber-500" />
          ) : (
            ctx.ops.length > 0 && (
              <span className="tabular-nums text-xs text-muted-foreground">
                {ctx.ops.length}
              </span>
            )
          )}
        </button>
      </div>

      {panel === "residents" ? (
        renderResidents()
      ) : (
        <HostOpLog ops={ctx.ops} onCancel={ctx.cancelOp} />
      )}
    </div>
  );
}
