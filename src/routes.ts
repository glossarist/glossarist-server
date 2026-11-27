import type { Env, Route } from "./types.js";
import { json, problem, withConditional } from "./http.js";
import { pickFormat, contentTypeFor } from "./negotiate.js";
import { sparqlEndpoint } from "./sparql.js";
import { mcpEndpoint } from "./mcp.js";
import { llmsTxt } from "./llms-txt.js";
import { dcatEndpoint } from "./dcat.js";
import { provEndpoint } from "./prov.js";
import { ontologiesIndex, ontologyDoc } from "./ontologies.js";
import { staticSite } from "./site.js";

// Paths that must always answer with Problem Details JSON, never the HTML
// site's 404 page. Everything else falls through to the R2-backed static site.
const API_PATH = /^\/(v1|sparql|mcp|id|dcat|prov|ontologies|healthz)(\/|$)|^\/(openapi\.json|llms\.txt)$/;

// Content types for per-concept artifacts served by the tenant's static host.
const ARTIFACT_EXT: Record<string, string> = {
  jsonld: ".jsonld",
  turtle: ".ttl",
  tbx: ".tbx",
  json: ".json",
};

async function registers(_req: Request, env: Env): Promise<Response> {
  const rows = await env.DB.prepare(
    "SELECT id, title, subtitle, uri_base, languages, concept_count, edition, series, domain FROM registers ORDER BY series, edition",
  ).all();
  return json({ registers: rows.results });
}

async function registerOne(_req: Request, env: Env, url: URL): Promise<Response> {
  const id = url.pathname.split("/")[3];
  const row = await env.DB.prepare(
    "SELECT id, title, subtitle, uri_base, languages, concept_count, edition, series, domain FROM registers WHERE id = ?",
  ).bind(id).first();
  if (!row) return problem(404, "unknown_register", "Unknown register", id);
  const ferin = await env.DB.prepare(
    "SELECT key, value FROM meta WHERE key IN ('build_id', 'generated_at', 'lineage_coverage')",
  ).all();
  return json({ ...row, meta: Object.fromEntries(ferin.results.map((r) => [r.key, r.value])) });
}

async function concepts(req: Request, env: Env, url: URL): Promise<Response> {
  const register = url.pathname.split("/")[3];
  const lang = url.searchParams.get("lang");
  const status = url.searchParams.get("status");
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 50), 200);

  const where: string[] = ["c.register = ?"];
  const binds: string[] = [register];
  if (lang) { where.push("EXISTS (SELECT 1 FROM designations d WHERE d.register = c.register AND d.uuid = c.uuid AND d.lang = ?)"); binds.push(lang); }
  if (status) { where.push("c.status = ?"); binds.push(status); }
  if (cursor) { where.push("c.identifier > ?"); binds.push(cursor); }

  const rows = await env.DB.prepare(
    `SELECT c.uuid, c.identifier, c.status, c.title_eng FROM concepts c WHERE ${where.join(" AND ")} ORDER BY c.identifier LIMIT ?`,
  ).bind(...binds, limit + 1).all();
  const results = rows.results as Record<string, unknown>[];
  const hasMore = results.length > limit;
  const page = hasMore ? results.slice(0, limit) : results;
  const nextCursor = hasMore ? String(page[page.length - 1].identifier) : null;

  let next: string | null = null;
  if (nextCursor) {
    const p = new URL(url.toString());
    p.searchParams.set("cursor", nextCursor);
    next = p.pathname + p.search;
  }
  return json({ register, concepts: page, next_cursor: nextCursor, next });
}

async function concept(req: Request, env: Env, url: URL): Promise<Response> {
  const uuid = url.pathname.split("/")[3];
  const register = url.searchParams.get("register");
  if (!register) return problem(400, "register_required", "The register query parameter is required");

  const row = await env.DB.prepare(
    "SELECT uuid, identifier, status, title_eng FROM concepts WHERE register = ? AND uuid = ?",
  ).bind(register, uuid).first();
  if (!row) return problem(404, "unknown_concept", "Unknown concept", `${register}/${uuid}`);

  const designations = await env.DB.prepare(
    "SELECT lang, designation FROM designations WHERE register = ? AND uuid = ? ORDER BY lang",
  ).bind(register, uuid).all();
  const relations = await env.DB.prepare(
    "SELECT subject, predicate, object FROM relations WHERE register = ? AND (subject = ? OR object = ?)",
  ).bind(register, uuid, uuid).all();
  const sources = await env.DB.prepare(
    "SELECT urn, clause, kind FROM concept_sources WHERE register = ? AND uuid = ?",
  ).bind(register, uuid).all();
  const lineage = await env.DB.prepare(
    "SELECT from_uuid, to_uuid, kind FROM lineage WHERE register = ? AND (from_uuid = ? OR to_uuid = ?)",
  ).bind(register, uuid, uuid).all();

  const reg = await env.DB.prepare("SELECT uri_base, domain FROM registers WHERE id = ?").bind(register).first();
  const format = pickFormat(req.headers.get("accept"));
  if (format !== "json" && format !== "jsonld") {
    // RDF/TBX forms are 303 pointers to the published lossless artifacts.
    const ext = ARTIFACT_EXT[format];
    const base = (reg?.uri_base as string | null) ?? "";
    if (base) return new Response(null, { status: 303, headers: { location: `${base}/data/${register}/concepts/${uuid}${ext}` } });
  }

  return json({
    register,
    ...row,
    designations: Object.fromEntries(
      (designations.results as { lang: string; designation: string }[]).map((d) => [d.lang, d.designation]),
    ),
    relations: relations.results,
    sources: sources.results,
    lineage: { entries: lineage.results, coverage_note: "edition supersession is recorded only where the dataset models it" },
    artifacts: reg?.uri_base
      ? { jsonld: `${reg.uri_base}/data/${register}/concepts/${uuid}.jsonld`, ttl: `${reg.uri_base}/data/${register}/concepts/${uuid}.ttl`, tbx: `${reg.uri_base}/data/${register}/concepts/${uuid}.tbx` }
      : undefined,
  });
}

async function relationsFor(req: Request, env: Env, url: URL): Promise<Response> {
  const uuid = url.pathname.split("/")[3];
  const register = url.searchParams.get("register");
  if (!register) return problem(400, "register_required", "The register query parameter is required");
  const direction = url.searchParams.get("direction") ?? "either";
  const cond = direction === "outgoing" ? "subject = ?" : direction === "incoming" ? "object = ?" : "(subject = ? OR object = ?)";
  const rows = await env.DB.prepare(
    `SELECT subject, predicate, object FROM relations WHERE register = ? AND ${cond}`,
  ).bind(register, ...(direction === "either" ? [uuid, uuid] : [uuid])).all();
  return json({ register, uuid, direction, relations: rows.results });
}

async function lineageFor(req: Request, env: Env, url: URL): Promise<Response> {
  const uuid = url.pathname.split("/")[3];
  const register = url.searchParams.get("register") ?? "";
  const rows = await env.DB.prepare(
    "SELECT from_uuid, to_uuid, kind, note FROM lineage WHERE register = ? AND (from_uuid = ? OR to_uuid = ?)",
  ).bind(register, uuid, uuid).all();
  const meta = await env.DB.prepare("SELECT value FROM meta WHERE key = 'lineage_coverage'").first() as { value: string } | null;
  return json({ register, uuid, lineage: rows.results, lineage_coverage: meta?.value ?? "0", note: "empty lineage is reported honestly: edition supersession appears here only where the dataset models it" });
}

async function search(req: Request, env: Env, url: URL): Promise<Response> {
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return problem(400, "query_required", "The q query parameter is required");
  const lang = url.searchParams.get("lang");
  const register = url.searchParams.get("register");
  const limit = Math.min(Number(url.searchParams.get("limit") ?? 25), 100);
  const like = `%${q.replace(/[%_]/g, "")}%`;
  const rows = await env.DB.prepare(
    `SELECT register, uuid, lang, designation, normative_status FROM designations
     WHERE designation LIKE ? ${lang ? "AND lang = ?" : ""} ${register ? "AND register = ?" : ""} ORDER BY designation LIMIT ?`,
  ).bind(...(lang ? [like, lang] : [like]), ...(register ? [register] : []), limit).all();
  return json({ query: q, hits: rows.results });
}

async function suggest(req: Request, env: Env, url: URL): Promise<Response> {
  const q = url.searchParams.get("q")?.trim() ?? "";
  if (!q) return json({ suggestions: [] });
  const rows = await env.DB.prepare(
    "SELECT DISTINCT designation FROM designations WHERE designation LIKE ? ORDER BY designation LIMIT 10",
  ).bind(`${q.replace(/[%_]/g, "")}%`).all();
  return json({ suggestions: (rows.results as { designation: string }[]).map((r) => r.designation) });
}

async function editions(req: Request, env: Env, url: URL): Promise<Response> {
  const series = url.searchParams.get("lineage");
  const rows = series
    ? await env.DB.prepare("SELECT id, title, edition, series, uri_base, concept_count FROM registers WHERE series = ? ORDER BY edition").bind(series).all()
    : await env.DB.prepare("SELECT id, title, edition, series, uri_base, concept_count FROM registers ORDER BY series, edition").all();
  const bySeries: Record<string, unknown[]> = {};
  for (const r of rows.results as Record<string, unknown>[]) {
    const k = String(r.series ?? r.id);
    (bySeries[k] ??= []).push(r);
  }
  return json({ series: bySeries });
}

async function sourcesFor(req: Request, env: Env, url: URL): Promise<Response> {
  const urn = decodeURIComponent(url.pathname.split("/").slice(3).join("/"));
  const register = url.searchParams.get("register");
  const rows = await env.DB.prepare(
    `SELECT register, urn, record FROM sources WHERE urn = ? ${register ? "AND register = ?" : ""}`,
  ).bind(...(register ? [urn, register] : [urn])).all();
  if (rows.results.length === 0) return problem(404, "unknown_source", "No bibliography record for that URN", urn);
  return json({ urn, records: (rows.results as { register: string; record: string }[]).map((r) => ({ register: r.register, record: JSON.parse(r.record) })) });
}

async function exportsFor(req: Request, env: Env, url: URL): Promise<Response> {
  const parts = url.pathname.split("/");
  const register = parts[3];
  const format = parts[5];
  const build = await env.DB.prepare("SELECT value FROM meta WHERE key = 'build_id'").first() as { value: string } | null;
  if (!build) return problem(503, "not_ingested", "No build ingested yet");
  const names: Record<string, string> = { jsonld: `${register}.jsonld`, turtle: `${register}.ttl`, csv: `${register}.csv`, gcr: `${register}.gcr` };
  const name = names[format];
  if (!name) return problem(404, "unknown_format", "Supported: jsonld, turtle, csv, gcr");
  const obj = await env.ARTIFACTS.get(`builds/${build.value}/${register}/${name}`);
  if (!obj) return problem(404, "not_found", "Export not present in this build");
  const types: Record<string, string> = { jsonld: "application/ld+json", turtle: "text/turtle", csv: "text/csv", gcr: "application/zip" };
  return new Response(obj.body, { headers: { "content-type": types[format], "content-disposition": `attachment; filename="${name}"` } });
}

async function iriRoute(req: Request, env: Env, url: URL): Promise<Response> {
  const [, , register, , uuid] = url.pathname.split("/");
  const format = pickFormat(req.headers.get("accept"));
  const row = await env.DB.prepare("SELECT uri_base FROM registers WHERE id = ?").bind(register).first() as { uri_base: string } | null;
  if (!row) return problem(404, "unknown_register", "Unknown register", register);
  if (format === "json") {
    return concept(new Request(`https://local/v1/concepts/${uuid}?register=${register}`, { headers: req.headers }), env, new URL(`https://local/v1/concepts/${uuid}?register=${register}`));
  }
  const ext = ARTIFACT_EXT[format] ?? ".jsonld";
  return new Response(null, { status: 303, headers: { location: `${row.uri_base}/data/${register}/concepts/${uuid}${ext}` } });
}

function openapi(_req: Request): Response {
  return json({
    openapi: "3.1.0",
    info: { title: "Glossarist Vocab API", version: "1.0.0", description: "Machine access to glossarist terminology registers. JSON-LD-first; RDF/TBX forms are 303 pointers to the published lossless artifacts." },
    servers: [{ url: "/" }],
    paths: {
      "/v1/registers": { get: { summary: "Register catalog", responses: { "200": { description: "ok" } } } },
      "/v1/registers/{id}": { get: { summary: "Register manifest + build metadata", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" }, "404": { description: "unknown" } } } },
      "/v1/registers/{id}/concepts": { get: { summary: "Paged concept index", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "lang", in: "query", schema: { type: "string" } }, { name: "status", in: "query", schema: { type: "string" } }, { name: "cursor", in: "query", schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
      "/v1/concepts/{uuid}": { get: { summary: "Full concept entry (structured view)", parameters: [{ name: "uuid", in: "path", required: true, schema: { type: "string" } }, { name: "register", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" }, "404": { description: "unknown" } } } },
      "/v1/concepts/{uuid}/lineage": { get: { summary: "Edition supersession chain (honest empty when unmodeled)", parameters: [{ name: "uuid", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
      "/v1/concepts/{uuid}/relations": { get: { summary: "Typed relations, incoming + outgoing", parameters: [{ name: "uuid", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
      "/v1/search": { get: { summary: "Designation search", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
      "/v1/suggest": { get: { summary: "Designation autocomplete", parameters: [{ name: "q", in: "query", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" } } } },
      "/v1/editions": { get: { summary: "Edition series (e.g. VIM 1984-2012)", responses: { "200": { description: "ok" } } } },
      "/v1/sources/{urn}": { get: { summary: "Citation resolution", parameters: [{ name: "urn", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" }, "404": { description: "unknown" } } } },
      "/v1/registers/{id}/exports/{format}": { get: { summary: "Bulk export", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }, { name: "format", in: "path", required: true, schema: { type: "string", enum: ["jsonld", "turtle", "csv", "gcr"] } }], responses: { "200": { description: "ok" } } } },
      "/id/{register}/concept/{uuid}": { get: { summary: "Dereferenceable concept IRI (conneg; RDF forms 303 to published artifacts)", responses: { "200": { description: "json view" }, "303": { description: "artifact pointer" } } } },
      "/sparql": { get: { summary: "SPARQL 1.1 query (roll-our-own engine, read-only)", responses: { "200": { description: "ok" } } } },
      "/mcp": { post: { summary: "MCP over Streamable HTTP", responses: { "200": { description: "ok" } } } },
      "/dcat": { get: { summary: "DCAT catalog (JSON-LD default, Turtle via conneg)", responses: { "200": { description: "ok" }, "406": { description: "format not offered" } } } },
      "/prov": { get: { summary: "PROV-O build provenance (JSON-LD default, Turtle via conneg)", responses: { "200": { description: "ok" } } } },
      "/ontologies": { get: { summary: "Ontology artifact index", responses: { "200": { description: "ok" } } } },
      "/ontologies/{id}": { get: { summary: "Ontology document (conneg: JSON-LD default, Turtle)", parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "ok" }, "404": { description: "unknown" } } } },
    },
  });
}

export const routes: Route[] = [
  ["GET", /^\/healthz$/, () => json({ ok: true })],
  ["GET", /^\/sparql$/, sparqlEndpoint],
  ["POST", /^\/sparql$/, sparqlEndpoint],
  ["POST", /^\/mcp$/, mcpEndpoint],
  ["GET", /^\/dcat$/, dcatEndpoint],
  ["GET", /^\/prov$/, provEndpoint],
  ["GET", /^\/ontologies$/, ontologiesIndex],
  ["GET", /^\/ontologies\/[^/]+$/, ontologyDoc],
  ["GET", /^\/llms\.txt$/, llmsTxt],
  ["GET", /^\/openapi\.json$/, openapi],
  ["GET", /^\/v1\/registers$/, registers],
  ["GET", /^\/v1\/registers\/[^/]+$/, registerOne],
  ["GET", /^\/v1\/registers\/[^/]+\/concepts$/, concepts],
  ["GET", /^\/v1\/registers\/[^/]+\/exports\/[a-z]+$/, exportsFor],
  ["GET", /^\/v1\/concepts\/[^/]+$/, concept],
  ["GET", /^\/v1\/concepts\/[^/]+\/relations$/, relationsFor],
  ["GET", /^\/v1\/concepts\/[^/]+\/lineage$/, lineageFor],
  ["GET", /^\/v1\/search$/, search],
  ["GET", /^\/v1\/suggest$/, suggest],
  ["GET", /^\/v1\/editions$/, editions],
  ["GET", /^\/v1\/sources\/.+$/, sourcesFor],
  ["GET", /^\/id\/[^/]+\/concept\/[^/]+$/, iriRoute],
];

export function dispatch(req: Request, env: Env, url: URL): Promise<Response> {
  const route = routes.find(([m, re]) => m === req.method && re.test(url.pathname));
  if (!route) {
    if (API_PATH.test(url.pathname)) return Promise.resolve(problem(404, "not_found", "No such route"));
    return staticSite(req, env, url);
  }
  return Promise.resolve(route[2](req, env, url)).then((res) => withConditional(res, req));
}
