import { CheckinRequestSchema } from "@/lib/domain/schemas";
import { handle, readJson } from "@/lib/http/respond";
import { runCheckin } from "@/lib/pipeline/checkin";
import { getStore } from "@/lib/store";

export async function POST(request: Request) {
  return handle(async () => {
    const body = CheckinRequestSchema.parse(await readJson(request));
    return runCheckin(await getStore(), body);
  });
}
