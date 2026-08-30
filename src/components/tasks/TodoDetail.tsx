import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Bot, CheckCircle2, Circle, Trash2, X } from "lucide-react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Switch } from "../ui/switch";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import DueDateCalendar from "./DueDateCalendar";
import { useTodoStore } from "../../stores/todoStore";
import { useAgentStore } from "../../stores/agentStore";
import { useAuthStore } from "../../stores/authStore";
import { getInitials, cn } from "../../lib/utils";
import type { TodoItem } from "../../lib/api";

interface TodoDetailProps {
  /** Present → edit that item. Absent → create mode. */
  todo?: TodoItem;
  /** Create mode: pre-fill the title (e.g. from the quick-add draft). */
  initialTitle?: string;
  /** Create mode: the newly created item, so the caller can keep the pane
   *  on it instead of dropping back to the empty state. */
  onCreated?: (todo: TodoItem) => void;
  /** Dismiss the pane (close button, or after a delete). */
  onClose: () => void;
}

interface DelegateOption {
  id: string | null;
  name: string;
  avatarUrl?: string;
  isAgent: boolean;
}

/**
 * Create/edit pane for a to-do, rendered in the Actions detail column
 * beside the list (the same slot a selected task uses) rather than in a
 * modal. Due date offers a week of quick-pick chips plus an inline month
 * calendar for anything further out; delegate is limited to agents visible
 * in the item's workspace (backend enforces the same). Edit mode diffs
 * against the current item and PATCHes only what changed.
 */
export default function TodoDetail({ todo, initialTitle, onCreated, onClose }: TodoDetailProps) {
  const { t } = useTranslation("tasks");
  const addTodo = useTodoStore((s) => s.addTodo);
  const updateTodo = useTodoStore((s) => s.updateTodo);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const deleteTodo = useTodoStore((s) => s.deleteTodo);
  const agents = useAgentStore((s) => s.agents);
  const me = useAuthStore((s) => s.participant);

  const isEdit = !!todo;
  const done = todo?.status === "done";

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [dueDay, setDueDay] = useState<Date | null>(null);
  const [dueHour, setDueHour] = useState(9);
  const [dueMinute, setDueMinute] = useState(0);
  const [assigneeId, setAssigneeId] = useState<string | null>(null);
  const [remind, setRemind] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  // Re-seed the form whenever the pane switches to a different target.
  // Keyed on the id (not the object) so a WS upsert of the item being
  // edited doesn't wipe in-progress typing.
  useEffect(() => {
    setTitle(todo?.title ?? initialTitle ?? "");
    setDescription(todo?.description ?? "");
    setAssigneeId(todo?.assignee?.id ?? null);
    setRemind(!!todo?.reminder);
    if (todo?.dueAt) {
      const due = new Date(todo.dueAt);
      const day = new Date(due);
      day.setHours(0, 0, 0, 0);
      setDueDay(day);
      setDueHour(due.getHours());
      setDueMinute(due.getMinutes());
    } else {
      setDueDay(null);
      setDueHour(9);
      setDueMinute(0);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [todo?.id]);

  const composedDue = useMemo(() => {
    if (!dueDay) return null;
    const d = new Date(dueDay);
    d.setHours(dueHour, dueMinute, 0, 0);
    return d;
  }, [dueDay, dueHour, dueMinute]);

  const dueIso = composedDue ? composedDue.toISOString() : null;
  const effectiveRemind = remind && !!dueIso;

  // The workspace the item lives in (edit) or will land in (create — the
  // acting workspace). Agents pinned to other workspaces are excluded:
  // they'd never see a workspace-scoped item delegated to them, and the
  // backend rejects them (:assignee_not_in_workspace).
  const scopeOrgId = todo ? todo.organizationId : (me?.activeOrganizationId ?? null);

  const delegateOptions = useMemo<DelegateOption[]>(() => {
    const options: DelegateOption[] = [{ id: null, name: t("todo.noDelegate"), isAgent: false }];
    if (me) options.push({ id: me.id, name: t("common:you"), avatarUrl: me.avatarUrl, isAgent: false });
    for (const managed of Object.values(agents)) {
      const agent = managed.agent;
      const visibleHere =
        scopeOrgId == null || !agent.organizationIds || agent.organizationIds.includes(scopeOrgId);
      if (visibleHere) {
        options.push({ id: agent.id, name: agent.displayName, avatarUrl: agent.avatarUrl, isAgent: true });
      }
    }
    return options;
  }, [me, agents, scopeOrgId, t]);

  const submit = async () => {
    const trimmed = title.trim();
    if (!trimmed) return;
    setSubmitting(true);

    if (isEdit && todo) {
      const patch: Record<string, unknown> = {};
      if (trimmed !== todo.title) patch.title = trimmed;
      const currentDescription = todo.description ?? "";
      if (description.trim() !== currentDescription) {
        patch.description = description.trim() === "" ? null : description.trim();
      }
      const currentDueMs = todo.dueAt ? new Date(todo.dueAt).getTime() : null;
      const newDueMs = composedDue ? composedDue.getTime() : null;
      if (currentDueMs !== newDueMs) patch.dueAt = dueIso;
      const currentAssignee = todo.assignee?.id ?? null;
      if (assigneeId !== currentAssignee) patch.assigneeId = assigneeId;
      const currentRemind = !!todo.reminder;
      if (effectiveRemind !== currentRemind) patch.remind = effectiveRemind;

      if (Object.keys(patch).length > 0) await updateTodo(todo.id, patch);
      setSubmitting(false);
      // Stay on the item — the pane is the detail view, not a modal.
      return;
    }

    const created = await addTodo({
      title: trimmed,
      description: description.trim() || undefined,
      dueAt: dueIso ?? undefined,
      assigneeId: assigneeId ?? undefined,
      remind: effectiveRemind || undefined,
    });
    setSubmitting(false);
    if (created) onCreated?.(created);
  };

  const handleDelete = async () => {
    if (!todo) return;
    await deleteTodo(todo.id);
    onClose();
  };

  const canSubmit = title.trim().length > 0 && !submitting;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <header className="px-6 py-4 border-b border-border bg-card">
        <div className="flex items-center gap-3">
          {isEdit && todo && (
            <button
              type="button"
              onClick={() => toggleTodo(todo.id)}
              aria-label={done ? t("todo.reopen") : todo.title}
              className="shrink-0 text-muted-foreground hover:text-primary"
            >
              {done ? (
                <CheckCircle2 className="h-[22px] w-[22px] text-primary" />
              ) : (
                <Circle className="h-[22px] w-[22px]" />
              )}
            </button>
          )}
          <h1 className="min-w-0 flex-1 truncate text-lg font-semibold leading-tight">
            {isEdit ? t("todo.sheetEdit") : t("todo.sheetNew")}
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
        {isEdit && todo && (
          <p className="mt-1.5 text-xs text-muted-foreground">
            {done && todo.completedBy
              ? t("todo.completedBy", { name: todo.completedBy.displayName })
              : t("todo.addedBy", { name: todo.createdBy.displayName })}
          </p>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5 space-y-4">
        <Input
          placeholder={t("todo.addPlaceholder")}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          autoFocus={!isEdit}
        />

        <div>
          <p className="mb-1 text-sm font-semibold text-foreground">{t("todo.detailsLabel")}</p>
          <Textarea
            placeholder={t("todo.detailsPlaceholder")}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold text-foreground">{t("todo.dueLabel")}</p>
          <DueDateCalendar
            value={dueDay}
            onChange={setDueDay}
            hour={dueHour}
            minute={dueMinute}
            onTimeChange={(h, m) => {
              setDueHour(h);
              setDueMinute(m);
            }}
          />
        </div>

        <div>
          <p className="mb-1 text-sm font-semibold text-foreground">{t("todo.delegateLabel")}</p>
          <div className="flex flex-wrap gap-1.5">
            {delegateOptions.map((option) => {
              const isActive = assigneeId === option.id;
              return (
                <button
                  type="button"
                  key={option.id ?? "none"}
                  onClick={() => setAssigneeId(option.id)}
                  className={cn(
                    "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-transparent text-foreground hover:bg-muted"
                  )}
                >
                  {option.id && (
                    <Avatar className="h-4 w-4">
                      {option.avatarUrl && <AvatarImage src={option.avatarUrl} />}
                      <AvatarFallback className="text-[7px]">
                        {option.isAgent ? <Bot className="h-2.5 w-2.5" /> : getInitials(option.name)}
                      </AvatarFallback>
                    </Avatar>
                  )}
                  {option.name}
                </button>
              );
            })}
          </div>
        </div>

        {dueDay && (
          <div className="flex items-center justify-between pt-1">
            <span className="text-sm text-foreground">{t("todo.remindLabel")}</span>
            <Switch checked={remind} onCheckedChange={setRemind} />
          </div>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-2 border-t border-border px-6 py-4">
        {isEdit && (
          <Button variant="destructive" size="icon" onClick={handleDelete} className="mr-auto">
            <Trash2 className="h-4 w-4" />
          </Button>
        )}
        <Button className="ml-auto" onClick={submit} disabled={!canSubmit}>
          {isEdit ? t("common:save") : t("common:add")}
        </Button>
      </div>
    </div>
  );
}
