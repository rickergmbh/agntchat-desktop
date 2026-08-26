import { useCallback, useEffect, useRef, useState } from "react";
import { Check, Copy as CopyIcon, Loader2, Terminal } from "lucide-react";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import * as api from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Open a URL in the system browser — Tauri native with window.open fallback. */
function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}

// Pull the OAuth authorize URL out of the captured login pane. claude /login
// prints a `https://claude.com/cai/oauth/authorize?…` (or claude.ai / anthropic
// console) URL when it can't open a browser.
//
// We anchor on the *authorize* URL specifically — not just any anthropic/claude
// link — so an unrelated marketing URL in the login banner (e.g.
// claude.com/news/…) is never mistaken for it. The backend runs the login in a
// 1000-column tmux pane and captures with `-J`, so the ~400-char URL comes back
// on a single line; from the anchor we take the contiguous run of non-whitespace.
const AUTHORIZE_URL_RE =
  /https?:\/\/(?:[a-z0-9.-]*\.)?(?:claude\.com|claude\.ai|anthropic\.com)\/[^\s]*oauth\/authorize[^\s]*/i;

function extractLoginUrl(pane: string): string | null {
  const m = pane.match(AUTHORIZE_URL_RE);
  if (!m) return null;
  return m[0].replace(/[).,]+$/, "") || null;
}

// Heuristic success / failure detection from the pane text.
function loginSucceeded(pane: string): boolean {
  return /login successful|logged in|successfully authenticated|you('| a)re now logged in/i.test(
    pane
  );
}
function loginFailed(pane: string): boolean {
  return /invalid code|authentication failed|oauth error|error:|expired/i.test(pane);
}

// Before the login URL appears, `claude` can show a "Do you trust the files in
// this folder?" prompt that must be answered (Enter = the default "Yes" option)
// before it continues. We detect it from the pane text and auto-confirm once.
function trustPromptVisible(pane: string): boolean {
  return /do you trust the files in this folder|trust the files in this|yes, proceed/i.test(
    pane
  );
}

// After the URL, `claude /login` prints a "Paste code here if prompted" line and
// blocks on stdin. Detecting it lets us reveal the code box even if URL
// extraction failed — so the operator is never stuck unable to paste.
function codePromptVisible(pane: string): boolean {
  return /paste (the )?code|enter (the )?code|authorization code|code:\s*$/im.test(pane);
}

/**
 * Drives an interactive `claude /login` on one host VM, entirely from the
 * desktop. The backend runs the login inside a detached tmux session over SSH;
 * we poll its pane text for the OAuth URL, let the operator open it locally and
 * paste the code back, then submit it. Writes the per-host file seat at
 * /home/agentgram/.claude/.credentials.json (shared by every bridge on the box).
 */
export function ClaudeLoginDialog({
  orgId,
  hostId,
  hostName,
  open,
  onOpenChange,
}: {
  orgId: string;
  hostId: string;
  hostName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [pane, setPane] = useState("");
  const [loginUrl, setLoginUrl] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [phase, setPhase] = useState<
    "starting" | "awaiting_url" | "awaiting_code" | "submitting" | "done" | "error"
  >("starting");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  // Auto-confirm the trust-folder prompt at most once per session so we don't
  // hammer Enter every 2s poll while the prompt is still painting.
  const trustConfirmedRef = useRef(false);

  // Fire-and-forget a navigation key into the remote session. Used both for the
  // automatic trust-prompt confirmation and the manual controls below.
  const sendKey = useCallback(
    async (key: string) => {
      setKeyBusy(true);
      try {
        const { output } = await api.sendClaudeLoginKey(orgId, hostId, key);
        setPane(output);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not send key to the host");
      } finally {
        setKeyBusy(false);
      }
    },
    [orgId, hostId]
  );

  // Start the session when the dialog opens; cancel + reset when it closes.
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const applyPane = (text: string) => {
      if (cancelled) return;
      setPane(text);
      // Auto-answer the trust-folder prompt (Enter = the highlighted "Yes")
      // once, so the login can advance to printing the URL.
      if (!trustConfirmedRef.current && !extractLoginUrl(text) && trustPromptVisible(text)) {
        trustConfirmedRef.current = true;
        void api.sendClaudeLoginKey(orgId, hostId, "Enter").catch(() => {});
      }
      const url = extractLoginUrl(text);
      if (url) setLoginUrl(url);
      // Don't override an in-flight code submission or a finished state. Move to
      // the code step once the URL appears OR the host prints its "paste code"
      // prompt — so a failed URL extraction never traps the operator.
      setPhase((prev) => {
        if (prev === "submitting" || prev === "done" || prev === "error") return prev;
        if (loginSucceeded(text)) return "done";
        if (url || codePromptVisible(text)) return "awaiting_code";
        return "awaiting_url";
      });
    };

    const poll = async () => {
      try {
        const { output } = await api.pollClaudeLoginOutput(orgId, hostId);
        applyPane(output);
      } catch {
        // Transient SSH hiccup — keep polling.
      }
      if (!cancelled) timer = setTimeout(poll, 2000);
    };

    setPhase("starting");
    setPane("");
    setLoginUrl(null);
    setCode("");
    setError(null);
    trustConfirmedRef.current = false;

    api
      .startClaudeLogin(orgId, hostId)
      .then(() => {
        if (cancelled) return;
        setPhase("awaiting_url");
        void poll();
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : "Could not start login on the host");
        setPhase("error");
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      // Best-effort teardown of the remote tmux session.
      void api.cancelClaudeLogin(orgId, hostId).catch(() => {});
    };
  }, [open, orgId, hostId]);

  const submit = async () => {
    const trimmed = code.trim();
    if (!trimmed) return;
    setPhase("submitting");
    setError(null);
    try {
      const { output } = await api.submitClaudeLoginCode(orgId, hostId, trimmed);
      setPane(output);
      setCode("");
      // Give claude a beat to process, then let the poller resolve success/failure.
      if (loginSucceeded(output)) setPhase("done");
      else if (loginFailed(output)) setPhase("error");
      else setPhase("awaiting_code");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not submit code");
      setPhase("awaiting_code");
    }
  };

  const copyUrl = () => {
    if (!loginUrl) return;
    void navigator.clipboard.writeText(loginUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Sign in to Claude — {hostName}</DialogTitle>
          <DialogDescription>
            Runs <code>claude /login</code> on the VM. Open the URL below in your
            browser, authorize, then paste the code it gives you. Credentials are
            stored on the host and shared by every agent running on it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          {phase === "starting" && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Starting login on the host…
            </div>
          )}

          {phase === "awaiting_url" && (
            <div className="space-y-2">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" /> Waiting for the login URL…
              </div>
              {trustPromptVisible(pane) && (
                <p className="text-xs text-muted-foreground">
                  The host is asking whether to trust this folder — confirming
                  automatically. If it's stuck, use the controls below to answer
                  it manually.
                </p>
              )}
            </div>
          )}

          {/* Manual terminal controls — a fallback for any prompt that precedes
              the login (trust-folder dialog, menu selection) that our
              auto-confirm didn't clear. Shown until the URL appears. */}
          {(phase === "awaiting_url" || phase === "starting") && (
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="mr-1 text-xs text-muted-foreground">Send key:</span>
              {(["Up", "Down", "Enter"] as const).map((k) => (
                <Button
                  key={k}
                  variant="outline"
                  size="sm"
                  className="h-7"
                  disabled={keyBusy}
                  onClick={() => void sendKey(k)}
                >
                  {k === "Up" ? "↑" : k === "Down" ? "↓" : "Enter ⏎"}
                </Button>
              ))}
            </div>
          )}

          {loginUrl && phase !== "done" && (
            <div className="space-y-1">
              <Label className="text-xs">Login URL</Label>
              <div className="flex items-center gap-2 rounded-md border border-border bg-muted px-2.5 py-2 font-mono text-xs break-all">
                <span className="flex-1 select-all">{loginUrl}</span>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 w-6 shrink-0 p-0"
                  onClick={copyUrl}
                  title="Copy URL"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <CopyIcon className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <Button
                variant="outline"
                size="sm"
                className="mt-1"
                onClick={() => openExternal(loginUrl)}
              >
                Open in browser
              </Button>
            </div>
          )}

          {(phase === "awaiting_code" || phase === "submitting") && (
            <div className="space-y-1">
              <Label htmlFor="claude-auth-code">Authorization code</Label>
              {!loginUrl && (
                <p className="text-xs text-muted-foreground">
                  Couldn't auto-detect the login URL — copy it from the terminal
                  output below, open it in your browser, then paste the code here.
                </p>
              )}
              <div className="flex items-center gap-2">
                <Input
                  id="claude-auth-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void submit();
                  }}
                  placeholder="Paste the code from the browser"
                  className="font-mono text-xs"
                  disabled={phase === "submitting"}
                  autoFocus
                />
                <Button onClick={() => void submit()} disabled={phase === "submitting" || !code.trim()}>
                  {phase === "submitting" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Submit"}
                </Button>
              </div>
            </div>
          )}

          {phase === "done" && (
            <div className="flex items-center gap-2 rounded-md border border-success/30 bg-success/10 px-2.5 py-2 text-sm text-success">
              <Check className="h-4 w-4" /> Signed in. Agents on this host can now use Claude.
            </div>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}

          {pane && (
            <div>
              <div className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                <Terminal className="h-3 w-3" /> Terminal output
              </div>
              <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-all rounded-sm bg-muted/40 px-2.5 py-2 font-mono text-[11px] text-muted-foreground">
                {pane}
              </pre>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {phase === "done" ? "Done" : "Cancel"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
