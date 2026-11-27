# Evidence — glossarist-server v1 (live 2026-11-27)

Deployment: https://vocab.oimlsmart.org (branded custom domain; same Cloudflare account as the worker) and https://glossarist-server.oimlsmart-06c.workers.dev (technical fallback).

## Golden suite (run against production)
11 pass, 0 fail on both origins — registers catalog, French search, refusal cases (empty query, syntax error, SPARQL DELETE attempt), honest no-hits, 404 Problem Details, SPARQL SELECT + French answer, MCP initialize + tools/list. The suite grows to 21 cases with PR #27 (DCAT/PROV/ontologies conneg, ETag+304, format refusals).

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
| Graph patterns | BGP, OPTIONAL, UNION, VALUES (4/5) | MINUS |
| Expressions | FILTER, &&, \|\|, !, regex/str/lang/datatype/bound, = != < > <= >= (3/3) | — |
| Solution modifiers | DISTINCT, ORDER BY ASC/DESC, LIMIT, OFFSET (4/4) | — |
| Prologue | PREFIX, BASE (2/2) | — |
| Datasets | — (0/2) | FROM, FROM NAMED/GRAPH (single-graph store by design) |
| Advanced | — (0/5) | subqueries, BIND, EXISTS/NOT EXISTS, property paths, aggregates/GROUP BY/HAVING |
| Projection | plain variables (0/1) | (expr AS ?var) |

**Coverage: 18/26 = 69% of the defined read-access surface.** SPARQL UPDATE is out of scope permanently — the endpoint is read-only by design (writes go through the register procedure). Roadmap: https://github.com/glossarist/docs/blob/main/cookbook/sparql-cookbook.md#5-engine-roadmap-honest-non-coverage. Two gaps (`<=`/`>=`, unary `!`) were found by live-probing the production endpoint while verifying the cookbook and fixed in glossarist-sparql#14 (0.1.1). 31/31 engine tests; cookbook queries executed live.

## Coverage
- Registers ingested: 11 (VIM 1984–2012 lineage, VIML 1968–2022, oiml-complete). g18-2010/g18-202X pending their site-config inclusion in oimlsmart/vocab (OIML's own consolidation work — tracked).
- Lineage coverage: 0 — reported honestly; edition supersession is not yet modeled in the datasets (OIML consolidation TODO).
- Concepts in the aggregates are typed `skos:Concept` (dual-typing `gloss:Concept` is an owner decision tracked in glossarist-js#157).

## Architecture note (parity)
Per-concept artifacts (json/ttl/tbx/jsonld/yaml) are served by the tenant's static host (today: oimlsmart.github.io/vocab, mirrored at www.oimlsmart.org/vocab) — `/id` IRIs and RDF-form requests 303 to them. The Worker serves aggregates (R2), the full dynamic API, SPARQL, MCP, /dcat, /prov, /ontologies, and the site upgrade path (#25: R2-backed static streaming — Workers Static Assets ruled out by the 45,130-file/576 MB build). Per-concept R2 mirroring is a Phase-2 option.
