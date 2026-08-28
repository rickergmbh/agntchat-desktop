import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bot,
  ChevronDown,
  ChevronRight,
  ListTodo,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";
import { useTodoStore } from "../../stores/todoStore";
import { useAuthStore } from "../../stores/authStore";
import type { TodoItem } from "../../lib/api";
import { Avatar, AvatarFallback, AvatarImage } from "../ui/avatar";
import { Input } from "../ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../ui/select";
import { cn, formatConversationTime, getInitials } from "../../lib/utils";

/** Tasks / To-dos segmented switch shown in the Tasks area header. */
export function TasksModeToggle({
  mode,
  onChange,
}: {
  mode: "tasks" | "todos";
  onChange: (mode: "tasks" | "todos") => void;
}) {
  const { t } = useTranslation("tasks");
  return (
    <div
      className="flex rounded-lg bg-muted p-0.5 text-xs"
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      {(["tasks", "todos"] as const).map((value) => (
        <button
          key={value}
          onClick={() => onChange(value)}
          className={cn(
            "rounded-md px-2.5 py-1 font-medium transition-colors",
            mode === value
              ? "bg-card text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {value === "tasks" ? t("nav:tasks") : t("todo.tab")}
        </button>
      ))}
    </div>
  );
}

function TodoRow({
  todo,
  onToggle,
  onDelete,
}: {
  todo: TodoItem;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation("tasks");
  const done = todo.status === "done";
  const author = todo.createdBy;

  return (
    <div className="group flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-accent">
      <input
        type="checkbox"
        checked={done}
        onChange={onToggle}
        aria-label={done ? t("todo.reopen") : todo.title}
        className="h-4 w-4 shrink-0 cursor-pointer accent-primary"
      />
      <div className="min-w-0 flex-1">
        <div className={cn("truncate text-sm", done && "text-muted-foreground line-through")}>
          {todo.title}
        </div>
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
      </div>
      <button
        onClick={onDelete}
        title={t("common:delete")}
        className="shrink-0 rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-destructive group-hover:opacity-100"
      >
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}

export function TodoList() {
  const { t } = useTranslation("tasks");
  const todos = useTodoStore((s) => s.todos);
  const loading = useTodoStore((s) => s.loading);
  const errorKey = useTodoStore((s) => s.errorKey);
  const fetchTodos = useTodoStore((s) => s.fetchTodos);
  const addTodo = useTodoStore((s) => s.addTodo);
  const toggleTodo = useTodoStore((s) => s.toggleTodo);
  const deleteTodo = useTodoStore((s) => s.deleteTodo);

  const myId = useAuthStore((s) => s.participant?.id);
  // Refetch on workspace switch — the list is workspace-scoped.
  const activeOrgId = useAuthStore((s) => s.participant?.activeOrganizationId);

  const [draft, setDraft] = useState("");
  const [authorFilter, setAuthorFilter] = useState<string>("all");
  const [showCompleted, setShowCompleted] = useState(true);

  useEffect(() => {
    fetchTodos();
  }, [fetchTodos, activeOrgId]);

  const authors = useMemo(() => {
    const map = new Map<string, TodoItem["createdBy"]>();
    for (const todo of todos) map.set(todo.createdBy.id, todo.createdBy);
    return [...map.values()];
  }, [todos]);

  const visible = useMemo(
    () => (authorFilter === "all" ? todos : todos.filter((t) => t.createdBy.id === authorFilter)),
    [todos, authorFilter]
  );
  const open = visible.filter((t) => t.status === "open");
  const completed = visible.filter((t) => t.status === "done");

  const submitDraft = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const ok = await addTodo(title);
    if (!ok) setDraft(title);
  };

  const authorLabel = (id: string) => {
    if (id === "all") return t("todo.filterAll");
    const author = authors.find((a) => a.id === id);
    if (!author) return id;
    return author.id === myId ? t("common:you") : author.displayName;
  };

  return (
    <div className="mx-auto flex h-full w-full max-w-2xl flex-col px-6">
      <div className="flex items-center gap-2 pt-6 pb-3">
        <ListTodo className="h-4 w-4 text-muted-foreground" />
        <h2 className="text-sm font-semibold">{t("todo.tab")}</h2>
        <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
          {open.length}
        </span>
        {authors.length > 1 && (
          <div className="ml-auto w-40">
            <Select value={authorFilter} onValueChange={(v) => v && setAuthorFilter(v)}>
              <SelectTrigger className="h-7 text-xs">
                <SelectValue>{(v: string) => authorLabel(v)}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">{t("todo.filterAll")}</SelectItem>
                {authors.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.id === myId ? t("common:you") : a.displayName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}
      </div>

      <div className="relative pb-2">
        <Plus className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          placeholder={t("todo.addPlaceholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitDraft();
          }}
          className="h-9 pl-8 text-sm"
        />
      </div>

      {errorKey && (
        <p className="pb-2 text-xs text-destructive">{t(`todo.${errorKey}`)}</p>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {loading && todos.length === 0 && (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!loading && visible.length === 0 && (
          <div className="py-10 text-center">
            <p className="text-sm font-medium text-foreground">{t("todo.empty")}</p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              {t("todo.emptyHint")}
            </p>
          </div>
        )}

        {open.map((todo) => (
          <TodoRow
            key={todo.id}
            todo={todo}
            onToggle={() => toggleTodo(todo.id)}
            onDelete={() => deleteTodo(todo.id)}
          />
        ))}

        {completed.length > 0 && (
          <>
            <button
              onClick={() => setShowCompleted((v) => !v)}
              className="mt-3 flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
            >
              {showCompleted ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              {t("todo.completedSection")}
              <span className="text-muted-foreground/70">({completed.length})</span>
            </button>
            {showCompleted &&
              completed.map((todo) => (
                <TodoRow
                  key={todo.id}
                  todo={todo}
                  onToggle={() => toggleTodo(todo.id)}
                  onDelete={() => deleteTodo(todo.id)}
                />
              ))}
          </>
        )}
      </div>
    </div>
  );
}
