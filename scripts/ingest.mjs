#!/usr/bin/env node
// Ingest generated OIML vocab data → R2 (aggregates, versioned) + D1 (index).
// Usage: node scripts/ingest.mjs --data <dist/data> [--build-id <id>] [--push]
// Without --push: dry run (counts only). R2/D1 writes go through wrangler.
import { readFileSync, existsSync, readdirSync, statSync, mkdirSync, writeFileSync, rmSync } from "node:fs";
import { join, basename, resolve } from "node:path";
import { execFileSync } from "node:child_process";

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const DATA = resolve(opt("data") ?? "../../oimlsmart/vocab/dist/data");
const ONTOLOGIES = opt("ontologies") ? resolve(opt("ontologies")) : null;
const BUILD_ID = opt("build-id") ?? `local-${new Date().toISOString().replace(/[:.]/g, "-")}`;
const PUSH = args.includes("--push");
const ACCOUNT = process.env.CLOUDFLARE_ACCOUNT_ID;
if (!PUSH) console.log("DRY RUN (pass --push to write)");
if (PUSH && !ACCOUNT) { console.error("CLOUDFLARE_ACCOUNT_ID required for --push"); process.exit(1); }

const wr = (args_, opts = {}) => {
  if (!PUSH) return;
  execFileSync("npx", ["wrangler", ...args_], { stdio: opts.quiet ? "ignore" : "inherit", env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, shell: process.platform === "win32" });
};

const sql = (v) =>
  v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`;

// --- enumerate registers -------------------------------------------------
const skipFiles = new Set(["_vocab.ttl", "versions.ttl", "routing.json", "site-config.json", "activity"]);
const entries = readdirSync(DATA).filter((n) => {
  const p = join(DATA, n);
  return statSync(p).isDirectory() && existsSync(join(p, "manifest.json"));
});
console.log(`registers found: ${entries.join(", ")}`);

const statements = [];
let lineageRows = 0, conceptRows = 0, designationRows = 0, sourceRows = 0;
const r2Keys = [];

for (const reg of entries) {
  const dir = join(DATA, reg);
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
  const languages = JSON.stringify(manifest.languages ?? []);
  const series = (reg.replace(/-\d{4}.*$/, "") || reg);
  const domain = manifest.uriBase ? new URL(manifest.uriBase).host : null;
  statements.push(
    `INSERT OR REPLACE INTO registers(id, title, subtitle, uri_base, languages, concept_count, edition, series, domain) VALUES (${sql(reg)}, ${sql(manifest.title)}, ${sql(manifest.subtitle)}, ${sql(manifest.uriBase)}, ${sql(languages)}, ${manifest.conceptCount ?? 0}, ${sql(manifest.year ?? null)}, ${sql(series)}, ${sql(domain)});`,
  );

  // concepts + designations from search chunks (canonical summary rows)
  const chunksDir = join(dir, "chunks");
  if (existsSync(chunksDir)) {
    for (const f of readdirSync(chunksDir).filter((f) => f.endsWith(".json"))) {
      const chunk = JSON.parse(readFileSync(join(chunksDir, f), "utf8"));
      for (const c of chunk.concepts ?? []) {
        conceptRows++;
        statements.push(
          `INSERT OR REPLACE INTO concepts(register, uuid, identifier, status, title_eng) VALUES (${sql(reg)}, ${sql(c.id)}, ${sql(c.designations?.eng ?? Object.values(c.designations ?? {})[0] ?? null)}, ${sql(c.status ?? "valid")}, ${sql(c.eng ?? null)});`,
        );
        for (const [lang, d] of Object.entries(c.designations ?? {})) {
          if (!d) continue;
          designationRows++;
          statements.push(
            `INSERT OR REPLACE INTO designations(register, uuid, lang, designation, normative_status) VALUES (${sql(reg)}, ${sql(c.id)}, ${sql(lang)}, ${sql(String(d))}, NULL);`,
          );
        }
      }
    }
  }

  // concept-level sources from browser concept files
  const conceptsDir = join(dir, "concepts");
  if (existsSync(conceptsDir)) {
    for (const f of readdirSync(conceptsDir)) {
      if (!f.endsWith(".json")) continue;
      let c;
      try { c = JSON.parse(readFileSync(join(conceptsDir, f), "utf8")); } catch { continue; }
      const uuid = c.identifier ?? f.replace(/\.json$/, "");
      for (const loc of Object.values(c.localizations ?? c.languages ?? {})) {
        for (const src of loc?.sources ?? []) {
          const urn = src?.origin?.ref?.source ?? src?.origin?.ref?.id ?? null;
          if (!urn) continue;
          sourceRows++;
          statements.push(
            `INSERT OR REPLACE INTO concept_sources(register, uuid, urn, clause, kind) VALUES (${sql(reg)}, ${sql(String(uuid))}, ${sql(String(urn))}, ${sql(src?.origin?.clause ?? src?.clause ?? null)}, ${sql(src?.type ?? null)});`,
          );
        }
      }
    }
  }

  // relations from edges.json (defensive shape walk)
  const edgesPath = join(dir, "edges.json");
  if (existsSync(edgesPath)) {
    let edges;
    try { edges = JSON.parse(readFileSync(edgesPath, "utf8")); } catch { edges = []; }
    for (const e of Array.isArray(edges) ? edges : (edges.edges ?? [])) {
      const subj = e.source?.id ?? e.source ?? null;
      const obj = e.target?.id ?? e.target ?? null;
      const pred = e.type ?? e.relation ?? null;
      if (!subj || !obj || !pred) continue;
      statements.push(
        `INSERT OR REPLACE INTO relations(register, subject, predicate, object) VALUES (${sql(reg)}, ${sql(String(subj))}, ${sql(String(pred))}, ${sql(String(obj))});`,
      );
    }
  }

  // bibliography → sources
  const bibPath = join(dir, "bibliography.json");
  if (existsSync(bibPath)) {
    const bib = JSON.parse(readFileSync(bibPath, "utf8"));
    for (const entry of bib.bibliography ?? []) {
      const urn = entry.urn ?? entry.id ?? null;
      if (!urn) continue;
      sourceRows++;
      statements.push(
        `INSERT OR REPLACE INTO sources(register, urn, record) VALUES (${sql(reg)}, ${sql(String(urn))}, ${sql(JSON.stringify(entry))});`,
      );
    }
  }

  // R2 aggregates + manifest + chunks (per-concept files stay on static assets)
  for (const f of [`${reg}.jsonld`, `${reg}.csv`, `${reg}.ttl`, "manifest.json", "bibliography.json", "index.json", "index-meta.json", "standards.json", "graph-nodes.json", "edges.json"]) {
    const p = join(dir, f);
    if (existsSync(p)) r2Keys.push([`builds/${BUILD_ID}/${reg}/${f}`, p]);
  }
  if (existsSync(chunksDir)) {
    for (const f of readdirSync(chunksDir)) r2Keys.push([`builds/${BUILD_ID}/${reg}/chunks/${f}`, join(chunksDir, f)]);
  }
}

statements.push(`INSERT OR REPLACE INTO meta(key, value) VALUES ('build_id', ${sql(BUILD_ID)});`);

// ontology artifacts (e.g. --ontologies <dir with gloss.ttl + gloss.jsonld>)
if (ONTOLOGIES) {
  if (!existsSync(ONTOLOGIES)) { console.error(`--ontologies dir not found: ${ONTOLOGIES}`); process.exit(1); }
  for (const f of readdirSync(ONTOLOGIES).filter((n) => n.endsWith(".ttl") || n.endsWith(".jsonld"))) {
    r2Keys.push([`builds/${BUILD_ID}/ontologies/${f}`, join(ONTOLOGIES, f)]);
  }
}

// static site tree (e.g. --site ../../oimlsmart/vocab/dist) — served at /vocab/*
// (the build's compiled base path) under the current build id (issue #25)
const SITE = opt("site") ? resolve(opt("site")) : null;
if (SITE) {
  if (!existsSync(SITE)) { console.error(`--site dir not found: ${SITE}`); process.exit(1); }
  const walk = (dir, rel) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      const childRel = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(p, childRel);
      else r2Keys.push([`builds/${BUILD_ID}/site/vocab/${childRel}`, p]);
    }
  };
  walk(SITE, "");
  console.log(`site files staged under site/vocab/`);
}
statements.push(`INSERT OR REPLACE INTO meta(key, value) VALUES ('generated_at', ${sql(new Date().toISOString())});`);
statements.push(`INSERT OR REPLACE INTO meta(key, value) VALUES ('registers', ${sql(JSON.stringify(entries))});`);
// lineage coverage: honest zero unless lineage rows exist
const totalConcepts = conceptRows;
statements.push(`INSERT OR REPLACE INTO meta(key, value) VALUES ('lineage_coverage', ${sql(lineageRows === 0 || totalConcepts === 0 ? "0" : String(lineageRows / totalConcepts))});`);

console.log(`rows: ${conceptRows} concepts, ${designationRows} designations, ${sourceRows} sources, statements: ${statements.length}`);
console.log(`r2 objects: ${r2Keys.length}`);

if (!PUSH) { console.log("dry run complete"); process.exit(0); }

// --- R2 uploads (concurrent: the site tree is tens of thousands of objects;
// sequential wrangler spawns would take hours) ------------------------------
import { execFile } from "node:child_process";
import { setTimeout as sleep } from "node:timers/promises";
const R2_CONCURRENCY = Number(process.env.R2_CONCURRENCY ?? 12);
// local binary, not npx: concurrent npx invocations race on the npm cache
const WRANGLER_BIN = resolve("node_modules/.bin/wrangler");
const wranglerArgs = (key, path) =>
  existsSync(WRANGLER_BIN)
    ? [WRANGLER_BIN, ["r2", "object", "put", `glossarist-artifacts/${key}`, "--file", path, "--remote"]]
    : ["npx", ["wrangler", "r2", "object", "put", `glossarist-artifacts/${key}`, "--file", path, "--remote"]];
const putOnce = ([bin, args]) => new Promise((res, rej) => {
  execFile(bin, args, { env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: ACCOUNT }, stdio: "ignore", shell: process.platform === "win32" }, (err) => (err ? rej(err) : res()));
});
await (async () => {
  let idx = 0, done = 0;
  const failed = [];
  const worker = async () => {
    while (idx < r2Keys.length) {
      const [key, path] = r2Keys[idx++];
      for (let attempt = 1; ; attempt++) {
        try { await putOnce(wranglerArgs(key, path)); break; }
        catch (e) {
          if (attempt >= 3) { failed.push(key); console.error(`FAILED ${key}: ${String(e.message ?? e).slice(0, 120)}`); break; }
          await sleep(2000 * attempt);
        }
      }
      done++;
      if (done % 500 === 0) console.log(`r2 uploads: ${done}/${r2Keys.length}`);
    }
  };
  await Promise.all(Array.from({ length: R2_CONCURRENCY }, worker));
  if (failed.length) {
    console.error(`r2 uploads FAILED for ${failed.length} objects — rerun the ingest to retry (uploads are idempotent)`);
    process.exit(1);
  }
})();
console.log(`r2 uploads complete: ${r2Keys.length}`);

// --- write batched SQL + execute ------------------------------------------
const BATCH = 400;
const dirOut = resolve("artifacts/seed");
mkdirSync(dirOut, { recursive: true });
const files = [];
for (let i = 0; i < statements.length; i += BATCH) {
  const f = join(dirOut, `seed-${String(i / BATCH).padStart(4, "0")}.sql`);
  writeFileSync(f, statements.slice(i, i + BATCH).join("\n"));
  files.push(f);
}
console.log(`sql batches: ${files.length}`);
for (const f of files) wr(["d1", "execute", "glossarist", "--remote", "-y", "--file", f], { quiet: true });

wr(["kv", "key", "put", "build_id", BUILD_ID, "--namespace-id", "3b2f36d46cbf490f974dc6121b3428b4", "--remote"], { quiet: false });
rmSync(dirOut, { recursive: true, force: true });
console.log(`INGESTED build ${BUILD_ID}: ${entries.length} registers, ${conceptRows} concepts, ${r2Keys.length} R2 objects`);
