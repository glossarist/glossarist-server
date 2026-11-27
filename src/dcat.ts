// /dcat — DCAT 3 catalog of the service: one dcat:Catalog listing every
// register as a dcat:Dataset with per-format dcat:Distributions, plus
// dcat:DataService entries for the API and the SPARQL endpoint.
// Rights statements are mandatory and honest; no license is asserted
// (licensing terms are an owner decision — only © statements are made).
import { iri, literal, type Quad, type Term } from "glossarist-sparql";
import type { Env } from "./types.js";
import { problem } from "./http.js";
import { rdfResponse, PREFIXES } from "./linked-data.js";

const RIGHTS =
  "© OIML/BIML. Vocabulary content © OIML/BIML; VIM/VIML vocabulary text © JCGM/BIPM/ISO as applicable.";
const EXPORT_FORMATS: { slug: string; media: string }[] = [
  { slug: "jsonld", media: "application/ld+json" },
  { slug: "turtle", media: "text/turtle" },
  { slug: "csv", media: "text/csv" },
];

type RegRow = {
  id: string; title: string; subtitle: string | null; uri_base: string;
  languages: string; concept_count: number; edition: string | null;
};

export async function dcatEndpoint(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const base = url.origin;
  const regs = await env.DB.prepare(
    "SELECT id, title, subtitle, uri_base, languages, concept_count, edition FROM registers ORDER BY series, edition",
  ).all();
  const meta = await env.DB.prepare("SELECT key, value FROM meta WHERE key IN ('build_id', 'generated_at')").all();
  const m = Object.fromEntries((meta.results as { key: string; value: string }[]).map((r) => [r.key, r.value]));
  if (!m.build_id) return problem(503, "not_ingested", "No build ingested yet");

  const quads: Quad[] = [];
  const add = (s: Term, p: Term, o: Term) => quads.push({ s, p, o });
  const lit = (v: string, lang = "eng") => literal(v, { lang });
  const date = (v: string, dt: string) => literal(v, { datatype: `${PREFIXES.xsd}${dt}` });
  const cat = iri(`${base}/dcat`);
  const datasetIri = (id: string) => iri(`${base}/dcat#dataset/${id}`);

  add(cat, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.dcat}Catalog`));
  add(cat, iri(`${PREFIXES.dct}title`), lit("OIML Vocabulary — machine catalog"));
  add(cat, iri(`${PREFIXES.dct}description`), lit("DCAT catalog of the Glossarist vocabulary service: registers, editions, distributions, and query services."));
  add(cat, iri(`${PREFIXES.dct}rights`), lit(RIGHTS));
  add(cat, iri(`${PREFIXES.dct}issued`), date((m.generated_at ?? "").slice(0, 10) || "1970-01-01", "date"));
  add(cat, iri(`${PREFIXES.foaf}homepage`), iri(`${base}/`));

  const publisher = iri(`${base}/dcat#publisher`);
  add(cat, iri(`${PREFIXES.dct}publisher`), publisher);
  add(publisher, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.foaf}Agent`));
  add(publisher, iri(`${PREFIXES.foaf}name`), lit("OIML — International Organization of Legal Metrology (BIML)"));
  add(publisher, iri(`${PREFIXES.foaf}homepage`), iri("https://www.oiml.org"));

  const datasetIris: Term[] = [];
  for (const r of regs.results as unknown as RegRow[]) {
    const ds = datasetIri(r.id);
    datasetIris.push(ds);
    add(cat, iri(`${PREFIXES.dcat}dataset`), ds);
    add(ds, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.dcat}Dataset`));
    add(ds, iri(`${PREFIXES.dct}title`), lit(r.title));
    if (r.subtitle) add(ds, iri(`${PREFIXES.dct}description`), lit(r.subtitle));
    add(ds, iri(`${PREFIXES.dct}rights`), lit(RIGHTS));
    if (r.edition) add(ds, iri(`${PREFIXES.dct}issued`), date(r.edition, "gYear"));
    for (const lang of JSON.parse(r.languages || "[]") as string[]) {
      add(ds, iri(`${PREFIXES.dct}language`), iri(`http://id.loc.gov/vocabulary/iso639-2/${lang}`));
    }
    if (r.uri_base) add(ds, iri(`${PREFIXES.dcat}landingPage`), iri(r.uri_base));
    for (const f of EXPORT_FORMATS) {
      const dist = iri(`${base}/dcat#dist/${r.id}/${f.slug}`);
      add(ds, iri(`${PREFIXES.dcat}distribution`), dist);
      add(dist, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.dcat}Distribution`));
      add(dist, iri(`${PREFIXES.dct}title`), lit(`${r.title} — ${f.slug} export`));
      add(dist, iri(`${PREFIXES.dct}format`), iri(`https://www.iana.org/assignments/media-types/${f.media}`));
      add(dist, iri(`${PREFIXES.dcat}accessURL`), iri(`${base}/v1/registers/${r.id}/exports/${f.slug}`));
      add(dist, iri(`${PREFIXES.dct}rights`), lit(RIGHTS));
    }
  }

  const sparqlService = iri(`${base}/sparql#service`);
  add(cat, iri(`${PREFIXES.dcat}service`), sparqlService);
  add(sparqlService, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.dcat}DataService`));
  add(sparqlService, iri(`${PREFIXES.dct}title`), lit("SPARQL endpoint (roll-our-own engine, read-only)"));
  add(sparqlService, iri(`${PREFIXES.dcat}endpointURL`), iri(`${base}/sparql`));
  add(sparqlService, iri(`${PREFIXES.dcat}endpointDescription`), iri(`${base}/openapi.json`));
  for (const d of datasetIris) add(sparqlService, iri(`${PREFIXES.dcat}servesDataset`), d);

  const apiService = iri(`${base}/dcat#api-service`);
  add(cat, iri(`${PREFIXES.dcat}service`), apiService);
  add(apiService, iri(`${PREFIXES.rdf}type`), iri(`${PREFIXES.dcat}DataService`));
  add(apiService, iri(`${PREFIXES.dct}title`), lit("Glossarist Vocab API"));
  add(apiService, iri(`${PREFIXES.dcat}endpointURL`), iri(`${base}/v1`));
  add(apiService, iri(`${PREFIXES.dcat}endpointDescription`), iri(`${base}/openapi.json`));
  for (const d of datasetIris) add(apiService, iri(`${PREFIXES.dcat}servesDataset`), d);

  return rdfResponse(req, quads, PREFIXES, m.build_id);
}
