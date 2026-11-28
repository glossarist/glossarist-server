# Evidence — glossarist-server v1 (live 2026-11-27)

Deployment: https://vocab.oimlsmart.org (branded custom domain; same Cloudflare account as the worker) and https://glossarist-server.oimlsmart-06c.workers.dev (technical fallback).

## Wave 1 additions (live 2026-11-28)
- **Semantic search** (#36): 12,365 designation vectors (Workers AI bge-m3, 1024-dim, per-language Vectorize namespaces); `/v1/search?semantic=true` live; **cross-lingual verified** (English query → French designations, score 0.62; designation-level — definition-level embeddings sharpen it, noted as future work). MCP tool `search_concepts_semantic` live (protocol 2026-07-28 negotiation + git-dep interim pending the owner's v0.2.0 tag).
- **SHACL** (#33): `/ontologies/gloss-shacl` serves the generated 46-shape artifact (conneg; generation pipeline concept-model#96); ingest validation gate with honest statuses (pass / vacuous-pass — OIML aggregates are pure SKOS, pending the dual-typing decision glossarist-js#157 — / validator-unavailable).
- **/conformance** (#38): 12 ISO-19135-style classes with honest statuses and evidence links.
- **CIE tenant** (#40): cie-2011 (1,448) + cie-2020 (1,347) registers live; `/cie/` site; **cross-tenant SPARQL** (CIE + OIML in one queryable store).
- **Browser features** (#259/#260/#266): relation graph view (vim-2012 graph: 241 nodes / 1,165 edges live; three section-only registers honestly emit empty graphs with a projected-out explanation) and curation queues (per-register worklists: e.g. oiml-complete — 0 invalid / 6,031 missing translations / 6,031 without sources), both live at /vocab/ after the 45,073-file rebuild upload (4 passes: 1,055 → 6,460 → 58 → 0 failures, all rate-limit related).
- **/llms-full.txt** + **OpenAPI 3.1 completion** (21 paths, 5 schemas) + **AsyncAPI 3.0** (/mcp transport + planned webhook channels) + observability (Logs + Traces).
- **Engine** (sparql#17/#19–#21): subqueries, BIND, MINUS, EXISTS/NOT EXISTS → 21/26 = 81% coverage; bench suite (4.9 ms warm total).

## Golden suite (run against production)
**24 pass, 0 fail on both origins** (vocab.oimlsmart.org + workers.dev) — registers catalog, ETag/304, French search, refusal cases (empty query, syntax error, SPARQL DELETE, format-not-offered), honest no-hits, 404 Problem Details, SPARQL SELECT + French answer with real-binding assertions, MCP initialize + tools/list, DCAT (JSON-LD + Turtle), /prov, /ontologies (index + gloss JSON-LD/Turtle), static site (index via clean-URL fallback, 404 page, data Turtle) and API-404-stays-JSON.

Two production bugs the suite caught and killed: (1) If-None-Match used byte comparison while the runtime serves compressed responses with weakened validators — fixed to RFC 7232 weak comparison (#50); (2) directory URLs built a double-slash R2 key for the clean-URL index fallback, then served it as octet-stream — fixed at the mapping layer + fallback content-type (#51, #52).

## Latency (3 samples, 2026-11-27)
| Route | Cold | Warm |
|---|---|---|
| /v1/search?q=measurement | 29.9 s (isolate cold start + hydration) | 15–23 ms |
| /sparql (FILTER regex+lang over all registers) | 16.1 s (hydrate 11 aggregates from R2) | 18–33 ms |

Warm-isolate SPARQL at ~20 ms covers the full 8177-concept corpus. Cold-start improvement (lazy per-register hydration) is queued for Phase 2.

## SPARQL engine coverage (glossarist-sparql, W3C SPARQL 1.1 subset)
Denominator: a 26-item query-surface checklist appropriate to read-only vocabulary data access (query forms, solution modifiers, graph patterns, expressions, prologue).

| Family | Implemented | Missing (honest) |
|---|---|---|
| Query forms | SELECT, ASK, CONSTRUCT (3/4) | DESCRIBE |
| Graph patterns | BGP, OPTIONAL, UNION, VALUES, MINUS (5/5) | — |
| Solution composition | subqueries, BIND, EXISTS/NOT EXISTS (3/3) | — |
| Expressions | FILTER, &&, \|\|, !, regex/str/lang/datatype/bound, = != < > <= >= (3/3) | — |
| Solution modifiers | DISTINCT, ORDER BY ASC/DESC, LIMIT, OFFSET (4/4) | — |
| Prologue | PREFIX, BASE (2/2) | — |
| Datasets | — (0/2) | FROM, FROM NAMED/GRAPH (single-graph store by design) |
| Advanced | — (0/3) | property paths, aggregates/GROUP BY/HAVING |
| Projection | plain variables (1/1) | (expr AS ?var) — semantic need partly covered by BIND |

**Coverage after Wave 1 (glossarist-sparql#19–#21): 21/26 = 81%** of the defined read-access surface — subqueries, BIND, MINUS, EXISTS/NOT EXISTS added; a bench suite shipped (8 queries over a 5,000-quad fixture, 4.9 ms warm total; 49/49 engine tests green). Pre-Wave-1 figure corrected to 17/26 = 65% (the earlier "18/26" double-counted one row). The remaining 5 items — property paths and aggregates/GROUP BY/HAVING scheduled (#18); DESCRIBE; FROM/FROM NAMED require a multi-graph store redesign and are honestly unreachable on the current single-graph store. SPARQL UPDATE is out of scope permanently — the endpoint is read-only by design (writes go through the register procedure). Engine roadmap with runnable-gap notes: https://github.com/glossarist/docs/blob/main/cookbook/sparql-cookbook.md#5-engine-roadmap-honest-non-coverage. Two earlier gaps (`<=`/`>=`, unary `!`) were found by live-probing the production endpoint while verifying the cookbook and fixed in glossarist-sparql#14.

## Coverage
- Registers ingested: 11 (VIM 1984–2012 lineage, VIML 1968–2022, oiml-complete). g18-2010/g18-202X pending their site-config inclusion in oimlsmart/vocab (OIML's own consolidation work — tracked).
- Lineage coverage: 0 — reported honestly; edition supersession is not yet modeled in the datasets (OIML consolidation TODO).
- Concepts in the aggregates are typed `skos:Concept` (dual-typing `gloss:Concept` is an owner decision tracked in glossarist-js#157).

## Architecture note (parity)
Per-concept artifacts (json/ttl/tbx/jsonld/yaml) are served by the tenant's static host (today: oimlsmart.github.io/vocab, mirrored at www.oimlsmart.org/vocab) — `/id` IRIs and RDF-form requests 303 to them. The Worker serves aggregates (R2), the full dynamic API, SPARQL, MCP, /dcat, /prov, /ontologies, and the site upgrade path (#25: R2-backed static streaming — Workers Static Assets ruled out by the 45,130-file/576 MB build). Per-concept R2 mirroring is a Phase-2 option.
