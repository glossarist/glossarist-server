#!/usr/bin/env node
// Golden e2e runner against a live deployment. Usage: node scripts/golden.mjs <base-url>
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
const base = process.argv[2] ?? "http://localhost:8787";
const spec = JSON.parse(readFileSync(join(dirname(fileURLToPath(import.meta.url)), "..", "test", "golden-cases.json"), "utf8"));
let pass = 0, fail = 0;
for (const c of spec.cases) {
  try {
    const res = await fetch(base + c.path, {
      method: c.method ?? "GET",
      headers: { accept: "application/json" },
      body: c.body ? JSON.stringify(c.body) : undefined,
    });
    const okStatus = res.status === c.expect.status;
    let okExtra = true;
    if (c.expect["registers-min"] || c.expect["hits-min"] || c.expect.hits !== undefined) {
      const body = await res.json();
      const n = body.registers?.length ?? body.hits?.length ?? -1;
      if (c.expect["registers-min"] !== undefined) okExtra = n >= c.expect["registers-min"];
      else if (c.expect["hits-min"] !== undefined) okExtra = n >= c.expect["hits-min"];
      else if (c.expect.hits !== undefined) okExtra = n === c.expect.hits;
    }
    if (c.expect["json-results"]) okExtra = (res.headers.get("content-type") ?? "").includes("sparql-results+json");
    if (c.expect.problem) okExtra = (res.headers.get("content-type") ?? "").includes("problem+json");
    if (c.expect["server-info"]) {
      const body = await res.json();
      okExtra = body.result?.serverInfo?.name === c.expect["server-info"];
    }
    if (okStatus && okExtra) { pass++; console.log(`PASS ${c.name}`); }
    else { fail++; console.log(`FAIL ${c.name} (status ${res.status})`); }
  } catch (e) {
    fail++; console.log(`FAIL ${c.name}: ${e.message}`);
  }
}
console.log(`golden: ${pass} pass, ${fail} fail`);
process.exit(fail ? 1 : 0);
