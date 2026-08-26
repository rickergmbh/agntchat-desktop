import { Fragment, useMemo, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import * as api from "../../lib/api";
import { UnmanagedVmRow } from "./UnmanagedVmRow";

/**
 * The merged host + provider-VM list, shared by the Hosts view and the
 * Platform admin Hosts tab so both surfaces group and label hosts the same
 * way: one entry per provider VM (managed VMs render the host row, unmanaged
 * VMs offer "Add host"), then hosts with no VM behind them (manually-added
 * boxes) — under an "Other hosts" heading only when a VM inventory is
 * present to distinguish them from.
 */
export function HostList<T extends api.OrganizationHost>({
  hosts,
  vms,
  vmsError,
  canAdd,
  onAdd,
  renderHost,
  empty,
}: {
  hosts: T[];
  vms: api.ProviderVm[];
  /** Provider inventory failure to surface inline (the host list still renders). */
  vmsError?: string | null;
  canAdd: boolean;
  /** Open the connect dialog, preselected on a VM when given. */
  onAdd: (vmId?: string) => void;
  /** Render one managed host row (an <li>), with its backing VM when known. */
  renderHost: (host: T, vm?: api.ProviderVm) => ReactNode;
  /** Shown when there are no hosts and no VMs at all. */
  empty: ReactNode;
}) {
  const { t } = useTranslation("platform");

  // Resolve which host (if any) backs a given VM. Prefer the explicit
  // provider_vm_id link; fall back to matching the host's SSH IP to the VM's
  // IPv4 — that covers hosts added manually by IP (no VM link stored), which
  // would otherwise look orphaned even though they run on a known VM.
  const hostForVm = useMemo(() => {
    const byVmId = new Map<string, T>();
    const byIp = new Map<string, T>();
    for (const h of hosts) {
      if (h.providerVmId) byVmId.set(h.providerVmId, h);
      const ip = h.sshHost?.trim();
      if (ip && !byIp.has(ip)) byIp.set(ip, h);
    }
    return (vm: api.ProviderVm) =>
      byVmId.get(vm.id) ?? (vm.ipv4 ? byIp.get(vm.ipv4.trim()) : undefined);
  }, [hosts]);

  // Hosts not backed by any VM in the inventory (manually-added boxes, or a VM
  // we couldn't list) — shown in their own group so they aren't lost.
  const otherHosts = useMemo(() => {
    const matchedHostIds = new Set<string>();
    for (const vm of vms) {
      const h = hostForVm(vm);
      if (h) matchedHostIds.add(h.id);
    }
    return hosts.filter((h) => !matchedHostIds.has(h.id));
  }, [hosts, vms, hostForVm]);

  return (
    <>
      {vms.length > 0 && (
        <ul className="space-y-2">
          {vms.map((vm) => {
            const host = hostForVm(vm);
            return (
              <Fragment key={vm.id}>
                {host ? (
                  renderHost(host, vm)
                ) : (
                  <UnmanagedVmRow vm={vm} canAdd={canAdd} onAdd={() => onAdd(vm.id)} />
                )}
              </Fragment>
            );
          })}
        </ul>
      )}

      {vmsError && (
        <p className="text-xs text-muted-foreground">
          {t("hosts.vmInventoryError", { error: vmsError })}
        </p>
      )}

      {otherHosts.length > 0 && (
        <div className="space-y-2 pt-2">
          {vms.length > 0 && (
            <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
              {t("hosts.otherHosts")}
            </div>
          )}
          <ul className="space-y-2">
            {otherHosts.map((h) => (
              <Fragment key={h.id}>{renderHost(h)}</Fragment>
            ))}
          </ul>
        </div>
      )}

      {vms.length === 0 && otherHosts.length === 0 && empty}
    </>
  );
}
