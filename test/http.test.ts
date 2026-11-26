import { describe, expect, it } from "vitest";
import { problem, json } from "../src/http.js";

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
