import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell } from "lucide-react";
import { useReminderStore } from "../stores/reminderStore";
import { groupReminderRows } from "../lib/reminderGrouping";
import { formatFutureTime } from "../lib/utils";
import ReminderDialog from "./tasks/ReminderDialog";
import type { AgentReminder } from "../lib/api";

interface AgentRemindersProps {
  agentId: string;
  /** Reports this section's count up to the agent-detail rail badge, so the
   *  number moves with the list instead of waiting for a refetch. */
  onCount?: (n: number) => void;
}

/**
 * Read-only list of an agent's active reminders (Bell capability). Unlike
 * the unified Actions list, this doesn't exclude to-do-linked reminders —
 * that exclusion exists there to avoid a redundant card next to the to-do's
 * own bell icon, which doesn't apply on a page that isn't showing to-dos.
 * Tapping a row opens the same edit/delete dialog the unified list uses.
 */
export function AgentReminders({ agentId, onCount }: AgentRemindersProps) {
  const { t } = useTranslation("agents");
  const reminders = useReminderStore((s) => s.reminders);
  const fetchReminders = useReminderStore((s) => s.fetchReminders);
  const loading = useReminderStore((s) => s.loading);
  const [dialogGroup, setDialogGroup] = useState<AgentReminder[] | null>(null);

  useEffect(() => {
    fetchReminders();
  }, [fetchReminders]);

  const groups = useMemo(
    () =>
      groupReminderRows(
        reminders.filter((r) => r.agentId === agentId && r.status === "active")
      ),
    [reminders, agentId]
  );

  useEffect(() => {
    onCount?.(groups.length);
  }, [groups.length, onCount]);

  if (loading && reminders.length === 0) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("remindersTab.loading")}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      {groups.length === 0 ? (
        <div className="text-center py-8">
          <Bell className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm text-muted-foreground">{t("remindersTab.empty")}</p>
        </div>
      ) : (
        <div className="space-y-2">
          {groups.map((group) => {
            const soonest = group[0];
            return (
              <button
                key={soonest.id}
                type="button"
                onClick={() => setDialogGroup(group)}
                className="w-full flex items-start gap-3 p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors text-left"
              >
                <Bell className="w-4 h-4 mt-0.5 text-muted-foreground shrink-0" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium truncate">{soonest.eventLabel}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {group.length > 1
                      ? t("tasks:reminder.seriesCount", { count: group.length }) + " · "
                      : ""}
                    {formatFutureTime(soonest.remindAt)}
                  </p>
                  {soonest.actionInstruction && (
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-1">
                      {soonest.actionInstruction}
                    </p>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}

      <ReminderDialog
        open={dialogGroup !== null}
        onClose={() => setDialogGroup(null)}
        group={dialogGroup ?? undefined}
      />
    </div>
  );
}
