import { MemoryStore } from "./memory";
import { MongoStore } from "./mongo";
import { describeDemoTwin, seedDemoTwin } from "@/lib/voice/demo-twin";
import type { AnchorStore } from "./types";

export type { AnchorStore } from "./types";

type StoreState = { store: AnchorStore; note: string | null; demoTwinNote?: string | null };

const globalForStore = globalThis as unknown as { __anchorStore?: Promise<StoreState> };

async function create(): Promise<StoreState> {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    return { store: new MemoryStore(), note: "MONGODB_URI not set. Using the seeded in-memory store." };
  }
  try {
    const store = await MongoStore.connect(uri, process.env.MONGODB_DB ?? "anchor");
    return { store, note: null };
  } catch (err) {
    // Graceful failure: the demo keeps working on seeded data, and says so.
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[anchor] MongoDB unreachable, falling back to memory:", reason);
    return {
      store: new MemoryStore(),
      note: `MongoDB unreachable (${reason.slice(0, 120)}). Using the seeded in-memory store.`,
    };
  }
}

async function createWithDemoTwin(): Promise<StoreState> {
  const state = await create();
  const outcome = await seedDemoTwin(state.store);
  const demoTwinNote = describeDemoTwin(outcome);
  if (demoTwinNote) console.error("[anchor]", demoTwinNote);
  return { ...state, demoTwinNote };
}

/** One store per server process, surviving dev hot reloads. */
export function getStoreState(): Promise<StoreState> {
  globalForStore.__anchorStore ??= createWithDemoTwin();
  return globalForStore.__anchorStore;
}

export async function getStore(): Promise<AnchorStore> {
  return (await getStoreState()).store;
}
