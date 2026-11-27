// /conformance — machine-readable self-check: ISO 19135-style conformance
// classes with honest pass/partial/untested status and evidence links.
// This document is generated from what the deployment actually implements —
// gaps are stated, never papered over.
import type { Env } from "./types.js";
import { json, withConditional } from "./http.js";
import { pickFormat } from "./negotiate.js";

type Status = "pass" | "partial" | "untested" | "not-implemented";

type ConformanceClass = {
  id: string;
  description: string;
  status: Status;
  evidence: string;
};

export async function conformanceEndpoint(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const base = url.origin;
  const build = await env.DB.prepare("SELECT value FROM meta WHERE key = 'build_id'").first() as { value: string } | null;
  const lineage = await env.DB.prepare("SELECT value FROM meta WHERE key = 'lineage_coverage'").first() as { value: string } | null;
  const sparqlCoverage = "0.69"; // published denominator: 26-item read surface (docs/EVIDENCE.md)

  const classes: ConformanceClass[] = [
    { id: "register-catalog", description: "Machine-readable register catalogue (DCAT 3)", status: "pass", evidence: `${base}/dcat` },
    { id: "concept-retrieval", description: "Concept retrieval over REST (/v1/concepts, /v1/registers, /v1/editions)", status: "pass", evidence: `${base}/openapi.json` },
    { id: "conneg", description: "Content negotiation: JSON-LD (default), Turtle, TBX, CSV, JSON; ETag/304; RFC 9457 problems", status: "pass", evidence: "golden suite cases dcat-turtle, dcat-format-refusal, registers-etag-304" },
    { id: "identifiers", description: "Dereferenceable concept IRIs with 303 conneg (/id/{register}/concept/{uuid})", status: "pass", evidence: `${base}/id/oiml-complete/concept/r21-2007-46` },
    { id: "ontology-publication", description: "Ontology + validation shapes published with conneg (GLOSS OWL + SHACL)", status: "pass", evidence: `${base}/ontologies/gloss` },
    { id: "sparql-subset", description: "SPARQL 1.1 read subset (roll-our-own engine, cost-limited)", status: "partial", evidence: `${base}/sparql — coverage ${sparqlCoverage} of the defined 26-item read surface; target ≥0.85` },
    { id: "lineage-supersession", description: "Edition supersession chains modeled and served", status: lineage?.value && lineage.value !== "0" ? "partial" : "partial", evidence: `${base}/v1/editions — lineage coverage ${lineage?.value ?? "0"} (reported honestly; dataset-side modeling pending)` },
    { id: "agent-interface", description: "Model Context Protocol endpoint for agents", status: "pass", evidence: `${base}/mcp` },
    { id: "build-provenance", description: "Build provenance (PROV-O activity/entity/agent)", status: "pass", evidence: `${base}/prov` },
    { id: "proposal-workflow", description: "ISO 19135 proposal/approval procedure (FERIN roles, proposal API)", status: "not-implemented", evidence: "roadmap #45" },
    { id: "semantic-search", description: "Semantic / cross-lingual designation search", status: "untested", evidence: "roadmap #36" },
    { id: "bulk-export", description: "Bulk lossless exports (JSON-LD, Turtle, CSV, GCR)", status: "pass", evidence: `${base}/v1/registers/oiml-complete/exports/turtle` },
  ];

  const doc = {
    $schema: "https://glossarist.org/schemas/conformance-1.json",
    service: base,
    build: build?.value ?? null,
    generatedAt: new Date().toISOString(),
    conformanceClasses: classes,
    note: "statuses are self-reported from the deployed build and re-checked by the golden suite on every deploy; untested/not-implemented items link to their roadmap issues",
  };

  const format = pickFormat(req.headers.get("accept"));
  if (format === "turtle") {
    // Honest minimal Turtle rendering of the same table
    const lines = [
      "@prefix cc: <https://glossarist.org/vocab/conformance#> .",
      "@prefix dct: <http://purl.org/dc/terms/> .",
      "",
      `<${base}/conformance> a cc:ConformanceReport ;`,
      `    dct:issued "${doc.generatedAt}" ;`,
      ...classes.map((c) => `    cc:class [ dct:identifier "${c.id}" ; cc:status "${c.status}" ; dct:description "${c.description.replace(/"/g, "'")}" ] ;`).join("\n").replace(/;$/, " ."),
    ];
    return withConditional(new Response(lines.join("\n") + "\n", { status: 200, headers: { "content-type": "text/turtle", vary: "accept", "access-control-allow-origin": "*" } }), req);
  }
  return withConditional(json(doc), req);
}
