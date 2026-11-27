#!/usr/bin/env node
// Derive PROPOSED edition-supersession lineage by matching concept clause
// stems across two edition data dirs (VIM uuids are clause stems: "1.1").
// Output is a REVIEW DRAFT — never applied to datasets without the owner's
// editorial sign-off. Unmatched entries are reported, never asserted.
// Usage: node scripts/derive-lineage.mjs --old <dir> --new <dir> --out <file> [--register-pair <oldReg>:<newReg>]
import { readFileSync, readdirSync, existsSync, writeFileSync, mkdirSync } from "node:fs";
import { join, dirname, resolve } from "node:path";

const args = process.argv.slice(2);
const opt = (k) => {
  const i = args.indexOf(`--${k}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const OLD = resolve(opt("old"));
const NEW = resolve(opt("new"));
const OUT = resolve(opt("out"));
const PAIR = opt("register-pair") ?? "edition-n:edition-n+1";

function conceptUuids(dir) {
  const chunks = join(dir, "chunks");
  const ids = new Set();
  if (existsSync(chunks)) {
    for (const f of readdirSync(chunks).filter((f) => f.endsWith(".json"))) {
      const chunk = JSON.parse(readFileSync(join(chunks, f), "utf8"));
      for (const c of chunk.concepts ?? []) if (c.id) ids.add(String(c.id));
    }
  }
  return ids;
}

const oldIds = conceptUuids(OLD);
const newIds = conceptUuids(NEW);
const matched = [...oldIds].filter((id) => newIds.has(id)).sort();
const retiredOld = [...oldIds].filter((id) => !newIds.has(id)).sort();
const introducedNew = [...newIds].filter((id) => !oldIds.has(id)).sort();

const draft = {
  note: "PROPOSAL — derived by clause-number match across editions. REVIEW BEFORE USE: clause-number equality is necessary but not sufficient for supersession (a number may be reused for a different concept after restructuring).",
  register_pair: PAIR,
  proposed_edges: matched.map((id) => ({
    from_uuid: id,
    to_uuid: id,
    kind: "supersededBy",
    note: `derived: clause ${id} present in both editions — confirm same concept before accepting`,
  })),
  report: {
    matched: matched.length,
    retired_in_old_only: retiredOld.length,
    introduced_in_new_only: introducedNew.length,
    retired_list: retiredOld.slice(0, 100),
    introduced_list: introducedNew.slice(0, 100),
  },
};

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(draft, null, 2) + "\n");
console.log(`proposal written: ${OUT}`);
console.log(`matched (proposed edges): ${matched.length} | old-only (retired?): ${retiredOld.length} | new-only (new concepts): ${introducedNew.length}`);
