import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "../../lib/utils";

const QUICK_DAY_COUNT = 7;

/** Local midnight for today + `offset` days. */
function dayAt(offset: number): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + offset);
  return d;
}

function sameLocalDay(a: Date, b: Date): boolean {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Month cells, Monday-first, padded with nulls to full weeks. */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const leading = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = Array(leading).fill(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

interface DueDateCalendarProps {
  value: Date | null;
  onChange: (day: Date | null) => void;
  hour: number;
  minute: number;
  onTimeChange: (hour: number, minute: number) => void;
}

const chipBase =
  "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors";
const chipInactive =
  "border-input bg-transparent text-foreground hover:bg-muted";
const chipActive = "border-primary bg-primary/10 text-primary";

/**
 * Due-date picker: a week of quick-pick day chips, an inline Monday-first
 * month calendar for anything further out, and hour chips once a day is
 * chosen. Pure Intl + React date math — no date-picker dependency, mirrors
 * mobile's TodoSheet.tsx calendar almost verbatim.
 */
export default function DueDateCalendar({
  value,
  onChange,
  hour,
  minute: _minute,
  onTimeChange,
}: DueDateCalendarProps) {
  const { t, i18n } = useTranslation("tasks");
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calCursor, setCalCursor] = useState<{ year: number; month: number }>(() => {
    const seed = value ?? new Date();
    return { year: seed.getFullYear(), month: seed.getMonth() };
  });

  const quickDays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: "short" });
    return Array.from({ length: QUICK_DAY_COUNT }, (_, i) => {
      const date = dayAt(i);
      const label = i === 0 ? t("todo.today") : i === 1 ? t("todo.tomorrow") : fmt.format(date);
      return { date, label };
    });
  }, [i18n.language, t]);

  const weekdayLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { weekday: "narrow" });
    return Array.from({ length: 7 }, (_, i) => fmt.format(new Date(2024, 0, 1 + i)));
  }, [i18n.language]);

  const monthLabel = useMemo(
    () =>
      new Intl.DateTimeFormat(i18n.language, { month: "long", year: "numeric" }).format(
        new Date(calCursor.year, calCursor.month, 1)
      ),
    [i18n.language, calCursor]
  );

  const hourLabels = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(i18n.language, { hour: "numeric" });
    return Array.from({ length: 24 }, (_, h) => fmt.format(new Date(2000, 0, 1, h)));
  }, [i18n.language]);

  const dueIsFarOut = !!value && !quickDays.some(({ date }) => sameLocalDay(date, value));
  const farOutLabel = useMemo(() => {
    if (!dueIsFarOut || !value) return null;
    return new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium" }).format(value);
  }, [dueIsFarOut, value, i18n.language]);

  const today = dayAt(0);
  const atCurrentMonth =
    calCursor.year === today.getFullYear() && calCursor.month === today.getMonth();

  const pickCalendarDay = (date: Date) => {
    onChange(date);
    setCalendarOpen(false);
  };

  const shiftMonth = (delta: number) => {
    setCalCursor(({ year, month }) => {
      const next = new Date(year, month + delta, 1);
      return { year: next.getFullYear(), month: next.getMonth() };
    });
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1.5">
        <button
          type="button"
          className={cn(chipBase, !value ? chipActive : chipInactive)}
          onClick={() => {
            onChange(null);
            setCalendarOpen(false);
          }}
        >
          {t("todo.noDue")}
        </button>
        {quickDays.map(({ date, label }) => {
          const isActive = !!value && sameLocalDay(value, date);
          return (
            <button
              type="button"
              key={date.toISOString()}
              className={cn(chipBase, isActive ? chipActive : chipInactive)}
              onClick={() => {
                onChange(date);
                setCalendarOpen(false);
              }}
            >
              {label}
            </button>
          );
        })}
        <button
          type="button"
          className={cn(
            chipBase,
            "inline-flex items-center gap-1",
            dueIsFarOut || calendarOpen ? chipActive : chipInactive
          )}
          onClick={() => setCalendarOpen((v) => !v)}
        >
          <CalendarDays className="h-3.5 w-3.5" />
          {farOutLabel ?? t("todo.pickDate")}
        </button>
      </div>

      {calendarOpen && (
        <div className="mt-2 rounded-lg border border-input bg-background p-3">
          <div className="mb-2 flex items-center justify-between">
            <button
              type="button"
              onClick={() => shiftMonth(-1)}
              disabled={atCurrentMonth}
              className="rounded p-1 text-foreground disabled:text-muted-foreground/40 hover:bg-muted disabled:hover:bg-transparent"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="text-sm font-semibold capitalize">{monthLabel}</span>
            <button
              type="button"
              onClick={() => shiftMonth(1)}
              className="rounded p-1 text-foreground hover:bg-muted"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="mb-1 grid grid-cols-7">
            {weekdayLabels.map((w, i) => (
              <span key={i} className="text-center text-[11px] font-semibold text-muted-foreground">
                {w}
              </span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-0.5">
            {monthGrid(calCursor.year, calCursor.month).map((date, i) => {
              if (!date) return <div key={i} className="aspect-square" />;
              const past = date.getTime() < today.getTime();
              const selected = !!value && sameLocalDay(value, date);
              const isToday = sameLocalDay(date, today);
              return (
                <button
                  type="button"
                  key={i}
                  disabled={past}
                  onClick={() => pickCalendarDay(date)}
                  className={cn(
                    "flex aspect-square items-center justify-center rounded-full text-sm",
                    past && "text-muted-foreground/40",
                    !past && !selected && "text-foreground hover:bg-muted",
                    isToday && !selected && "ring-1 ring-primary",
                    selected && "bg-primary font-semibold text-primary-foreground"
                  )}
                >
                  {date.getDate()}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {value && (
        <div className="mt-3">
          <p className="mb-1 text-sm font-semibold text-foreground">{t("todo.timeLabel")}</p>
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            {hourLabels.map((label, h) => {
              const isActive = hour === h;
              return (
                <button
                  type="button"
                  key={h}
                  className={cn(chipBase, "shrink-0", isActive ? chipActive : chipInactive)}
                  onClick={() => onTimeChange(h, 0)}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
