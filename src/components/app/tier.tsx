import { AlertTriangle, CheckCircle2, Flag } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

export const TIER_META = {
  1: { name: "Tier 1", short: "Mild", action: "Resolve in conversation", Icon: CheckCircle2, variant: "tier1" as const },
  2: { name: "Tier 2", short: "Moderate", action: "Flag pattern (OpenShell-gated)", Icon: Flag, variant: "tier2" as const },
  3: { name: "Tier 3", short: "At risk", action: "Escalate (never gated)", Icon: AlertTriangle, variant: "tier3" as const },
};

export function TierBadge({ tier, className, withAction = false }: { tier: 1 | 2 | 3; className?: string; withAction?: boolean }) {
  const meta = TIER_META[tier];
  return (
    <Badge variant={meta.variant} className={cn("gap-1", className)}>
      <meta.Icon aria-hidden />
      {meta.name}: {meta.short}
      {withAction ? <span className="font-normal">· {meta.action}</span> : null}
    </Badge>
  );
}
