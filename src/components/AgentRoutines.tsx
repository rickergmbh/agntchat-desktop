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
import { cn } from "../lib/utils";
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

// Select-safe stand-in for "no workspace pin" — the owner's Personal
// workspace, which the backend resolves when organization_id is omitted.
const PERSONAL_WORKSPACE = "__personal__";

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
  /** Reports this section's count up to the agent-detail rail badge, so the
   *  number moves with the list instead of waiting for a refetch. */
  onCount?: (n: number) => void;
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

// One chip style for every "pick one of these" control in the schedule
// builder — the same treatment to-do delegate chips and reminder quick-picks
// use, so the routine editor reads as part of the app rather than its own
// thing.
const chipBase = "rounded-lg border px-2.5 py-1 text-xs font-medium transition-colors";
const chipActive = "border-primary bg-primary/10 text-primary";
const chipIdle =
  "border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground";

/** Interval presets, in minutes. Labels come from the compact plural keys
 *  so a chip reads the same as the summary line ("Every 30 min"). */
const INTERVAL_PRESETS = [15, 30, 60, 360, 1440];

function intervalPresetLabel(minutes: number): string {
  if (minutes % 1440 === 0)
    return i18n.t("agents:routines.everyDaysCompact", { count: minutes / 1440 });
  if (minutes % 60 === 0)
    return i18n.t("agents:routines.everyHoursCompact", { count: minutes / 60 });
  return i18n.t("agents:routines.everyMinutesCompact", { count: minutes });
}

/** :00 … :55 — values, not copy. A routine authored elsewhere (an agent's
 *  own cron, say) can sit on an off-step minute, so that value is folded in
 *  rather than silently dropped by the picker. */
const MINUTE_STEPS = Array.from({ length: 12 }, (_, i) => String(i * 5));

function minuteOptions(current: string): string[] {
  if (MINUTE_STEPS.includes(current)) return MINUTE_STEPS;
  return [...MINUTE_STEPS, current].sort((a, b) => parseInt(a, 10) - parseInt(b, 10));
}

function minuteLabel(value: string): string {
  return `:${value.padStart(2, "0")}`;
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

  return (
    <div className="space-y-2">
      {/* Mode — a segmented control on a muted track, the same idiom the
          rest of the app uses for "pick one of a few". */}
      <div className="flex rounded-lg bg-muted p-0.5">
        {SCHEDULE_MODES.map((opt) => {
          const active = state.mode === opt.key;
          return (
            <button
              key={opt.key}
              type="button"
              onClick={() => setMode(opt.key)}
              className={cn(
                "flex-1 rounded-md px-2 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {t(opt.labelKey)}
            </button>
          );
        })}
      </div>

      {/* The chosen mode's controls and the plain-English summary read as one
          block, so the schedule doesn't look like loose inputs. */}
      <div className="space-y-3 rounded-xl border border-border bg-muted/30 p-3">
        {state.mode === "interval" && (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {INTERVAL_PRESETS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  onClick={() => setState({ ...state, intervalMinutes: minutes })}
                  className={cn(
                    chipBase,
                    state.intervalMinutes === minutes ? chipActive : chipIdle,
                  )}
                >
                  {intervalPresetLabel(minutes)}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("routines.runEvery")}</span>
              <Input
                type="number"
                min={1}
                value={state.intervalMinutes}
                onChange={(e) =>
                  setState({ ...state, intervalMinutes: parseInt(e.target.value) || 1 })
                }
                className="h-8 w-20 text-center"
              />
              <span className="text-xs text-muted-foreground">{t("routines.minutes")}</span>
            </div>
          </div>
        )}

        {state.mode === "hourly" && (
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground">{t("routines.atMinute")}</span>
            <Select
              value={state.cronMinute}
              onValueChange={(v) => setState({ ...state, cronMinute: v ?? "0" })}
            >
              <SelectTrigger className="h-8 w-24">
                <SelectValue>{(val: unknown) => minuteLabel(String(val))}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {minuteOptions(state.cronMinute).map((m) => (
                  <SelectItem key={m} value={m}>
                    {minuteLabel(m)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {state.mode === "datetime" && (
          <>
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-muted-foreground">{t("routines.days")}</span>
                <div className="flex items-center gap-1">
                  {DAY_PRESETS.map((p) => (
                    <button
                      key={p.key}
                      type="button"
                      onClick={() => setState({ ...state, selectedDays: p.days })}
                      className={cn(
                        "rounded-md px-1.5 py-0.5 text-[11px] transition-colors",
                        matchesPreset(p.days)
                          ? "text-primary"
                          : "text-muted-foreground hover:text-foreground",
                      )}
                    >
                      {t(p.labelKey)}
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {DOW_KEYS.map((_, idx) => {
                  const active = state.selectedDays.includes(idx);
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => toggleDay(idx)}
                      className={cn(
                        "h-8 min-w-11 rounded-lg border px-2 text-xs font-medium transition-colors",
                        active ? chipActive : chipIdle,
                      )}
                      aria-pressed={active}
                    >
                      {dowShort(idx)}
                    </button>
                  );
                })}
              </div>
              {state.selectedDays.length === 0 && (
                <p className="text-[11px] text-warning">{t("routines.pickAtLeastOneDay")}</p>
              )}
            </div>

            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">{t("routines.timeOfDayUtc")}</span>
              <Select
                value={state.cronHour}
                onValueChange={(v) => setState({ ...state, cronHour: v ?? "9" })}
              >
                <SelectTrigger className="h-8 w-28">
                  <SelectValue>
                    {(val: unknown) => hourLabel(parseInt(String(val), 10)).replace(":00", "")}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {HOURS.map((h) => (
                    <SelectItem key={h.value} value={h.value}>
                      {hourLabel(parseInt(h.value, 10)).replace(":00", "")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select
                value={state.cronMinute}
                onValueChange={(v) => setState({ ...state, cronMinute: v ?? "0" })}
              >
                <SelectTrigger className="h-8 w-24">
                  <SelectValue>{(val: unknown) => minuteLabel(String(val))}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  {minuteOptions(state.cronMinute).map((m) => (
                    <SelectItem key={m} value={m}>
                      {minuteLabel(m)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </>
        )}

        {state.mode === "custom" && (
          <div className="space-y-1.5">
            <Input
              value={state.customCron}
              onChange={(e) => setState({ ...state, customCron: e.target.value })}
              placeholder="0 8 * * 1-5"
              className="h-8 font-mono text-xs"
            />
            <p className="text-[11px] text-muted-foreground">{t("routines.cronHint")}</p>
          </div>
        )}

        <div className="flex items-center gap-2 border-t border-border/60 pt-2.5 text-xs text-foreground">
          <Clock className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
          <span>{describeSchedule(state)}</span>
        </div>
      </div>
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
  organizationId,
  value,
  onChange,
}: {
  agentId: string;
  agentName?: string;
  /** The routine's workspace — destinations outside it are rejected by the
   *  backend, so they aren't offered. */
  organizationId?: string | null;
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
  // Anything else the routine may post into: a DM, group or channel that
  // BOTH this agent and I belong to, inside the routine's workspace. That
  // membership rule is what stops one agent's routine reaching another
  // agent's DM — it simply isn't in it. Mirrors Routines.validate_report_to.
  const options = useMemo(
    () =>
      conversations
        .filter((c) => {
          if (c.id === ownerDmId || c.parentConversationId) return false;
          if (c.type !== "direct" && c.type !== "group" && c.type !== "channel") return false;
          if (organizationId && c.organizationId && c.organizationId !== organizationId) {
            return false;
          }
          const members = c.members || [];
          return (
            members.some((m) => m.participantId === agentId) &&
            members.some((m) => m.participantId === currentParticipantId)
          );
        })
        .slice(0, 30)
        .map((c) => ({
          id: c.id,
          label: conversationDisplayLabel(c, currentParticipantId),
        })),
    [conversations, currentParticipantId, ownerDmId, organizationId, agentId],
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

export function formatSchedule(scheduleType: string, scheduleConfig: Record<string, unknown>): string {
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

export function AgentRoutines({ agentId, onCount }: AgentRoutinesProps) {
  const { t } = useTranslation("agents");
  const [routines, setRoutines] = useState<Routine[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreate, setShowCreate] = useState(false);
  const [editingRoutine, setEditingRoutine] = useState<Routine | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const fetchRoutines = useCallback(async () => {
    try {
      setError(null);
      const { routines: data } = await listRoutines(agentId);
      setRoutines(data || []);
      onCount?.((data || []).length);
    } catch (e) {
      console.error("Failed to fetch routines:", e);
      setError(e instanceof Error ? e.message : i18n.t("agents:routines.errors.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, [agentId, onCount]);

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
    workspacesEnabled && activeWorkspace ? activeWorkspace.id : PERSONAL_WORKSPACE,
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
      workspacesEnabled && activeWorkspace ? activeWorkspace.id : PERSONAL_WORKSPACE,
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
        ...(organizationId !== PERSONAL_WORKSPACE
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
        {/* Same grouping as the edit form: identity, what it does, when it
            runs, then the optional delivery settings. */}
        <div className="flex-1 min-h-0 divide-y divide-border overflow-y-auto px-6 py-4">
          {/* Workspace sits up top with the name: it decides where the
              routine lives, which list it shows up in, and which rooms the
              destination picker below can even offer. */}
          <div className="grid gap-3 pb-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label className="text-xs">{t("common:name")}</Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("routines.namePlaceholder")}
              />
            </div>

            {workspacesEnabled && workspaces.length > 1 && (
              <div className="space-y-1.5">
                <Label className="text-xs">{t("workspacePin.label")}</Label>
                <Select
                  value={organizationId || PERSONAL_WORKSPACE}
                  onValueChange={(v) => {
                    if (!v) return;
                    setOrganizationId(v);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue>
                      {(val: unknown) =>
                        String(val) === PERSONAL_WORKSPACE
                          ? t("pulse.defaultWorkspace")
                          : workspaces.find((w) => w.id === String(val))?.name ??
                            String(val ?? "")
                      }
                    </SelectValue>
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={PERSONAL_WORKSPACE}>{t("pulse.defaultWorkspace")}</SelectItem>
                    {workspaces.map((w) => (
                      <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">{t("workspacePin.hint")}</p>
              </div>
            )}

            <div className="space-y-1.5 sm:col-span-2">
              <Label className="text-xs">{t("routines.descriptionOptional")}</Label>
              <Input
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder={t("routines.descriptionPlaceholder")}
              />
            </div>
          </div>

          <div className="space-y-1.5 py-4">
            <Label className="text-xs">{t("routines.instructions")}</Label>
            <Textarea
              className="min-h-[180px] font-mono text-sm leading-relaxed resize-y"
              value={instructions}
              onChange={(e) => setInstructions(e.target.value)}
              placeholder={t("routines.instructionsPlaceholder")}
            />
          </div>

          <div className="space-y-1.5 py-4">
            <Label className="text-xs">{t("routines.schedule")}</Label>
            <ScheduleFields state={schedule} setState={setSchedule} />
          </div>

          <div className="grid gap-3 pt-4 sm:grid-cols-2">
            <ReportToPicker
              agentId={agentId}
              agentName={agentName}
              organizationId={organizationId === PERSONAL_WORKSPACE ? undefined : organizationId}
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
                <p className="text-[11px] text-muted-foreground">{t("routines.templateHint")}</p>
              </div>
            )}

            <ModelOverrideField agentId={agentId} value={model} onChange={setModel} />

            {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
          </div>
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

export interface RoutineFormProps {
  routine: Routine;
  /** Chrome around the fields: the modal footer used on an agent's own
   *  Routines section, or the panel footer used in the Actions detail
   *  column. */
  variant: "dialog" | "panel";
  /** Closes the dialog — on cancel, and after a successful save. The panel
   *  variant stays open on the item it just saved, so it doesn't use this. */
  onDone?: () => void;
  /** The saved row, so a caller holding its own copy can refresh it. */
  onSaved?: (routine: Routine) => void;
}

/**
 * Edit form for a routine, shared by the modal on an agent's Routines
 * section (`EditRoutineDialog`) and the Actions detail pane
 * (`tasks/RoutineDetail`). Save is gated on `isDirty` so an untouched form
 * can't PATCH a no-op.
 */
export function RoutineForm({ routine, variant, onDone, onSaved }: RoutineFormProps) {
  const { t } = useTranslation("agents");
  const [name, setName] = useState(routine.name);
  const [description, setDescription] = useState(routine.description || "");
  const [instructions, setInstructions] = useState(routine.instructions);
  const [schedule, setSchedule] = useState<ScheduleState>(() => parseRoutineSchedule(routine));
  const [responseTemplate, setResponseTemplate] = useState(routine.responseTemplate || "");
  const [reportTo, setReportTo] = useState(routine.reportTo || "");
  // "" = the agent's default model; a model id runs this routine on that model.
  const [model, setModel] = useState(routine.model || "");
  // The workspace a routine lives in: it only appears in that workspace's
  // lists, and it delivers into that workspace's rooms. Moving one takes it
  // out of this workspace's list on save and resets the destination to the
  // DM in the new one (the backend clears report_to).
  const [organizationId, setOrganizationId] = useState(
    routine.organizationId || PERSONAL_WORKSPACE,
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const workspaces = useWorkspaces();
  const workspacesEnabled = useWorkspacesEnabled();
  const movingWorkspace = organizationId !== (routine.organizationId || PERSONAL_WORKSPACE);

  const { agents } = useAgentStore();
  const agentName = Object.values(agents).find((m) => m.agent.id === routine.participantId)
    ?.agent.displayName;
  const templateNames = useMemo(() => {
    const managed = Object.values(agents).find((m) => m.agent.id === routine.participantId);
    const templates = managed?.agent.structuredCapabilities?.detail_templates;
    return templates ? Object.keys(templates).sort() : [];
  }, [agents, routine.participantId]);

  // Re-seed when the pane switches to a different routine. Keyed on the id
  // rather than the object so a store refresh doesn't wipe in-progress edits.
  useEffect(() => {
    setName(routine.name);
    setDescription(routine.description || "");
    setInstructions(routine.instructions);
    setResponseTemplate(routine.responseTemplate || "");
    setReportTo(routine.reportTo || "");
    setModel(routine.model || "");
    setOrganizationId(routine.organizationId || PERSONAL_WORKSPACE);
    setSchedule(parseRoutineSchedule(routine));
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [routine.id]);

  const scheduleValid =
    schedule.mode !== "datetime" || schedule.selectedDays.length > 0;

  const isDirty = useMemo(() => {
    if (name !== routine.name) return true;
    if (instructions !== routine.instructions) return true;
    if ((description || "") !== (routine.description || "")) return true;
    if ((responseTemplate || "") !== (routine.responseTemplate || "")) return true;
    if ((reportTo || "") !== (routine.reportTo || "")) return true;
    if ((model || "") !== (routine.model || "")) return true;
    if (movingWorkspace) return true;
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
  }, [
    routine,
    name,
    instructions,
    description,
    responseTemplate,
    reportTo,
    model,
    movingWorkspace,
    schedule,
  ]);

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      const { scheduleType, scheduleConfig } = buildScheduleConfig(schedule);

      const body: Record<string, unknown> = {
        name,
        description: description || null,
        instructions,
        schedule_type: scheduleType,
        schedule_config: scheduleConfig,
        response_template: responseTemplate || null,
        report_to: reportTo || null,
        // "" clears the override (→ agent's default model).
        model,
      };

      // Only send the workspace when it actually changed — the backend
      // treats its presence as a move and clears report_to.
      if (movingWorkspace) {
        body.organization_id =
          organizationId === PERSONAL_WORKSPACE ? undefined : organizationId;
        delete body.report_to;
      }

      const { routine: updated } = await updateRoutine(routine.id, body);
      onSaved?.(updated);
      if (variant === "dialog") onDone?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : t("routines.errors.saveFailed"));
    } finally {
      setSaving(false);
    }
  };

  // Grouped with hairline rules rather than one long stack of inputs:
  // identity, what it does, when it runs, then the optional delivery
  // settings.
  const fields = (
    <div className="divide-y divide-border">
      {/* Workspace sits up top with the name: it decides where the routine
          lives, which list it shows up in, and which rooms the destination
          picker below can even offer. */}
      <div className="grid gap-3 pb-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label className="text-xs">{t("common:name")}</Label>
          <Input value={name} onChange={(e) => setName(e.target.value)} />
        </div>

        {workspacesEnabled && workspaces.length > 1 && (
        <div className="space-y-1.5">
          <Label className="text-xs">{t("workspacePin.label")}</Label>
          <Select
            value={organizationId}
            onValueChange={(v) => v && setOrganizationId(v)}
          >
            <SelectTrigger className="w-full">
              <SelectValue>
                {(val: unknown) =>
                  String(val) === PERSONAL_WORKSPACE
                    ? t("pulse.defaultWorkspace")
                    : workspaces.find((w) => w.id === String(val))?.name ?? String(val ?? "")
                }
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={PERSONAL_WORKSPACE}>{t("pulse.defaultWorkspace")}</SelectItem>
              {workspaces.map((w) => (
                <SelectItem key={w.id} value={w.id}>{w.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="text-[11px] text-muted-foreground">
            {movingWorkspace ? t("routines.movingWorkspaceHint") : t("workspacePin.hint")}
          </p>
        </div>
        )}

        <div className="space-y-1.5 sm:col-span-2">
          <Label className="text-xs">{t("common:description")}</Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t("routines.descriptionPlaceholder")}
          />
        </div>
      </div>

      <div className="space-y-1.5 py-4">
        <Label className="text-xs">{t("routines.instructions")}</Label>
        <Textarea
          className="min-h-[180px] font-mono text-sm leading-relaxed resize-y"
          value={instructions}
          onChange={(e) => setInstructions(e.target.value)}
        />
      </div>

      <div className="space-y-1.5 py-4">
        <Label className="text-xs">{t("routines.schedule")}</Label>
        <ScheduleFields state={schedule} setState={setSchedule} />
      </div>

      <div className="grid gap-3 pt-4 sm:grid-cols-2">
        <ReportToPicker
          agentId={routine.participantId}
          agentName={agentName}
          organizationId={organizationId === PERSONAL_WORKSPACE ? undefined : organizationId}
          value={reportTo}
          onChange={setReportTo}
        />

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
          agentId={routine.participantId}
          value={model}
          onChange={setModel}
        />

        {error && <p className="text-xs text-destructive sm:col-span-2">{error}</p>}
      </div>
    </div>
  );

  const saveButton = (
    <Button
      onClick={handleSave}
      disabled={saving || !name || !instructions || !scheduleValid || !isDirty}
    >
      {saving ? t("common:saving") : t("common:saveChanges")}
    </Button>
  );

  if (variant === "dialog") {
    return (
      <>
        <div className="flex-1 min-h-0 overflow-y-auto px-6 py-4">{fields}</div>
        <div className="px-6 py-4 border-t shrink-0 flex gap-2 justify-end">
          <Button variant="outline" onClick={onDone}>
            {t("common:cancel")}
          </Button>
          {saveButton}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">{fields}</div>
      <div className="px-6 py-4 border-t border-border shrink-0 flex justify-end">
        {saveButton}
      </div>
    </>
  );
}

function EditRoutineDialog({
  routine,
  onClose,
}: {
  routine: Routine | null;
  onClose: () => void;
}) {
  const { t } = useTranslation("agents");

  return (
    <Dialog open={!!routine} onOpenChange={() => onClose()}>
      <DialogContent className="w-[90vw] sm:max-w-3xl max-h-[85vh] flex flex-col gap-0 p-0">
        <DialogHeader className="px-6 pt-6 pb-4 border-b shrink-0">
          <DialogTitle>{t("routines.edit")}</DialogTitle>
        </DialogHeader>
        {/* Remount per target so the form re-seeds from the new routine. */}
        {routine && (
          <RoutineForm key={routine.id} routine={routine} variant="dialog" onDone={onClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
