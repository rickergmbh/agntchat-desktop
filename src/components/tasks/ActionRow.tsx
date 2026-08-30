import { useTranslation } from "react-i18next";
import { Bell, Bot, CheckCircle2, Circle, Clock, Repeat } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { formatSchedule } from "../AgentRoutines";
import { useTodoStore } from "../../stores/todoStore";
import { useTaskStore } from "../../stores/taskStore";
import { cn, formatConversationTime, formatFutureTime, getInitials } from "../../lib/utils";
import type { Agent, Routine, Task, TodoItem } from "../../lib/api";
import type { MergedItem } from "../../hooks/useUnifiedActions";
import type { ActionSelection } from "./selection";

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-warning/10 text-warning border-warning/30",
  accepted: "bg-primary/10 text-primary border-primary/30",
  in_progress: "bg-warning/10 text-warning border-warning/30",
  blocked: "bg-destructive/10 text-destructive border-destructive/30",
  complete: "bg-success/10 text-success border-success/30",
  cancelled: "bg-muted text-muted-foreground border-border",
  failed: "bg-destructive/10 text-destructive border-destructive/30",
  rejected: "bg-destructive/10 text-destructive border-destructive/30",
  exhausted: "bg-muted text-muted-foreground border-border",
};

const STATUS_LABEL_KEY: Record<string, string> = {
  pending: "status.pending",
  accepted: "status.accepted",
  in_progress: "status.inProgress",
  blocked: "status.blocked",
  complete: "status.complete",
  cancelled: "status.cancelled",
  failed: "status.failed",
  rejected: "status.rejected",
  exhausted: "status.exhausted",
};

interface ActionRowProps {
  item: MergedItem;
  agentsById: Map<string, Agent>;
  myId?: string;
  /** Row is what the detail column is currently showing. */
  isSelected: boolean;
  /** Hand a to-do/reminder to the detail column. Tasks select through
   *  `taskStore` instead — chat cards deep-link into the same state. */
  onSelect: (next: ActionSelection) => void;
}

/** Selected rows read as the list half of a list/detail pair, so the
 *  detail column always has a visible origin. */
const SELECTED_ROW_CLASS = "bg-accent";

export default function ActionRow({ item, agentsById, myId, isSelected, onSelect }: ActionRowProps) {
  if (item.kind === "task") return <TaskCard task={item.task} isSelected={isSelected} onSelect={onSelect} />;
  if (item.kind === "todo") {
    return (
      <TodoCard
        todo={item.todo}
        isSelected={isSelected}
        onOpen={() => onSelect({ kind: "todo", id: item.id })}
      />
    );
  }
  if (item.kind === "reminder") {
    const agent = agentsById.get(item.reminder.agentId);
    return (
      <ReminderCard
        item={item}
        agent={agent}
        isSelf={item.reminder.agentId === myId}
        isSelected={isSelected}
        onOpen={() => onSelect({ kind: "reminder", id: item.id })}
      />
    );
  }
  const agent = agentsById.get(item.routine.participantId);
  return (
    <RoutineCard
      routine={item.routine}
      agent={agent}
      isSelected={isSelected}
      onOpen={() => onSelect({ kind: "routine", id: item.id })}
    />
  );
}

function TaskCard({
  task,
  isSelected,
  onSelect,
}: {
  task: Task;
  isSelected: boolean;
  onSelect: (next: ActionSelection) => void;
}) {
  const { t } = useTranslation("tasks");
  const selectTask = useTaskStore((s) => s.selectTask);
  const assignee = task.assignees?.[0];
  const name = assignee?.displayName ?? t("unassigned");
  const statusClass = STATUS_COLORS[task.status] ?? STATUS_COLORS.cancelled;

  return (
    <button
      type="button"
      onClick={() => {
        onSelect(null);
        selectTask(task.id);
      }}
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
        isSelected && SELECTED_ROW_CLASS
      )}
    >
      <Avatar className="h-7 w-7 shrink-0">
        {assignee?.avatarUrl && <AvatarImage src={assignee.avatarUrl} />}
        <AvatarFallback className="text-[10px]">{getInitials(name)}</AvatarFallback>
      </Avatar>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{task.title || t("untitledAction")}</p>
        <div className="mt-0.5 flex items-center gap-1.5">
          <span className={cn("rounded-md border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide", statusClass)}>
            {STATUS_LABEL_KEY[task.status] ? t(STATUS_LABEL_KEY[task.status]) : task.status.replace(/_/g, " ")}
          </span>
          <span className="truncate text-[11px] text-muted-foreground">{name}</span>
        </div>
      </div>
      <span className="shrink-0 text-[10px] text-muted-foreground">
        {formatConversationTime(task.updatedAt)}
      </span>
    </button>
  );
}

function TodoCard({ todo, isSelected, onOpen }: { todo: TodoItem; isSelected: boolean; onOpen: () => void }) {
  const { t } = useTranslation("tasks");
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const done = todo.status === "done";
  const author = todo.createdBy;

  const dueMs = todo.dueAt ? new Date(todo.dueAt).getTime() : undefined;
  const dueOverdue = dueMs !== undefined && dueMs < Date.now();
  const dueSoon = dueMs !== undefined && dueMs - Date.now() < 24 * 3600_000;
  const dueClass = dueOverdue ? "text-destructive" : dueSoon ? "text-warning" : "text-muted-foreground";

  return (
    <div
      className={cn(
        "group flex items-start gap-2.5 rounded-lg px-3 py-2 transition-colors hover:bg-accent",
        isSelected && SELECTED_ROW_CLASS
      )}
    >
      <button
        type="button"
        onClick={() => toggleTodo(todo.id)}
        aria-label={done ? t("todo.reopen") : todo.title}
        className="mt-0.5 shrink-0 text-muted-foreground hover:text-primary"
      >
        {done ? <CheckCircle2 className="h-[22px] w-[22px] text-primary" /> : <Circle className="h-[22px] w-[22px]" />}
      </button>
      <button type="button" onClick={onOpen} className="min-w-0 flex-1 text-left">
        <p className={cn("truncate text-sm", done && "text-muted-foreground line-through")}>{todo.title}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
          <Avatar className="h-3.5 w-3.5">
            {author.avatarUrl && <AvatarImage src={author.avatarUrl} />}
            <AvatarFallback className="text-[7px]">
              {author.type === "agent" ? <Bot className="h-2 w-2" /> : getInitials(author.displayName)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">
            {done && todo.completedBy
              ? t("todo.completedBy", { name: todo.completedBy.displayName })
              : t("todo.addedBy", { name: author.displayName })}
          </span>
          <span className="shrink-0">
            · {formatConversationTime(done && todo.completedAt ? todo.completedAt : todo.insertedAt)}
          </span>
        </div>
        {!done && (todo.dueAt || todo.assignee || todo.reminder) && (
          <div className="mt-1 flex items-center gap-2">
            {todo.dueAt && (
              <span className={cn("flex items-center gap-1 text-[11px]", dueClass)}>
                <Clock className="h-3 w-3" />
                {dueOverdue ? t("deadlineOverdue") : t("deadlineDue", { time: formatFutureTime(todo.dueAt) })}
              </span>
            )}
            {todo.reminder && <Bell className="h-3 w-3 text-warning" />}
            {todo.assignee && (
              <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
                <Avatar className="h-3.5 w-3.5">
                  {todo.assignee.avatarUrl && <AvatarImage src={todo.assignee.avatarUrl} />}
                  <AvatarFallback className="text-[7px]">
                    {todo.assignee.type === "agent" ? <Bot className="h-2 w-2" /> : getInitials(todo.assignee.displayName)}
                  </AvatarFallback>
                </Avatar>
                {todo.assignee.displayName}
              </span>
            )}
          </div>
        )}
      </button>
    </div>
  );
}

function ReminderCard({
  item,
  agent,
  isSelf,
  isSelected,
  onOpen,
}: {
  item: MergedItem & { kind: "reminder" };
  agent?: Agent;
  isSelf: boolean;
  isSelected: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation("tasks");
  const { reminder, group } = item;
  const name = isSelf ? t("common:you") : agent?.displayName ?? t("agents:thisAgent");
  const isGrouped = group.length > 1;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
        isSelected && SELECTED_ROW_CLASS
      )}
    >
      <Bell className="h-5 w-5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{reminder.eventLabel}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          {!isSelf && (
            <Avatar className="h-3.5 w-3.5">
              {agent?.avatarUrl && <AvatarImage src={agent.avatarUrl} />}
              <AvatarFallback className="text-[7px]"><Bot className="h-2 w-2" /></AvatarFallback>
            </Avatar>
          )}
          <span className="truncate">
            {name}
            {isGrouped ? ` · ${t("reminder.seriesCount", { count: group.length })}` : ""} ·{" "}
            {formatFutureTime(reminder.remindAt)}
          </span>
        </div>
        {reminder.actionInstruction && (
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{reminder.actionInstruction}</p>
        )}
      </div>
    </button>
  );
}

function RoutineCard({
  routine,
  agent,
  isSelected,
  onOpen,
}: {
  routine: Routine;
  agent?: Agent;
  isSelected: boolean;
  onOpen: () => void;
}) {
  const { t } = useTranslation("tasks");
  const agentName = agent?.displayName ?? t("agents:thisAgent");
  const nextRun = routine.nextRunAt
    ? t("agents:routines.nextRun", { time: formatFutureTime(routine.nextRunAt) })
    : t("agents:routines.notScheduled");

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
        isSelected && SELECTED_ROW_CLASS
      )}
    >
      <Repeat className="h-5 w-5 shrink-0 text-info" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{routine.name}</p>
        <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Avatar className="h-3.5 w-3.5">
            {agent?.avatarUrl && <AvatarImage src={agent.avatarUrl} />}
            <AvatarFallback className="text-[7px]"><Bot className="h-2 w-2" /></AvatarFallback>
          </Avatar>
          <span className="truncate">
            {agentName} · {formatSchedule(routine.scheduleType, routine.scheduleConfig as Record<string, unknown>)} · {nextRun}
          </span>
        </div>
      </div>
    </button>
  );
}
