import { handle } from "@/lib/http/respond";
import { getStore } from "@/lib/store";

/**
 * Measured from the audit log, not estimated: how many turns were handled
 * and how long it took from receiving a Tier 3 turn to committing the
 * escalation.
 */
export async function GET() {
  return handle(async () => {
    const store = await getStore();
    const audit = await store.listAudit({ limit: 2000 });
    const chronological = [...audit].sort((a, b) => a.seq - b.seq);
    const received = chronological.filter((a) => a.kind === "checkin_received");
    const committed = chronological.filter((a) => a.kind === "escalation_committed");

    const latencies: number[] = [];
    for (const c of committed) {
      const turn = [...received].reverse().find((r) => r.patientId === c.patientId && r.seq < c.seq);
      if (turn) latencies.push(new Date(c.timestamp).getTime() - new Date(turn.timestamp).getTime());
    }
    latencies.sort((a, b) => a - b);
    const median = latencies.length ? latencies[Math.floor(latencies.length / 2)] : null;

    const gate = await store.listGateRequests();
    return {
      turnsHandled: received.length,
      escalationsCommitted: committed.length,
      medianMsToEscalation: median,
      gatePending: gate.filter((g) => g.status === "pending").length,
      gateDecided: gate.filter((g) => g.status !== "pending").length,
    };
  });
}
