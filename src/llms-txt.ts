// /llms.txt — the AI-discovery surface for this deployment.
import type { Env } from "./types.js";
import { json } from "./http.js";

export async function llmsTxt(_req: Request, env: Env): Promise<Response> {
  const regs = await env.DB.prepare("SELECT id, title, concept_count FROM registers ORDER BY id").all();
  const lines = [
    "# Glossarist Server",
    "",
    "Machine-readable terminology registers (glossarist v3 model; SKOS-compatible JSON-LD).",
    "",
    "## Surfaces",
    "- [Vocab API](/openapi.json): REST over registers, concepts, lineage, relations, sources, exports",
    "- [SPARQL endpoint](/sparql): SPARQL 1.1 subset (read-only) — GET /sparql?query=…",
    "- [MCP](/mcp): Model Context Protocol over Streamable HTTP (JSON-RPC 2.0)",
    "- [Concept IRIs](/id/{register}/concept/{uuid}): dereferenceable, content-negotiated",
    "",
    "## Registers",
    ...((regs.results as { id: string; title: string; concept_count: number }[]).map(
      (r) => `- [${r.title ?? r.id}](/v1/registers/${r.id}/concepts?limit=50): ${r.concept_count} concepts`,
    )),
    "",
    "All data © their registers' owners — see /dcat and each register's rights metadata.",
  ];
  return new Response(lines.join("\n"), { headers: { "content-type": "text/plain; charset=utf-8" } });
}
