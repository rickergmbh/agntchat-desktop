import { Copy as CopyIcon } from "lucide-react";
import i18n from "../../i18n";
import { cn } from "../../lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

export function relativeAge(iso?: string | null): string {
  if (!iso) return i18n.t("common:time.never");
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return i18n.t("common:unknown");
  const secs = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (secs < 60) return i18n.t("common:time.justNow");
  const mins = Math.round(secs / 60);
  if (mins < 60) return i18n.t("common:time.minutesAgo", { count: mins });
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return i18n.t("common:time.hoursAgo", { count: hrs });
  return i18n.t("common:time.daysAgo", { count: Math.round(hrs / 24) });
}

export function CopyField({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <Label className="text-xs">{label}</Label>
      <div
        className={cn(
          "flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 text-xs break-all",
          mono && "font-mono"
        )}
      >
        <span className="flex-1 select-all">{value}</span>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => void navigator.clipboard.writeText(value)}
          aria-label={`Copy ${label}`}
        >
          <CopyIcon className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}
