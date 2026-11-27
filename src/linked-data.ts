// Shared helpers for RDF document routes (/dcat, /prov, /ontologies):
// build a quad graph once, then negotiate the wire form — JSON-LD (default)
// or Turtle, per the same Accept policy as the rest of the API.
import { toJsonld, serializeTurtle, type Quad } from "glossarist-sparql";
import { pickFormat, contentTypeFor } from "./negotiate.js";
import { problem } from "./http.js";

export const PREFIXES: Record<string, string> = {
  dcat: "http://www.w3.org/ns/dcat#",
  dct: "http://purl.org/dc/terms/",
  foaf: "http://xmlns.com/foaf/0.1/",
  prov: "http://www.w3.org/ns/prov#",
  rdf: "http://www.w3.org/1999/02/22-rdf-syntax-ns#",
  xsd: "http://www.w3.org/2001/XMLSchema#",
};

function etagFor(body: string): string {
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0;
  return `"${(h >>> 0).toString(16)}"`;
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, HEAD, OPTIONS",
  "access-control-allow-headers": "Accept, Authorization",
};

/** Serialize a quad graph as JSON-LD (default) or Turtle; 406 for other formats. */
export function rdfResponse(req: Request, quads: Quad[], context: Record<string, string> = PREFIXES, cacheKey = ""): Response {
  const format = pickFormat(req.headers.get("accept"));
  if (format !== "jsonld" && format !== "turtle" && format !== "json") {
    return problem(406, "format_not_offered", "This document is offered as JSON-LD or Turtle only", `Accept: ${req.headers.get("accept") ?? ""}`);
  }
  let body: string;
  let type: string;
  if (format === "turtle") {
    body = serializeTurtle(quads, context);
    type = contentTypeFor("turtle");
  } else {
    body = JSON.stringify(toJsonld(quads, context));
    type = format === "json" ? contentTypeFor("json") : contentTypeFor("jsonld");
  }
  return new Response(body, {
    status: 200,
    headers: { "content-type": type, etag: etagFor(cacheKey + body), vary: "accept", ...CORS },
  });
}
