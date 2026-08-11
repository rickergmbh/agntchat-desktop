import { useEffect, useState, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import i18n from "../i18n";
import { useAgentStore } from "../stores/agentStore";
import { useChatStore } from "../stores/chatStore";
import { useAuthStore } from "../stores/authStore";
import {
  useActiveWorkspace,
  useWorkspaces,
  useWorkspacesEnabled,
} from "../stores/workspaceStore";
import {
  type Routine,
  listRoutines,
  createRoutine,
  updateRoutine,
  deleteRoutine,
  pauseRoutine,
  resumeRoutine,
} from "../lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ModelOverrideField } from "./ModelOverrideField";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Timer,
  Plus,
  Pause,
  Play,
  Trash2,
  Pencil,
  Clock,
  AlertTriangle,
} from "lucide-react";

const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: String(i) }));

// AM/PM label for hour `i` (0-23), resolved via the i18n singleton at call
// time so language switches stay live (never t() at module scope, since
// HOURS/hourLabel are module-level).
function hourLabel(i: number): string {
  const period = i < 12 ? i18n.t("common:time.am") : i18n.t("common:time.pm");
  const h12 = i === 0 ? 12 : i <= 12 ? i : i - 12;
  return `${h12}:00 ${period}`;
}

// Key suffixes only — resolved via i18n.t at call time so language
// switches stay live (never t() at module scope).
const DOW_KEYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
const dowShort = (i: number) => i18n.t(`common:daysShort.${DOW_KEYS[i]}`);

// Parse a cron day-of-week field ("*", "1-5", "0,6", "1,3,5") into a sorted
// list of 0..6 (Sunday=0).
function parseDowField(field: string): number[] {
  if (!field || field === "*") return [0, 1, 2, 3, 4, 5, 6];
  const set = new Set<number>();
  for (const part of field.split(",")) {
    const trimmed = part.trim();
    if (trimmed.includes("-")) {
      const [a, b] = trimmed.split("-").map((x) => parseInt(x, 10));
      if (!isNaN(a) && !isNaN(b)) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) {
          if (i >= 0 && i <= 6) set.add(i);
        }
      }
    } else {
      const n = parseInt(trimmed, 10);
      if (!isNaN(n) && n >= 0 && n <= 6) set.add(n);
    }
  }
  return Array.from(set).sort((a, b) => a - b);
}

function buildDowField(days: number[]): string {
  if (days.length === 7) return "*";
  return [...days].sort((a, b) => a - b).join(",");
}

type ScheduleMode = "interval" | "hourly" | "datetime" | "custom";

interface ScheduleState {
  mode: ScheduleMode;
  intervalMinutes: number;
  cronHour: string;
  cronMinute: string;
  selectedDays: number[];
  customCron: string;
}

function defaultScheduleState(): ScheduleState {
  return {
    mode: "datetime",
    intervalMinutes: 60,
    cronHour: "9",
    cronMinute: "0",
    selectedDays: [0, 1, 2, 3, 4, 5, 6],
    customCron: "",
  };
}

function parseRoutineSchedule(routine: Routine): ScheduleState {
  const base = defaultScheduleState();
  if (routine.scheduleType === "interval") {
    const mins = Number(
      routine.scheduleConfig.every_minutes ??
        routine.scheduleConfig.minutes ??
        60,
    );
    return { ...base, mode: "interval", intervalMinutes: mins };
  }
  const expr = String(
    routine.scheduleConfig.expression || routine.scheduleConfig.cron || "0 9 * * *",
  );
  const parts = expr.split(/\s+/);
  if (parts.length !== 5) return { ...base, mode: "custom", customCron: expr };
  const [min, hour, dom, mon, dow] = parts;
  if (hour === "*" && dom === "*" && mon === "*" && dow === "*") {
    return { ...base, mode: "hourly", cronMinute: min };
  }
  const minN = parseInt(min, 10);
  const hourN = parseInt(hour, 10);
  if (!isNaN(minN) && !isNaN(hourN) && dom === "*" && mon === "*") {
    return {
      ...base,
      mode: "datetime",
      cronHour: String(hourN),
      cronMinute: String(minN),
      selectedDays: parseDowField(dow),
    };
  }
  return { ...base, mode: "custom", customCron: expr };
}

function buildScheduleConfig(state: ScheduleState): {
  scheduleType: string;
  scheduleConfig: Record<string, unknown>;
} {
  switch (state.mode) {
    case "interval":
      return {
        scheduleType: "interval",
        scheduleConfig: { every_minutes: state.intervalMinutes || 1 },
      };
    case "hourly":
      return {
        scheduleType: "cron",
        scheduleConfig: { expression: `${state.cronMinute || "0"} * * * *` },
      };
    case "custom":
      return {
        scheduleType: "cron",
        scheduleConfig: { expression: state.customCron.trim() || "0 9 * * *" },
      };
    case "datetime":
    default: {
      const dow = buildDowField(state.selectedDays);
      return {
        scheduleType: "cron",
        scheduleConfig: {
          expression: `${state.cronMinute || "0"} ${state.cronHour || "0"} * * ${dow}`,
        },
      };
    }
  }
}

const SCHEDULE_MODES: Array<{ key: ScheduleMode; labelKey: string }> = [
  { key: "interval", labelKey: "routines.mode.interval" },
  { key: "hourly", labelKey: "routines.mode.hourly" },
  { key: "datetime", labelKey: "routines.mode.datetime" },
  { key: "custom", labelKey: "routines.mode.custom" },
];

const DAY_PRESETS: Array<{ key: string; labelKey: string; days: number[] }> = [
  { key: "all", labelKey: "routines.everyDay", days: [0, 1, 2, 3, 4, 5, 6] },
  { key: "weekdays", labelKey: "routines.weekdays", days: [1, 2, 3, 4, 5] },
  { key: "weekends", labelKey: "routines.weekends", days: [0, 6] },
];

function describeSchedule(state: ScheduleState): string {
  switch (state.mode) {
    case "interval": {
      const m = state.intervalMinutes;
      if (m >= 1440)
        return i18n.t("agents:routines.everyDays", { count: Math.round(m / 1440) });
      if (m >= 60 && m % 60 === 0)
        return i18n.t("agents:routines.everyHours", { count: m / 60 });
      return i18n.t("agents:routines.everyMinutes", { count: m });
    }
    case "hourly":
      return i18n.t("agents:routines.everyHourAt", {
        minute: (state.cronMinute || "0").padStart(2, "0"),
      });
    case "custom":
      return i18n.t("agents:routines.customCronExpression");
    case "datetime":
    default: {
      const hourValue = parseInt(state.cronHour, 10);
      const formattedHourLabel = !isNaN(hourValue)
        ? hourLabel(hourValue).replace(
            ":00",
            `:${(state.cronMinute || "0").padStart(2, "0")}`,
          )
        : `${state.cronHour}:${(state.cronMinute || "0").padStart(2, "0")}`;
      const days = state.selectedDays;
      let dayLabel: string;
      if (days.length === 7) dayLabel = i18n.t("agents:routines.everyDay");
      else if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)))
        dayLabel = i18n.t("agents:routines.weekdays");
      else if (days.length === 2 && days.includes(0) && days.includes(6))
        dayLabel = i18n.t("agents:routines.weekends");
      else if (days.length === 0) dayLabel = i18n.t("agents:routines.noDaysSelected");
      else dayLabel = days.map((d) => dowShort(d)).join(", ");
      return i18n.t("agents:routines.daysAtTimeUtc", { days: dayLabel, time: formattedHourLabel });
    }
  }
}

interface AgentRoutinesProps {
  agentId: string;
}

function formatHourMinute12h(hour: number, minute: number): string {
  const period = hour < 12 ? i18n.t("common:time.am") : i18n.t("common:time.pm");
  const h = hour === 0 ? 12 : hour <= 12 ? hour : hour - 12;
  const m = String(minute).padStart(2, "0");
  return `${h}:${m} ${period}`;
}

function humanizeCron(expr: string): string {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return expr;
  const [minStr, hourStr, dom, mon, dow] = parts;
  const minute = parseInt(minStr, 10);
  const hour = parseInt(hourStr, 10);

  if (hourStr === "*" && dom === "*" && mon === "*" && dow === "*" && !isNaN(minute)) {
    return minute === 0
      ? i18n.t("agents:routines.everyHour")
      : i18n.t("agents:routines.everyHourAt", {
          minute: String(minute).padStart(2, "0"),
        });
  }

  if (isNaN(hour) || isNaN(minute)) return expr;
  const time = formatHourMinute12h(hour, minute);

  if (dom === "*" && mon === "*") {
    if (dow === "*") return i18n.t("agents:routines.everyDayAt", { time });
    if (dow === "1-5") return i18n.t("agents:routines.weekdaysAt", { time });
    if (dow === "0,6" || dow === "6,0")
      return i18n.t("agents:routines.weekendsAt", { time });
    const days = parseDowField(dow);
    if (days.length > 0) {
      const labels = days.map((d) => dowShort(d)).join(", ");
      return i18n.t("agents:routines.daysAtTime", { days: labels, time });
    }
  }

  return expr;
}

function ScheduleFields({
  state,
  setState,
}: {
  state: ScheduleState;
  setState: (next: ScheduleState) => void;
}) {
  const { t } = useTranslation("agents");
  const setMode = (mode: ScheduleMode) => setState({ ...state, mode });
  const toggleDay = (d: number) => {
    if (state.selectedDays.includes(d)) {
      setState({ ...state, selectedDays: state.selectedDays.filter((x) => x !== d) });
    } else {
      setState({
        ...state,
        selectedDays: [...state.selectedDays, d].sort((a, b) => a - b),
      });
    }
  };
  const matchesPreset = (days: number[]) =>
    days.length === state.selectedDays.length &&
    days.every((d) => state.selectedDays.includes(d));
  const clampMinute = (v: string) =>
    String(Math.min(59, Math.max(0, parseInt(v, 10) || 0)));

  return (
    <div className="space-y-3">
      <div className="space-y-1.5">
        <Label className="text-xs">{t("routines.schedule")}</Label>
        <div className="grid grid-cols-4 gap-1.5">
          {SCHEDULE_MODES.map((opt) => {
            const active = state.mode === opt.key;
            return (
              <button
                key={opt.key}
                type="button"
                onClick={() => setMode(opt.key)}
                className={[
                  "rounded-md border px-2 py-2 text-xs font-medium transition-colors",
                  active
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border bg-background text-foreground hover:bg-accent/40",
                ].join(" ")}
              >
                {t(opt.labelKey)}
              </button>
            );
          })}
        </div>
      </div>

      {state.mode === "interval" && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("routines.runEvery")}</Label>
          <div className="flex items-center gap-2">
            <Input
              type="number"
              min={1}
              value={state.intervalMinutes}
              onChange={(e) =>
                setState({ ...state, intervalMinutes: parseInt(e.target.value) || 1 })
              }
              className="w-24"
            />
            <span className="text-xs text-muted-foreground">{t("routines.minutes")}</span>
          </div>
        </div>
      )}

      {state.mode === "hourly" && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("routines.atMinute")}</Label>
          <div className="flex items-center gap-1.5">
            <span className="text-xs text-muted-foreground">:</span>
            <Input
              type="number"
              min={0}
              max={59}
              value={state.cronMinute}
              onChange={(e) =>
                setState({ ...state, cronMinute: clampMinute(e.target.value) })
              }
              className="w-16 text-center"
            />
          </div>
        </div>
      )}

      {state.mode === "datetime" && (
        <>
          <div className="space-y-1.5">
            <Label className="text-xs">{t("routines.days")}</Label>
            <div className="flex flex-wrap gap-1.5">
              {DAY_PRESETS.map((p) => {
                const active = matchesPreset(p.days);
                return (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => setState({ ...state, selectedDays: p.days })}
                    className={[
                      "rounded-full border px-3 py-1 text-xs",
                      active
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border bg-background text-foreground hover:bg-accent/40",
                    ].join(" ")}
                  >
                    {t(p.labelKey)}
                  </button>
                );
              })}
            </div>
            <div className="flex gap-1.5">
              {DOW_KEYS.map((_, idx) => {
                const label = dowShort(idx);
                const active = state.selectedDays.includes(idx);
                return (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={[
                      "flex-1 aspect-square rounded-full border text-xs font-semibold transition-colors",
                      active
                        ? "border-primary bg-primary text-primary-foreground"
                        : "border-border bg-background text-foreground hover:bg-accent/40",
                    ].join(" ")}
                    aria-pressed={active}
                    aria-label={label}
                  >
                    {label[0]}
                  </button>
                );
              })}
            </div>
            {state.selectedDays.length === 0 && (
              <p className="text-[11px] text-warning">
                {t("routines.pickAtLeastOneDay")}
              </p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("routines.timeOfDayUtc")}</Label>
            <div className="flex items-center gap-2">
              <Select
                value={state.cronHour}
                onValueChange={(v) => setState({ ...state, cronHour: v ?? "9" })}
              >
                <SelectTrigger className="w-32">
                  <SelectValue>
                    {(val: unknown) => hourLabel(parseInt(String(val), 10))}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>
                      {hourLabel(parseInt(h.value, 10))}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center gap-1.5">
                <span className="text-xs text-muted-foreground">:</span>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={state.cronMinute}
                  onChange={(e) =>
                    setState({ ...state, cronMinute: clampMinute(e.target.value) })
                  }
                  className="w-16 text-center"
                />
              </div>
            </div>
          </div>
        </>
      )}

      {state.mode === "custom" && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("routines.cronExpression")}</Label>
          <Input
            value={state.customCron}
            onChange={(e) => setState({ ...state, customCron: e.target.value })}
            placeholder="0 8 * * 1-5"
            className="font-mono text-xs"
          />
          <p className="text-[11px] text-muted-foreground">
            {t("routines.cronHint")}
          </p>
        </div>
      )}

      <p className="text-[11px] text-muted-foreground">{describeSchedule(state)}</p>
    </div>
  );
}

// Friendly label for a conversation in the "Report to" picker. For direct
// conversations, this is the name of the other participant.
function conversationDisplayLabel(
  conv: {
    title?: string;
    type?: string;
    members?: { participantId: string; participant?: { displayName?: string } }[];
  },
  currentParticipantId: string | undefined,
): string {
  if (conv.title) return conv.title;
  const others = (conv.members || []).filter(
    (m) => m.participantId !== currentParticipantId,
  );
  const names = others
    .map((m) => m.participant?.displayName)
    .filter(Boolean) as string[];
  if (names.length > 0) return names.join(", ");
  return conv.type === "group"
    ? i18n.t("chat:groupConversation")
    : i18n.t("chat:directMessage");
}

function ReportToPicker({
  agentId,
  agentName,
  value,
  onChange,
}: {
  agentId: string;
  agentName?: string;
  value: string;
  onChange: (id: string) => void;
}) {
  const { t } = useTranslation("agents");
  const conversations = useChatStore((s) => s.conversations);
  const currentParticipantId = useAuthStore((s) => s.participant?.id);
  const ownerDmId = useMemo(
    () =>
      conversations.find(
        (c) =>
          c.type === "direct" &&
          (c.members || []).some((m) => m.participantId === currentParticipantId) &&
          (c.members || []).some((m) => m.participantId === agentId),
      )?.id,
    [conversations, currentParticipantId, agentId],
  );
  const options = useMemo(
    () =>
      conversations
        .filter((c) => c.type === "direct" && c.id !== ownerDmId)
        .slice(0, 30)
        .map((c) => ({
          id: c.id,
          label: conversationDisplayLabel(c, currentParticipantId),
        })),
    [conversations, currentParticipantId, ownerDmId],
  );
  const defaultLabel = t("routines.reportDefaultOption", {
    name: agentName || t("routines.thisAgent"),
  });

  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t("routines.whereToReport")}</Label>
      <Select
        value={value || "__default__"}
        onValueChange={(v) => onChange(v === "__default__" ? "" : (v ?? ""))}
      >
        <SelectTrigger>
          <SelectValue placeholder={defaultLabel} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__default__">{defaultLabel}</SelectItem>
          {options.map((opt) => (
            <SelectItem key={opt.id} value={opt.id}>
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {t("routines.reportDefaultHint", {
          name: agentName || t("routines.thisAgent"),
        })}
      </p>
    </div>
  );
}

function formatSchedule(scheduleType: string, scheduleConfig: Record<string, unknown>): string {
  if (scheduleType === "interval") {
    const minutes = Number(scheduleConfig.minutes || scheduleConfig.interval_minutes || scheduleConfig.every_minutes || 0);
    if (minutes === 60) return i18n.t("agents:routines.everyHour");
    if (minutes > 60 && minutes % 60 === 0)
      return i18n.t("agents:routines.everyHours", { count: minutes / 60 });
    return i18n.t("agents:routines.everyMinutes", { count: minutes });
  }
  if (scheduleType === "cron") {
    const expr = String(scheduleConfig.expression || scheduleConfig.cron || "");
    return expr ? humanizeCron(expr) : i18n.t("agents:routines.customSchedule");
  }
  return scheduleType;
}

function formatDateTime(iso?: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function statusVariant(status: string): "default" | "secondary" | "outline" | "destructive" {
  switch (status) {
    case "active":
      return "default";
    case "paused":
      return "secondary";
    case "expired":
    case "disabled":
      return "destructive";
    default:
      return "outline";
  }
}

function statusColor(status: string): string {
  switch (status) {
    case "active":
      return "bg-success";
    case "paused":
      return "bg-warning";
    case "expired":
    case "disabled":
      return "bg-destructive";
    default:
      return "";
  }
}

export function AgentRoutines({ agentId }: AgentRoutinesProps) {
  const { t } = useTranslation("agents");
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Routines are workspace-scoped; label the ones pinned to a workspace other
  // than the one the user is currently looking at.
  const activeOrgId = useAuthStore((s) => s.participant?.activeOrganizationId);
  const workspaces = useWorkspaces();
  const workspacesEnabled = useWorkspacesEnabled();
  const workspaceLabel = useCallback(
    (routine: Routine): string | null => {
      if (!workspacesEnabled || !routine.organizationId) return null;
      if (routine.organizationId === activeOrgId) return null;
      return (
        workspaces.find((w) => w.id === routine.organizationId)?.name ??
        i18n.t("agents:routines.otherWorkspace")
      );
    },
    [workspacesEnabled, activeOrgId, workspaces],
  );

  const fetchRoutines = useCallback(async () => {
    try {
      setError(null);
      const { routines: data } = await listRoutines(agentId);
      setRoutines(data || []);
    } catch (e) {
      console.error("Failed to fetch routines:", e);
      setError(e instanceof Error ? e.message : i18n.t("agents:routines.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [agentId]);

  useEffect(() => {
    fetchRoutines();
  }, [fetchRoutines]);

  const handlePauseResume = async (routine: Routine) => {
    try {
      if (routine.status === "active") {
        const { routine: updated } = await pauseRoutine(routine.id);
        setRoutines((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      } else if (routine.status === "paused") {
        const { routine: updated } = await resumeRoutine(routine.id);
        setRoutines((prev) => prev.map((r) => (r.id === updated.id ? updated : r)));
      }
    } catch (e) {
      console.error("Failed to toggle routine:", e);
      window.alert(e instanceof Error ? e.message : i18n.t("agents:routines.errors.updateFailed"));
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await deleteRoutine(id);
      setRoutines((prev) => prev.filter((r) => r.id !== id));
      setConfirmDelete(null);
    } catch (e) {
      console.error("Failed to delete routine:", e);
      window.alert(e instanceof Error ? e.message : i18n.t("agents:routines.errors.deleteFailed"));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-sm text-muted-foreground">
        {t("routines.loading")}
      </div>
    );
  }

  return (
    <div className="p-5 space-y-6">
      {error && (
        <div className="flex items-center gap-2 text-xs text-destructive bg-destructive/10 rounded-lg p-3">
          <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
          {error}
        </div>
      )}

      {routines.length === 0 ? (
        <div className="text-center py-8">
          <Timer className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
          <p className="text-sm font-medium">{t("routines.emptyTitle")}</p>
          <p className="text-xs text-muted-foreground mt-1">
            {t("routines.emptyDescription")}
          </p>
          <Button size="sm" className="mt-4" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("routines.create")}
          </Button>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            {routines.map((routine) => {
              const wsLabel = workspaceLabel(routine);
              return (
              <div
                key={routine.id}
                className="flex items-center justify-between p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-medium truncate">{routine.name}</span>
                    <Badge
                      variant={statusVariant(routine.status)}
                      className={`text-[10px] px-1.5 py-0 ${routine.status === "active" ? statusColor(routine.status) : ""}`}
                    >
                      {t(`status.${routine.status}`, { defaultValue: routine.status })}
                    </Badge>
                    {wsLabel && (
                      <Badge
                        variant="outline"
                        className="text-[10px] px-1.5 py-0 max-w-32 truncate"
                        title={t("routines.inWorkspace", { name: wsLabel })}
                      >
                        {wsLabel}
                      </Badge>
                    )}
                    {routine.consecutiveFailures > 0 && (
                      <Badge variant="destructive" className="text-[10px] px-1.5 py-0">
                        <AlertTriangle className="w-2.5 h-2.5 mr-0.5" />
                        {t("routines.failCount", { count: routine.consecutiveFailures })}
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">
                    <span className="flex items-center gap-1">
                      <Clock className="w-3 h-3" />
                      {formatSchedule(routine.scheduleType, routine.scheduleConfig)}
                    </span>
                    {routine.nextRunAt && (
                      <span>{t("routines.nextRun", { time: formatDateTime(routine.nextRunAt) })}</span>
                    )}
                    <span>{t("routines.runCount", { count: routine.runCount })}{routine.maxRuns ? `/${routine.maxRuns}` : ""}</span>
                  </div>
                </div>
                <div className="flex items-center gap-1 ml-3 shrink-0">
                  {(routine.status === "active" || routine.status === "paused") && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7"
                      onClick={() => handlePauseResume(routine)}
                      title={routine.status === "active" ? t("common:pause") : t("common:resume")}
                    >
                      {routine.status === "active" ? (
                        <Pause className="w-3.5 h-3.5" />
                      ) : (
                        <Play className="w-3.5 h-3.5" />
                      )}
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-7 w-7"
                    onClick={() => setEditingRoutine(routine)}
                    title={t("common:edit")}
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  {confirmDelete === routine.id ? (
                    <div className="flex items-center gap-1">
                      <Button
                        variant="destructive"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => handleDelete(routine.id)}
                      >
                        {t("common:confirm")}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-7 text-xs px-2"
                        onClick={() => setConfirmDelete(null)}
                      >
                        {t("common:cancel")}
                      </Button>
                    </div>
                  ) : (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive/90"
                      onClick={() => setConfirmDelete(routine.id)}
                      title={t("common:delete")}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  )}
                </div>
              </div>
              );
            })}
          </div>

          <Button size="sm" variant="outline" onClick={() => setShowCreate(true)}>
            <Plus className="w-3.5 h-3.5 mr-1.5" /> {t("routines.create")}
          </Button>
        </>
      )}

      {/* Create Routine Dialog */}
      <CreateRoutineDialog
        open={showCreate}
        onClose={() => {
          setShowCreate(false);
          fetchRoutines();
        }}
        agentId={agentId}
      />

      {/* Edit Routine Dialog */}
      <EditRoutineDialog
        routine={editingRoutine}
        onClose={() => {
          setEditingRoutine(null);
          fetchRoutines();
        }}
      />
    </div>
  );
}

// --- Create Routine Dialog ---

function CreateRoutineDialog({
  open,
  onClose,
  agentId,
}: {
  open: boolean;
  onClose: () => void;
  agentId: string;
}) {
  const { t } = useTranslation("agents");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [schedule, setSchedule] = useState<ScheduleState>(() => defaultScheduleState());
  const [reportTo, setReportTo] = useState("");
  const [maxRuns, setMaxRuns] = useState("");
  const [responseTemplate, setResponseTemplate] = useState("");
  // "" = the agent's default model; a model id runs this routine on that model.
  const [model, setModel] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Workspace pin. "__personal__" = owner's Personal workspace (no pin);
  // otherwise a workspace id. Org is immutable after creation, so this
  // picker lives only on the create form. Pre-select the workspace the
  // user is currently in (a real workspace, not Personal).
  const workspacesEnabled = useWorkspacesEnabled();
  const workspaces = useWorkspaces();
  const activeWorkspace = useActiveWorkspace();
  const [organizationId, setOrganizationId] = useState(
    workspacesEnabled && activeWorkspace ? activeWorkspace.id : "__personal__",
  );

  // Get available templates from the agent's structured_capabilities
  const { agents } = useAgentStore();
  const agentName = useMemo(
    () => Object.values(agents).find((m) => m.agent.id === agentId)?.agent.displayName,
    [agents, agentId],
  );
  const templateNames = useMemo(() => {
    const managed = Object.values(agents).find((m) => m.agent.id === agentId);
    const templates = managed?.agent.structuredCapabilities?.detail_templates;
    return templates ? Object.keys(templates).sort() : [];
  }, [agents, agentId]);

  const scheduleValid =
    schedule.mode !== "datetime" || schedule.selectedDays.length > 0;

  const resetForm = () => {
    setName("");
    setDescription("");
    setInstructions("");
    setSchedule(defaultScheduleState());
    setReportTo("");
    setMaxRuns("");
    setResponseTemplate("");
    setModel("");
    setOrganizationId(
      workspacesEnabled && activeWorkspace ? activeWorkspace.id : "__personal__",
    );
    setError(null);
  };

  const handleCreate = async () => {
    setCreating(true);
    setError(null);
    try {
      const { scheduleType, scheduleConfig } = buildScheduleConfig(schedule);

      await createRoutine({
        agent_id: agentId,
        name,
        instructions,
        schedule_type: scheduleType,
        schedule_config: scheduleConfig,
        ...(description ? { description } : {}),
        ...(reportTo ? { report_to: reportTo } : {}),
        ...(maxRuns ? { max_runs: parseInt(maxRuns) } : {}),
        ...(responseTemplate ? { response_template: responseTemplate } : {}),
        ...(model ? { model } : {}),
        ...(organizationId !== "__personal__"
          ? { organization_id: organizationId }
          : {}),
      });
      resetForm();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("routines.errors.createFailed"));
    } finally {
      setCreating(false);
    }
  };

  const handleClose = () => {
    resetForm();
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="w-[90vw] sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>{t("routines.create")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("common:name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("routines.namePlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("routines.descriptionOptional")}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("routines.descriptionPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("routines.instructions")}</Label>
            <Textarea
              className="min-h-[220px] font-mono text-sm leading-relaxed resize-y"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t("routines.instructionsPlaceholder")}
            />
          </div>

          <ScheduleFields state={schedule} setState={setSchedule} />

          <div className="grid grid-cols-2 gap-3">
            <ReportToPicker
              agentId={agentId}
              agentName={agentName}
              value={reportTo}
              onChange={setReportTo}
            />
            <div className="space-y-1.5">
              <Label className="text-xs">{t("routines.maxRunsOptional")}</Label>
              <Input
                type="number"
                min={1}
                value={maxRuns}
                onChange={(e) => setMaxRuns(e.target.value)}
                placeholder={t("routines.unlimited")}
              />
            </div>
          </div>

          {templateNames.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("routines.responseTemplateOptional")}</Label>
              <Select value={responseTemplate} onValueChange={(v) => setResponseTemplate(v ?? "")}>
                <SelectTrigger>
                  <SelectValue placeholder={t("routines.noTemplatePlainText")} />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("common:none")}</SelectItem>
                  {templateNames.map((tpl) => (
                    <SelectItem key={tpl} value={tpl}>
                      {tpl.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                {t("routines.templateHint")}
              </p>
            </div>
          )}

          <ModelOverrideField agentId={agentId} value={model} onChange={setModel} />

          {/* Workspace pin — only meaningful when the owner belongs to more
              than one workspace. "__personal__" is the Select-safe stand-in
              for "unpinned" (owner's Personal workspace). Org is immutable
              after creation, so this appears only on the create form. */}
          {workspacesEnabled && workspaces.length > 1 && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("workspacePin.label")}</Label>
              <Select
                value={organizationId || "__personal__"}
                onValueChange={(v) => {
                  if (!v) return;
                  setOrganizationId(v);
                }}
              >
                <SelectTrigger>
                  <SelectValue>
                    {(val: unknown) =>
                      String(val) === "__personal__"
                        ? t("pulse.defaultWorkspace")
                        : workspaces.find((w) => w.id === String(val))?.name ??
                          String(val ?? "")
                    }
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__personal__">{t("pulse.defaultWorkspace")}</SelectItem>
                  {workspaces.map((w) => (
                    <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-[11px] text-muted-foreground">
                {t("workspacePin.hint")}
              </p>
            </div>
          )}

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t shrink-0 flex gap-2 justify-end">
          <Button variant="outline" onClick={handleClose}>
            {t("common:cancel")}
          </Button>
          <Button
            onClick={handleCreate}
            disabled={creating || !name || !instructions || !scheduleValid}
          >
            {creating ? t("common:creating") : t("routines.create")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- Edit Routine Dialog ---

function EditRoutineDialog({
  routine,
  onClose,
}: {
  routine: Routine | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("agents");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState("");
  const [schedule, setSchedule] = useState<ScheduleState>(() => defaultScheduleState());
  const [responseTemplate, setResponseTemplate] = useState("");
  // "" = the agent's default model; a model id runs this routine on that model.
  const [model, setModel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { agents } = useAgentStore();
  const templateNames = useMemo(() => {
    if (!routine) return [];
    const managed = Object.values(agents).find((m) => m.agent.id === routine.participantId);
    const templates = managed?.agent.structuredCapabilities?.detail_templates;
    return templates ? Object.keys(templates).sort() : [];
  }, [agents, routine?.participantId]);

  useEffect(() => {
    if (routine) {
      setName(routine.name);
      setDescription(routine.description || "");
      setInstructions(routine.instructions);
      setResponseTemplate(routine.responseTemplate || "");
      setModel(routine.model || "");
      setSchedule(parseRoutineSchedule(routine));
      setError(null);
    }
  }, [routine]);

  const scheduleValid =
    schedule.mode !== "datetime" || schedule.selectedDays.length > 0;

  const isDirty = useMemo(() => {
    if (!routine) return false;
    if (name !== routine.name) return true;
    if (instructions !== routine.instructions) return true;
    if ((description || "") !== (routine.description || "")) return true;
    if ((responseTemplate || "") !== (routine.responseTemplate || "")) return true;
    if ((model || "") !== (routine.model || "")) return true;
    const built = buildScheduleConfig(schedule);
    if (built.scheduleType !== routine.scheduleType) return true;
    const cfg = routine.scheduleConfig as {
      every_minutes?: number;
      minutes?: number;
      expression?: string;
      cron?: string;
    };
    const origEvery = cfg.every_minutes ?? cfg.minutes ?? null;
    const origExpr = cfg.expression ?? cfg.cron ?? null;
    const newEvery =
      (built.scheduleConfig as { every_minutes?: number }).every_minutes ?? null;
    const newExpr = (built.scheduleConfig as { expression?: string }).expression ?? null;
    if (origEvery !== newEvery || origExpr !== newExpr) return true;
    return false;
  }, [routine, name, instructions, description, responseTemplate, model, schedule]);

  const handleSave = async () => {
    if (!routine) return;
    setSaving(true);
    setError(null);
    try {
      const { scheduleType, scheduleConfig } = buildScheduleConfig(schedule);

      await updateRoutine(routine.id, {
        name,
        description: description || null,
        instructions,
        schedule_type: scheduleType,
        schedule_config: scheduleConfig,
        response_template: responseTemplate || null,
        // "" clears the override (→ agent's default model).
        model,
      });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("routines.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={!!routine} onOpenChange={() => onClose()}>
      <DialogContent className="w-[90vw] sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>{t("routines.edit")}</DialogTitle>
        </DialogHeader>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4 space-y-4">
          <div className="space-y-1.5">
            <Label className="text-xs">{t("common:name")}</Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("common:description")}</Label>
            <Input
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder={t("routines.descriptionPlaceholder")}
            />
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">{t("routines.instructions")}</Label>
            <Textarea
              className="min-h-[220px] font-mono text-sm leading-relaxed resize-y"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
            />
          </div>

          <ScheduleFields state={schedule} setState={setSchedule} />

          {templateNames.length > 0 && (
            <div className="space-y-1.5">
              <Label className="text-xs">{t("routines.responseTemplate")}</Label>
              <Select value={responseTemplate} onValueChange={(v) => setResponseTemplate(v ?? "")}>
                <SelectTrigger><SelectValue placeholder={t("routines.noTemplate")} /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="">{t("common:none")}</SelectItem>
                  {templateNames.map((tpl) => (
                    <SelectItem key={tpl} value={tpl}>{tpl.replace(/_/g, " ")}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}

          <ModelOverrideField
            agentId={routine?.participantId ?? ""}
            value={model}
            onChange={setModel}
          />

          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>

        <div className="px-6 py-4 border-t shrink-0 flex gap-2 justify-end">
          <Button variant="outline" onClick={onClose}>
            {t("common:cancel")}
          </Button>
          <Button
            onClick={handleSave}
            disabled={saving || !name || !instructions || !scheduleValid || !isDirty}
          >
            {saving ? t("common:saving") : t("common:saveChanges")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
