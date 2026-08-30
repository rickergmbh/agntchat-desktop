import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, ChevronDown, ChevronRight, ListTodo, Loader2, Plus, Search, SlidersHorizontal, X } from "lucide-react";
import { Input } from "../ui/input";
import { useUnifiedActions, type Person } from "../../hooks/useUnifiedActions";
import { useTodoStore } from "../../stores/todoStore";
import { useTaskStore } from "../../stores/taskStore";
import { useAuthStore } from "../../stores/authStore";
import ActionRow from "./ActionRow";
import { cn } from "../../lib/utils";
import type { ActionSelection } from "./selection";

/**
 * The unified Actions list — merges to-dos, agent tasks, reminders, and
 * routines into one kind-segmented feed (To-dos, Actions, Reminders,
 * Routines, then a collapsible Completed section). Direct port of
 * mobile's app/(main)/(tabs)/(tasks)/index.tsx, replacing the old
 * Tasks/To-dos tab split — everything lives in this one list now.
 *
 * Rows never open a modal: picking one hands the selection up to
 * `TasksView`, which renders it in the detail column.
 */
export function ActionsList({
  width,
  innerRef,
  selection,
  onSelect,
}: {
  /** Resizable width in px (from useResizableWidth). */
  width?: number;
  /** Ref to the aside — its left edge is the resize drag origin. */
  innerRef?: React.RefObject<HTMLElement | null>;
  /** What the detail column is showing (null → a task, or nothing). */
  selection: ActionSelection;
  onSelect: (next: ActionSelection) => void;
}) {
  const { t } = useTranslation("tasks");
  const {
    sections,
    people,
    personFilter,
    setPersonFilter,
    searchQuery,
    setSearchQuery,
    showCompleted,
    setShowCompleted,
    doneCount,
    loading,
    agentsById,
    myId,
  } = useUnifiedActions();

  const addTodo = useTodoStore((s) => s.addTodo);
  const myParticipantId = useAuthStore((s) => s.participant?.id);
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);

  const [draft, setDraft] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);

  const submitDraft = async () => {
    const title = draft.trim();
    if (!title) return;
    setDraft("");
    const created = await addTodo({ title });
    if (!created) setDraft(title);
  };

  const hasAnyFilter = personFilter !== "all" || searchQuery.length > 0;
  const totalItems = sections.reduce((n, s) => n + s.data.length, 0);

  const personLabel = (p: Person | { id: "all" }) => {
    if (p.id === "all") return t("todo.filterAll");
    if (p.id === myParticipantId) return t("common:you");
    return (p as Person).displayName;
  };

  return (
    <aside
      ref={innerRef}
      className="relative z-0 shrink-0 flex flex-col bg-canvas"
      style={{ width: width ?? 320, WebkitAppRegion: "drag" } as React.CSSProperties}
    >
      <div
        className="h-14 shrink-0 px-4 border-b border-border flex items-center"
        style={{ WebkitAppRegion: "drag" } as React.CSSProperties}
      >
        <h2 className="text-sm font-semibold text-foreground">{t("nav:tasks")}</h2>
      </div>

      <div className="flex min-h-0 flex-1 flex-col px-3" style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}>
      {/* Pinned add-to-do row — enter for a quick title-only item, the
          sliders icon for the full editor in the detail column
          (due/delegate/remind/details). */}
      <div className="flex items-center gap-2 pt-3 pb-2">
        <Plus className="h-4 w-4 shrink-0 text-muted-foreground" />
        <Input
          placeholder={t("todo.addPlaceholder")}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") submitDraft();
          }}
          className="h-9 flex-1 text-sm"
        />
        <button
          type="button"
          onClick={() => onSelect({ kind: "todo", id: null, draftTitle: draft })}
          className="shrink-0 rounded p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <SlidersHorizontal className="h-4 w-4" />
        </button>
      </div>

      {/* Toolbar — person filter chips + add-reminder + search toggle. */}
      {searchOpen ? (
        <div className="flex items-center gap-1.5 pb-2">
          <div className="flex flex-1 items-center gap-1.5 rounded-lg bg-muted px-2.5 py-1.5">
            <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
            <input
              autoFocus
              placeholder={t("unified.searchPlaceholder")}
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <button
            type="button"
            onClick={() => {
              setSearchQuery("");
              setSearchOpen(false);
            }}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-1 pb-2">
          <div className="flex flex-1 gap-1.5 overflow-x-auto">
            {([{ id: "all" } as const, ...people] as (Person | { id: "all" })[]).map((p) => {
              const isActive = personFilter === p.id;
              return (
                <button
                  type="button"
                  key={p.id}
                  onClick={() => setPersonFilter(p.id)}
                  className={cn(
                    "shrink-0 rounded-full border px-2.5 py-1.5 text-xs font-medium transition-colors",
                    isActive
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-input bg-transparent text-foreground hover:bg-muted"
                  )}
                >
                  {personLabel(p)}
                </button>
              );
            })}
          </div>
          <button
            type="button"
            onClick={() => onSelect({ kind: "reminder", id: null })}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
            title={t("reminder.addTitle")}
          >
            <Bell className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={() => setSearchOpen(true)}
            className="shrink-0 rounded-full p-1.5 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Search className="h-4 w-4" />
          </button>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto pb-6">
        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        ) : totalItems === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <ListTodo className="mb-3 h-10 w-10 text-muted-foreground/40" />
            <p className="text-sm font-medium text-foreground">
              {hasAnyFilter ? t("unified.noMatching") : t("unified.empty")}
            </p>
            <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
              {hasAnyFilter ? t("common:tryAdjustingFilters") : t("unified.emptyHint")}
            </p>
          </div>
        ) : (
          sections.map((section) => (
            <div key={section.key}>
              <SectionHeader
                sectionKey={section.key}
                count={section.key === "done" ? doneCount : section.data.length}
                showCompleted={showCompleted}
                onToggleCompleted={() => setShowCompleted((v) => !v)}
              />
              {section.data.map((item) => (
                <ActionRow
                  key={`${item.kind}-${item.id}`}
                  item={item}
                  agentsById={agentsById}
                  myId={myId}
                  isSelected={
                    item.kind === "task"
                      ? !selection && selectedTaskId === item.id
                      : selection?.kind === item.kind && selection.id === item.id
                  }
                  onSelect={onSelect}
                />
              ))}
            </div>
          ))
        )}
      </div>
      </div>
    </aside>
  );
}

function SectionHeader({
  sectionKey,
  count,
  showCompleted,
  onToggleCompleted,
}: {
  sectionKey: "todos" | "tasks" | "reminders" | "routines" | "done";
  count: number;
  showCompleted: boolean;
  onToggleCompleted: () => void;
}) {
  const { t } = useTranslation("tasks");

  if (sectionKey === "done") {
    return (
      <button
        onClick={onToggleCompleted}
        className="mt-3 flex w-full items-center gap-1 px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground"
      >
        {showCompleted ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
        {t("todo.completedSection")}
        <span className="text-muted-foreground/70">({count})</span>
      </button>
    );
  }

  const label =
    sectionKey === "todos"
      ? t("todo.tab")
      : sectionKey === "tasks"
        ? t("actions")
        : sectionKey === "reminders"
          ? t("unified.remindersSection")
          : t("agents:routines.title");

  return (
    <div className="mt-3 flex items-center gap-1.5 px-3 py-1">
      <span className="text-[11px] font-semibold text-muted-foreground">
        {label} ({count})
      </span>
    </div>
  );
}
