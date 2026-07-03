import type { ResponseTemplate } from "../lib/api";
import { useTranslation } from "react-i18next";
import { sanitizeHtml } from "../lib/sanitizeHtml";
import { Badge } from "@/components/ui/badge";
import {
  TrendingUp,
  TrendingDown,
  Minus,
  DollarSign,
  BarChart3,
  ArrowLeftRight,
  Clock,
  Building2,
  Landmark,
  Target,
  Newspaper,
  Calendar,
  type LucideIcon,
} from "lucide-react";

interface Props {
  template: ResponseTemplate;
  /** Override sample data (defaults to template.sampleData) */
  data?: Record<string, unknown>;
}

const ICON_MAP: Record<string, LucideIcon> = {
  "dollar-sign": DollarSign,
  "bar-chart-3": BarChart3,
  "arrow-left-right": ArrowLeftRight,
  clock: Clock,
  "building-2": Building2,
  landmark: Landmark,
  target: Target,
  newspaper: Newspaper,
  calendar: Calendar,
  "trending-up": TrendingUp,
};

function resolveColor(color?: string): string {
  switch (color) {
    case "success": return "text-success dark:text-success";
    case "warning": return "text-warning dark:text-warning";
    case "error":
    case "destructive": return "text-destructive dark:text-destructive";
    case "primary": return "text-primary dark:text-primary";
    default: return "text-success dark:text-success";
  }
}

function FieldIcon({ name, className }: { name?: string; className?: string }) {
  if (!name) return null;
  const Icon = ICON_MAP[name];
  if (!Icon) return null;
  return <Icon className={className || "w-3 h-3 text-muted-foreground"} />;
}

function ChangeIndicatorWeb({ value }: { value: string }) {
  const cleaned = value.replace(/[%$,\s]/g, "");
  const num = parseFloat(cleaned);
  const dir = isNaN(num) || num === 0 ? "flat" : num > 0 ? "up" : "down";
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const colors = dir === "up"
    ? "bg-success/10 text-success dark:text-success"
    : dir === "down"
    ? "bg-destructive/10 text-destructive dark:text-destructive"
    : "bg-muted text-muted-foreground";

  return (
    <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-semibold ${colors}`}>
      <Icon className="w-3 h-3" />
      {value}
    </span>
  );
}

function SparklineWeb({ data }: { data: number[] }) {
  if (!data || data.length < 2) return null;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const w = 140;
  const h = 28;
  const pad = 2;

  const points = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = pad + (h - pad * 2) - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");

  const trending = data[data.length - 1] >= data[0];
  // Use CSS variables so these follow the design-system tokens + debug mode.
  const color = trending
    ? "var(--color-success)"
    : "var(--color-destructive)";

  return (
    <svg width={w} height={h} className="mt-1">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function TemplateCardPreview({ template, data: overrideData }: Props) {
  const sample = overrideData || template.sampleData;
  if (!sample) return <EmptyPreview template={template} />;

  const details = (sample.details || {}) as Record<string, unknown>;

  const rows = template.fields.filter(f => f.display === "row" && !f.hidden);
  const chips = template.fields.filter(f => f.display === "chip" && !f.hidden);
  const highlights = template.fields.filter(f => f.display === "highlight" && !f.hidden);
  const bodies = template.fields.filter(f => f.display === "body" && !f.hidden);
  const changes = template.fields.filter(f => f.display === "change" && !f.hidden);
  const sparklines = template.fields.filter(f => f.display === "sparkline" && !f.hidden);

  const title = sample.title as string | undefined;
  const subtitle = sample.subtitle as string | undefined;
  const highlightsList = sample.highlights as string[] | undefined;
  const price = sample.price as { amount?: number; currency?: string } | undefined;
  const rating = sample.rating as number | undefined;

  return (
    <div className="border rounded-xl bg-card overflow-hidden shadow-sm max-w-sm">
      {/* Header */}
      <div className="p-4 pb-2">
        {title && (
          <h3 className="text-base font-semibold">{title}</h3>
        )}
        {subtitle && (
          <p className="text-xs text-muted-foreground mt-0.5">{subtitle}</p>
        )}
        {price && (
          <p className="text-lg font-bold mt-1">
            {price.currency === "USD" ? "$" : ""}{price.amount?.toLocaleString()}
          </p>
        )}
        {rating != null && (
          <div className="flex items-center gap-1 mt-1">
            <span className="text-warning">{"★".repeat(Math.round(rating))}</span>
            <span className="text-xs text-muted-foreground">{rating}</span>
          </div>
        )}
        {highlightsList && highlightsList.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-2">
            {highlightsList.map((h, i) => (
              <Badge key={i} variant="secondary" className="text-[10px]">{h}</Badge>
            ))}
          </div>
        )}
      </div>

      {/* Details */}
      <div className="px-4 pb-4 space-y-2">
        {/* Row fields */}
        {rows.map(field => {
          const val = details[field.key];
          if (val == null) return null;
          return (
            <div key={field.key} className="flex items-center gap-2 text-xs">
              <FieldIcon name={field.icon} />
              <span className="text-muted-foreground">{field.label}:</span>
              <span className="font-medium">{String(val)}</span>
            </div>
          );
        })}

        {/* Change indicators */}
        {changes.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {changes.map(field => {
              const val = details[field.key];
              if (val == null) return null;
              return <ChangeIndicatorWeb key={field.key} value={String(val)} />;
            })}
          </div>
        )}

        {/* Chips */}
        {chips.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {chips.map(field => {
              const val = details[field.key];
              if (val == null) return null;
              return (
                <Badge key={field.key} variant="outline" className="text-[10px] font-normal">
                  <FieldIcon name={field.icon} className="w-2.5 h-2.5 mr-1 text-muted-foreground" />
                  {field.label && <span className="text-muted-foreground mr-1">{field.label}:</span>}
                  {String(val)}
                </Badge>
              );
            })}
          </div>
        )}

        {/* Sparklines */}
        {sparklines.map(field => {
          const val = details[field.key];
          if (!val || !Array.isArray(val)) return null;
          return (
            <div key={field.key}>
              {field.label && (
                <span className="text-[10px] text-muted-foreground">{field.label}</span>
              )}
              <SparklineWeb data={val.map(Number)} />
            </div>
          );
        })}

        {/* Body fields */}
        {bodies.map(field => {
          const val = details[field.key];
          if (val == null) return null;
          const text = String(val);
          const isHtml = /<[a-z][\s\S]*>/i.test(text);
          return (
            <div
              key={field.key}
              className="text-xs text-muted-foreground leading-relaxed mt-1 border-t pt-2 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:list-decimal [&_ol]:pl-4 [&_a]:text-primary [&_a]:underline"
              {...(isHtml
                ? { dangerouslySetInnerHTML: { __html: sanitizeHtml(text) } }
                : { children: text })}
            />
          );
        })}

        {/* Highlights */}
        {highlights.map(field => {
          const val = details[field.key];
          if (val == null) return null;
          return (
            <div key={field.key} className={`flex items-center gap-2 text-xs font-medium mt-1 ${resolveColor(field.color)}`}>
              <FieldIcon name={field.icon} className={`w-3 h-3 ${resolveColor(field.color)}`} />
              {String(val)}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function EmptyPreview({ template }: { template: ResponseTemplate }) {
  const { t } = useTranslation("templates");
  return (
    <div className="border rounded-xl bg-card p-4 max-w-sm">
      <p className="text-sm font-medium font-mono">{template.name}</p>
      <p className="text-xs text-muted-foreground mt-1">{t("noSampleData")}</p>
      <div className="flex flex-wrap gap-1 mt-3">
        {template.fields.map(f => (
          <Badge key={f.key} variant="outline" className="text-[10px]">
            {f.key} ({f.display})
          </Badge>
        ))}
      </div>
    </div>
  );
}
