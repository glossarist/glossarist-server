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
