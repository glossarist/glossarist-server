// /prov — PROV-O provenance of the current build: what ingested activity
// produced the served indexes, from which source build, when. Only what the
// meta table actually records — no fabricated agents or times.
import { iri, literal, type Quad, type Term } from "glossarist-sparql";
import type { Env } from "./types.js";
import { problem } from "./http.js";
import { rdfResponse, PREFIXES } from "./linked-data.js";

export async function provEndpoint(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const base = url.origin;
  const meta = await env.DB.prepare(
    "SELECT key, value FROM meta WHERE key IN ('build_id', 'generated_at', 'lineage_coverage')",
  ).all();
  const m = Object.fromEntries((meta.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  if (!m.build_id) return problem(503, "not_ingested", "No build ingested yet");

  const quads: Quad[] = [];
  const add = (s: Term, p: Term, o: Term) => quads.push({ s, p, o });
  const dt = (v: string) => literal(v, { datatype: `${PREFIXES.xsd}dateTime` });
  const activity = iri(`${base}/prov#ingest`);
  const entity = iri(`${base}/prov#build/${encodeURIComponent(m.build_id)}`);
  const agent = iri(`${base}/prov#agent`);

  add(activity, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.prov}Activity`));
  if (m.generated_at) add(activity, iri(`${PREFIXES.prov}startedAtTime`), dt(m.generated_at));
  add(activity, iri(`${PREFIXES.prov}used`), entity);
  add(activity, iri(`${PREFIXES.prov}wasAttributedTo`), agent);
  add(activity, iri(`${PREFIXES.dct}title`), literal("Ingest of the OIML vocabulary build into R2 + D1", { lang: "eng" }));

  add(entity, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.prov}Entity`));
  add(entity, iri(`${PREFIXES.dct}identifier`), literal(m.build_id));
  if (m.generated_at) add(entity, iri(`${PREFIXES.prov}generatedAtTime`), dt(m.generated_at));
  if (m.lineage_coverage) {
    add(entity, iri(`${PREFIXES.dct}description`), literal(`Edition lineage coverage recorded for this build: ${m.lineage_coverage}`, { lang: "eng" }));
  }

  add(agent, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.prov}SoftwareAgent`));
  add(agent, iri(`${PREFIXES.foaf}name`), literal("glossarist-server ingest", { lang: "eng" }));

  return rdfResponse(req, quads, PREFIXES, m.build_id);
}
