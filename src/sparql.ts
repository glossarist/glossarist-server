// /sparql — SPARQL 1.1 query endpoint over the roll-our-own engine.
// Store hydration: R2 per-register aggregates (jsonld) for the current build,
// cached per isolate, keyed by build id. Read-only by design.
import { QuadStore, readJsonld, readJsonldIntoStore, parseQuery, evaluate, SparqlSyntaxError, SparqlTimeoutError, SparqlCostError, serializeTurtle } from "glossarist-sparql";
import type { Env } from "./types.js";
import { problem } from "./http.js";

type Hydrated = { buildId: string; store: QuadStore };
let cache: Hydrated | null = null;

async function hydrate(env: Env): Promise<QuadStore> {
  const build = await env.DB.prepare("SELECT value FROM meta WHERE key = 'build_id'").first() as { value: string } | null;
  if (!build) throw new Error("no build ingested");
  // Fingerprint = build id + register count: registers can be added to the
  // same build id after the initial ingest (tenant onboarding), and a
  // build-id-only cache would serve a store missing the new registers.
  const regs = await env.DB.prepare("SELECT id FROM registers").all() as { results: { id: string }[] };
  const fingerprint = `${build.value}:${regs.results.length}`;
  if (cache && cache.buildId === fingerprint) return cache.store;

  const store = new QuadStore();
  for (const { id } of regs.results) {
    const obj = await env.ARTIFACTS.get(`builds/${build.value}/${id}/${id}.jsonld`);
    if (!obj) continue;
    const doc = JSON.parse(await obj.text());
    readJsonldIntoStore(doc, store);
  }
  cache = { buildId: fingerprint, store };
  return store;
}

function termToWire(t: { kind: string; value: string; lang?: string; datatype?: string }): Record<string, unknown> {
  if (t.kind === "iri") return { type: "uri", value: t.value };
  if (t.kind === "bnode") return { type: "bnode", value: t.value };
  const out: Record<string, unknown> = { type: "literal", value: t.value };
  if (t.lang) out["xml:lang"] = t.lang;
  else if (t.datatype) out.datatype = t.datatype;
  return out;
}

export async function sparqlEndpoint(req: Request, env: Env): Promise<Response> {
  let query: string | null = null;
  if (req.method === "GET") query = new URL(req.url).searchParams.get("query");
  else if (req.method === "POST") {
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/sparql-query")) query = await req.text();
    else if (ct.includes("application/x-www-form-urlencoded")) query = new URLSearchParams(await req.text()).get("query");
  }
  if (!query || query.trim().length === 0) return problem(400, "query_required", "Provide ?query= or an application/sparql-query body");

  let store: QuadStore;
  try {
    store = await hydrate(env);
  } catch (e) {
    return problem(503, "not_ingested", (e as Error).message);
  }

  let parsed;
  try {
    parsed = parseQuery(query);
  } catch (e) {
    if (e instanceof SparqlSyntaxError) return problem(400, "sparql_syntax", "SPARQL syntax error", (e as Error).message);
    throw e;
  }

  let result;
  try {
    result = evaluate(store, parsed, { deadlineMs: Date.now() + 4_000, maxSolutions: 200_000 });
  } catch (e) {
    if (e instanceof SparqlTimeoutError) return problem(408, "sparql_timeout", "Query exceeded the wall-clock deadline");
    if (e instanceof SparqlCostError) return problem(400, "sparql_cost", "Query exceeded the solution ceiling");
    return problem(400, "sparql_error", (e as Error).message);
  }

  if (typeof result === "boolean") {
    return new Response(JSON.stringify({ head: {}, boolean: result }), { headers: { "content-type": "application/sparql-results+json" } });
  }
  if ("quads" in result) {
    return new Response(serializeTurtle(result.quads), { headers: { "content-type": "text/turtle" } });
  }
  const sel = result as { vars: string[]; bindings: Record<string, { kind: string; value: string; lang?: string; datatype?: string }>[] };
  const bindingList = sel.bindings.map((solution) => {
    const out: Record<string, unknown> = {};
    for (const v of sel.vars) if (solution[v]) out[v] = termToWire(solution[v]);
    return out;
  });
  return new Response(JSON.stringify({ head: { vars: sel.vars }, results: { bindings: bindingList } }), {
    headers: { "content-type": "application/sparql-results+json" },
  });
}
