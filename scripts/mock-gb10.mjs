// A stand-in for the GB10's local services, for development without the box.
//
//   /v1/models, /v1/chat/completions   OpenAI-compatible reasoning model
//   /v1/audio/speech                   Kokoro-style TTS (returns a short tone)
//   /hook                              OpenClaw hook (records bounded tasks)
//
// Usage: node scripts/mock-gb10.mjs  (listens on MOCK_PORT, default 8765)
// Then:  ANCHOR_LLM_BASE_URL=http://localhost:8765/v1 \
//        ANCHOR_TTS_BASE_URL=http://localhost:8765/v1 \
//        OPENCLAW_HOOK_URL=http://localhost:8765/hook npm run dev
import http from "node:http";

const PORT = Number(process.env.MOCK_PORT ?? 8765);
const hookTasks = [];

function readBody(req) {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (c) => (data += c));
    req.on("end", () => resolve(data ? JSON.parse(data) : {}));
  });
}

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// A deliberately simple "model": enough to exercise the adapter contract.
function fakeTriage(text) {
  const t = text.toLowerCase();
  if (/hopeless|scared of myself|don't want to talk|doesn't matter/.test(t)) return { tier: 3, rationale: "Safety-relevant or evasive language.", topics: [] };
  if (/again|third time|keep missing|not working/.test(t)) return { tier: 2, rationale: "The patient describes a recurring issue.", topics: ["craving"] };
  if (/movie|gym|dinner|walk|work was/.test(t)) return { tier: 1, rationale: "An ordinary day described clearly.", topics: ["on_track"] };
  return { tier: 1, rationale: "Clearly described, situational.", topics: [] };
}

function tone() {
  // 0.3 s, 440 Hz, 16-bit mono WAV
  const rate = 16000, n = Math.floor(rate * 0.3);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write("RIFF", 0); buf.writeUInt32LE(36 + n * 2, 4); buf.write("WAVE", 8);
  buf.write("fmt ", 12); buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24); buf.writeUInt32LE(rate * 2, 28); buf.writeUInt16LE(2, 32); buf.writeUInt16LE(16, 34);
  buf.write("data", 36); buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) buf.writeInt16LE(Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000), 44 + i * 2);
  return buf;
}

http
  .createServer(async (req, res) => {
    if (req.method === "GET" && req.url === "/v1/models") return json(res, 200, { data: [{ id: "qwen-3.8-27b" }] });
    if (req.method === "GET" && req.url === "/hook/tasks") return json(res, 200, { tasks: hookTasks });
    const body = req.method === "POST" ? await readBody(req) : {};
    if (req.url === "/v1/chat/completions") {
      const system = body.messages?.[0]?.content ?? "";
      const user = body.messages?.[1]?.content ?? "";
      const content = system.includes("opening line")
        ? JSON.stringify({ script: "Hey, it's me. Checking in like we planned. How did today go?" })
        : `<think>reading</think>${JSON.stringify(fakeTriage(user.split("<<<")[1] ?? user))}`;
      return json(res, 200, { choices: [{ message: { role: "assistant", content } }] });
    }
    if (req.url === "/v1/audio/speech") {
      res.writeHead(200, { "Content-Type": "audio/wav" });
      return res.end(tone());
    }
    if (req.url === "/hook") {
      if (req.headers.authorization !== `Bearer ${process.env.OPENCLAW_HOOK_TOKEN ?? "dev-token"}`) return json(res, 401, { error: "unauthorized" });
      hookTasks.push(body);
      return json(res, 202, { accepted: true });
    }
    json(res, 404, { error: "not found" });
  })
  .listen(PORT, () => console.log(`mock GB10 services on http://localhost:${PORT}`));
