const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS",
  "Access-Control-Allow-Headers": "Accept, Authorization",
};

export function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...CORS, ...headers },
  });
}

export function problem(status: number, code: string, title: string, detail?: string): Response {
  return new Response(
    JSON.stringify({ type: `https://glossarist.org/problems/${code}`, title, detail, status }),
    { status, headers: { "content-type": "application/problem+json", ...CORS } },
  );
}

export function withETag(res: Response, etag: string): Response {
  const headers = new Headers(res.headers);
  headers.set("etag", etag);
  headers.set("vary", "accept");
  return new Response(res.body, { status: res.status, headers });
}

export function cors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}

const CONDITIONAL_TYPES = ["application/json", "application/problem+json", "application/ld+json", "text/turtle"];
const CONDITIONAL_MAX_CHARS = 1_000_000;

/**
 * ETag + If-None-Match handling for buffered GET/HEAD 200 JSON/RDF responses
 * (the mission requires ETag+304+Vary on every route). Attachments (R2 bulk
 * exports) and oversized bodies are passed through unhashed.
 */
export async function withConditional(res: Response, req: Request): Promise<Response> {
  if (req.method !== "GET" && req.method !== "HEAD") return res;
  if (res.status !== 200) return res;
  if (res.headers.get("content-disposition")?.includes("attachment")) return res;
  const type = res.headers.get("content-type") ?? "";
  if (!CONDITIONAL_TYPES.some((t) => type.includes(t))) return res;

  const body = await res.text();
  if (body.length > CONDITIONAL_MAX_CHARS) return res;
  let h = 5381;
  for (let i = 0; i < body.length; i++) h = ((h << 5) + h + body.charCodeAt(i)) | 0;
  const etag = `"${(h >>> 0).toString(16)}"`;

  const headers = new Headers(res.headers);
  headers.set("etag", etag);
  headers.set("vary", "accept");

  const inm = req.headers.get("if-none-match");
  if (inm && (inm === "*" || inm.split(",").some((t) => t.trim() === etag))) {
    return new Response(null, { status: 304, headers });
  }
  return new Response(body, { status: 200, headers });
}
