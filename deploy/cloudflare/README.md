# anchor-edge

The Cloudflare Worker in front of `anchor.nextrex.health`.

Every request goes to the Mac first, through the `anchor` Cloudflare Tunnel. If the tunnel has no live connector (530), the app isn't answering (502/503), or the Mac doesn't start responding within 8 seconds, the Worker serves the request from a Cloudflare Container running the repo's `Dockerfile`, and skips the Mac for the next 30 seconds. When the Mac comes back, traffic returns to it.

Every response has an `x-anchor-origin: mac | cloud` header. Send `x-anchor-origin: cloud` to force the cloud copy:

```bash
curl -sI -H "x-anchor-origin: cloud" https://anchor.nextrex.health/api/status
```

## Deploy

Deployed by [Workers Builds](https://developers.cloudflare.com/workers/ci-cd/builds/) on every push to `main`:

| Setting | Value |
|---|---|
| Worker name | `anchor-edge` |
| Root directory | `deploy/cloudflare` |
| Build command | *(empty)* |
| Deploy command | `npx wrangler deploy` |

Containers need the Workers Paid plan. The container only runs during a handover and sleeps 15 minutes after its last request.

## Limits

- **Separate data.** The Mac and the cloud copy each keep their own in-memory store, so records made on one aren't on the other. Set `MONGODB_URI` on both to share one database. Keep `max_instances` at 1 until then.
- **Writes during a hang.** If a POST times out on the Mac, the Worker returns 503 and doesn't replay it on the cloud copy, since the Mac may have received it.
- **Mismatched builds.** A page loaded from one copy may fail to load a script from the other until it's refreshed.
- **The Mac doesn't update itself.** Pushes redeploy the cloud copy only. On the Mac: `git pull && npm run build`, then `launchctl kickstart -k gui/$(id -u)/health.nextrex.anchor.app`.

## Local

```bash
npm install
npm run typecheck
npx wrangler dev --enable-containers=false --var MAC_ORIGIN:http://localhost:3100
```

Running the container locally needs Docker.
