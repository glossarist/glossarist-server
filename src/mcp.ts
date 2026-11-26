// /mcp — MCP over Streamable HTTP (JSON-RPC 2.0, protocol 2025-06-18).
// Tools from the glossarist-mcp package; backend reads D1 directly.
import { createMcpHandler, MCP_TOOL_SCHEMAS, type Backend } from "glossarist-mcp";
import type { Env } from "./types.js";

class D1Backend implements Backend {
  constructor(private readonly env: Env) {}

  async listRegisters() {
    const rows = await this.env.DB.prepare(
      "SELECT id, title, subtitle, uri_base, languages, concept_count, edition, series FROM registers ORDER BY series, edition",
    ).all();
    return rows.results as unknown as Awaited<ReturnType<Backend["listRegisters"]>>;
  }

  async searchConcepts(q: string, opts?: { lang?: string; register?: string; limit?: number }) {
    const like = `%${q.replace(/[%_]/g, "")}%`;
    const rows = await this.env.DB.prepare(
      `SELECT register, uuid, identifier, lang, designation, status FROM designations
       JOIN concepts ON concepts.register = designations.register AND concepts.uuid = designations.uuid
       WHERE designation LIKE ? ${opts?.lang ? "AND lang = ?" : ""} ${opts?.register ? "AND designations.register = ?" : ""}
       ORDER BY designation LIMIT ?`,
    ).bind(
      like,
      ...(opts?.lang ? [opts.lang] : []),
      ...(opts?.register ? [opts.register] : []),
      Math.min(opts?.limit ?? 25, 100),
    ).all();
    return (rows.results as Record<string, string>[]).map((r) => ({
      register: r.register, uuid: r.uuid, identifier: r.identifier, designation: r.designation, lang: r.lang, status: r.status,
    }));
  }

  async getConcept(uuid: string, register: string) {
    const row = await this.env.DB.prepare(
      "SELECT uuid, identifier, status, title_eng FROM concepts WHERE register = ? AND uuid = ?",
    ).bind(register, uuid).first();
    if (!row) return null;
    const designations = await this.env.DB.prepare(
      "SELECT lang, designation FROM designations WHERE register = ? AND uuid = ?",
    ).bind(register, uuid).all();
    const relations = await this.env.DB.prepare(
      "SELECT subject, predicate, object FROM relations WHERE register = ? AND (subject = ? OR object = ?)",
    ).bind(register, uuid, uuid).all();
    const sources = await this.env.DB.prepare(
      "SELECT urn, clause, kind FROM concept_sources WHERE register = ? AND uuid = ?",
    ).bind(register, uuid).all();
    const reg = await this.env.DB.prepare("SELECT uri_base FROM registers WHERE id = ?").bind(register).first() as { uri_base: string } | null;
    return {
      register,
      uuid: String(row.uuid),
      identifier: (row.identifier as string) ?? null,
      status: (row.status as string) ?? "valid",
      designations: Object.fromEntries((designations.results as { lang: string; designation: string }[]).map((d) => [d.lang, d.designation])),
      relations: relations.results as { subject: string; predicate: string; object: string }[],
      sources: sources.results as { urn: string; clause: string | null; kind: string | null }[],
      artifacts: reg?.uri_base ? {
        jsonld: `${reg.uri_base}/data/${register}/concepts/${uuid}.jsonld`,
        ttl: `${reg.uri_base}/data/${register}/concepts/${uuid}.ttl`,
        tbx: `${reg.uri_base}/data/${register}/concepts/${uuid}.tbx`,
      } : undefined,
    };
  }

  async getLineage(uuid: string, register: string) {
    const rows = await this.env.DB.prepare(
      "SELECT from_uuid, to_uuid, kind, note FROM lineage WHERE register = ? AND (from_uuid = ? OR to_uuid = ?)",
    ).bind(register, uuid, uuid).all();
    const coverage = await this.env.DB.prepare("SELECT value FROM meta WHERE key = 'lineage_coverage'").first() as { value: string } | null;
    return { lineage: rows.results, lineage_coverage: coverage?.value ?? "0", note: "edition supersession appears here only where the dataset models it" };
  }

  async resolveCitation(urn: string, register?: string) {
    const rows = await this.env.DB.prepare(
      `SELECT register, record FROM sources WHERE urn = ? ${register ? "AND register = ?" : ""}`,
    ).bind(...(register ? [urn, register] : [urn])).all();
    if (rows.results.length === 0) return null;
    return { urn, records: (rows.results as { register: string; record: string }[]).map((r) => ({ register: r.register, record: JSON.parse(r.record) })) };
  }
}

export async function mcpEndpoint(req: Request, env: Env): Promise<Response> {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ jsonrpc: "2.0", error: { code: -32000, message: "POST with a JSON-RPC 2.0 body (initialize, tools/list, tools/call)" } }), {
      status: 405,
      headers: { "content-type": "application/json", "allow": "POST", "access-control-allow-origin": "*" },
    });
  }
  let body: unknown;
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }), { status: 400, headers: { "content-type": "application/json" } });
  }
  const handle = createMcpHandler(new D1Backend(env));
  const response = await handle(body);
  if (response === null) return new Response(null, { status: 202 });
  return new Response(JSON.stringify(response), { headers: { "content-type": "application/json", "access-control-allow-origin": "*" } });
}

export { MCP_TOOL_SCHEMAS };
