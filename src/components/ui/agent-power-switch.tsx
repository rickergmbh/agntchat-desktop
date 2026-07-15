"use client";

import * as React from "react";
import { Loader2 } from "lucide-react";

import { Switch } from "@/components/ui/switch";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

export interface AgentPowerSwitchProps {
  /** Whether the agent is online (switch on = green, off = muted). */
  checked: boolean;
  /** Fired when the user flips the switch. `next` is the requested state. */
  onToggle?: (next: boolean, e: React.MouseEvent) => void;
  /** Action in flight — shows a spinner and disables the switch. */
  busy?: boolean;
  disabled?: boolean;
  /** Accessible name + fallback tooltip, e.g. "Bring online" / "Take offline". */
  label: string;
  /** Optional hover explanation (e.g. why a hosted agent can't be stopped here). */
  tooltip?: string;
}

/**
 * On/off control for an agent's power state, as a switch instead of a button.
 * On reads green (online), off reads muted (offline) — so the control doubles
 * as the status indicator. Copy stays in the caller so this is locale-agnostic.
 */
export function AgentPowerSwitch({
  checked,
  onToggle,
  busy,
  disabled,
  label,
  tooltip,
}: AgentPowerSwitchProps) {
  const control = (
    <span className="flex h-7 items-center gap-1.5">
      {busy && (
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
      )}
      <Switch
        checked={checked}
        disabled={disabled || busy}
        aria-label={label}
        title={!tooltip ? label : undefined}
        // On = online → green (success); off = muted (base `bg-input`).
        className="data-checked:bg-success"
        onClick={(e) => e.stopPropagation()}
        onCheckedChange={(next, event) =>
          onToggle?.(next, event as unknown as React.MouseEvent)
        }
      />
    </span>
  );

  if (!tooltip) return control;

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={control} />
        <TooltipContent side="left" className="text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
