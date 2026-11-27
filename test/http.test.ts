import { describe, expect, it } from "vitest";
import { problem, json, withConditional } from "../src/http.js";

describe("http helpers", () => {
  it("problem bodies carry type, title, status", () => {
    const res = problem(404, "not_found", "No such route");
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).toBe("application/problem+json");
  });
  it("json sets content type and CORS", () => {
    const res = json({ ok: true });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("withConditional (ETag + 304)", () => {
  const get = (headers: Record<string, string> = {}) => new Request("https://x/v1/registers", { headers });

  it("sets etag and vary on buffered 200 GETs", async () => {
    const res = await withConditional(json({ ok: true }), get());
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
    expect(res.headers.get("vary")).toContain("accept");
  });

  it("returns 304 when If-None-Match matches", async () => {
    const first = await withConditional(json({ ok: true }), get());
    const etag = first.headers.get("etag")!;
    const second = await withConditional(json({ ok: true }), get({ "if-none-match": etag }));
    expect(second.status).toBe(304);
    expect(second.headers.get("etag")).toBe(etag);
  });

  it("leaves non-GET and non-200 responses untouched", async () => {
    const posted = await withConditional(json({ ok: true }), new Request("https://x/sparql", { method: "POST" }));
    expect(posted.headers.get("etag")).toBeNull();
    const notFound = await withConditional(problem(404, "x", "y"), get());
    expect(notFound.headers.get("etag")).toBeNull();
  });
});

describe("dispatch (HEAD)", () => {
  it("serves HEAD via GET routes with an ETag", async () => {
    const { dispatch } = await import("../src/routes.js");
    const url = new URL("https://x/healthz");
    const res = await dispatch(new Request("https://x/healthz", { method: "HEAD" }), { DB: {} } as never, url);
    expect(res.status).toBe(200);
    expect(res.headers.get("etag")).toMatch(/^"[0-9a-f]+"$/);
  });
});

describe("withConditional (weak validators)", () => {
  it("returns 304 for a W/-weakened If-None-Match (RFC 7232 weak comparison)", async () => {
    const first = await withConditional(json({ ok: true }), new Request("https://x/v1/registers"));
    const etag = first.headers.get("etag")!;
    const second = await withConditional(json({ ok: true }), new Request("https://x/v1/registers", { headers: { "if-none-match": `W/${etag}` } }));
    expect(second.status).toBe(304);
  });
});
