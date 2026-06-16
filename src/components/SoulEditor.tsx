import { useState, useEffect, useCallback } from "react";
import { useAgentStore } from "../stores/agentStore";
import { updateSoulMd, revertSoulMd, reviseSoulMd } from "../lib/api";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Save, Link, RotateCcw, Loader2, Sparkles, X } from "lucide-react";

interface SoulEditorProps {
  agentId: string;
}

export function SoulEditor({ agentId }: SoulEditorProps) {
  const agent = useAgentStore((s) => s.agents[agentId]?.agent);
  const refreshAgent = useAgentStore((s) => s.selectAgent);
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [reverting, setReverting] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // AI "describe your changes" panel
  const [showRevise, setShowRevise] = useState(false);
  const [instruction, setInstruction] = useState("");
  const [revising, setRevising] = useState(false);
  // True once an AI proposal has been loaded into the editor but not yet saved.
  const [proposed, setProposed] = useState(false);

  const isClone = !!agent?.soulMdSourceName;
  const isInherited = !!agent?.soulMdInherited;

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
      setError(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  const handleRevise = async () => {
    const trimmed = instruction.trim();
    if (!trimmed) return;
    setRevising(true);
    setError(null);
    try {
      const { soulMd } = await reviseSoulMd(agentId, trimmed);
      setContent(soulMd);
      setDirty(true);
      setProposed(true);
      setShowRevise(false);
      setInstruction("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to generate update");
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
      setError(e instanceof Error ? e.message : "Failed to revert");
    } finally {
      setReverting(false);
    }
  }, [agentId, refreshAgent]);

  return (
    <div className="flex flex-col h-full p-4 gap-2">
      <div className="space-y-1">
        <h3 className="text-sm font-semibold">Soul</h3>
        <p className="text-xs text-muted-foreground leading-relaxed">
          The soul is this agent&apos;s core identity — its system prompt. Written
          in Markdown, it defines who the agent is, how it speaks, what it cares
          about, and the rules it follows. It&apos;s sent to the model on every
          message and task, so it shapes everything the agent does. Write it in
          plain language, as if briefing a new teammate.
        </p>
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
              <>Inherited from <span className="font-semibold">{agent.soulMdSourceName}</span>. Editing will detach from source.</>
            ) : (
              <>
                Detached from <span className="font-semibold">{agent.soulMdSourceName}</span> — local edits override the source.
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
                  Revert to source
                </button>
              </>
            )}
          </p>
        </div>
      )}

      {showRevise ? (
        <div className="flex flex-col gap-2 rounded-md border border-primary/40 bg-primary/5 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-semibold text-primary">
              <Sparkles className="h-3.5 w-3.5" />
              Describe your changes
            </span>
            <button
              onClick={() => {
                setShowRevise(false);
                setInstruction("");
              }}
              className="text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Cancel"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          <Textarea
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
            placeholder="e.g. Make her tone more playful, and add that she's an expert in tax law."
            className="text-sm resize-none"
            rows={3}
            autoFocus
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault();
                handleRevise();
              }
            }}
          />
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">
              The proposed soul will load below for you to review before saving.
            </span>
            <Button size="sm" onClick={handleRevise} disabled={revising || !instruction.trim()}>
              {revising ? (
                <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />
              ) : (
                <Sparkles className="w-3.5 h-3.5 mr-1.5" />
              )}
              {revising ? "Generating..." : "Generate"}
            </Button>
          </div>
        </div>
      ) : null}

      {proposed && (
        <div className="flex items-start gap-2.5 rounded-md bg-primary/10 px-3 py-2.5 text-xs text-primary">
          <Sparkles className="mt-0.5 h-3.5 w-3.5 shrink-0" />
          <p>
            AI-proposed changes loaded below. Review and edit as needed, then{" "}
            <span className="font-semibold">Save</span> to apply.
          </p>
        </div>
      )}

      <Textarea
        value={content}
        onChange={(e) => handleChange(e.target.value)}
        placeholder="Agent soul.md content..."
        className="flex-1 font-mono text-sm resize-none"
      />
      {error && <p className="text-xs text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {!showRevise && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setShowRevise(true);
              setError(null);
            }}
            disabled={saving || revising}
          >
            <Sparkles className="w-3.5 h-3.5 mr-1.5" />
            Update with AI
          </Button>
        )}
        <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
          <Save className="w-3.5 h-3.5 mr-1.5" />
          {saving ? "Saving..." : "Save"}
        </Button>
      </div>
    </div>
  );
}
