// Semantic search (#36): designation vectors in Vectorize, one namespace per
// language. Embeddings via the Workers AI binding (bge-m3, multilingual,
// 1024-dim — matches the glossarist-semantic index). Seeding is an
// admin-token-gated chunked route so no API tokens leave the account.
import type { Env } from "./types.js";
import { problem } from "./http.js";
import { pickFormat } from "./negotiate.js";

const MODEL = "@cf/baai/bge-m3";
const EMBED_DIMS = 1024;
const SEED_BATCH = 64;

type DesignationRow = { register: string; uuid: string; lang: string; designation: string; identifier: string | null; rowid: number };

export async function embedQuery(env: Env, q: string): Promise<number[]> {
  const res = await env.AI.run(MODEL, { text: [q] }) as { data: number[][] };
  const vec = res.data?.[0];
  if (!vec || vec.length !== EMBED_DIMS) throw new Error(`embedding model returned ${vec?.length ?? 0} dims, expected ${EMBED_DIMS}`);
  return vec;
}

/** GET /admin/embed?token=…&cursor=0 — upserts SEED_BATCH designation vectors, returns the next cursor. */
export async function adminEmbed(req: Request, env: Env, url: URL): Promise<Response> {
  const token = url.searchParams.get("token") ?? req.headers.get("authorization")?.replace(/^Bearer /, "");
  const expected = env.ADMIN_TOKEN;
  if (!expected || token !== expected) return problem(401, "unauthorized", "Admin token required");
  const cursor = Math.max(0, Number(url.searchParams.get("cursor") ?? 0));

  const rows = await env.DB.prepare(
    `SELECT d.rowid, d.register, d.uuid, d.lang, d.designation, c.identifier, c.status
     FROM designations d LEFT JOIN concepts c ON c.register = d.register AND c.uuid = d.uuid
     WHERE d.designation IS NOT NULL AND d.designation != ''
     ORDER BY d.rowid LIMIT ? OFFSET ?`,
  ).bind(SEED_BATCH, cursor).all() as { results: (DesignationRow & { status: string | null })[] };

  const batch = rows.results;
  if (batch.length === 0) {
    return new Response(JSON.stringify({ done: true, cursor }), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
  }

  const texts = batch.map((r) => `${r.designation}. Register: ${r.register}.`);
  const res = await env.AI.run(MODEL, { text: texts }) as { data: number[][] };
  const vectors = batch.map((r, i) => ({
    id: `${r.register}:${r.uuid}:${r.lang}`,
    values: res.data[i],
    namespace: r.lang,
    metadata: { register: r.register, uuid: r.uuid, lang: r.lang, designation: r.designation.slice(0, 120), identifier: r.identifier ?? "", status: r.status ?? "unknown" },
  }));
  await env.VECTORIZE.upsert(vectors);

  const next = cursor + batch.length;
  return new Response(JSON.stringify({ done: false, cursor, next, embedded: batch.length }), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

type VectorMatch = { id: string; score: number; metadata?: Record<string, unknown> };

/** GET /v1/search?semantic=true&q=…&lang=… — vector search over designations. */
export async function semanticSearch(req: Request, env: Env, url: URL): Promise<Response> {
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return problem(400, "query_required", "The q query parameter is required");
  const lang = url.searchParams.get("lang");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 10), 25);

  const vector = await embedQuery(env, q);
  const queried = await env.VECTORIZE.query(vector, {
    topK: limit * (lang ? 1 : 3),
    returnMetadata: "all",
    ...(lang ? { namespace: lang } : {}),
  });
  const matches = (queried.matches ?? []) as VectorMatch[];

  const seen = new Set<string>();
  const hits = matches
    .filter((m) => {
      const key = String(m.id);
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, limit)
    .map((m) => ({
      register: m.metadata?.register,
      uuid: m.metadata?.uuid,
      lang: m.metadata?.lang,
      designation: m.metadata?.designation,
      identifier: m.metadata?.identifier || null,
      score: Number(m.score.toFixed(4)),
    }));

  const format = pickFormat(req.headers.get("accept"));
  if (format === "turtle") {
    const ttl = [
      "@prefix dct: <http://purl.org/dc/terms/> .",
      "",
      `<${url.origin}/v1/search> dct:title "semantic search results" .`,
      ...hits.map((h, i) => `<${url.origin}/id/${h.register}/concept/${h.uuid}> dct:title "${String(h.designation).replace(/"/g, "'")} (score ${h.score})" .`),
    ].join("\n");
    return new Response(ttl + "\n", { status: 200, headers: { "content-type": "text/turtle", vary: "accept", "access-control-allow-origin": "*" } });
  }
  return new Response(JSON.stringify({ query: q, semantic: true, lang: lang ?? "all", hits }), {
    status: 200,
    headers: { "content-type": format === "json" ? "application/json" : "application/ld+json", vary: "accept", "access-control-allow-origin": "*" },
  });
}
