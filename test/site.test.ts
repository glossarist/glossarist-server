import { describe, expect, it } from "vitest";
import { siteKeyFor } from "../src/site.js";

describe("siteKeyFor (R2 site tree mapping)", () => {
  it("redirects the origin root and bare /vocab into the mount", () => {
    expect(siteKeyFor("/")).toEqual({ redirect: "/vocab/" });
    expect(siteKeyFor("/vocab")).toEqual({ redirect: "/vocab/" });
    expect(siteKeyFor("")).toEqual({ redirect: "/vocab/" });
  });

  it("maps mount paths under the build's site tree", () => {
    expect(siteKeyFor("/vocab/index.html")).toEqual({ key: "site/vocab/index.html", contentType: "text/html; charset=utf-8", immutable: false });
    expect(siteKeyFor("/vocab/_astro/app.abc123.css")).toEqual({ key: "site/vocab/_astro/app.abc123.css", contentType: "text/css; charset=utf-8", immutable: true });
    expect(siteKeyFor("/vocab/data/vim-2012/vim-2012.jsonld")).toMatchObject({ key: "site/vocab/data/vim-2012/vim-2012.jsonld", contentType: "application/ld+json" });
    expect(siteKeyFor("/vocab/dataset/x.gcr")).toMatchObject({ contentType: "application/zip", immutable: false });
  });

  it("rejects traversal and non-mount paths", () => {
    expect(siteKeyFor("/etc/passwd")).toBeNull();
    expect(siteKeyFor("/vocab/../../secret")).toBeNull();
    expect(siteKeyFor("/vocab/%2e%2e/secret")).toBeNull();
    expect(siteKeyFor("/vocab/bad%zz")).toBeNull();
  });
});
