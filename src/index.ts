import { dispatch } from "./routes.js";
import { cors, problem } from "./http.js";
import type { Env } from "./types.js";

export default {
  async fetch(req: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (req.method === "OPTIONS") return cors(new Response(null, { status: 204 }));
    try {
      return cors(await dispatch(req, env, url));
    } catch (e) {
      return problem(500, "internal", "Internal error", (e as Error).message);
    }
  },
} satisfies ExportedHandler<Env>;
