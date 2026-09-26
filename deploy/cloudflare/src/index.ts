/**
 * anchor-edge: serve anchor.nextrex.health from the Mac, and hand over to a
 * Cloudflare Container running the same image when the Mac is asleep, off, or offline.
 *
 * Every response carries `x-anchor-origin: mac | cloud` so a handover is visible.
 * Send `x-anchor-origin: cloud` on a request to force the cloud copy (for testing).
 */
import { Container, getContainer } from "@cloudflare/containers";

/** How long the Mac gets to start answering before we hand over. */
const MAC_TIMEOUT_MS = 8_000;
/** After a failure, skip the Mac for this long so each request doesn't pay the timeout. */
const MAC_DOWN_TTL_MS = 30_000;

/**
 * Statuses that prove the request never reached the app on the Mac:
 * 530 = the tunnel has no live connector (Cloudflare error 1033);
 * 502/503 = cloudflared is up but the app on port 3100 isn't answering.
 */
const MAC_UNREACHABLE = new Set([502, 503, 530]);

export class AnchorContainer extends Container<Env> {
  // Matches PORT in the repo's Dockerfile.
  defaultPort = 3000;
  // The copy only matters during a handover; let it sleep once traffic is back on the Mac.
  sleepAfter = "15m";
}

// Per isolate, best effort: a fresh isolate simply tries the Mac once more.
let macDownUntil = 0;

export default {
  async fetch(request, env): Promise<Response> {
    const forceCloud = request.headers.get("x-anchor-origin") === "cloud";

    if (!forceCloud && Date.now() >= macDownUntil) {
      const outcome = await tryMac(request, env);
      if (outcome.kind === "ok") return tag(outcome.response, "mac");
      macDownUntil = Date.now() + MAC_DOWN_TTL_MS;
      if (outcome.kind === "ambiguous") {
        // A write may have reached the Mac before it stopped answering. Replaying it
        // on the cloud copy could double-submit, so let the client retry instead.
        return tag(
          Response.json(
            { error: "Anchor's primary server stopped responding. Retry in a few seconds." },
            { status: 503, headers: { "retry-after": "5" } },
          ),
          "cloud",
        );
      }
    }

    try {
      const response = await getContainer(env.ANCHOR_CLOUD, "primary").fetch(request);
      return tag(response, "cloud");
    } catch (err) {
      console.error("[anchor-edge] cloud copy failed:", err);
      return tag(
        new Response("Anchor is starting its backup server. Refresh in a minute.", {
          status: 503,
          headers: { "retry-after": "30", "content-type": "text/plain; charset=utf-8" },
        }),
        "cloud",
      );
    }
  },
} satisfies ExportedHandler<Env>;

type MacOutcome =
  | { kind: "ok"; response: Response }
  | { kind: "unreachable" }
  | { kind: "ambiguous" };

async function tryMac(request: Request, env: Env): Promise<MacOutcome> {
  const incoming = new URL(request.url);
  const target = new URL(incoming.pathname + incoming.search, env.MAC_ORIGIN);
  const idempotent = request.method === "GET" || request.method === "HEAD";
  // Clone so the original body is still readable if we hand over.
  const copy = request.clone();

  // The timer only bounds the wait for response headers; clearing it once they
  // arrive lets long bodies (audio, streamed pages) finish.
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MAC_TIMEOUT_MS);
  try {
    const response = await fetch(target, {
      method: copy.method,
      headers: copy.headers,
      body: copy.body,
      redirect: "manual",
      signal: controller.signal,
    });
    if (MAC_UNREACHABLE.has(response.status)) return { kind: "unreachable" };
    return { kind: "ok", response };
  } catch {
    return idempotent ? { kind: "unreachable" } : { kind: "ambiguous" };
  } finally {
    clearTimeout(timer);
  }
}

function tag(response: Response, origin: "mac" | "cloud"): Response {
  const tagged = new Response(response.body, response);
  tagged.headers.set("x-anchor-origin", origin);
  return tagged;
}
