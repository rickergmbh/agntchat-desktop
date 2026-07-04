import { useEffect, useState } from "react";
import { getLocalDeviceName, type ManagedAgent } from "../stores/agentStore";

/** This machine's name as Rust computes it — the same value the bridge
 *  reports to the backend (null while loading / when Tauri is unavailable). */
export function useLocalDeviceName(): string | null {
  const [name, setName] = useState<string | null>(null);
  useEffect(() => {
    let mounted = true;
    getLocalDeviceName().then((n) => {
      if (mounted) setName(n);
    });
    return () => {
      mounted = false;
    };
  }, []);
  return name;
}

/**
 * The machine a local-runtime agent's bridge is currently running on, when
 * that machine is NOT this one — i.e. starting the agent here would take it
 * over and stop it there. Returns the device name (`""` when the bridge
 * predates device reporting), or `null` when there is nothing to take over:
 * agent offline, hosted, already running here, or the online executor is
 * this device's own (a stale row from a previous session here).
 *
 * `liveOnline` / `presenceDevice` come from presenceStore — the single
 * runtime presence truth (never REST `agent.online`, which can be stale).
 */
export function runningElsewhereOn(
  managed: ManagedAgent,
  liveOnline: boolean,
  presenceDevice: string | undefined,
  myDevice: string | null
): string | null {
  if (managed.agent.runtime === "org_host") return null;
  if (
    managed.processStatus === "running" ||
    managed.processStatus === "starting"
  ) {
    return null;
  }
  if (!liveOnline) return null;
  const device = presenceDevice ?? null;
  if (device && myDevice && device === myDevice) return null;
  return device ?? "";
}
