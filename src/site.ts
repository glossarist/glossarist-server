// Static site serving (issue #25): the concept-browser build streams from R2
// keyed by the current build id — builds/{build_id}/site/vocab/<path> — so the
// HTML site, the data, and the API indexes share one version. The build is
// compiled with base path /vocab, so that prefix is mounted here; the origin
// root redirects into it. Content is immutable per build.
import type { Env } from "./types.js";
import { problem } from "./http.js";

const CONTENT_TYPES: Record<string, string> = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  jsonld: "application/ld+json",
  ttl: "text/turtle",
  xml: "application/xml",
  svg: "image/svg+xml",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  ico: "image/x-icon",
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  csv: "text/csv",
  webmanifest: "application/manifest+json",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  pdf: "application/pdf",
  gcr: "application/zip",
  zip: "application/zip",
};

export type SiteKey = { key: string; contentType: string; immutable: boolean } | { redirect: string } | null;

/**
 * Map a request path to an R2 object key under the current build's site tree.
 * Returns a redirect for the origin root and the unprefixed /vocab,
 * null for traversal attempts and anything outside the mount.
 */
export function siteKeyFor(pathname: string): SiteKey {
  let path: string;
  try {
    path = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (path === "/" || path === "") return { redirect: "/vocab/" };
  if (path === "/vocab") return { redirect: "/vocab/" };
  if (!path.startsWith("/vocab/") || path.includes("..") || path.includes("\0")) return null;

  const rel = path.slice("/vocab/".length);
  const ext = rel.includes(".") ? (rel.split(".").pop() ?? "").toLowerCase() : "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const immutable = rel.startsWith("_astro/") || rel.startsWith("_favicon") || ext === "woff2" || ext === "woff";
  return { key: `site/vocab/${rel}`, contentType, immutable };
}

export async function staticSite(req: Request, env: Env, url: URL): Promise<Response> {
  const mapped = siteKeyFor(url.pathname);
  if (mapped === null) return problem(404, "not_found", "No such route");
  if ("redirect" in mapped) {
    return new Response(null, { status: 308, headers: { location: mapped.redirect, "access-control-allow-origin": "*" } });
  }

  const build = await env.DB.prepare("SELECT value FROM meta WHERE key = 'build_id'").first() as { value: string } | null;
  if (!build) return problem(503, "not_ingested", "No build ingested yet");

  const base = `builds/${build.value}/${mapped.key}`;
  let obj = await env.ARTIFACTS.get(base);
  if (!obj && (mapped.contentType.startsWith("text/html") || !mapped.key.includes("."))) {
    obj = await env.ARTIFACTS.get(`${base}/index.html`); // clean URLs: /learn → /learn/index.html
  }
  if (!obj) {
    const notFound = await env.ARTIFACTS.get(`builds/${build.value}/site/vocab/404.html`);
    if (notFound) {
      return new Response(notFound.body, {
        status: 404,
        headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" },
      });
    }
    return problem(404, "not_found", "No such route");
  }

  const headers: Record<string, string> = {
    "content-type": mapped.contentType,
    "cache-control": mapped.immutable ? "public, max-age=31536000, immutable" : "public, max-age=600",
    etag: `"site-${build.value}-${mapped.key}"`,
    "access-control-allow-origin": "*",
  };
  if (req.method === "HEAD") return new Response(null, { status: 200, headers });
  return new Response(obj.body, { status: 200, headers });
}
