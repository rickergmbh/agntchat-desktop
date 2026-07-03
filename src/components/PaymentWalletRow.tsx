import { useState, useEffect, useRef, useCallback } from "react";
import { Wallet, ExternalLink, Loader2, AlertCircle } from "lucide-react";
import { useTranslation } from "react-i18next";
import { open as tauriOpen } from "@tauri-apps/plugin-shell";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "./ui/dialog";
import { Button } from "./ui/button";
import { cn } from "../lib/utils";
import {
  paymentConnectStart,
  paymentConnectPoll,
  paymentWalletStatus,
  paymentDisconnect,
} from "../lib/api";

/**
 * Connect / disconnect the owner's Stripe Link "wallet for agents".
 *
 * OAuth device flow: Connect → backend returns a short code + verification
 * URL → we open the URL and poll until the human approves in Stripe Link.
 * Rendered as a row inside the Connected Accounts list container.
 */

interface WalletStatus {
  connected: boolean;
  status: string | null;
  hasPaymentMethod: boolean;
}

interface DeviceInfo {
  userCode: string;
  verificationUriComplete: string;
}

// Poll responses that mean "this device session is over" — anything else
// thrown (5xx, network blip) is transient and the next tick retries.
const TERMINAL_POLL_STATUSES = [403, 404, 410];

function openExternal(url: string) {
  tauriOpen(url).catch(() => {
    window.open(url, "_blank");
  });
}

export function PaymentWalletRow() {
  const { t } = useTranslation("settings");
  const [status, setStatus] = useState<WalletStatus | null>(null);
  const [device, setDevice] = useState<DeviceInfo | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const mountedRef = useRef(true);

  const stopPolling = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
  }, []);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await paymentWalletStatus();
      if (mountedRef.current) setStatus(s);
    } catch {
      if (mountedRef.current) {
        setStatus({ connected: false, status: null, hasPaymentMethod: false });
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    fetchStatus();
    return () => {
      mountedRef.current = false;
      stopPolling();
    };
  }, [fetchStatus, stopPolling]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setError(null);
    try {
      const resp = await paymentConnectStart();
      const url = resp.verificationUriComplete || resp.verificationUri;
      if (!resp.userCode || !url) {
        setError(t("wallet.incompleteResponse"));
        return;
      }

      setDevice({ userCode: resp.userCode, verificationUriComplete: url });
      openExternal(url);

      // Honor the server's polling cadence + expiry window (RFC 8628).
      const intervalMs = Math.max((resp.interval ?? 5) * 1000, 3000);
      const maxPolls = Math.ceil(((resp.expiresIn ?? 300) * 1000) / intervalMs);
      let polls = 0;

      stopPolling();
      pollRef.current = setInterval(async () => {
        polls += 1;
        if (polls > maxPolls) {
          stopPolling();
          if (mountedRef.current) {
            setDevice(null);
            setError(t("wallet.timedOutBody"));
          }
          return;
        }
        try {
          const poll = await paymentConnectPoll();
          if (poll.status === "connected") {
            stopPolling();
            if (!mountedRef.current) return;
            setDevice(null);
            await fetchStatus();
          }
          // "pending" → keep polling
        } catch (e) {
          // Only a terminal poll response ends the flow; a transient error
          // (5xx, dropped request) just retries on the next tick.
          const code = (e as { status?: number })?.status;
          if (code && TERMINAL_POLL_STATUSES.includes(code)) {
            stopPolling();
            if (mountedRef.current) {
              setDevice(null);
              setError(t("wallet.notCompletedBody"));
            }
          }
        }
      }, intervalMs);
    } catch {
      if (mountedRef.current) setError(t("wallet.startFailed"));
    } finally {
      if (mountedRef.current) setConnecting(false);
    }
  }, [fetchStatus, stopPolling]);

  const cancelConnect = useCallback(() => {
    stopPolling();
    setDevice(null);
  }, [stopPolling]);

  const handleDisconnect = useCallback(async () => {
    setConfirmingDisconnect(false);
    setDisconnecting(true);
    setError(null);
    try {
      await paymentDisconnect();
      await fetchStatus();
    } catch {
      if (mountedRef.current) setError(t("wallet.disconnectFailed"));
    } finally {
      if (mountedRef.current) setDisconnecting(false);
    }
  }, [fetchStatus]);

  const isConnected = status?.connected === true;

  return (
    <>
      <div className="px-4 py-3">
        <div className="flex items-center gap-3">
          <div
            className={cn(
              "w-8 h-8 rounded-md flex items-center justify-center flex-shrink-0 border",
              isConnected
                ? "bg-primary/10 border-primary/20 text-primary"
                : "bg-muted border-transparent text-muted-foreground"
            )}
          >
            <Wallet className="w-4 h-4" />
          </div>

          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{t("wallet.title")}</p>
            {isConnected ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground truncate mt-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-success flex-shrink-0" />
                <span className="truncate">
                  {t("common:connected")}
                  <span className="text-muted-foreground"> · Stripe Link</span>
                </span>
              </p>
            ) : (
              <p className="text-xs text-muted-foreground truncate mt-0.5">
                {t("wallet.description")}
              </p>
            )}
          </div>

          {isConnected ? (
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {confirmingDisconnect ? (
                <>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={handleDisconnect}
                    disabled={disconnecting}
                  >
                    {disconnecting && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                    {t("common:confirm")}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmingDisconnect(false)}
                    disabled={disconnecting}
                  >
                    {t("common:cancel")}
                  </Button>
                </>
              ) : (
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-muted-foreground hover:text-destructive"
                  onClick={() => setConfirmingDisconnect(true)}
                >
                  {t("wallet.disconnect")}
                </Button>
              )}
            </div>
          ) : (
            <Button
              variant="outline"
              size="sm"
              className="flex-shrink-0"
              onClick={handleConnect}
              disabled={connecting || !!device}
            >
              {connecting ? (
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <ExternalLink className="w-3.5 h-3.5" />
              )}
              {t("wallet.connect")}
            </Button>
          )}
        </div>

        {isConnected && status && !status.hasPaymentMethod && (
          <p className="ml-11 mt-1 flex items-center gap-1 text-[11px] text-warning">
            <AlertCircle className="w-3 h-3" />
            {t("wallet.noPaymentMethodFound")}
          </p>
        )}

        {error && (
          <p className="ml-11 mt-1 flex items-center gap-1 text-[11px] text-destructive">
            <AlertCircle className="w-3 h-3" />
            {error}
          </p>
        )}
      </div>

      {/* Device-code dialog */}
      <Dialog open={!!device} onOpenChange={(open) => !open && cancelConnect()}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t("wallet.connectTitle")}</DialogTitle>
            <DialogDescription>{t("wallet.approveHint")}</DialogDescription>
          </DialogHeader>

          <div className="space-y-3 py-2">
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
              <p className="text-xs text-muted-foreground mb-2">{t("wallet.verificationCode")}</p>
              <code className="text-2xl font-mono font-bold tracking-widest text-foreground">
                {device?.userCode}
              </code>
            </div>

            <Button
              variant="outline"
              size="sm"
              className="w-full"
              onClick={() =>
                device?.verificationUriComplete && openExternal(device.verificationUriComplete)
              }
            >
              <ExternalLink className="w-3.5 h-3.5" />
              {t("wallet.openLink")}
            </Button>

            <p className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              {t("wallet.waiting")}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
