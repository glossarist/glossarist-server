import type { Env, Route } from "./types.js";
import { json, problem } from "./http.js";

async function registers(_req: Request, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT id, title, subtitle, uri_base, languages, concept_count FROM registers ORDER BY id",
  ).all();
  return json({ registers: rows.results }, 200, { etag: `"registers-${rows.results.length}"` });
}

export const routes: Route[] = [
  ["GET", /^\/healthz$/, () => json({ ok: true })],
  ["GET", /^\/v1\/registers$/, registers],
];

export function dispatch(req: Request, env: Env, url: URL): Response | Promise<Response> {
  const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
  if (!route) return problem(404, "not_found", "No such route");
  return route[2](req, env, url);
}
