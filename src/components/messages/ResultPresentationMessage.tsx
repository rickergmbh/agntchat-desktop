import { useState, useCallback } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import type { Message } from "../../lib/api";
import { cn } from "../../lib/utils";
import { sanitizeHtml } from "../../lib/sanitizeHtml";
import { MarkdownContent } from "./MarkdownContent";
import { ScreenplayBody, isScreenplayTemplate } from "./ScreenplayBody";
import {
  Star,
  MapPin,
  ExternalLink,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Bed,
  Utensils,
  Plane,
  Calendar,
  ShoppingBag,
  Package,
  Clock,
  DollarSign,
  Mail,
  Send,
  Tag,
  CheckCircle,
  User,
  ShieldCheck,
  Navigation,
  TrendingUp,
  TrendingDown,
  ArrowUpRight,
  ArrowDownRight,
  Minus,
  Phone,
  Globe,
  Briefcase,
  CircleDot,
  Contact,
  Inbox,
  Building2,
  Landmark,
  ArrowLeftRight,
  Target,
  Newspaper,
  Banknote,
  BarChart3,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ResultPrice {
  amount: number;
  currency?: string;
  per?: string;
  original_amount?: number;
  discount_pct?: number;
}

interface ResultCTA {
  label: string;
  url?: string;
  action?: string;
}

interface DetailFieldDescriptor {
  key: string;
  display: "row" | "chip" | "highlight" | "body" | "sparkline" | "change";
  label?: string;
  icon?: string;
  color?: string;
  format?: string;
  hidden?: boolean;
  link?: "tel" | "mailto" | "url" | "map";
}

function resolveFieldLink(
  field: DetailFieldDescriptor,
  rawValue: unknown,
): string | null {
  if (!field.link || rawValue == null) return null;
  const value = String(rawValue).trim();
  if (!value) return null;

  switch (field.link) {
    case "tel": {
      const digits = value.replace(/(?!^\+)[^\d]/g, "");
      if (!digits) return null;
      return `tel:${digits}`;
    }
    case "mailto":
      return `mailto:${value}`;
    case "url":
      return /^https?:\/\//i.test(value) ? value : `https://${value}`;
    case "map":
      return `https://maps.google.com/?q=${encodeURIComponent(value)}`;
    default:
      return null;
  }
}

interface ResultItem {
  type?: string;
  title?: string;
  subtitle?: string;
  image_url?: string;
  gallery_images?: string[];
  rating?: number;
  rating_count?: number;
  rating_source?: string;
  price?: ResultPrice;
  amenities?: string[];
  highlights?: string[];
  booking_url?: string;
  cta?: { primary?: ResultCTA; secondary?: ResultCTA[] };
  details?: Record<string, unknown>;
  detail_schema?: DetailFieldDescriptor[];
  detail_template?: string;
  [key: string]: unknown;
}

interface RPData {
  result_type?: string;
  title?: string;
  items?: ResultItem[];
  citations?: Array<{
    source_name?: string;
    url?: string;
    confidence?: number;
  }>;
}

// ---------------------------------------------------------------------------
// Icon registry
// ---------------------------------------------------------------------------

// Keep in sync with web's ResultPresentationMessage ICON_MAP, mobile's
// lib/detailTemplate/icons.tsx, and the backend catalog
// (ResponseTemplates.Schema.icon_catalog/0).
const ICON_MAP: Record<string, LucideIcon> = {
  bed: Bed,
  "map-pin": MapPin,
  clock: Clock,
  plane: Plane,
  utensils: Utensils,
  calendar: Calendar,
  navigation: Navigation,
  "shield-check": ShieldCheck,
  "shopping-bag": ShoppingBag,
  "dollar-sign": DollarSign,
  mail: Mail,
  send: Send,
  inbox: Inbox,
  tag: Tag,
  "check-circle": CheckCircle,
  user: User,
  star: Star,
  package: Package,
  "external-link": ExternalLink,
  "trending-up": TrendingUp,
  "trending-down": TrendingDown,
  phone: Phone,
  globe: Globe,
  briefcase: Briefcase,
  "circle-dot": CircleDot,
  "building-2": Building2,
  landmark: Landmark,
  "arrow-left-right": ArrowLeftRight,
  target: Target,
  newspaper: Newspaper,
  banknote: Banknote,
  "bar-chart-3": BarChart3,
};

const RESULT_TYPE_ICONS: Record<string, LucideIcon> = {
  hotel: Bed,
  restaurant: Utensils,
  flight: Plane,
  event: Calendar,
  product: ShoppingBag,
  finance: DollarSign,
  email: Mail,
  contact: Contact,
  generic: Package,
};

function resolveIcon(name?: string): LucideIcon | null {
  if (!name) return null;
  return ICON_MAP[name] ?? null;
}

function resultTypeIcon(type?: string): LucideIcon {
  if (!type) return Package;
  return RESULT_TYPE_ICONS[type] ?? Package;
}

// ---------------------------------------------------------------------------
// Currency helper
// ---------------------------------------------------------------------------

const CURRENCY_SYMBOLS: Record<string, string> = {
  USD: "$",
  EUR: "\u20AC",
  GBP: "\u00A3",
};

function currencySymbol(code?: string): string {
  if (!code) return "$";
  return CURRENCY_SYMBOLS[code.toUpperCase()] ?? code;
}

// ---------------------------------------------------------------------------
// Format helper for detail fields
// ---------------------------------------------------------------------------

function formatValue(
  field: DetailFieldDescriptor,
  details: Record<string, unknown>,
  t: TFunction<"chat">,
): string {
  const raw = details[field.key];
  if (raw == null) return "";

  if (field.format === "route") {
    const arrival = details["arrival"] ?? details["to"];
    return arrival ? `${raw} \u2192 ${arrival}` : String(raw);
  }

  if (field.format === "stops") {
    const n = Number(raw);
    if (n === 0) return t("results.nonstop");
    return t("results.stops", { count: n });
  }

  return String(raw);
}

// ---------------------------------------------------------------------------
// Sparkline SVG
// ---------------------------------------------------------------------------

function Sparkline({
  data,
  color = "currentColor",
}: {
  data: number[];
  color?: string;
}) {
  if (!data || data.length < 2) return null;
  const w = 80;
  const h = 24;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data
    .map(
      (v, i) =>
        `${(i / (data.length - 1)) * w},${h - ((v - min) / range) * h}`,
    )
    .join(" ");
  return (
    <svg width={w} height={h} className="inline-block align-middle">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
      />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Star Rating
// ---------------------------------------------------------------------------

function StarRating({
  rating,
  count,
  source,
}: {
  rating: number;
  count?: number;
  source?: string;
}) {
  const stars = [];
  for (let i = 1; i <= 5; i++) {
    const filled = rating >= i;
    const half = !filled && rating >= i - 0.5;
    stars.push(
      <Star
        key={i}
        className={cn(
          "h-3 w-3",
          filled
            ? "fill-warning text-warning"
            : half
              ? "fill-warning/50 text-warning/50"
              : "text-muted-foreground/30",
        )}
      />,
    );
  }

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <div className="flex items-center gap-0.5">{stars}</div>
      <span className="font-medium">{rating.toFixed(1)}</span>
      {count != null && (
        <span className="text-muted-foreground">({count.toLocaleString()})</span>
      )}
      {source && (
        <span className="text-muted-foreground">{source}</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Price Badge
// ---------------------------------------------------------------------------

function PriceBadge({ price }: { price: ResultPrice }) {
  const sym = currencySymbol(price.currency);

  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-base font-semibold tabular-nums text-foreground">
        {sym}
        {price.amount.toLocaleString()}
      </span>
      {price.per && (
        <span className="text-xs text-muted-foreground">/{price.per}</span>
      )}
      {price.original_amount != null && (
        <span className="text-xs text-muted-foreground line-through">
          {sym}
          {price.original_amount.toLocaleString()}
        </span>
      )}
      {price.discount_pct != null && (
        <span className="text-xs font-medium tabular-nums text-success">
          -{price.discount_pct}%
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Amenity Chips
// ---------------------------------------------------------------------------

function AmenityChips({ amenities }: { amenities: string[] }) {
  const { t } = useTranslation("chat");
  const MAX_VISIBLE = 6;
  const visible = amenities.slice(0, MAX_VISIBLE);
  const overflow = amenities.length - MAX_VISIBLE;

  return (
    <div className="flex flex-wrap gap-1">
      {visible.map((a) => (
        <span
          key={a}
          className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
        >
          {a}
        </span>
      ))}
      {overflow > 0 && (
        <span className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
          {t("results.more", { count: overflow })}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlights
// ---------------------------------------------------------------------------

function Highlights({ highlights }: { highlights: string[] }) {
  return (
    <div className="flex flex-wrap gap-1">
      {highlights.map((h) => (
        <span
          key={h}
          className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-foreground"
        >
          {h}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Highlight color mapping
// ---------------------------------------------------------------------------

// Callout (magazine-style) accent for `display: "highlight"` fields — the
// headline at the top of a brief card, or a punchy talking-point at the
// bottom. Quiet-card rules: the left rule stays neutral (structure, not
// status); the schema color lands only on the small icon glyph.
const CALLOUT_ACCENT: Record<string, { text: string }> = {
  success: { text: "text-success" },
  warning: { text: "text-warning" },
  destructive: { text: "text-destructive" },
  primary: { text: "text-primary" },
};

// ---------------------------------------------------------------------------
// Collapsible Body
// ---------------------------------------------------------------------------

function isHtml(text: string): boolean {
  return /<[a-z][\s\S]*>/i.test(text);
}

function RichBody({
  content,
  screenplay,
}: {
  content: string;
  screenplay?: boolean;
}) {
  if (screenplay) {
    return <ScreenplayBody content={content} />;
  }

  if (isHtml(content)) {
    return (
      <div
        className="text-sm leading-relaxed [&_p]:mb-1 [&_p:last-child]:mb-0 [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-4 [&_ol]:my-1 [&_ol]:list-decimal [&_ol]:pl-4 [&_li]:my-0.5 [&_strong]:font-semibold [&_b]:font-semibold [&_a]:underline [&_h1]:text-base [&_h1]:font-bold [&_h2]:text-[15px] [&_h2]:font-bold [&_h3]:text-sm [&_h3]:font-semibold [&_blockquote]:border-l-2 [&_blockquote]:border-current/30 [&_blockquote]:pl-2"
        dangerouslySetInnerHTML={{ __html: sanitizeHtml(content) }}
      />
    );
  }
  return <MarkdownContent content={content} />;
}

function CollapsibleBody({
  content,
  label,
  icon: IconComp,
  disableCollapse,
  screenplay,
}: {
  content: string;
  label?: string;
  icon?: LucideIcon | null;
  disableCollapse?: boolean;
  screenplay?: boolean;
}) {
  const { t } = useTranslation("common");
  const [expanded, setExpanded] = useState(false);
  const isLong = !disableCollapse && content.length > 200;

  return (
    <div
      className={cn(
        "relative",
        label && "mt-2 pt-2 border-t border-border/60",
      )}
    >
      {label && (
        <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
          {IconComp && <IconComp className="h-3 w-3" />}
          <span>{label}</span>
        </div>
      )}
      <div
        className={cn(
          !expanded && isLong && "max-h-[200px] overflow-hidden",
        )}
      >
        <RichBody content={content} screenplay={screenplay} />
      </div>
      {isLong && !expanded && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-card to-transparent" />
      )}
      {isLong && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="mt-1 flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80"
        >
          {expanded ? (
            <>
              <ChevronDown className="h-3 w-3" /> {t("showLess")}
            </>
          ) : (
            <>
              <ChevronRight className="h-3 w-3" /> {t("showMore")}
            </>
          )}
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Detail Section — renders fields from detail_schema
// ---------------------------------------------------------------------------

function DetailSection({
  schema,
  details,
  disableBodyCollapse,
  screenplay,
}: {
  schema: DetailFieldDescriptor[];
  details: Record<string, unknown>;
  disableBodyCollapse?: boolean;
  screenplay?: boolean;
}) {
  const { t } = useTranslation("chat");
  // Group consecutive chip fields together
  const elements: React.ReactNode[] = [];
  let chipBuffer: DetailFieldDescriptor[] = [];

  function flushChips() {
    if (chipBuffer.length === 0) return;
    const chips = chipBuffer;
    chipBuffer = [];
    elements.push(
      <div key={`chips-${chips[0]?.key ?? "buf"}`} className="flex flex-wrap gap-1">
        {chips.map((f) => {
          const val = details[f.key];
          if (val == null) return null;
          const url = resolveFieldLink(f, val);
          const text = `${f.label ? `${f.label}: ` : ""}${String(val)}`;
          if (url) {
            return (
              <a
                key={f.key}
                href={url}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-primary underline"
              >
                {text}
              </a>
            );
          }
          return (
            <span
              key={f.key}
              className="inline-flex items-center rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground"
            >
              {text}
            </span>
          );
        })}
      </div>,
    );
  }

  for (const field of schema) {
    if (field.hidden) continue;
    const val = details[field.key];
    if (val == null && field.display !== "body") continue;

    if (field.display === "chip") {
      chipBuffer.push(field);
      continue;
    }

    flushChips();

    if (field.display === "row") {
      const IconComp = resolveIcon(field.icon);
      const url = resolveFieldLink(field, val);
      const valueText = formatValue(field, details, t);
      elements.push(
        <div
          key={field.key}
          className="flex items-center gap-2 text-xs"
        >
          {IconComp && (
            <IconComp className="h-3.5 w-3.5 text-muted-foreground" />
          )}
          {field.label && (
            <span className="text-muted-foreground">{field.label}:</span>
          )}
          {url ? (
            <a
              href={url}
              target="_blank"
              rel="noopener noreferrer"
              className="font-medium text-primary underline hover:text-primary/80"
            >
              {valueText}
            </a>
          ) : (
            <span className="font-medium">{valueText}</span>
          )}
        </div>,
      );
    } else if (field.display === "highlight") {
      const accent =
        CALLOUT_ACCENT[field.color ?? "primary"] ?? CALLOUT_ACCENT.primary!;
      const IconComp = resolveIcon(field.icon);
      const url = resolveFieldLink(field, val);
      const text = `${field.label ? `${field.label}: ` : ""}${String(val)}`;

      const callout = (
        <div className="flex items-start gap-2 border-l-2 border-border-strong py-1 pl-3 text-[15px] font-semibold leading-snug text-foreground">
          {IconComp && (
            <IconComp className={cn("mt-0.5 h-4 w-4 shrink-0", accent.text)} />
          )}
          <span className="min-w-0">{text}</span>
        </div>
      );

      if (url) {
        elements.push(
          <a
            key={field.key}
            href={url}
            target="_blank"
            rel="noopener noreferrer"
            className="block hover:opacity-80 transition-opacity"
          >
            {callout}
          </a>,
        );
      } else {
        elements.push(<div key={field.key}>{callout}</div>);
      }
    } else if (field.display === "body") {
      const text = val != null ? String(val) : "";
      if (!text) continue;
      const BodyIcon = resolveIcon(field.icon);
      const renderAsScreenplay =
        screenplay &&
        ["content", "script", "page"].includes(field.key.toLowerCase());
      elements.push(
        <CollapsibleBody
          key={field.key}
          content={text}
          label={field.label}
          icon={BodyIcon}
          disableCollapse={disableBodyCollapse}
          screenplay={renderAsScreenplay}
        />,
      );
    } else if (field.display === "change") {
      // Agents send change values as strings ("+.10%", "-1.5") as often as
      // numbers — parse like mobile's ChangeIndicator and show the raw value.
      const raw = String(val);
      const num = parseFloat(raw.replace(/[%$,\s]/g, ""));
      const flat = Number.isNaN(num) || num === 0;
      const text =
        field.format === "percent" && !raw.endsWith("%") ? `${raw}%` : raw;
      elements.push(
        <div key={field.key} className="flex items-center gap-1.5 text-xs">
          {field.label && (
            <span className="text-muted-foreground">{field.label}:</span>
          )}
          <span className="inline-flex items-center gap-1">
            {flat ? (
              <Minus className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            ) : num > 0 ? (
              <ArrowUpRight className="h-3.5 w-3.5 shrink-0 text-success" />
            ) : (
              <ArrowDownRight className="h-3.5 w-3.5 shrink-0 text-destructive" />
            )}
            <span className="font-medium tabular-nums text-foreground">
              {text}
            </span>
          </span>
        </div>,
      );
    } else if (field.display === "sparkline") {
      const arr = Array.isArray(val) ? (val as number[]) : [];
      if (arr.length < 2) continue;
      elements.push(
        <div key={field.key} className="flex items-center gap-2 text-xs">
          {field.label && (
            <span className="text-muted-foreground">{field.label}:</span>
          )}
          <Sparkline data={arr} color={field.color} />
        </div>,
      );
    }
  }

  flushChips();

  if (elements.length === 0) return null;
  return <div className="space-y-2">{elements}</div>;
}

// ---------------------------------------------------------------------------
// CTA Buttons
// ---------------------------------------------------------------------------

// Direct REST execution for email actions; anything else without a URL is
// relayed to the agent as a UserAction event. Mirrors web/mobile.
async function executeCTAAction(
  action: string,
  itemTitle: string | undefined,
  itemDetails: Record<string, unknown>,
  t: TFunction<"chat">
): Promise<string | null> {
  if (action === "send_email" || action === "save_draft") {
    const { request } = await import("../../lib/api");
    const to = String(itemDetails.to ?? "");
    const subject = itemTitle || String(itemDetails.subject ?? "");
    const body = String(itemDetails.body ?? "");

    if (action === "send_email" && (!to || !body)) {
      return t("results.cannotSendMissing");
    }
    if (action === "save_draft" && !body) {
      return t("results.cannotSaveDraftEmpty");
    }

    const contentType = /<[a-z][\s\S]*>/i.test(body) ? "text/html" : "text/plain";
    const payload = {
      to,
      subject,
      body,
      ...(itemDetails.cc ? { cc: itemDetails.cc } : {}),
      ...(itemDetails.bcc ? { bcc: itemDetails.bcc } : {}),
      content_type: contentType,
    };

    if (action === "send_email") {
      const result = await request<{ sent_to?: string }>("/api/google/gmail/send", {
        method: "POST",
        body: JSON.stringify(payload),
      });
      return t("results.emailSentTo", { to: result?.sent_to || to });
    }
    await request("/api/google/gmail/drafts", {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return t("results.draftSaved", { subject });
  }

  return null; // unknown action — caller falls through to the WS relay
}

function CTAButton({
  cta,
  primary,
  itemTitle,
  itemDetails,
  conversationId,
}: {
  cta: ResultCTA;
  primary?: boolean;
  itemTitle?: string;
  itemDetails: Record<string, unknown>;
  conversationId?: string;
}) {
  const { t } = useTranslation("chat");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);

  const className = cn(
    "inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-medium",
    primary
      ? "bg-primary text-primary-foreground hover:bg-primary/90"
      : "border border-border text-foreground hover:bg-muted",
    (busy || done) && "opacity-60 pointer-events-none"
  );

  if (cta.url) {
    return (
      <a href={cta.url} target="_blank" rel="noopener noreferrer" className={className}>
        {cta.label}
        {primary && <ExternalLink className="h-3 w-3" />}
      </a>
    );
  }

  if (!cta.action) return null;

  const handleClick = async () => {
    if (busy || done) return;
    setBusy(true);
    try {
      const result = await executeCTAAction(cta.action!, itemTitle, itemDetails, t);
      if (result != null) {
        setDone(result);
        return;
      }
      // Unknown action: relay to the agent as a structured UserAction event.
      if (conversationId) {
        const { ws } = await import("../../services/websocket");
        await ws.sendAction(conversationId, cta.action!, {
          label: cta.label,
          details: itemDetails,
        });
        setDone(cta.label);
      }
    } catch (e) {
      console.error("CTA action failed:", e);
      setDone(t("results.actionFailed"));
    } finally {
      setBusy(false);
    }
  };

  return (
    <button type="button" onClick={handleClick} className={className} title={done ?? undefined}>
      {done ? (
        <>
          <CheckCircle className="h-3 w-3" /> {done}
        </>
      ) : (
        <>
          {cta.label}
          {cta.action === "send_email" && <Send className="h-3 w-3" />}
        </>
      )}
    </button>
  );
}

function CTAButtons({
  cta,
  itemTitle,
  itemDetails,
  conversationId,
}: {
  cta: { primary?: ResultCTA; secondary?: ResultCTA[] };
  itemTitle?: string;
  itemDetails: Record<string, unknown>;
  conversationId?: string;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {cta.primary && (
        <CTAButton
          cta={cta.primary}
          primary
          itemTitle={itemTitle}
          itemDetails={itemDetails}
          conversationId={conversationId}
        />
      )}
      {cta.secondary?.map((s, i) => (
        <CTAButton
          key={i}
          cta={s}
          itemTitle={itemTitle}
          itemDetails={itemDetails}
          conversationId={conversationId}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Citations
// ---------------------------------------------------------------------------

function Citations({
  citations,
}: {
  citations: Array<{
    source_name?: string;
    url?: string;
    confidence?: number;
  }>;
}) {
  const { t } = useTranslation("chat");
  const { t: tCommon } = useTranslation("common");
  if (citations.length === 0) return null;
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
      <span>{t("results.sources")}</span>
      {citations.map((c, i) => (
        <span key={i}>
          {c.url ? (
            <a
              href={c.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline hover:text-foreground"
            >
              {c.source_name ?? c.url}
            </a>
          ) : (
            c.source_name ?? tCommon("unknown")
          )}
          {i < citations.length - 1 && ","}
        </span>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Single Result Card
// ---------------------------------------------------------------------------

function ResultCard({
  item,
  resultType,
  conversationId,
}: {
  item: ResultItem;
  resultType?: string;
  conversationId?: string;
}) {
  const { t } = useTranslation("chat");
  const TypeIcon = resultTypeIcon(item.type ?? resultType);
  const details = (item.details ?? {}) as Record<string, unknown>;
  const schema = item.detail_schema;
  const isScreenplayCard = isScreenplayTemplate(
    item.detail_template,
    item.type,
    resultType,
  );

  // Magazine-style card: 2+ body sections in a single item (sports brief,
  // daily digest). Disable per-section "Show more" so the whole card is
  // visible at once — the card IS the deliverable, no point hiding parts.
  const bodyFieldCount = schema?.filter((f) => f.display === "body").length ?? 0;
  const isEmailCard = item.detail_template?.startsWith("email_") ?? false;
  const isMagazineCard = bodyFieldCount >= 2 && !isEmailCard;

  return (
    <div className="overflow-hidden rounded-lg border border-border bg-card">
      {/* Hero image */}
      {item.image_url && (
        <img
          src={item.image_url}
          alt={item.title ?? t("results.imageAlt")}
          className="w-full h-[200px] object-cover"
        />
      )}

      {/* Content */}
      <div className="space-y-3 p-3">
        {/* Header: icon + title + subtitle */}
        {(item.title || item.subtitle) && (
          <div className="flex items-start gap-2">
            <TypeIcon className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0">
              {item.title && (
                <h4 className="text-sm font-medium leading-snug text-foreground">
                  {item.title}
                </h4>
              )}
              {item.subtitle && (
                <p className="text-xs text-muted-foreground">{item.subtitle}</p>
              )}
            </div>
          </div>
        )}

        {/* Star rating */}
        {item.rating != null && (
          <StarRating
            rating={item.rating}
            count={item.rating_count}
            source={item.rating_source}
          />
        )}

        {/* Price */}
        {item.price && <PriceBadge price={item.price} />}

        {/* Amenities */}
        {item.amenities && item.amenities.length > 0 && (
          <AmenityChips amenities={item.amenities} />
        )}

        {/* Highlights */}
        {item.highlights && item.highlights.length > 0 && (
          <Highlights highlights={item.highlights} />
        )}

        {/* Dynamic detail section */}
        {schema && schema.length > 0 && (
          <DetailSection
            schema={schema}
            details={details}
            disableBodyCollapse={isMagazineCard}
            screenplay={isScreenplayCard}
          />
        )}

        {/* CTA buttons */}
        {item.cta && (
          <CTAButtons
            cta={item.cta}
            itemTitle={item.title}
            itemDetails={details}
            conversationId={conversationId}
          />
        )}

        {/* Fallback booking URL when no CTA provided */}
        {!item.cta && item.booking_url && (
          <a
            href={item.booking_url}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:text-primary/80"
          >
            {t("results.viewDetails")} <ExternalLink className="h-3 w-3" />
          </a>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function ResultPresentationMessage({
  message,
}: {
  message: Message;
}) {
  const { t } = useTranslation("chat");
  const data = (message.contentStructured?.data ?? {}) as RPData;
  const items = data.items ?? [];

  if (items.length === 0) {
    return <p className="text-sm">{message.content}</p>;
  }

  const singleItem = items.length === 1;

  return (
    <div className="space-y-2">
      {/* Overall result title */}
      {data.title && (
        <div className="flex items-center gap-2 px-1">
          <h3 className="text-sm font-semibold">{data.title}</h3>
          {!singleItem && (
            <span className="text-xs text-muted-foreground">
              {t("results.count", { count: items.length })}
            </span>
          )}
        </div>
      )}

      {/* Cards — single item stacks, multiple items carousel */}
      {singleItem ? (
        <ResultCard
          item={items[0]!}
          resultType={data.result_type}
          conversationId={message.conversationId}
        />
      ) : (
        <Carousel
          items={items}
          resultType={data.result_type}
          conversationId={message.conversationId}
        />
      )}

      {/* Citations */}
      {data.citations && data.citations.length > 0 && (
        <div className="px-1 pt-1">
          <Citations citations={data.citations} />
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Carousel (arrow navigation + counter for web)
// ---------------------------------------------------------------------------

function Carousel({
  items,
  resultType,
  conversationId,
}: {
  items: ResultItem[];
  resultType?: string;
  conversationId?: string;
}) {
  const { t } = useTranslation("common");
  const [activeIndex, setActiveIndex] = useState(0);

  const prev = useCallback(() => setActiveIndex((i) => Math.max(0, i - 1)), []);
  const next = useCallback(
    () => setActiveIndex((i) => Math.min(items.length - 1, i + 1)),
    [items.length],
  );

  return (
    <div>
      <ResultCard
        item={items[activeIndex]!}
        resultType={resultType}
        conversationId={conversationId}
      />

      {/* Navigation bar */}
      <div className="flex items-center justify-between pt-2 px-1">
        <button
          onClick={prev}
          disabled={activeIndex === 0}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 disabled:invisible"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> {t("prev")}
        </button>

        <span className="text-xs text-muted-foreground">
          {activeIndex + 1} / {items.length}
        </span>

        <button
          onClick={next}
          disabled={activeIndex === items.length - 1}
          className="flex items-center gap-1 text-xs font-medium text-primary hover:text-primary/80 disabled:invisible"
        >
          {t("next")} <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
