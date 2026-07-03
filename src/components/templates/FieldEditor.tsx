import { X } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "../../lib/utils";
import type { DetailField, DisplayType, FieldLink, HighlightColor } from "../../lib/api";

const DISPLAY_TYPES: DisplayType[] = [
  "row",
  "chip",
  "highlight",
  "body",
  "change",
  "sparkline",
];

const LINK_TYPES: FieldLink[] = ["tel", "mailto", "url", "map"];

const HIGHLIGHT_COLORS: { value: HighlightColor; labelKey: string; cls: string }[] = [
  { value: "success", labelKey: "colors.green", cls: "bg-success" },
  { value: "warning", labelKey: "colors.yellow", cls: "bg-warning" },
  { value: "destructive", labelKey: "colors.red", cls: "bg-destructive" },
  { value: "primary", labelKey: "colors.blue", cls: "bg-primary" },
];

interface Props {
  field: DetailField;
  onChange: (updated: DetailField) => void;
  onDelete: () => void;
}

export function FieldEditor({ field, onChange, onDelete }: Props) {
  const { t } = useTranslation("templates");
  return (
    <div className="relative rounded-lg border border-border p-3 space-y-3">
      <button
        type="button"
        onClick={onDelete}
        className="absolute right-2 top-2 rounded p-1 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        title={t("field.remove")}
      >
        <X className="h-3.5 w-3.5" />
      </button>

      <div className="grid grid-cols-2 gap-3 pr-6">
        <div className="space-y-1">
          <Label className="text-xs">{t("field.key")}</Label>
          <Input
            value={field.key}
            onChange={(e) => onChange({ ...field, key: e.target.value })}
            placeholder="field_key"
            className="h-8 font-mono text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("field.label")}</Label>
          <Input
            value={field.label ?? ""}
            onChange={(e) =>
              onChange({ ...field, label: e.target.value || undefined })
            }
            placeholder={t("field.labelPlaceholder")}
            className="h-8 text-xs"
          />
        </div>
      </div>

      <div className="space-y-1">
        <Label className="text-xs">{t("field.displayType")}</Label>
        <div className="flex flex-wrap gap-1.5">
          {DISPLAY_TYPES.map((dt) => (
            <button
              key={dt}
              type="button"
              onClick={() => onChange({ ...field, display: dt })}
              className={cn(
                "rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors",
                field.display === dt
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border text-muted-foreground hover:bg-accent"
              )}
            >
              {t(`displayTypes.${dt}`, { defaultValue: dt })}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t("field.icon")}</Label>
          <Input
            value={field.icon ?? ""}
            onChange={(e) =>
              onChange({ ...field, icon: e.target.value || undefined })
            }
            placeholder={t("field.iconPlaceholder")}
            className="h-8 text-xs"
          />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">{t("field.format")}</Label>
          <Input
            value={field.format ?? ""}
            onChange={(e) =>
              onChange({ ...field, format: e.target.value || undefined })
            }
            placeholder={t("field.formatPlaceholder")}
            className="h-8 text-xs"
          />
        </div>
      </div>

      {field.display === "highlight" && (
        <div className="space-y-1">
          <Label className="text-xs">{t("field.highlightColor")}</Label>
          <div className="flex gap-2">
            {HIGHLIGHT_COLORS.map((hc) => (
              <button
                key={hc.value}
                type="button"
                onClick={() => onChange({ ...field, color: hc.value })}
                className={cn(
                  "flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] font-medium transition-colors",
                  field.color === hc.value
                    ? "border-primary bg-primary/5"
                    : "border-border hover:bg-accent"
                )}
              >
                <span className={cn("h-2.5 w-2.5 rounded-full", hc.cls)} />
                {t(hc.labelKey)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="flex items-end justify-between gap-3">
        <div className="space-y-1">
          <Label className="text-xs">{t("field.link")}</Label>
          <div className="flex flex-wrap gap-1.5">
            {LINK_TYPES.map((lt) => (
              <button
                key={lt}
                type="button"
                onClick={() =>
                  onChange({ ...field, link: field.link === lt ? undefined : lt })
                }
                className={cn(
                  "rounded-full border px-2.5 py-0.5 text-[10px] font-medium transition-colors",
                  field.link === lt
                    ? "border-primary bg-primary/10 text-primary"
                    : "border-border text-muted-foreground hover:bg-accent"
                )}
              >
                {lt}
              </button>
            ))}
          </div>
        </div>
        <label className="flex items-center gap-1.5 text-[10px] font-medium text-muted-foreground">
          <input
            type="checkbox"
            checked={field.hidden ?? false}
            onChange={(e) => onChange({ ...field, hidden: e.target.checked || undefined })}
          />
          {t("field.hidden")}
        </label>
      </div>
    </div>
  );
}
