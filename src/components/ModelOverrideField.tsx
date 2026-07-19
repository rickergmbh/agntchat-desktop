import { useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgentStore } from "../stores/agentStore";
import { useModelCatalog } from "../stores/modelCatalogStore";

// Select-safe stand-in for "" (shadcn items can't hold an empty value).
const AGENT_DEFAULT = "__default__";

/**
 * Optional per-run LLM model override shared by the pulse/routine/loop
 * editors. `value` "" = run on the agent's default model. Options come from
 * the backend model catalog filtered to the agent's provider — the same
 * source as the agent config picker, so the surfaces stay aligned.
 */
export function ModelOverrideField({
  agentId,
  value,
  onChange,
}: {
  agentId: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const { t } = useTranslation("agents");
  const backend =
    useAgentStore((s) => s.agents[agentId]?.config.backend) || "anthropic";
  const ensureLoaded = useModelCatalog((s) => s.ensureLoaded);
  const modelsFor = useModelCatalog((s) => s.modelsFor);
  useEffect(() => {
    void ensureLoaded();
  }, [ensureLoaded]);
  const models = modelsFor(backend);
  // Keep a stored value selectable even when it's no longer in the catalog
  // (renamed/retired model) so opening the editor doesn't silently clear it.
  const orphaned = !!value && !models.some((m) => m.id === value);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs">{t("modelOverride.label")}</Label>
      <Select
        value={value || AGENT_DEFAULT}
        onValueChange={(v) => {
          if (!v) return;
          onChange(v === AGENT_DEFAULT ? "" : v);
        }}
      >
        <SelectTrigger>
          <SelectValue>
            {(val: unknown) =>
              String(val) === AGENT_DEFAULT
                ? t("modelOverride.agentDefault")
                : (models.find((m) => m.id === String(val))?.label ??
                  String(val ?? ""))
            }
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={AGENT_DEFAULT}>
            {t("modelOverride.agentDefault")}
          </SelectItem>
          {orphaned && <SelectItem value={value}>{value}</SelectItem>}
          {models.map((m) => (
            <SelectItem key={m.id} value={m.id}>
              {m.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <p className="text-[11px] text-muted-foreground">
        {t("modelOverride.hint")}
      </p>
    </div>
  );
}
