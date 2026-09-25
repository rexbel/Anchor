import type {
  AuditEvent,
  CheckinQueueEntry,
  CheckinRecord,
  EscalationEvent,
  GateRequest,
  RecoveryPlan,
  ReferenceLibraryEntry,
} from "@/lib/domain/schemas";
import type { CheckinResult } from "@/lib/pipeline/checkin";
import type { FhirSummary } from "@/lib/data/fhir";

export type Status = {
  store: { kind: "memory" | "mongodb"; note: string | null };
  model: { name: string; status: "reachable" | "unreachable" | "not_configured" };
  tts: { engine: "kokoro" | "browser"; voice: string };
  openclaw: { hook: "configured" | "local_queue" };
  demoMode: boolean;
};

export type QueueRow = CheckinQueueEntry & { displayName: string; scenario?: RecoveryPlan["scenario"] };
export type PatientSummary = {
  patientId: string;
  displayName: string;
  scenario: RecoveryPlan["scenario"];
  scenarioBlurb: string;
  diagnosis: RecoveryPlan["diagnosis"];
  openEscalations: number;
  patternFlags: number;
};
export type PatientDetail = {
  plan: RecoveryPlan;
  history: CheckinRecord[];
  copingPlan: ReferenceLibraryEntry[];
  fhir: FhirSummary | null;
};
export type GateRow = GateRequest & { displayName: string };
export type EscalationRow = EscalationEvent & { displayName: string; clinician: RecoveryPlan["clinician"] };
export type AuditRow = AuditEvent & { displayName: string };
export type Metrics = {
  turnsHandled: number;
  escalationsCommitted: number;
  medianMsToEscalation: number | null;
  gatePending: number;
  gateDecided: number;
};
export type { CheckinResult };

export class ApiError extends Error {}

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...init,
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((body as { error?: string }).error ?? `Request failed (${res.status})`);
  return body as T;
}

export const api = {
  status: () => call<Status>("/api/status"),
  metrics: () => call<Metrics>("/api/metrics"),
  queue: () => call<{ queue: QueueRow[] }>("/api/queue"),
  propose: (id: string) => call<{ gateRequest: GateRequest; source: string }>(`/api/queue/${id}/propose`, { method: "POST" }),
  patients: () => call<{ patients: PatientSummary[] }>("/api/patients"),
  patient: (id: string) => call<PatientDetail>(`/api/patients/${id}`),
  checkin: (body: { patientId: string; direction: "inbound" | "outbound"; utterance: string }) =>
    call<CheckinResult>("/api/checkins", { method: "POST", body: JSON.stringify(body) }),
  gate: () => call<{ requests: GateRow[] }>("/api/gate"),
  decide: (id: string, body: { decision: "approved" | "rejected"; clinician: string; draft?: string; note?: string }) =>
    call<GateRequest>(`/api/gate/${id}`, { method: "POST", body: JSON.stringify(body) }),
  escalations: () =>
    call<{ escalations: EscalationRow[]; clinicianReference: ReferenceLibraryEntry[] }>("/api/escalations"),
  resolve: (id: string, body: { patientId: string; clinician: string; note: string }) =>
    call<EscalationEvent>(`/api/escalations/${id}/resolve`, { method: "POST", body: JSON.stringify(body) }),
  audit: (patientId?: string) =>
    call<{ events: AuditRow[] }>(`/api/audit${patientId ? `?patientId=${encodeURIComponent(patientId)}` : ""}`),
  reset: () => call<{ ok: true }>("/api/reset", { method: "POST" }),
};
