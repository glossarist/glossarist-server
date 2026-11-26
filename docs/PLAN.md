# Glossarist Server — Full Plan (v2, for owner review)

*2026-11-26. STATUS: APPROVED — repos created (glossarist-server, glossarist-sparql, glossarist-mcp, docs), 23 issues filed, implementation in progress (1-week deadline).*
*Deadline: implementation complete in 1 week. Roll-our-own SPARQL. Cloudflare Workers deployment for OIML first.*
*Companion docs: `REGISTER-EDITOR-SPEC.md` (editor), `isogr/SOTA-2027-PLAN.md` (platform).*

---

## 1. Product definition

**Glossarist Server** — the served counterpart to concept-browser. Git repos remain the SSOT (oimlsmart/vocab first tenant; enosema/concept-register second). The server is a projection: read/query/notify. Writes return through git + FERIN procedure (Phase 3, after this week).

Four surfaces, one Worker deployment per SDO:
1. **Vocab API** — REST v1, JSON-LD-first content negotiation, for JCGM WG2
2. **SPARQL endpoint** — SPARQL 1.1 subset on a **roll-our-own engine** (§5), read-only
3. **MCP endpoint** — terminology tools for AI agents (Streamable HTTP)
4. **The site** — concept-browser static assets served by the same Worker

**Feature-parity requirement (owner-mandated):** glossarist-server is the **dynamic server option** of the suite — concept-browser being the static option. It must serve **everything concept-browser serves** (per-concept artifacts in all formats, search chunks, manifests, standards.json, about pages, the SPA) plus the dynamic surfaces (API, SPARQL, MCP, IRIs, ontology conneg). A parity checklist against concept-browser's emitted output tree gates the deployment. `concept-model` remains the model SSOT: its artifacts are what `/ontologies` serves and what glossarist/docs publishes as the GLOSS specification.

## 2. Repo topology

**Recommendation: THREE new repos.**

| Repo | Contents | Why separate |
|---|---|---|
| **`glossarist-server`** | The Cloudflare Worker: routes (API/SPARQL/MCP), bindings (D1/R2/KV), static assets, ingest webhook + seed scripts, OpenAPI spec, per-tenant config | Deployment-specific; the OIML deliverable |
| **`glossarist-sparql`** | The roll-our-own SPARQL engine + quadstore + JSON-LD reader as a **pure npm package** (no Cloudflare deps — runs in Workers, Node, browser) | The engine is reusable and deserves its own test matrix (W3C test subset); keeps the deployment repo lean |
| **`glossarist-mcp`** | npm package `glossarist-mcp`: MCP tools for glossarist data — **transport-agnostic tool implementations** (search_concepts, get_concept, get_lineage, resolve_citation, …) over a backend interface: local GCR/datasets (stdio) or remote glossarist-server API (Streamable HTTP) | The agent surface as a distributable product: `npx glossarist-mcp ./register.gcr` works without us hosting anything; glossarist-server's `/mcp` route imports the same package with its D1/R2 backend |

| **`glossarist/docs`** | Metanorma specification sources: **GLOSS 1.0 formal specification**, GCR format spec, FERIN/19135 conformance docs, **SPARQL cookbook**, the SOTA whitepaper — published at `glossarist.org/docs` | Mirrors `enosema/docs` (EFS channel) and ommisa's whitepaper pattern: the ontology as a citable standard, evidence as published documents |

**No `glossarist-api` repo.** The API spec lives inside glossarist-server; a WG2 client package can be generated from the OpenAPI spec later without a fourth repo.

## 3. Architecture

```
GitHub (SSOT: oimlsmart/vocab, …)
  │ push → Actions: emit artifacts (jsonld/ttl/tbx/csv/json per concept + aggregates)
  │ → repository_dispatch webhook
  ▼
[ingest worker] verify signature → Queues
  ▼
[Workflow: reindex]
  ├─ R2   — versioned artifacts (immutable, content-addressed keys)
  ├─ D1   — concept index: uuid, register, identifier, designations×lang, status,
  │         relations adjacency, lineage edges, FERIN registration status
  ├─ KV   — build-version keys (store-hydration invalidation contract)
  └─ (Vectorize — Phase 2: multilingual semantic search)
  ▼
[glossarist-server Worker]
  /v1/* REST · /sparql · /id/* IRIs · /mcp · /dcat /prov · static assets
```

- **Workers + Static Assets** (Cloudflare's recommendation for new sites — not Pages): one Worker = site + all API routes, per-tenant custom domain.
- **Cache API**: registers change per-commit (rarely) — near-perfect cacheability; ETags + conditional GET everywhere.
- **Durable Objects**: Phase 2 (change feed SSE, webhooks). Not week-1 scope.
- **Analytics Engine + Workers Logs**: usage metrics per consumer; observability.

## 4. Vocab API v1 (week scope)

```
GET /v1/registers                                        → catalog
GET /v1/registers/{id}                                   → manifest + FERIN metadata
GET /v1/registers/{id}/concepts?lang=&status=&section=&cursor=
GET /v1/concepts/{uuid}?register=                        → full entry, all localizations
GET /v1/concepts/{uuid}/lineage?register=                → supersession chain
GET /v1/concepts/{uuid}/relations?direction=either
GET /v1/search?q=&lang=                                  → exact (D1); semantic in Phase 2
GET /v1/suggest?q=                                       → designation autocomplete
GET /v1/editions?lineage=vim                             → edition chain
GET /v1/diff?from=&to=                                   → edition diff (concept-diff) [stretch]
GET /v1/sources/{urn}                                    → citation resolution (urn:oiml:pub:…)
GET /v1/registers/{id}/exports/{format}                  → jsonld | ttl | tbx | csv | gcr
GET /id/{register}/concept/{uuid}                        → dereferenceable IRI (conneg)
GET /openapi.json                                        → OpenAPI 3.1 spec
```

Rules: `Accept: application/ld+json | text/turtle | text/csv | application/xml(TBX) | application/json`; Problem Details (RFC 9457) errors; ETag + 304; CORS open; cursor pagination; API tokens optional for rate-limit bumps (reads open).

## 5. Roll-our-own SPARQL (`glossarist-sparql` package)

We already replaced jsonld.js with our own writer — same philosophy. Decisive advantage: **our JSON-LD projection is deterministic and we wrote it**, so the reader can parse it back losslessly. No third-party engine anywhere.

**Quadstore** (`store/`): dictionary-encoded (string interning), per-binding-pattern indexes (SPO, POS, OSP + predicate counts), deterministic order. Pure TS, zero deps.

**JSON-LD reader**: reverses OUR compact projection (`@context` + `@graph` nodes → quads): context-aware IRI expansion, `@type` → rdf:type, `{"@id"}` → terms, arrays → multi-quads, lang/datatype literals. ~200 lines, fully testable against emitted fixtures.

**SPARQL v0 subset** (honest scope for the week):
- Forms: SELECT (with DISTINCT), ASK, CONSTRUCT
- Patterns: BGP; `a` shorthand; OPTIONAL; UNION; VALUES
- FILTER: `= != < >`, `regex()`, `lang()`, `datatype()`, `bound()`, logical ops
- Modifiers: ORDER BY, LIMIT, OFFSET, projection
- Default prefixes preloaded from our PREFIXES map; PREFIX/BASE supported
- **v0 non-goals** (documented): UPDATE (read-only server), property paths, subqueries, aggregates (COUNT if time allows), named graphs (single union graph; per-register named graphs v1), SERVICE

**Engine internals**: tokenizer → recursive-descent parser (subset of the SPARQL grammar) → algebra tree → evaluator with index-lookup joins (binding-pattern-driven; nested-loop fine at 10⁴–10⁶ quads).

**Testing**: fixture queries against real VIM data with hand-authored expected results + W3C SPARQL 1.1 test-suite **curated subset** (syntax + eval tests for the v0 feature set) as the credibility bar. Property-based invariants (row counts vs store, DISTINCT semantics).

**Risk + fallback**: isolate CPU/memory limits — mitigated by dictionary encoding + indexes; registers are 10²–10³ concepts (tiny). Cold hydrate from R2 sub-second; warm isolates cached by version key.

## 6. MCP endpoint — `glossarist-mcp` (CONFIRMED: official `@modelcontextprotocol/sdk`)

- **SDK decision (owner-confirmed 2026-11-26)**: use the official `@modelcontextprotocol/sdk` — protocol framing (JSON-RPC, Streamable HTTP, stdio) comes from the SDK; our code is the tool layer only.
- **Package structure**: tool implementations are transport-agnostic functions over a backend interface; `glossarist-mcp` ships two transports:
  - **stdio** — `npx glossarist-mcp ./register.gcr` (or a datasets directory) — works locally, no hosting
  - **Streamable HTTP** — used by glossarist-server's `/mcp` route, wired to the D1/R2 backend
- **Tools (v0, read-only)**: `search_concepts`, `get_concept`, `get_lineage`, `list_editions`, `resolve_citation`, `list_registers`.
- **Phase 3**: `draft_change_proposal` (FERIN PR path) + OAuth identity.
- Resources: register manifests; Prompts: "terminology lookup with citations", "edition comparison".

## 7. Ingest (week-1 scope)

- Day 1: regenerate OIML vocab artifacts locally (concept-browser generate → per-concept json/jsonld/ttl/tbx/yaml + aggregates + chunks + manifest).
- Seed script: R2 upload (versioned) + D1 schema + row build (concepts, designations per language, relations, lineage, statuses).
- GitHub webhook endpoint (`/ingest/github`, signature-verified) → Queues — wired at end of week; local seed is the week-1 data source.

## 8. Deployment

- `wrangler deploy` → `glossarist-server.<subdomain>.workers.dev` first; end-to-end verify (API + SPARQL + MCP + site).
- **OIML custom domain** (www.oimlsmart.org/vocab + api routes): requires the oimlsmart.org zone in an accessible Cloudflare account — **need owner input: which CF account hosts oimlsmart.org DNS?** (the wrangler login on build machines — account list will be checked at deploy; if the zone is elsewhere, DNS gets a CNAME to the Worker or the zone is moved/added).
- Per-tenant config in-repo: `tenants/oiml.toml` (registers, domain, branding) — adding Enosema later = one config + one deploy.

## 9. The week — four-first compressed roadmap

**Principles: data-first (git SSOT → index → stable IRIs), model-first (GLOSS schemas validate everything, ontology served), semantic-first (SPARQL + JSON-LD/Turtle everywhere), AI-first (MCP + cited answers) — and docs-as-we-go (glossarist/docs).**

| Day | Data-first | Model/semantic-first | AI-first |
|---|---|---|---|
| **1** | 4 repos created + CI; ingest: vocab → D1/R2 seed; skeleton live on workers.dev | glossarist-sparql repo: quadstore + JSON-LD reader | glossarist-mcp scaffold (SDK, backend interface) |
| **2** | Vocab API v1 complete (conneg, ETag, OpenAPI) + tests | JSON-LD reader fixtures against real VIM emits | MCP tools over the API internals (no-drift adapter) |
| **3** | `/id/*` IRIs + `/ontologies` conneg (concept-model artifacts served) | SPARQL parser + algebra; `/sparql` endpoint wired | stdio transport: `npx glossarist-mcp ./register.gcr` |
| **4** | Lineage + relations + sources endpoints; exports (5 formats) | SPARQL evaluator + fixture suite | Cited-answer endpoint v0 (Workers AI, ommisa stage pattern) |
| **5** | GitHub webhook ingest + Queues; gates.sh-style promotion gate | W3C curated test subset pass; playground page | Ask-path golden cases; MCP published |
| **6** | Evidence pages (benchmarks, fidelity matrix); glossarist/docs: GLOSS 1.0 spec skeleton + cookbook | SPARQL cookbook (20 queries) | Whitepaper skeleton |
| **7** | Custom domain deploy (oimlsmart.org) + end-to-end verify | Conformance self-check run | Handoff doc + issue closeout |

**Immediately after the week (queued, not dropped):** Vectorize semantic search · edition diff · DO change feeds · write path (FERIN proposals) · glossarist-py · generated clients · LOV/w3id registration · conformance matrix public · glossarist/ci · create-glossarist-register · RAG eval dataset · interoperability matrix.

## 10. Decisions needed from owner (blocking)

1. **Repo topology**: two repos (server + sparql engine) as recommended? Or three (adding glossarist-api for spec/client)?
2. **MCP protocol library**: official MCP SDK (recommended) vs hand-rolled?
3. **SPARQL v0 scope**: confirm the subset in §5 (esp. non-goals: no UPDATE/property paths/aggregates in week 1)?
4. **Cloudflare account**: which account hosts oimlsmart.org (zone) and where do Workers/D1/R2 live?
5. **GA register set**: all OIML editions at once (vim-1984…2012, viml-1968…2022, g18, oiml-complete) or current editions first?
6. **SPARQL write**: confirm read-only permanently (writes only via FERIN governance)?
7. **Auth**: open reads + optional tokens OK for WG2 launch?

## 11. Out of scope (week 1), by design

Vectorize semantic search, edition diff endpoints (stretch only), Durable Object feeds, write path, OAuth, Enosema tenant (config-ready only), w3id.org IRI redirects, DOI minting.

## 11a. Incorporated from ommisa / oimlsmart-ai (proven patterns, same stack)

`oimlsmart/ai` (ommisa, www.ommisa.org) already runs in production on the identical Cloudflare stack: Workers ×2 (public+internal), Vectorize ×2, D1, KV, R2 ×3, Queues, Workflows, Cron, Turnstile, AI Gateway — citation-grounded RAG over ~900 OIML documents, 9.3M words, 10 languages. Adopt, don't reinvent:

| ommisa pattern | Adopted in glossarist-server as |
|---|---|
| Route table (`workers/shared/router.ts`) dispatched by both workers | One route table; `/v1`, `/sparql`, `/mcp`, `/id`, `/ontologies` |
| Stage registry (`stages/`, composition-only retrieve) | The ask/serving path when AI answers land (Phase 2) — stages: parse → lookup → cite → render |
| **Dependency-free protocol engine** (`mcp-proto.ts`, unit-tested) | Note: glossarist-mcp uses the official SDK (owner decision); ommisa's hand-rolled engine is the reference for edge cases + the no-drift adapter pattern (MCP handlers wrap the same internals as API routes) |
| D1 **graph projection** (registry, families, concepts, cites edges) | The concept/lineage/relations adjacency schema — same shape, glossarist-v3-native |
| Contract tests (ChunkMeta ↔ pydantic wire) | Wire contracts: D1 rows ↔ emitted JSON-LD ↔ API responses, one schema-union drift test |
| Promotion gate (`gates.sh`: golden ×3 + annealment, evidence under `artifacts/`) | The deploy gate: golden queries ×N against the live registers before promote; evidence kept |
| One-command safe reindex (`reindex.sh`, step-verified, abort-on-fail) | The ingest/reindex pipeline wrapper (seed → reconcile → verify) |
| OAuth issuer (`id.oimlsmart.org/op/device`) + API-key tiering | Phase 3 write path: proposals authenticate against the existing issuer; no new accounts |
| Whitepaper (academic PDF, house style) | glossarist/docs: the SOTA whitepaper + GLOSS 1.0 spec channel |
| Two-lane model policy (cost-first serving, quality-first one-time) | Any AI features (ask/grounding) follow the same lanes on Workers AI |

Division of labor with ommisa: **ommisa indexes OIML documents (chunks); glossarist-server indexes OIML concepts (structured v3 data)**. The bridge: ommisa's graph build can consume glossarist registers, and glossarist answers cite concept IRIs while ommisa answers cite document clauses — complementary surfaces, one account family.

## 11b. Competitive bar: BIPM SI Digital Framework / SI Reference Point (probed 2026-11-26)

BIPM's SIRP went **stable June 2026**. Probed live surface: `si-digital-framework.org` — `/SI` serves the OWL ontology (JSON-LD, conneg), `/SI/units` serves Turtle (98 KB) + a flat JSON list, `/SI/units/kilogram` serves per-unit Turtle PIDs, PROV-O provenance present, open-source (github.com/TheBIPM/SI-Reference-Point-2023). FAIR-branded.

**What SIRP has:** conneg ✓, PIDs ✓, JSON-LD/Turtle ✓, OWL ontology ✓, PROV-O ✓, definition versioning (`hasPreviousDefinition`).
**What SIRP lacks (our scorecard):** no SPARQL endpoint · no MCP · **terminology is out of scope entirely** (units/prefixes/constants only — no concepts, designations, multilingual definitions, relations) · no governance procedures (no proposals, no register model) · no multi-register federation · no edition registers/supersession chains · flat denormalized JSON.

**The claim we must earn:** everything SIRP does (conneg, PIDs, JSON-LD/Turtle, OWL, PROV-O) PLUS SPARQL, MCP, full terminological structure, FERIN governance, edition lineage, and multi-register federation — on registers whose scale and structure exceed SIRP's flat unit list. Every §12 SOTA-suite item widens that gap. glossarist/docs carries the comparison whitepaper section.

## 12. The SOTA suite — ecosystem completeness checklist

**Already owned (the foundation):** glossarist-ruby (toolchain) · glossarist-js (SDK) · concept-browser (read layer) · concept-model (Lutaml SSOT → schemas/SHACL/ontology) · this plan's server + sparql + mcp · the editor program · FERIN/19135 governance alignment.

**Week-1 additions (cheap, high-visibility):**
- [ ] **SPARQL cookbook** — 20 ready terminology queries ("EN↔FR preferred designation pairs", "concepts superseded between editions", "entries without sources") — the WG2 handout
- [ ] **Playground page** on the server — interactive SPARQL + API explorer against live registers (Wikidata-Query-Service-style demo)

**2027 suite (what "SOTA suite" still lacks):**
- [ ] **glossarist-py** — Python SDK (the semantic-web/data community's language; relaton-py precedent exists)
- [ ] **Generated API clients** — TS + Python, published from the OpenAPI spec
- [ ] **Dereferenceable ontology IRIs** — gloss: namespace serving TTL/JSON-LD/HTML with conneg; SHACL shapes at their IRIs; **LOV registration**; w3id.org persistence redirects
- [ ] **GLOSS SKOS profile** — formal profile description (W3C `prof:` vocabulary) + SHACL-constrained SKOS subset + GLOSS extension mapping, published at `/profile` and in glossarist/docs
- [ ] **GLOSS 1.0 formal specification** — a versioned, citable spec document (Metanorma, Enosema EFS channel) — the ontology as a standard, not just code
- [ ] **Published evidence**: FERIN/19135 conformance matrix (ATS results per register) · format-fidelity test matrix per release · performance benchmarks (build times, SPARQL latency) — SOTA claims need public numbers
- [ ] **Verifiable provenance** — sigstore-signed build artifacts; "every published file provably built from commit X" (supply-chain trust for data)
- [ ] **glossarist/ci** — reusable GitHub workflows: generate → validate → publish for any register repo (new SDOs inherit SOTA automatically)
- [ ] **`create-glossarist-register`** — scaffold CLI/template: zero → published register in minutes
- [ ] **Interoperability matrix** — verified-consumer list (Skosmos, Protégé, Jena, rdflib, VOCAB readers) with test evidence
- [ ] **Terminology-RAG evaluation dataset** — golden Q&A set over the VIM, published (contribution to AI-for-terminology)


## 13. Ten-pass red-team critique (2026-11-26) — findings and fixes

Each pass attacks the plan from a different adversarial angle. Fixes marked **[W1]** land in week 1; **[2027]** join the roadmap.

**Pass 1 — 2027 competitive horizon.** A SPARQL *subset* engine reads as 2021-grade in 2027. **[2027]** Roadmap the full SPARQL 1.1 surface (aggregates, subqueries, property paths, named graphs) and track SPARQL 1.2/RDF-star. **[2027]** GraphRAG over the concept graph (relations/partitives as graph walks, not flat retrieval) for the ask path. **[W1]** Publish `llms.txt`; **[2027]** register the MCP servers in public MCP registries.

**Pass 2 — Strict FAIR assessor.** `/id` IRIs are only FAIR if *persistent*: depending on `vocab.oimlsmart.org` alone is weak. **[2027]** w3id.org redirects + edition DOIs (already queued — promote in priority). **[W1]** Rights metadata mandatory in `/dcat` and DCAT records. **[2027]** Cross-register references must use permanent URNs, never relative paths.

**Pass 3 — Security/abuse.** Open SPARQL is a DoS surface: cross-product joins hang isolates. **[W1]** Engine-level query cost limits + wall-clock timeout (planner guard), not just rate limits. **[W1]** MCP/AI surfaces: definition text is an injection vector — output-shaping + refusal behavior required (adopt ommisa's refusal golden cases). **[W1]** Webhook replay protection (timestamp + signature window). **[2027]** Egress controls on any Workers-AI call path.

**Pass 4 — Data integrity.** **The lineage endpoint may serve empty data**: edition supersession in the OIML vocab is not yet modeled (edition alignment is the manual TODO.consolidate). **[W1]** Ingest reports lineage coverage per register; the API never fabricates lineage — empty is honest. The cookbook's supersession query ships with the data caveat. **[W1]** Version-key contract tests: artifacts (emitter version) ↔ server reader — one drift test, ommisa pattern.

**Pass 5 — Scale/perf.** **[W1]** `Vary: Accept` discipline on every conneg route (classic conneg-cache footgun). **[W1]** OPTIONAL-heavy query planner guard + per-query timeout (see Pass 3). **[W1]** Publish hydration SLA numbers (cold/warm) on the evidence page.

**Pass 6 — API ergonomics.** **[W1]** Error-code taxonomy in Problem Details extensions. **[W1]** `?lang=` semantics defined from site-config `ui_languages` (default, fallback order). **[2027]** API stability policy + `/changelog` endpoint.

**Pass 7 — Governance/sustainability.** **[W1]** GOVERNANCE.md/CODEOWNERS/ADR directory per repo; version-skew policy stated (server pins model vX, drift-gated). **[W1]** Cost model stated (Workers paid tier for Queues/DO; ommisa-style spend discipline for any AI calls).

**Pass 8 — Legal.** **The sharpest finding:** VIM/VIML text is © JCGM/BIPM/ISO — the API, exports, and GCR packaging *redistribute* it. The site already publishes it (existing OIML permission presumed) but the plan must carry an explicit **rights statement per register** in `/dcat` + docs, a permission record, and a takedown story. **[W1]** Rights statement; **[2027]** formal permission record in glossarist/docs. No PII exposed; API analytics anonymized.

**Pass 9 — Testing/quality.** **[W1]** Publish W3C-subset coverage % openly (anti-cherry-pick). **[W1]** Fuzz the SPARQL parser. **[W1]** Golden e2e suite for API+SPARQL+MCP incl. refusal + French cases (ommisa's 13-case pattern). **[2027]** Mutation testing on the engine; shared wire-type contracts across the four repos (single types package or fixture parity).

**Pass 10 — Positioning.** **[W1, DONE]** LICENSE files (BSD-2-Clause) — fixed the same day. **[W1]** glossarist.org presents the full suite (server/sparql/mcp/docs) — one entry surface. **[2027]** Receipts: latency benchmarks vs SIRP, conformance matrix, demo walkthrough video.


## 13b. Ten genuine rounds (2026-11-26, redone properly) — NEW findings per round

Owner challenged that the "ten passes" were one analysis in ten categories. Redone: ten sequential rounds, each logging only findings the earlier rounds missed. Fixed between rounds where actionable.

**R1 — Competitor horizon (new):** SIRP iterates too (stable June 2026, active repo) — add a tracked watch on TheBIPM/SI-Reference-Point changelog. QUDT/OM already serve unit RDF — interlink (owl:sameAs/skos:closeMatch to QUDT for unit mentions), don't compete.

**R2 — FAIR formal (new):** A1.2 metadata-persistence basis must be stated explicitly: the GitHub repos are the persistence layer; /dcat served even under maintenance. Produce a short FAIR self-assessment doc (per-principle, evidence links).

**R3 — WG2 domain scientist (new):** ISO 10241-1 definition *types/principles* (intensional/extensional/partitive) and entry-level terminological attributes — audit model coverage in concept-model and surface in the API (or document their absence honestly). Register ordering must be clause-aware natural sort (3.1.10 > 3.1.2 — naturalSort exists in glossarist-js; the API MUST use it).

**R4 — Platform engineer (new, sharp):** **KV is eventually consistent (~60 s)** — the "version-key invalidation" contract in §3 contradicts it. Fix: the store-hydration version comes from **R2 object metadata or D1 (strongly consistent)**; KV demoted to a hint. Also missing: D1 migration/rollback story; subrequest budget (50/1000) for ingest fan-out.

**R5 — SPARQL standards lawyer (new):** RDF 1.1 simple literals ARE xsd:string — engine must normalize for `=` comparisons; language-tag case normalization (@EN ≡ @en); DISTINCT/bnode identity semantics; CONSTRUCT template rules (unbound vars drop triples). These become engine conformance notes + tests.

**R6 — Security red team (new):** **ReDoS**: FILTER `regex()` compiles adversarial patterns — cap pattern length/complexity + reuse the wall-clock guard. Non-finding verified: the JSON-LD reader takes a fixed in-repo context — no remote @context fetch, no SSRF. MCP tool args schema-validated by the SDK.

**R7 — Data modeler (new, needs owner):** **Language-tag form**: our data emits ISO 639-3 codes (`@eng`) — valid BCP47 subtags but nonstandard as primary tags; external SKOS consumers expect `@en`/`@fr`. Interop decision required: dual emission, or document the 639-3 convention. Filed on glossarist-js (owns emission) — data-level owner decision.

**R8 — Ops/SRE (new, fixed now):** all four repos had **no branch protection** — enabled (PRs required, no force-push, no deletion). Missing: D1 backup/restore cadence (export cron + restore runbook). Rollback = Workers version redeploy (platform-native ✓).

**R9 — WG2 product (new):** playground queries need **shareable permalinks** (?query=…); the API explorer/docs route lives on the server itself (`/docs`), docs-first landing.

**R10 — Delivery realist (new, needs owner):** the [W1] list accreted across critiques — the 7-day plan is now **overloaded**. Proposed triage — week 1 MUST: API, ingest, SPARQL v0, MCP, parity, deploy, licenses (done), rights statement, cost-limit guard, Vary discipline, branch protection (done). Week 2: cookbook, playground, evidence pages, llms.txt, whitepaper, GOVERNANCE polish, golden-suite expansion. Owner arbitrates.
