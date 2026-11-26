export interface Env {
  DB: D1Database;
  ARTIFACTS: R2Bucket;
  VERSIONS: KVNamespace;
}
export type RouteHandler = (req: Request, env: Env, url: URL) => Promise<Response> | Response;
export type Route = [method: string, pattern: RegExp, handler: RouteHandler];
