import { ZodError } from "zod";

import { ToolError } from "@/lib/tools";

/** Uniform JSON errors with messages a user can act on. */
export async function handle<T>(fn: () => Promise<T>): Promise<Response> {
  try {
    return Response.json(await fn());
  } catch (err) {
    if (err instanceof ZodError) {
      return Response.json(
        { error: err.issues.map((i) => i.message).join(" ") || "Invalid request." },
        { status: 400 },
      );
    }
    if (err instanceof ToolError) {
      return Response.json({ error: err.message }, { status: err.status });
    }
    console.error("[anchor] unhandled", err);
    return Response.json({ error: "Something went wrong on the server. The demo data is unchanged." }, { status: 500 });
  }
}

export async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    throw new ToolError("Request body must be JSON.", 400);
  }
}
