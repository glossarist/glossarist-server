# Concept-browser output parity checklist (issue #3)

Gate: the dynamic server serves every artifact concept-browser emits, plus dynamic surfaces. Source of truth for the tree: `oimlsmart/vocab dist/data/` (verified 2026-11-26).

## Per register
| Artifact | concept-browser | server plan | Status |
|---|---|---|---|
| `concepts/{id}.json` (browser JSON) | ✓ | static assets copy | [ ] |
| `concepts/{id}.jsonld` | ✓ | static assets copy | [ ] |
| `concepts/{id}.ttl` | ✓ | static assets copy | [ ] |
| `concepts/{id}.tbx` | ✓ | static assets copy | [ ] |
| `concepts/{id}.yaml` | ✓ | static assets copy | [ ] |
| `chunks/index-*.json` | ✓ | static assets copy (+ D1 mirror for /v1) | [ ] |
| `index.json`, `index-meta.json` | ✓ | static assets copy | [ ] |
| `manifest.json` | ✓ | static assets + /v1/registers/{id} | [x] dynamic |
| `bibliography.json` | ✓ | static assets copy | [ ] |
| `graph-nodes.json`, `edges.json`, `domain-nodes.json` | ✓ | static assets copy | [ ] |
| `partitive_relations.json`, `stats.json` | ✓ | static assets copy | [ ] |
| `{register}.csv` | ✓ | R2 export via /v1/…/exports/csv | [x] dynamic |
| `{register}.jsonld` | ✓ | R2 export + SPARQL hydration source | [x] dynamic |
| `{register}.ttl` | ✓ | R2 export | [x] dynamic |

## Site-wide
| Artifact | plan | Status |
|---|---|---|
| `_vocab.ttl`, `versions.ttl`, `bib.ttl` | static assets copy | [ ] |
| `activity/{runId}.ttl` (build provenance) | emitted per server build | [ ] |
| `cross-ref-index.json`, `routing.json`, `site-config.json` | static assets copy | [ ] |

## Dynamic superset (beyond concept-browser)
- [x] /v1 REST API · /sparql · /mcp · /id IRIs · /openapi.json · /llms.txt · /dcat
- [ ] /dcat + /prov endpoints (Day 6)
- [ ] semantic search (Phase 2)

## Execution
Static-asset parity = the deployment copies the full `dist/data` tree as Workers Static Assets next to the Worker (one `wrangler deploy` with the generated tree in `public/`), then the checklist boxes are verified by path-probing every artifact class on the live domain. Scripted: scripts/parity-check.mjs (probes N paths per class against the live URL and diffs against the local tree).
