import { useTranslation } from "react-i18next";
import { Bell, X } from "lucide-react";
import ReminderForm from "./ReminderForm";
import { formatFutureTime } from "../../lib/utils";
import type { AgentReminder } from "../../lib/api";

/**
 * Create/edit pane for a reminder, rendered in the Actions detail column
 * beside the list (the same slot a selected task uses) rather than in a
 * modal. The form itself is shared with `ReminderDialog`, which is still
 * how reminders are edited from an agent's own page — there's no detail
 * column there to render into.
 */
export default function ReminderDetail({
  group,
  onClose,
}: {
  /** Present → edit that group. Absent → create mode. */
  group?: AgentReminder[];
  onClose: () => void;
}) {
  const { t } = useTranslation("tasks");
  const soonest = group?.[0];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          <Bell className="h-5 w-5 shrink-0 text-warning" />
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight">
            {group ? t("reminder.editTitle") : t("reminder.addTitle")}
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
        {soonest && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {group && group.length > 1
              ? `${t("reminder.seriesCount", { count: group.length })} · `
              : ""}
            {formatFutureTime(soonest.remindAt)}
          </p>
        )}
      </header>

      <ReminderForm group={group} onDone={onClose} variant="panel" />
    </div>
  );
}
