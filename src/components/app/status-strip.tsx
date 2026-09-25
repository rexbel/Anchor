"use client";

import { useEffect, useState } from "react";
import { Cpu, Database, Mic, Waypoints } from "lucide-react";

import { api, type Status } from "@/lib/client/api";
import { cn } from "@/lib/utils";

function Pill({ ok, icon: Icon, label, title }: { ok: boolean; icon: typeof Cpu; label: string; title: string }) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs",
        ok ? "border-brand/40 bg-accent text-foreground" : "border-border bg-muted text-muted-foreground",
      )}
    >
      <Icon className="size-3.5" aria-hidden />
      {label}
      <span className="sr-only">{ok ? "(live)" : "(fallback)"}</span>
    </span>
  );
}

export function StatusStrip({ className }: { className?: string }) {
  const [status, setStatus] = useState<Status | null>(null);
  useEffect(() => {
    api.status().then(setStatus).catch(() => setStatus(null));
  }, []);

  if (!status) {
    return <div className={cn("h-7 w-80 animate-pulse rounded-full bg-muted", className)} aria-hidden />;
  }
  const modelLive = status.model.status === "reachable";
  return (
    <div className={cn("flex flex-wrap items-center gap-2", className)} aria-label="Adapter status">
      <Pill
        ok={modelLive}
        icon={Cpu}
        label={modelLive ? `${status.model.name} live` : "Deterministic triage"}
        title={
          modelLive
            ? "The local reasoning model is reachable. Triage combines its reading with the deterministic floor."
            : "No reasoning model reachable. Triage runs on deterministic rules and routes up on doubt."
        }
      />
      <Pill
        ok={status.store.kind === "mongodb"}
        icon={Database}
        label={status.store.kind === "mongodb" ? "MongoDB" : "Seeded memory store"}
        title={status.store.note ?? "Connected to MongoDB, the durable system of record."}
      />
      <Pill
        ok={status.tts.engine === "kokoro"}
        icon={Mic}
        label={status.tts.engine === "kokoro" ? "Kokoro voice" : "Browser voice"}
        title={status.tts.engine === "kokoro" ? "Voice rendered by the local Kokoro server." : "No Kokoro server configured. The browser speaks instead."}
      />
      <Pill
        ok={status.twin.cloning === "configured"}
        icon={Mic}
        label={status.twin.cloning === "configured" ? "Digital Twin cloning" : "No cloning server"}
        title={
          status.twin.cloning === "configured"
            ? "Enrolled patients hear Anchor in their own cloned voice."
            : "Set ANCHOR_TWIN_TTS_URL to the Digital Twin TTS on the GB10. Until then, enrolled patients hear the standard voice."
        }
      />
      <Pill
        ok={status.openclaw.hook === "configured"}
        icon={Waypoints}
        label={status.openclaw.hook === "configured" ? "OpenClaw hook" : "Local clinician queue"}
        title={
          status.openclaw.hook === "configured"
            ? "Escalations send a bounded task to the authenticated OpenClaw hook after committing."
            : "No OpenClaw hook configured. Escalations wait in the clinician queue in this app."
        }
      />
    </div>
  );
}
