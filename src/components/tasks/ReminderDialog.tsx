import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "../ui/dialog";
import ReminderForm from "./ReminderForm";
import type { AgentReminder } from "../../lib/api";

interface ReminderDialogProps {
  open: boolean;
  onClose: () => void;
  /** Present → edit/delete (a single reminder) or view/delete-all (2+
   *  sharing a source event). Absent → create mode. */
  group?: AgentReminder[];
}

/**
 * Modal wrapper around `ReminderForm`, used where there's no detail column
 * to render into (an agent's own Reminders section). The Actions view uses
 * `ReminderDetail` instead — same form, panel chrome.
 */
export default function ReminderDialog({ open, onClose, group }: ReminderDialogProps) {
  const { t } = useTranslation("tasks");

  return (
    <Dialog open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{group ? t("reminder.editTitle") : t("reminder.addTitle")}</DialogTitle>
        </DialogHeader>
        {/* Remount per target so the form re-seeds from the new group. */}
        <ReminderForm key={group?.[0]?.id ?? "new"} group={group} onDone={onClose} variant="dialog" />
      </DialogContent>
    </Dialog>
  );
}
