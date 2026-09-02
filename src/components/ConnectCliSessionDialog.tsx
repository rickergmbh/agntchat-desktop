import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { invoke } from "@tauri-apps/api/core";
import { X, Loader2, Copy, Check, Terminal } from "lucide-react";
import { createAgentInvite } from "../lib/api";
import { Button } from "@/components/ui/button";

interface Props {
  onClose: () => void;
}

type CliTool = "claude-code" | "codex";

/**
 * "Connect CLI session" (#148): creates a one-shot agent invite and shows
 * the exact `python -m agentchat connect <code>` command to run from the
 * bundled bridge folder. The claimer becomes an `external` agent — a Claude
 * Code / Codex session the user drives themselves, tracked here via its
 * hooks. Nothing is started from this app; the terminal is the process.
 */
export function ConnectCliSessionDialog({ onClose }: Props) {
  const { t } = useTranslation("agents");
  const [displayName, setDisplayName] = useState(t("hosting.externalTool.claude_code"));
  const [tool, setTool] = useState<CliTool>("claude-code");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [paths, setPaths] = useState<{ bridgeDir: string; python: string } | null>(null);
  const [pathsFailed, setPathsFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    invoke<{ bridgeDir: string; python: string }>("get_bridge_paths")
      .then((p) => {
        if (!cancelled) setPaths(p);
      })
      .catch(() => {
        if (!cancelled) setPathsFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const name = displayName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      const invite = await createAgentInvite({ displayName: name });
      setCode(invite.code);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("connectCli.errors.create"));
    } finally {
      setCreating(false);
    }
  }

  const quote = (v: string) => (/\s/.test(v) ? `"${v}"` : v);
  const python = paths?.python ?? "python3";
  const command = code
    ? `${paths ? `cd ${quote(paths.bridgeDir)} && ` : ""}${quote(python)} -m agentchat connect ${code}${
        tool === "codex" ? " --tool codex" : " --install"
      }`
    : "";

  async function copy() {
    try {
      await navigator.clipboard.writeText(command);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard unavailable — the command is selectable in the block.
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={onClose}
      style={{ WebkitAppRegion: "no-drag" } as React.CSSProperties}
    >
      <div
        className="w-full max-w-lg rounded-lg border border-border bg-popover p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-center justify-between">
          <h2 className="flex items-center gap-2 text-base font-semibold">
            <Terminal className="h-4 w-4 text-warning" />
            {t("connectCli.title")}
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common:close")}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <p className="mb-4 text-sm text-muted-foreground">{t("connectCli.intro")}</p>

        {!code ? (
          <form onSubmit={handleCreate} className="space-y-3">
            <div className="space-y-1.5">
              <label className="text-xs font-medium text-muted-foreground" htmlFor="connect-cli-name">
                {t("connectCli.nameLabel")}
              </label>
              <input
                id="connect-cli-name"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                maxLength={100}
                className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                autoFocus
              />
            </div>
            <div className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t("connectCli.toolLabel")}</span>
              <div className="flex gap-2">
                {(["claude-code", "codex"] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setTool(v)}
                    className={
                      "rounded-md border px-3 py-1.5 text-sm " +
                      (tool === v
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent")
                    }
                  >
                    {v === "codex"
                      ? t("hosting.externalTool.codex")
                      : t("hosting.externalTool.claude_code")}
                  </button>
                ))}
              </div>
            </div>
            {error && <p className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button type="button" variant="ghost" size="sm" onClick={onClose}>
                {t("common:cancel")}
              </Button>
              <Button type="submit" size="sm" disabled={creating || !displayName.trim()}>
                {creating && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                {t("connectCli.create")}
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-3">
            <p className="text-sm">{t("connectCli.runThis")}</p>
            <pre className="select-all overflow-x-auto whitespace-pre-wrap break-all rounded-md border border-border bg-muted/50 p-3 font-mono text-xs">
              {command}
            </pre>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={copy}>
                {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                {copied ? t("connectCli.copied") : t("connectCli.copy")}
              </Button>
              {pathsFailed && (
                <span className="text-xs text-muted-foreground">{t("connectCli.bridgeMissing")}</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">{t("connectCli.expires")}</p>
            <p className="text-xs text-muted-foreground">{t("connectCli.next")}</p>
            <div className="flex justify-end pt-1">
              <Button size="sm" onClick={onClose}>
                {t("connectCli.done")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
