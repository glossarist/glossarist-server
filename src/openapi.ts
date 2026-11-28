// /openapi.json — full OpenAPI 3.1 description of the /v1 REST surface:
// schemas, parameters, examples per endpoint. Single source for clients and
// the AI-crawler index; kept in step with the route table by construction
// (both live in this deployment).
import { json } from "./http.js";

const problem = {
  type: "object",
  description: "RFC 9457 Problem Details",
  required: ["type", "title", "status"],
  properties: {
    type: { type: "string", description: "URI identifying the problem type, e.g. https://glossarist.org/problems/not_found" },
    title: { type: "string" },
    status: { type: "number" },
    detail: { type: "string" },
  },
};

const register = {
  type: "object",
  required: ["id", "title", "uri_base", "concept_count"],
  properties: {
    id: { type: "string", examples: ["vim-2012"] },
    title: { type: "string" },
    subtitle: { type: ["string", "null"] },
    uri_base: { type: "string", description: "Canonical published base of the register's artifacts" },
    languages: { type: "string", description: "JSON array of ISO 639-2 codes, e.g. [\"deu\",\"eng\",\"fra\",\"pol\",\"spa\"]" },
    concept_count: { type: "number" },
    edition: { type: ["string", "null"], description: "Edition year" },
    series: { type: ["string", "null"], description: "Edition series id, e.g. vim" },
    domain: { type: ["string", "null"] },
  },
};

const conceptSummary = {
  type: "object",
  required: ["uuid", "identifier", "status"],
  properties: {
    uuid: { type: "string", examples: ["1.1"] },
    identifier: { type: ["string", "null"] },
    status: { type: "string", enum: ["valid", "superseded", "retired"] },
    title_eng: { type: ["string", "null"] },
  },
};

const conceptEntry = {
  type: "object",
  properties: {
    register: { type: "string" },
    uuid: { type: "string" },
    identifier: { type: ["string", "null"] },
    status: { type: "string" },
    title_eng: { type: ["string", "null"] },
    designations: { type: "object", description: "language code → designation", additionalProperties: { type: "string" }, examples: [{ eng: "quantity", fra: "grandeur" }] },
    relations: { type: "array", items: { type: "object", properties: { subject: { type: "string" }, predicate: { type: "string" }, object: { type: "string" } } } },
    sources: { type: "array", items: { type: "object", properties: { urn: { type: "string" }, clause: { type: ["string", "null"] }, kind: { type: ["string", "null"] } } } },
    lineage: { type: "object", properties: { entries: { type: "array", items: { type: "object", properties: { from_uuid: { type: "string" }, to_uuid: { type: "string" }, kind: { type: "string" } } } }, coverage_note: { type: "string" } } },
    artifacts: { type: "object", description: "Published lossless artifacts (303 targets)", properties: { jsonld: { type: "string" }, ttl: { type: "string" }, tbx: { type: "string" } } },
  },
};

const searchHits = {
  type: "object",
  required: ["query", "hits"],
  properties: {
    query: { type: "string" },
    semantic: { type: "boolean", description: "true when vector search served the query" },
    hits: {
      type: "array",
      items: {
        type: "object",
        properties: {
          register: { type: "string" },
          uuid: { type: "string" },
          lang: { type: "string" },
          designation: { type: "string" },
          normative_status: { type: ["string", "null"] },
          identifier: { type: ["string", "null"] },
          score: { type: "number", description: "semantic relevance (0 for keyword hits)" },
        },
      },
    },
  },
};

function p(name: string, where: "path" | "query", required = false, description?: string) {
  return { name, in: where, required, schema: { type: "string" }, ...(description ? { description } : {}) };
}
const ok = (description: string) => ({ "200": { description, content: { "application/json": {} } } });
const notFound = { "404": { description: "Problem Details", content: { "application/problem+json": {} } } };

export function openapiDocument(origin: string): Record<string, unknown> {
  return {
    openapi: "3.1.0",
    info: {
      title: "Glossarist Vocab API",
      version: "1.1.0",
      description: "Machine access to glossarist terminology registers. JSON-LD-first: every JSON response is also available as Turtle, TBX or CSV where meaningful (content negotiation; Accept header). RDF/TBX forms of concepts are 303 pointers to the published lossless artifacts. Errors are RFC 9457 Problem Details. Also here: /sparql (SPARQL 1.1 subset, read-only), /mcp (Model Context Protocol), /dcat, /prov, /ontologies, /conformance, /asyncapi.json (streaming + webhook surface).",
      contact: { name: "Glossarist", url: "https://glossarist.org" },
      license: { name: "BSD-2-Clause" },
    },
    servers: [{ url: origin }],
    paths: {
      "/v1/registers": { get: { summary: "Register catalog", responses: { ...ok("Register list"), "200": { description: "ok", content: { "application/json": { schema: { type: "object", required: ["registers"], properties: { registers: { type: "array", items: { "$ref": "#/components/schemas/Register" } } } } } } } } } },
      "/v1/registers/{id}": { get: { summary: "Register manifest + build metadata", parameters: [p("id", "path", true)], responses: { ...ok("Register + meta"), "404": notFound } } },
      "/v1/registers/{id}/concepts": {
        get: { summary: "Paged concept index", parameters: [p("id", "path", true), p("lang", "query", false, "filter: has designation in language"), p("status", "query"), p("cursor", "query", false, "opaque cursor from next_cursor"), p("limit", "query")], responses: { ...ok("Page + next_cursor"), "404": notFound } },
      },
      "/v1/concepts/{uuid}": { get: { summary: "Full concept entry (structured view)", parameters: [p("uuid", "path", true), p("register", "query", true)], responses: { ...ok("ConceptEntry"), "404": notFound } } },
      "/v1/concepts/{uuid}/lineage": { get: { summary: "Edition supersession chain (honest empty when unmodeled)", parameters: [p("uuid", "path", true), p("register", "query")], responses: ok("Lineage") } },
      "/v1/concepts/{uuid}/relations": { get: { summary: "Typed relations, incoming + outgoing", parameters: [p("uuid", "path", true), p("register", "query"), p("direction", "query", false, "either | outgoing | incoming")], responses: ok("Relations") } },
      "/v1/search": { get: { summary: "Designation search (keyword, or semantic when semantic=true)", parameters: [p("q", "query", true), p("semantic", "query", false, "true = vector search; cross-lingual when lang omitted"), p("lang", "query"), p("register", "query"), p("limit", "query")], responses: { ...ok("SearchHits"), "400": { description: "Problem Details (q required)" } } } },
      "/v1/suggest": { get: { summary: "Designation autocomplete", parameters: [p("q", "query", true)], responses: ok("Suggestions") } },
      "/v1/editions": { get: { summary: "Edition series (e.g. VIM 1984-2012)", parameters: [p("lineage", "query", false, "series id")], responses: ok("Series") } },
      "/v1/sources/{urn}": { get: { summary: "Citation resolution", parameters: [p("urn", "path", true), p("register", "query")], responses: { ...ok("Records"), "404": notFound } } },
      "/v1/registers/{id}/exports/{format}": { get: { summary: "Bulk lossless export", parameters: [p("id", "path", true), { name: "format", in: "path", required: true, schema: { type: "string", enum: ["jsonld", "turtle", "csv", "gcr"] } }], responses: { "200": { description: "File stream (content-disposition attachment)" }, "404": notFound } } },
      "/id/{register}/concept/{uuid}": { get: { summary: "Dereferenceable concept IRI (FAIR identifier; RDF forms 303 to published artifacts)", parameters: [p("register", "path", true), p("uuid", "path", true)], responses: { "200": { description: "JSON view" }, "303": { description: "Redirect to artifact" }, "404": notFound } } },
      "/dcat": { get: { summary: "DCAT 3 catalog (JSON-LD default, Turtle via conneg)", responses: { "200": { description: "Catalog" }, "406": { description: "Format not offered" } } } },
      "/prov": { get: { summary: "PROV-O build provenance", responses: ok("Provenance") } },
      "/ontologies": { get: { summary: "Ontology artifact index", responses: ok("Index") } },
      "/ontologies/{id}": { get: { summary: "Ontology document (GLOSS OWL / SHACL shapes; conneg)", parameters: [p("id", "path", true)], responses: { ...ok("Document"), "404": notFound } } },
      "/conformance": { get: { summary: "Machine-readable conformance classes (self-checked)", responses: ok("ConformanceReport") } },
      "/sparql": { get: { summary: "SPARQL 1.1 subset (read-only, cost-limited)", parameters: [p("query", "query", true, "URL-encoded SPARQL; SELECT/ASK return SPARQL-JSON, CONSTRUCT returns Turtle")], responses: { "200": { description: "Results" }, "400": { description: "Problem Details (syntax / write refusal)" } } } },
      "/mcp": { post: { summary: "Model Context Protocol over Streamable HTTP (see /asyncapi.json)", responses: { "200": { description: "JSON-RPC response or SSE stream" } } } },
      "/llms.txt": { get: { summary: "AI-crawler index", responses: ok("Text") } },
      "/asyncapi.json": { get: { summary: "AsyncAPI 3.0: MCP transport + webhook channels", responses: ok("AsyncAPI") } },
    },
    components: {
      schemas: {
        Register: register,
        ConceptSummary: conceptSummary,
        ConceptEntry: conceptEntry,
        SearchHits: searchHits,
        Problem: problem,
      },
    },
    tags: [
      { name: "registers" }, { name: "concepts" }, { name: "search" }, { name: "rdf" }, { name: "agents" },
    ],
  };
}

export async function openapiEndpoint(req: Request): Promise<Response> {
  return json(openapiDocument(new URL(req.url).origin));
}
