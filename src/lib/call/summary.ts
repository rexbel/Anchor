/** Pure call bookkeeping for the live-call screen, kept separate so it is testable. */

export type CallTurn = {
  tier: 1 | 2 | 3;
  escalated: boolean;
  gated: boolean;
};

export type CallSummary = {
  durationSec: number;
  turns: number;
  highestTier: 1 | 2 | 3 | null;
  escalations: number;
  gateRequests: number;
};

export function summarizeCall(turns: CallTurn[], startedAt: number, endedAt: number): CallSummary {
  return {
    durationSec: Math.max(0, Math.round((endedAt - startedAt) / 1000)),
    turns: turns.length,
    highestTier: turns.length ? (Math.max(...turns.map((t) => t.tier)) as 1 | 2 | 3) : null,
    escalations: turns.filter((t) => t.escalated).length,
    gateRequests: turns.filter((t) => t.gated).length,
  };
}

export function formatDuration(totalSec: number): string {
  const s = Math.max(0, Math.floor(totalSec));
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

/** Clinician-approved opening line for outbound calls. */
export const OUTBOUND_OPENER = "Hey, it's me. How'd today go with the plan?";
