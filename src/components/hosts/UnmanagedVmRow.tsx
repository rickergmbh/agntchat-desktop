import { Cloud, Plus } from "lucide-react";
import { useTranslation } from "react-i18next";
import * as api from "../../lib/api";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

/**
 * A provider VM that isn't (yet) registered as a host. Compact row showing the
 * VM facts with an "Add host" action that opens the connect dialog preselected
 * on this VM. Rendered by the shared HostList on both the Hosts view and the
 * Platform admin tab.
 */
export function UnmanagedVmRow({
  vm,
  canAdd,
  onAdd,
}: {
  vm: api.ProviderVm;
  canAdd: boolean;
  onAdd: () => void;
}) {
  const { t } = useTranslation("platform");
  return (
    <li className="flex items-center gap-3 rounded-lg border border-dashed border-border px-4 py-3">
      <Cloud className="h-4 w-4 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium">{vm.hostname || vm.id}</span>
          <Badge variant={vm.state === "running" ? "default" : "outline"} className="shrink-0">
            {vm.state || t("common:unknown")}
          </Badge>
          <Badge variant="outline" className="shrink-0 text-muted-foreground">
            {t("hosts.notAdded")}
          </Badge>
        </div>
        <div className="mt-0.5 truncate text-xs text-muted-foreground">
          {[vm.ipv4, vm.plan, vm.datacenter].filter(Boolean).join(" · ") || vm.id}
        </div>
      </div>
      {canAdd && (
        <Button variant="outline" size="sm" className="shrink-0" onClick={onAdd}>
          <Plus className="h-3.5 w-3.5" />
          {t("hosts.addHost")}
        </Button>
      )}
    </li>
  );
}
