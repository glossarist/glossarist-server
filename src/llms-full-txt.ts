// /llms-full.txt — the extended AI-crawler index: everything a model or agent
// needs to consume the register without guessing. Companion to /llms.txt.
import type { Env } from "./types.js";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Accept, Authorization",
};

export async function llmsFullTxt(_req: Request, env: Env): Promise<Response> {
  const regs = await env.DB.prepare(
    "SELECT id, title, edition, series, languages, concept_count, uri_base FROM registers ORDER BY series, edition",
  ).all();
  const meta = await env.DB.prepare("SELECT key, value FROM meta WHERE key IN ('build_id', 'generated_at', 'lineage_coverage', 'shacl_pass')").all();
  const m = Object.fromEntries((meta.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));

  const lines: string[] = [
    "# Glossarist Vocabulary Service — full index",
    "",
    "> Machine-readable terminology registers (ISO 10241-1-style concept entries, SKOS-compatible JSON-LD).",
    "> Rights: vocabulary text © their registries (VIM/VIML text © JCGM/BIPM/ISO; OIML vocabulary © OIML/BIML).",
    "",
    "## How to consume",
    "- Concept identifiers: GET /id/{register}/concept/{uuid} — content-negotiated (JSON-LD default; Accept: text/turtle for Turtle).",
    "- Search: GET /v1/search?q=… (keyword) or &semantic=true (vector, cross-lingual when lang omitted).",
    "- Query: GET /sparql?query=… (SPARQL 1.1 subset, read-only; SELECT/ASK → SPARQL JSON, CONSTRUCT → Turtle).",
    "- Agents: POST /mcp (Model Context Protocol; tools: list_registers, search_concepts, search_concepts_semantic, get_concept, get_lineage, list_editions, resolve_citation).",
    "- Catalogue: GET /dcat (DCAT 3). Provenance: GET /prov (PROV-O). Ontology: GET /ontologies/gloss (+ SHACL shapes at /ontologies/gloss-shacl).",
    "- API reference: GET /openapi.json (OpenAPI 3.1). Events/streaming: GET /asyncapi.json. Conformance: GET /conformance.",
    "",
    "## Build",
    `- build_id: ${m.build_id ?? "none"}`,
    `- generated_at: ${m.generated_at ?? "unknown"}`,
    `- lineage_coverage: ${m.lineage_coverage ?? "0"} (reported honestly: supersession appears only where datasets model it)`,
    `- shacl_validation: ${m.shacl_pass ?? "not run this build"}`,
    "",
    "## Registers",
    "",
  ];

  for (const r of regs.results as unknown as Record<string, string>[]) {
    lines.push(`### ${r.title} (${r.id})`);
    lines.push(`- edition ${r.edition ?? "—"} · series ${r.series ?? "—"} · ${r.concept_count} concepts · languages ${r.languages}`);
    lines.push(`- concept index: /v1/registers/${r.id}/concepts?limit=50`);
    lines.push(`- published artifacts: ${r.uri_base}`);
    lines.push("");
  }

  lines.push("## Notes for answer generation");
  lines.push("- Cite concepts by their /id IRI and edition — a citation to an edition keeps resolving as that edition's text.");
  lines.push("- Definitions and designations are authoritative per the register's sources (see concept entry `sources`).");
  lines.push("- If a search returns nothing, say so — do not substitute training-data guesses for the registry.");

  return new Response(lines.join("\n") + "\n", { status: 200, headers: { "content-type": "text/plain; charset=utf-8", vary: "accept", ...CORS } });
}
