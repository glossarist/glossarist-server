import { describe, expect, it } from "vitest";
import { rdfResponse } from "../src/linked-data.js";
import { PREFIXES } from "../src/linked-data.js";
import { iri, literal, type Quad } from "glossarist-sparql";

const QUADS: Quad[] = [
  { s: iri("https://example.org/cat"), p: iri("http://www.w3.org/1999/02/22-rdf-syntax-ns#type"), o: iri("http://www.w3.org/ns/dcat#Catalog") },
  { s: iri("https://example.org/cat"), p: iri("http://purl.org/dc/terms/rights"), o: literal("© JCGM/BIPM/ISO", { lang: "eng" }) },
];

describe("rdfResponse (conneg over quads)", () => {
  const req = (accept: string) => new Request("https://x/dcat", { headers: { accept } });

  it("emits compact JSON-LD by default", () => {
    const res = rdfResponse(req("application/ld+json"), QUADS, PREFIXES);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/ld+json");
    expect(res.headers.get("vary")).toContain("accept");
  });

  it("emits Turtle on request", async () => {
    const res = rdfResponse(req("text/turtle"), QUADS, PREFIXES);
    expect(res.headers.get("content-type")).toContain("text/turtle");
    const body = await res.text();
    expect(body).toContain("@prefix");
    expect(body).toContain("dcat:Catalog");
  });

  it("refuses formats it does not offer", () => {
    const res = rdfResponse(req("text/csv"), QUADS, PREFIXES);
    expect(res.status).toBe(406);
    expect(res.headers.get("content-type")).toContain("problem+json");
  });
});
