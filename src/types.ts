export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  VERSIONS: KVNamespace;
  AI: Ai;
  VECTORIZE: VectorizeIndex;
  ADMIN_TOKEN?: string;
}
export type RouteHandler = (req: Request, env: Env, url: URL) => Promise<Response> | Response;
export type Route = [method: string, pattern: RegExp, handler: RouteHandler];
