# Evidence — glossarist-server v1 (live 2026-11-27)

Deployment: https://glossarist-server.oimlsmart-06c.workers.dev (OIML Cloudflare account)

## Golden suite (run against production)
11 pass, 0 fail — registers catalog, French search, refusal cases (empty query, syntax error, SPARQL DELETE attempt), honest no-hits, 404 Problem Details, SPARQL SELECT + French answer, MCP initialize + tools/list.

## Latency (3 samples, 2026-11-27)
| Route | Cold | Warm |
|---|---|---|
| /v1/search?q=measurement | 29.9 s (isolate cold start + hydration) | 15–23 ms |
| /sparql (FILTER regex+lang over all registers) | 16.1 s (hydrate 11 aggregates from R2) | 18–33 ms |

Warm-isolate SPARQL at ~20 ms covers the full 8177-concept corpus. Cold-start improvement (lazy per-register hydration) is queued for Phase 2.

## Coverage
- Registers ingested: 11 (VIM 1984–2012 lineage, VIML 1968–2022, oiml-complete). g18-2010/g18-202X pending their site-config inclusion in oimlsmart/vocab (OIML's own consolidation work — tracked).
- Lineage coverage: 0 — reported honestly; edition supersession is not yet modeled in the datasets (OIML consolidation TODO).
- SPARQL W3C-subset coverage: tracked in glossarist-sparql (fixture + curated W3C tests; 21 tests green at ship).

## Architecture note (parity)
Per-concept artifacts (json/ttl/tbx/jsonld/yaml) are served by the tenant's static host (today: oimlsmart.github.io/vocab) — `/id` IRIs and RDF-form requests 303 to them. The Worker serves aggregates (R2), the full dynamic API, SPARQL, MCP, and the site upgrade path. Per-concept R2 mirroring is a Phase-2 option.
