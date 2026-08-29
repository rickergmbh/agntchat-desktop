import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { useReminderStore } from "../../stores/reminderStore";
import { cn } from "../../lib/utils";
import type { AgentReminder } from "../../lib/api";

interface ReminderDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present → edit/delete (a single reminder) or view/delete-all (2+
   *  sharing a source event). Absent → create mode. */
  group?: AgentReminder[];
}

function nextDayAt(hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function inDaysAt(days: number, hour: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

function inHours(hours: number): string {
  return new Date(Date.now() + hours * 3600_000).toISOString();
}

function remindTypeLabel(t: (key: string) => string, remindType: AgentReminder["remindType"]): string {
  switch (remindType) {
    case "7_day":
      return t("reminder.remindTypeSevenDay");
    case "1_day":
      return t("reminder.remindTypeOneDay");
    case "day_of":
      return t("reminder.remindTypeDayOf");
    default:
      return remindType;
  }
}

/**
 * Create/edit/delete dialog for a reminder. A memory-derived or
 * event-group trio (one source event fanned out into 7_day/1_day/day_of)
 * renders as a read-only breakdown with a "delete all N" action instead of
 * per-member editing, since editing one leg would desync it from the
 * others.
 */
export default function ReminderDialog({ open, onClose, group }: ReminderDialogProps) {
  const { t } = useTranslation("tasks");
  const addReminder = useReminderStore((s) => s.addReminder);
  const updateReminder = useReminderStore((s) => s.updateReminder);
  const deleteReminder = useReminderStore((s) => s.deleteReminder);
  const deleteReminderGroup = useReminderStore((s) => s.deleteReminderGroup);
  const deleteReminderGroupByEventGroupId = useReminderStore((s) => s.deleteReminderGroupByEventGroupId);
  const deleteReminders = useReminderStore((s) => s.deleteReminders);

  const reminder = group?.[0];
  const isEdit = !!group;
  const isMultiGroup = (group?.length ?? 0) > 1;
  const isEditable = !isEdit || (!isMultiGroup && reminder?.remindType === "exact");

  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  useEffect(() => {
    if (open) {
      setTitle(reminder?.eventLabel ?? "");
      setSelected(null);
      setConfirmingDelete(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, reminder]);

  const quickPicks = useMemo(
    () => [
      { key: "inHour", label: t("reminder.quickInHour"), date: inHours(1) },
      { key: "tomorrowMorning", label: t("reminder.quickTomorrowMorning"), date: nextDayAt(9) },
      { key: "tomorrowEvening", label: t("reminder.quickTomorrowEvening"), date: nextDayAt(18) },
      { key: "in3Days", label: t("reminder.quickIn3Days"), date: inDaysAt(3, 9) },
    ],
    [t]
  );

  const handleClose = () => {
    setSubmitting(false);
    setConfirmingDelete(false);
    onClose();
  };

  const submit = async () => {
    const label = title.trim();
    if (!label) return;
    // Create requires a time; edit can change just the label and leave
    // the existing schedule alone.
    if (!isEdit && !selected) return;

    setSubmitting(true);
    const ok =
      isEdit && reminder
        ? await updateReminder(reminder.id, label, selected ?? reminder.remindAt)
        : await addReminder(label, selected!);
    setSubmitting(false);
    if (ok) handleClose();
  };

  const handleDelete = async () => {
    if (!reminder) return;
    await deleteReminder(reminder.id);
    handleClose();
  };

  const handleDeleteGroup = async () => {
    if (!group || group.length <= 1 || !reminder) return;
    const eventGroupId = group.find((r) => typeof r.metadata?.event_group_id === "string")
      ?.metadata?.event_group_id as string | undefined;

    // Prefer a hard identifier the server can bulk-cancel by; only fall
    // back to deleting each member individually for reminders grouped
    // solely by the client-side heuristic (created before memoryId/
    // event_group_id existed on this group).
    if (reminder.memoryId) await deleteReminderGroup(reminder.memoryId);
    else if (eventGroupId) await deleteReminderGroupByEventGroupId(eventGroupId);
    else await deleteReminders(group.map((r) => r.id));
    handleClose();
  };

  const canSubmit = title.trim().length > 0 && (isEdit || !!selected) && !submitting;

  return (
    <Dialog open={open} onOpenChange={(next) => !next && handleClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{isEdit ? t("reminder.editTitle") : t("reminder.addTitle")}</DialogTitle>
        </DialogHeader>

        {isEditable ? (
          <div className="space-y-3">
            <Input
              placeholder={t("reminder.titlePlaceholder")}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              autoFocus={!isEdit}
            />
            {isEdit && reminder && (
              <p className="text-xs text-muted-foreground">
                {t("reminder.currentTime", { time: new Date(reminder.remindAt).toLocaleString() })}
              </p>
            )}
            {isEdit && reminder?.actionInstruction && (
              <div className="rounded-lg border border-input bg-muted/40 p-2.5">
                <p className="mb-1 text-xs font-semibold text-foreground">{t("reminder.detailsLabel")}</p>
                <p className="line-clamp-8 text-xs text-muted-foreground">{reminder.actionInstruction}</p>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {quickPicks.map((q) => {
                const isActive = selected === q.date;
                return (
                  <button
                    type="button"
                    key={q.key}
                    onClick={() => setSelected(q.date)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                      isActive
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-input bg-transparent text-foreground hover:bg-muted"
                    )}
                  >
                    {q.label}
                  </button>
                );
              })}
            </div>
          </div>
        ) : isMultiGroup && group ? (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("reminder.groupHint", { count: group.length })}</p>
            {group[0]?.actionInstruction && (
              <div className="rounded-lg border border-input bg-muted/40 p-2.5">
                <p className="mb-1 text-xs font-semibold text-foreground">{t("reminder.detailsLabel")}</p>
                <p className="line-clamp-8 text-xs text-muted-foreground">{group[0].actionInstruction}</p>
              </div>
            )}
            <div className="divide-y divide-border rounded-lg border border-input">
              {group.map((r) => (
                <div key={r.id} className="flex items-center justify-between px-3 py-2 text-xs">
                  <span className="font-medium text-foreground">{remindTypeLabel(t, r.remindType)}</span>
                  <span className="text-muted-foreground">{new Date(r.remindAt).toLocaleString()}</span>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-sm text-muted-foreground">{t("reminder.notEditableHint")}</p>
            {reminder?.actionInstruction && (
              <div className="rounded-lg border border-input bg-muted/40 p-2.5">
                <p className="mb-1 text-xs font-semibold text-foreground">{t("reminder.detailsLabel")}</p>
                <p className="line-clamp-8 text-xs text-muted-foreground">{reminder.actionInstruction}</p>
              </div>
            )}
          </div>
        )}

        <div className="-mx-4 -mb-4 flex items-center gap-2 rounded-b-xl border-t bg-muted/50 px-4 py-3">
          {isEdit &&
            (confirmingDelete ? (
              <div className="mr-auto flex items-center gap-1.5">
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={isMultiGroup ? handleDeleteGroup : handleDelete}
                >
                  {isMultiGroup ? t("reminder.deleteAll", { count: group!.length }) : t("common:delete")}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => setConfirmingDelete(false)}>
                  {t("common:cancel")}
                </Button>
              </div>
            ) : (
              <Button
                variant="destructive"
                size="sm"
                className="mr-auto"
                onClick={() => setConfirmingDelete(true)}
              >
                {isMultiGroup ? t("reminder.deleteAll", { count: group!.length }) : t("common:delete")}
              </Button>
            ))}
          <Button variant="outline" onClick={handleClose}>
            {t("common:cancel")}
          </Button>
          {isEditable && (
            <Button onClick={submit} disabled={!canSubmit}>
              {isEdit ? t("common:save") : t("reminder.create")}
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
