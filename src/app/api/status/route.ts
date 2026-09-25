import { aiConfig, modelDisplayName } from "@/lib/ai/config";
import { pingModel } from "@/lib/ai/provider";
import { handle } from "@/lib/http/respond";
import { getStoreState } from "@/lib/store";

export async function GET() {
  return handle(async () => {
    const [{ store, note }, model] = await Promise.all([getStoreState(), pingModel()]);
    return {
      store: { kind: store.kind, note },
      model: { name: modelDisplayName(), status: model },
      tts: { engine: aiConfig.ttsBaseUrl ? "kokoro" : "browser", voice: aiConfig.ttsVoice },
      openclaw: { hook: aiConfig.openclawHookUrl ? "configured" : "local_queue" },
      demoMode: process.env.ANCHOR_DEMO_MODE !== "false",
    };
  });
}
