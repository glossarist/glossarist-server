// /ontologies — serves the GLOSS ontology artifacts uploaded per build into
// R2 (builds/{build_id}/ontologies/). Turtle is canonical; JSON-LD is a
// pre-converted artifact (mechanical conversion of the same source, produced
// offline — never re-parsed or transformed in-flight here).
import type { Env } from "./types.js";
import { problem } from "./http.js";
import { pickFormat, contentTypeFor } from "./negotiate.js";

export async function ontologiesIndex(_req: Request, env: Env): Promise<Response> {
  const build = await env.DB.prepare("SELECT value FROM meta WHERE key = 'build_id'").first() as { value: string } | null;
  if (!build) return problem(503, "not_ingested", "No build ingested yet");
  const listed = await env.ARTIFACTS.list({ prefix: `builds/${build.value}/ontologies/` });
  const byId = new Map<string, { id: string; iri: string; formats: string[]; bytes: number }>();
  for (const obj of listed.objects) {
    const name = obj.key.split("/").pop() ?? "";
    const id = name.replace(/\.(ttl|jsonld)$/, "");
    const entry = byId.get(id) ?? { id, iri: id === "gloss" ? "https://www.glossarist.org/ontologies/glossarist" : `${obj.key}`, formats: [], bytes: 0 };
    if (name.endsWith(".ttl")) entry.formats.push(contentTypeFor("turtle"));
    if (name.endsWith(".jsonld")) entry.formats.push(contentTypeFor("jsonld"));
    entry.bytes += obj.size;
    entry.formats.sort();
    byId.set(id, entry);
  }
  const ontologies = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  return new Response(JSON.stringify({ ontologies }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      etag: `"ont-${build.value}"`,
      vary: "accept",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "Accept, Authorization",
    },
  });
}

export async function ontologyDoc(req: Request, env: Env, url: URL): Promise<Response> {
  const id = url.pathname.split("/")[2];
  const build = await env.DB.prepare("SELECT value FROM meta WHERE key = 'build_id'").first() as { value: string } | null;
  if (!build) return problem(503, "not_ingested", "No build ingested yet");
  const format = pickFormat(req.headers.get("accept"));
  const ext = format === "turtle" ? "ttl" : "jsonld"; // json + jsonld both serve JSON-LD (the default RDF form)
  if (format === "tbx" || format === "csv") {
    return problem(406, "format_not_offered", "Ontologies are offered as JSON-LD (default) or Turtle only");
  }
  const obj = await env.ARTIFACTS.get(`builds/${build.value}/ontologies/${id}.${ext}`);
  if (!obj) return problem(404, "unknown_ontology", "Ontology not present in the current build", `${id} (${ext})`);
  return new Response(obj.body, {
    status: 200,
    headers: {
      "content-type": contentTypeFor(format === "turtle" ? "turtle" : "jsonld"),
      etag: `"ont-${build.value}-${id}-${ext}"`,
      vary: "accept",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET, HEAD, OPTIONS",
      "access-control-allow-headers": "Accept, Authorization",
    },
  });
}
