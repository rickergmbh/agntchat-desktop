import { AlertCircle, Image as ImageIcon } from "lucide-react";
import { PhaseOrb } from "../PhaseOrb";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { cn } from "../../lib/utils";

const ZONE_COLORS: Record<string, string> = {
  header: "border-l-primary",
  content: "border-l-success",
  footer: "border-l-warning",
};

const ZONE_BG: Record<string, string> = {
  header: "bg-primary/5",
  content: "bg-success/5",
  footer: "bg-warning/5",
};

type Props = Record<string, unknown>;

function propString(props: Props, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = props[k];
    if (typeof v === "string" && v.length > 0) return v;
  }
  return undefined;
}

export function PreviewWidget({ widget }: { widget: Record<string, unknown> }) {
  const type = (widget.type as string) ?? "unknown";
  const props = (widget.props ?? {}) as Props;

  switch (type) {
    case "text":
    case "heading": {
      const variant = props.variant as string | undefined;
      const content =
        propString(props, "content", "text", "label") ?? "(empty text)";
      return (
        <div className="px-3 py-1.5">
          <p
            className={cn(
              variant === "title" && "text-base font-bold",
              variant === "subtitle" && "text-sm font-semibold",
              variant === "body" && "text-sm",
              variant === "caption" && "text-xs text-muted-foreground",
              !variant && "text-sm"
            )}
          >
            {content}
          </p>
        </div>
      );
    }

    case "button": {
      const label = propString(props, "label", "text") ?? "Button";
      return (
        <div className="px-3 py-1.5">
          <div className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-xs font-medium text-primary-foreground">
            {label}
          </div>
        </div>
      );
    }

    case "button_grid": {
      const buttons = Array.isArray(props.buttons)
        ? (props.buttons as Props[])
        : [];
      return (
        <div className="flex flex-wrap gap-1.5 px-3 py-1.5">
          {buttons.map((btn, i) => (
            <div
              key={i}
              className={cn(
                "inline-flex h-8 items-center rounded-md px-3 text-xs font-medium",
                (btn.style as string) === "primary"
                  ? "bg-primary text-primary-foreground"
                  : "border border-border bg-background text-foreground"
              )}
            >
              {(btn.label as string) ?? "Button"}
            </div>
          ))}
          {buttons.length === 0 && (
            <span className="text-xs text-muted-foreground">
              (no buttons defined)
            </span>
          )}
        </div>
      );
    }

    case "card": {
      const title = propString(props, "title");
      const subtitle = propString(props, "subtitle");
      return (
        <div className="mx-3 my-1.5 rounded-lg border border-border p-3">
          {title && <p className="text-sm font-semibold">{title}</p>}
          {subtitle && (
            <p className="mt-0.5 text-xs text-muted-foreground">{subtitle}</p>
          )}
          {!title && !subtitle && (
            <span className="text-xs text-muted-foreground">(empty card)</span>
          )}
        </div>
      );
    }

    case "alert":
    case "banner":
    case "toast": {
      const content =
        propString(props, "content", "message", "text") ?? "(alert)";
      const variant = (props.variant as string) ?? "warning";
      const palette =
        variant === "success"
          ? "border-success/30 bg-success/5 text-success"
          : variant === "error" || variant === "destructive"
          ? "border-destructive/30 bg-destructive/5 text-destructive"
          : variant === "info"
          ? "border-primary/30 bg-primary/5 text-primary"
          : "border-warning/30 bg-warning/5 text-warning";
      return (
        <div className={cn("mx-3 my-1.5 rounded-lg border px-3 py-2", palette)}>
          <p className="text-xs">{content}</p>
        </div>
      );
    }

    case "divider":
    case "separator":
      return (
        <div className="px-3 py-2">
          <Separator />
        </div>
      );

    case "spacer": {
      const size = (props.size as string) ?? "md";
      const h = size === "sm" ? "h-2" : size === "lg" ? "h-6" : "h-4";
      return <div className={h} />;
    }

    case "image": {
      const src = propString(props, "src", "url");
      const alt = propString(props, "alt", "caption") ?? "image";
      return (
        <div className="mx-3 my-1.5 overflow-hidden rounded-lg border border-border bg-muted/20">
          {src ? (
            <img src={src} alt={alt} className="max-h-40 w-full object-cover" />
          ) : (
            <div className="flex h-24 items-center justify-center text-muted-foreground">
              <ImageIcon className="h-5 w-5" />
              <span className="ml-2 text-xs">(no src)</span>
            </div>
          )}
        </div>
      );
    }

    case "table": {
      const cols = Array.isArray(props.columns) ? (props.columns as Props[]) : [];
      const rows = Array.isArray(props.rows) ? (props.rows as Props[]) : [];
      return (
        <div className="mx-3 my-1.5 overflow-hidden rounded-lg border border-border">
          <div className="bg-muted/40 px-2 py-1 border-b border-border">
            <div className="flex gap-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {cols.map((c, i) => (
                <span key={i} className="flex-1 truncate">
                  {propString(c, "label", "header", "title") ?? `col ${i + 1}`}
                </span>
              ))}
              {cols.length === 0 && <span>(no columns)</span>}
            </div>
          </div>
          <div className="divide-y divide-border">
            {rows.slice(0, 3).map((r, i) => (
              <div key={i} className="flex gap-3 px-2 py-1 text-xs">
                {cols.length > 0
                  ? cols.map((c, j) => {
                      const key = propString(c, "key", "field");
                      return (
                        <span key={j} className="flex-1 truncate">
                          {key ? String(r[key] ?? "") : ""}
                        </span>
                      );
                    })
                  : Object.values(r)
                      .slice(0, 3)
                      .map((v, j) => (
                        <span key={j} className="flex-1 truncate">
                          {String(v)}
                        </span>
                      ))}
              </div>
            ))}
            {rows.length === 0 && (
              <div className="px-2 py-2 text-[11px] text-muted-foreground/60">
                (no rows)
              </div>
            )}
            {rows.length > 3 && (
              <div className="px-2 py-1 text-[10px] text-muted-foreground/60">
                …{rows.length - 3} more rows
              </div>
            )}
          </div>
        </div>
      );
    }

    case "carousel": {
      const items = Array.isArray(props.items) ? (props.items as Props[]) : [];
      return (
        <div className="mx-3 my-1.5">
          <div className="flex gap-2 overflow-x-auto pb-1">
            {items.map((it, i) => (
              <div
                key={i}
                className="min-w-[140px] rounded-lg border border-border bg-card p-2 text-xs"
              >
                <p className="font-semibold truncate">
                  {propString(it, "title", "label") ?? `Item ${i + 1}`}
                </p>
                {propString(it, "subtitle", "description") && (
                  <p className="mt-0.5 truncate text-[10px] text-muted-foreground">
                    {propString(it, "subtitle", "description")}
                  </p>
                )}
              </div>
            ))}
            {items.length === 0 && (
              <span className="text-xs text-muted-foreground">
                (no carousel items)
              </span>
            )}
          </div>
        </div>
      );
    }

    case "accordion": {
      const items = Array.isArray(props.items) ? (props.items as Props[]) : [];
      return (
        <div className="mx-3 my-1.5 rounded-lg border border-border overflow-hidden">
          {items.map((it, i) => (
            <div
              key={i}
              className="border-b border-border last:border-b-0 px-3 py-2 text-xs"
            >
              <p className="font-medium">
                {propString(it, "title", "label") ?? `Item ${i + 1}`}
              </p>
              {propString(it, "content", "body") && (
                <p className="mt-0.5 text-[11px] text-muted-foreground truncate">
                  {propString(it, "content", "body")}
                </p>
              )}
            </div>
          ))}
          {items.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              (no accordion items)
            </div>
          )}
        </div>
      );
    }

    case "tabs": {
      const tabs = Array.isArray(props.tabs) ? (props.tabs as Props[]) : [];
      return (
        <div className="mx-3 my-1.5 rounded-lg border border-border overflow-hidden">
          <div className="flex gap-1 border-b border-border bg-muted/30 px-2 py-1">
            {tabs.map((t, i) => (
              <span
                key={i}
                className={cn(
                  "rounded px-2 py-0.5 text-[10px]",
                  i === 0 ? "bg-background font-medium" : "text-muted-foreground"
                )}
              >
                {propString(t, "label", "title") ?? `Tab ${i + 1}`}
              </span>
            ))}
            {tabs.length === 0 && (
              <span className="text-[10px] text-muted-foreground">
                (no tabs)
              </span>
            )}
          </div>
          <div className="px-3 py-2 text-xs text-muted-foreground">
            Active tab content
          </div>
        </div>
      );
    }

    case "slider": {
      const min = (props.min as number) ?? 0;
      const max = (props.max as number) ?? 100;
      const value = (props.value as number) ?? (min + max) / 2;
      const pct = max > min ? ((value - min) / (max - min)) * 100 : 0;
      return (
        <div className="mx-3 my-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{min}</span>
            <span className="font-mono">{value}</span>
            <span>{max}</span>
          </div>
          <div className="mt-1 h-1 rounded-full bg-muted">
            <div
              className="h-1 rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    }

    case "progress_bar": {
      const value = (props.value as number) ?? 0;
      const max = (props.max as number) ?? 100;
      const pct = Math.min(100, Math.max(0, (value / max) * 100));
      return (
        <div className="mx-3 my-1.5">
          <div className="flex items-center justify-between text-[10px] text-muted-foreground">
            <span>{propString(props, "label") ?? "Progress"}</span>
            <span className="font-mono">{Math.round(pct)}%</span>
          </div>
          <div className="mt-1 h-1.5 rounded-full bg-muted">
            <div
              className="h-1.5 rounded-full bg-primary"
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
      );
    }

    case "switch_toggle": {
      const label = propString(props, "label") ?? "Toggle";
      const on = Boolean(props.value ?? props.checked);
      return (
        <div className="mx-3 my-1.5 flex items-center justify-between text-xs">
          <span>{label}</span>
          <div
            className={cn(
              "relative inline-flex h-4 w-7 items-center rounded-full transition-colors",
              on ? "bg-primary" : "bg-muted"
            )}
          >
            <span
              className={cn(
                "inline-block h-3 w-3 rounded-full bg-background transition-transform",
                on ? "translate-x-3.5" : "translate-x-0.5"
              )}
            />
          </div>
        </div>
      );
    }

    case "radio_group": {
      const options = Array.isArray(props.options)
        ? (props.options as Props[])
        : [];
      const value = props.value;
      return (
        <div className="mx-3 my-1.5 space-y-1">
          {options.map((opt, i) => {
            const v = opt.value ?? opt.label;
            const selected = v === value || (i === 0 && value == null);
            return (
              <div key={i} className="flex items-center gap-2 text-xs">
                <span
                  className={cn(
                    "inline-block h-3 w-3 rounded-full border",
                    selected
                      ? "border-primary"
                      : "border-muted-foreground/40"
                  )}
                >
                  {selected && (
                    <span className="block h-1.5 w-1.5 m-0.5 rounded-full bg-primary" />
                  )}
                </span>
                <span>{propString(opt, "label") ?? String(v)}</span>
              </div>
            );
          })}
          {options.length === 0 && (
            <span className="text-xs text-muted-foreground">
              (no radio options)
            </span>
          )}
        </div>
      );
    }

    case "stat_row":
    case "hero_stat":
    case "score_display": {
      const label = propString(props, "label", "title") ?? "Stat";
      const value = propString(props, "value") ?? String(props.value ?? "—");
      const hero = type === "hero_stat";
      return (
        <div className="mx-3 my-1.5 rounded-lg border border-border bg-card px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          <p
            className={cn(
              "font-semibold",
              hero ? "text-2xl mt-1" : "text-sm mt-0.5"
            )}
          >
            {value}
          </p>
        </div>
      );
    }

    case "schedule_display": {
      const items = Array.isArray(props.items) ? (props.items as Props[]) : [];
      return (
        <div className="mx-3 my-1.5 rounded-lg border border-border overflow-hidden">
          {items.slice(0, 3).map((it, i) => (
            <div
              key={i}
              className="flex items-center gap-2 border-b border-border last:border-b-0 px-3 py-1.5 text-xs"
            >
              <span className="font-mono text-[10px] text-muted-foreground">
                {propString(it, "time", "start") ?? "--:--"}
              </span>
              <span className="truncate">
                {propString(it, "title", "label") ?? `Event ${i + 1}`}
              </span>
            </div>
          ))}
          {items.length === 0 && (
            <div className="px-3 py-2 text-xs text-muted-foreground">
              (no schedule items)
            </div>
          )}
          {items.length > 3 && (
            <div className="px-3 py-1 text-[10px] text-muted-foreground/60">
              …{items.length - 3} more
            </div>
          )}
        </div>
      );
    }

    case "typing_indicator":
      return (
        <div className="mx-3 my-1.5 inline-flex items-center rounded-full bg-muted px-2 py-1">
          <PhaseOrb state="composing" />
        </div>
      );

    case "flow_step_indicator": {
      const steps = Array.isArray(props.steps) ? (props.steps as Props[]) : [];
      const current = (props.current as number) ?? 0;
      return (
        <div className="mx-3 my-1.5 flex items-center gap-1">
          {steps.map((s, i) => (
            <div key={i} className="flex flex-1 items-center gap-1">
              <span
                className={cn(
                  "inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-semibold",
                  i <= current
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {i + 1}
              </span>
              <span className="truncate text-[10px] text-muted-foreground">
                {propString(s, "label") ?? ""}
              </span>
              {i < steps.length - 1 && (
                <span className="flex-1 h-px bg-border" />
              )}
            </div>
          ))}
          {steps.length === 0 && (
            <span className="text-xs text-muted-foreground">(no steps)</span>
          )}
        </div>
      );
    }

    case "message_list":
      return (
        <div className="mx-3 my-1.5 flex h-24 items-center justify-center rounded-lg border border-dashed border-border bg-muted/30">
          <span className="text-xs text-muted-foreground">
            Messages appear here
          </span>
        </div>
      );

    default:
      return (
        <div className="mx-3 my-1.5 flex items-center gap-2 rounded-lg border border-dashed border-border px-3 py-2">
          <Badge variant="secondary" className="text-[9px] px-1 py-0 font-mono">
            {type}
          </Badge>
          <span className="text-[10px] text-muted-foreground truncate">
            {propString(props, "text", "label", "title") ??
              "(no preview for this widget type)"}
          </span>
        </div>
      );
  }
}

export function CanvasRenderer({ json }: { json: string }) {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(json);
  } catch {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center">
        <div>
          <AlertCircle className="mx-auto mb-2 h-6 w-6 text-muted-foreground/50" />
          <p className="text-xs text-muted-foreground">
            Fix JSON errors to see preview
          </p>
        </div>
      </div>
    );
  }

  const layout = parsed.layout as Record<string, unknown> | undefined;
  const zones: string[] = Array.isArray(layout?.zones)
    ? (layout.zones as string[])
    : ["content"];
  const widgets = Array.isArray(parsed.widgets)
    ? (parsed.widgets as Record<string, unknown>[])
    : [];
  const theme = parsed.theme as Record<string, unknown> | undefined;

  return (
    <div className="flex h-full flex-col overflow-auto">
      {theme?.bgColor ? (
        <div className="px-3 py-1">
          <span className="text-[9px] text-muted-foreground">
            bg: {String(theme.bgColor)}
          </span>
        </div>
      ) : null}
      {zones.map((zone) => {
        const zoneWidgets = widgets.filter((w) => w.zone === zone);
        return (
          <div
            key={zone}
            className={cn(
              "border-l-2 py-2",
              ZONE_COLORS[zone] ?? "border-l-muted-foreground",
              ZONE_BG[zone] ?? "bg-muted/5",
              zone === "content" && "flex-1"
            )}
          >
            <p className="px-3 pb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground">
              {zone}
            </p>
            {zoneWidgets.length > 0 ? (
              zoneWidgets.map((w, i) => (
                <PreviewWidget key={(w.id as string) ?? i} widget={w} />
              ))
            ) : (
              <div className="px-3 py-1">
                <span className="text-[10px] text-muted-foreground/50">
                  (empty zone)
                </span>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
