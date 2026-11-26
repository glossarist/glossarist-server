# glossarist-server

The dynamic server of the Glossarist suite — Cloudflare Workers deployment serving:

- **Vocab API** (`/v1/*`) — REST, JSON-LD-first content negotiation, for JCGM WG2
- **SPARQL endpoint** (`/sparql`) — roll-our-own engine (glossarist-sparql)
- **MCP** (`/mcp`) — glossarist-mcp tools over Streamable HTTP
- **The site** — concept-browser static assets (feature parity required) + `/id/*` IRIs, `/ontologies`, `/dcat`

Plan: `GLOSSARIST-SERVER-PLAN.md` (workspace). First tenant: OIML vocabularies (oimlsmart/vocab).
