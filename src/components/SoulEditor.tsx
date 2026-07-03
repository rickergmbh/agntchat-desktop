import { useState, useEffect, useCallback } from "react";
import { useTranslation, Trans } from "react-i18next";
import { useAgentStore } from "../stores/agentStore";
import { updateSoulMd, revertSoulMd, reviseSoulMd } from "../lib/api";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Link, RotateCcw, Loader2 } from "lucide-react";

interface SoulEditorProps {
  agentId: string;
}

export function SoulEditor({ agentId }: SoulEditorProps) {
  const { t } = useTranslation("agents");
  const agent = useAgentStore((s) => s.agents[agentId]?.agent);
  const refreshAgent = useAgentStore((s) => s.selectAgent);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI "describe a change" field
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  // True once an AI proposal has been loaded into the editor but not yet saved.
  const [proposed, setProposed] = useState(false);

  const isClone = !!agent?.soulMdSourceName;
  const isInherited = !!agent?.soulMdInherited;
  const agentName = agent?.displayName?.trim();

  useEffect(() => {
    if (agent?.soulMd != null) {
      setContent(agent.soulMd);
      setDirty(false);
      setProposed(false);
    }
  }, [agent?.soulMd]);

  const handleChange = (value: string) => {
    setContent(value);
    setDirty(true);
    setProposed(false);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await updateSoulMd(agentId, content);
      await refreshAgent(agentId);
      setDirty(false);
      setProposed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("soul.errors.save"));
    } finally {
      setSaving(false);
    }
  };

  const handleRevise = async () => {
    const trimmed = instruction.trim();
    if (!trimmed || revising) return;
    setRevising(true);
    setError(null);
    try {
      const { soulMd } = await reviseSoulMd(agentId, trimmed);
      setContent(soulMd);
      setDirty(true);
      setProposed(true);
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("soul.errors.generate"));
    } finally {
      setRevising(false);
    }
  };

  const handleRevert = useCallback(async () => {
    setReverting(true);
    setError(null);
    try {
      await revertSoulMd(agentId);
      await refreshAgent(agentId);
      setDirty(false);
      setProposed(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("soul.errors.revert"));
    } finally {
      setReverting(false);
    }
  }, [agentId, refreshAgent, t]);

  return (
    <div className="flex flex-col h-full p-4 gap-3">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">{t("soul.title")}</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          {t("soul.description")}
        </p>
      </div>

      {/* AI revision field — always visible at the top; just start typing. */}
      <div className="rounded-md border border-muted-foreground/25 bg-background transition-colors focus-within:border-ring focus-within:ring-1 focus-within:ring-ring">
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          placeholder={
            agentName
              ? t("soul.changePlaceholderNamed", { name: agentName })
              : t("soul.changePlaceholder")
          }
          rows={2}
          disabled={revising}
          className="min-h-0 resize-none border-0 bg-transparent px-3 pt-2.5 pb-1.5 text-sm shadow-none focus-visible:ring-0 focus-visible:ring-offset-0"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleRevise();
            }
          }}
        />
        <div className="flex items-center justify-between gap-3 px-3 pb-2">
          <span className="text-[11px] text-muted-foreground">
            {t("common:enterToGenerateHint")}
          </span>
          <Button
            size="sm"
            variant="outline"
            onClick={handleRevise}
            disabled={revising || !instruction.trim()}
          >
            {revising && <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />}
            {revising ? t("common:generating") : t("common:generate")}
          </Button>
        </div>
      </div>

      {isClone && (
        <div
          className={`flex items-start gap-2.5 rounded-md px-3 py-2.5 text-xs ${
            isInherited
              ? "bg-primary text-white"
              : "bg-warning text-black"
          }`}
        >
          <Link className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            {isInherited ? (
              <Trans
                t={t}
                i18nKey="soul.inherited"
                values={{ name: agent.soulMdSourceName }}
                components={{ b: <span className="font-semibold" /> }}
              />
            ) : (
              <>
                <Trans
                  t={t}
                  i18nKey="soul.detached"
                  values={{ name: agent.soulMdSourceName }}
                  components={{ b: <span className="font-semibold" /> }}
                />
                <span className="mx-1.5">·</span>
                <button
                  onClick={handleRevert}
                  disabled={reverting}
                  className="inline-flex items-center gap-1 font-medium underline underline-offset-2 hover:opacity-80 transition-opacity"
                >
                  {reverting ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    <RotateCcw className="h-3 w-3" />
                  )}
                  {t("soul.revertToSource")}
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {proposed && (
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2.5 text-xs text-muted-foreground">
          <Trans
            t={t}
            i18nKey="soul.proposedNotice"
            values={{ save: t("common:save") }}
            components={{ b: <span className="font-medium text-foreground" /> }}
          />
        </div>
      )}

      <Textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder={t("soul.contentPlaceholder")}
        className="flex-1 font-mono text-sm resize-none"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end">
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? t("common:saving") : t("common:save")}
        </Button>
      </div>
    </div>
  );
}
