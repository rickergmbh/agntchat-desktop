"use client";

import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { AlertTriangle, Loader2, Power, PowerOff } from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";

// The lifecycle action for an agent, expressed as one consistent control so
// "get this agent running" / "stop it" / "something's wrong" read the same
// everywhere they appear (the agents table, the detail pane, anywhere else).
//
//   bring-online — agent is off; start it (local subprocess or host bridge)
//   take-offline — agent is running; stop it
//   warning      — a problem blocks starting (missing API key, etc.); the
//                  click routes to the fix rather than retrying
//
// All states are deliberately muted (neutral ghost) except `warning`, which
// is the only one that draws the eye (amber). A `busy` flag swaps the icon for
// a spinner and disables the control while an action is in flight.
const agentPowerButtonVariants = cva("", {
  variants: {
    state: {
      "bring-online": "text-muted-foreground hover:text-foreground",
      "take-offline": "text-muted-foreground hover:text-foreground",
      warning: "text-warning hover:text-warning/90",
    },
  },
  defaultVariants: { state: "bring-online" },
});

const STATE_ICON = {
  "bring-online": Power,
  "take-offline": PowerOff,
  warning: AlertTriangle,
} as const;

export type AgentPowerState = NonNullable<
  VariantProps<typeof agentPowerButtonVariants>["state"]
>;

export interface AgentPowerButtonProps
  extends VariantProps<typeof agentPowerButtonVariants> {
  state: AgentPowerState;
  /** Visible label, e.g. "Bring online" / "Take offline". Localize upstream. */
  label: string;
  onClick?: (e: React.MouseEvent) => void;
  disabled?: boolean;
  /** Action in flight — shows a spinner, keeps `label`, and disables. */
  busy?: boolean;
  /** Optional hover explanation. Given the whole control a tooltip; most
   *  useful on the `warning` state to carry the reason (e.g. the key error). */
  tooltip?: string;
  /** Render icon-only (label as aria-label + tooltip fallback) for very tight
   *  spaces. Defaults to a labeled button. */
  iconOnly?: boolean;
  /** Give the control a visible border/fill so it reads as a button rather
   *  than inline text. Use where it stands alone (e.g. a conversation header)
   *  rather than in a dense list of ghost row actions. */
  outlined?: boolean;
  className?: string;
}

/**
 * Design-system control for an agent's power/lifecycle action. Wraps the base
 * {@link Button} so it inherits focus/disabled/press behavior, and pins the
 * per-state icon + muted/warning treatment. Copy stays in the caller so the
 * component is locale-agnostic.
 */
export function AgentPowerButton({
  state,
  label,
  onClick,
  disabled,
  busy,
  tooltip,
  iconOnly,
  outlined,
  className,
}: AgentPowerButtonProps) {
  const Icon = STATE_ICON[state];
  const button = (
    <Button
      variant={outlined ? "outline" : "ghost"}
      size={iconOnly ? "icon-sm" : "sm"}
      className={cn(
        !iconOnly && "h-7 gap-1.5 px-2",
        // The base `outline` variant's border-border is faint; use the
        // stronger token (matching the header's info pill) so an outlined
        // power button clearly reads as a button, not inline text.
        outlined && "border-border-strong dark:border-border-strong",
        agentPowerButtonVariants({ state }),
        className
      )}
      onClick={onClick}
      disabled={disabled || busy}
      aria-label={iconOnly ? label : undefined}
      title={iconOnly && !tooltip ? label : undefined}
    >
      {busy ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
      ) : (
        <Icon className="w-3.5 h-3.5" />
      )}
      {!iconOnly && <span className="truncate">{label}</span>}
    </Button>
  );

  if (!tooltip) return button;

  return (
    <TooltipProvider delay={150}>
      <Tooltip>
        <TooltipTrigger render={button} />
        <TooltipContent side="left" className="text-xs">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}
