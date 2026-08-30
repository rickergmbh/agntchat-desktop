import { useTranslation } from "react-i18next";
import { Repeat, X } from "lucide-react";
import { RoutineForm, formatSchedule } from "../AgentRoutines";
import { useRoutineStore } from "../../stores/routineStore";
import { useAgentStore } from "../../stores/agentStore";
import { formatFutureTime } from "../../lib/utils";
import type { Routine } from "../../lib/api";

/**
 * Edit pane for a routine, rendered in the Actions detail column beside
 * the list (the same slot a selected task uses). The form is shared with
 * the modal on an agent's own Routines section — clicking a routine here
 * no longer leaves the Actions area for the agent page.
 *
 * Creating and deleting routines still lives on the agent's page: both
 * need the surrounding per-agent list (workspace pin, report-to, the
 * pause/resume controls) that has no place in a single-item pane.
 */
export default function RoutineDetail({
  routine,
  onClose,
}: {
  routine: Routine;
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const upsertRoutine = useRoutineStore((s) => s.upsertRoutine);
  const agents = useAgentStore((s) => s.agents);
  const agent = Object.values(agents).find((m) => m.agent.id === routine.participantId)?.agent;
  const agentName = agent?.displayName ?? t("agents:thisAgent");

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Repeat className="h-5 w-5 shrink-0 text-info" />
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight">
            {routine.name}
          </h1>
          <button
            type="button"
            onClick={onClose}
            title={t("common:close")}
            className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <p className="mt-1.5 text-xs text-muted-foreground">
          {agentName} ·{" "}
          {formatSchedule(routine.scheduleType, routine.scheduleConfig as Record<string, unknown>)} ·{" "}
          {routine.nextRunAt
            ? t("agents:routines.nextRun", { time: formatFutureTime(routine.nextRunAt) })
            : t("agents:routines.notScheduled")}
        </p>
      </header>

      <RoutineForm key={routine.id} routine={routine} variant="panel" onSaved={upsertRoutine} />
    </div>
  );
}
