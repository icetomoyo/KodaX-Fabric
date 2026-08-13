import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { ApiError, request, setUnauthorizedHandler } from "./http";

function mockFetch(status: number, body: unknown) {
  return vi.fn().mockResolvedValue(
    new Response(typeof body === "string" ? body : JSON.stringify(body), {
      status,
      headers: { "Content-Type": "application/json" },
    }),
  );
}

describe("http request", () => {
  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(null);
  });

  it("returns parsed json on 2xx", async () => {
    vi.stubGlobal("fetch", mockFetch(200, { operator: { id: 1 } }));
    const data = await request<{ operator: { id: number } }>("/console/v1/me");
    expect(data.operator.id).toBe(1);
  });

  it("flattens backend {error:{message}} into ApiError", async () => {
    vi.stubGlobal("fetch", mockFetch(403, { error: { code: "forbidden", message: "admin only" } }));
    const err = await request("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).message).toBe("admin only");
    expect((err as ApiError).status).toBe(403);
    expect((err as ApiError).code).toBe("forbidden");
  });

  it("handles string error shape", async () => {
    vi.stubGlobal("fetch", mockFetch(400, { error: "bad input" }));
    const err = await request("/x").catch((e) => e);
    expect((err as ApiError).message).toBe("bad input");
  });

  it("notifies the unauthorized handler on 401", async () => {
    const on401 = vi.fn();
    setUnauthorizedHandler(on401);
    vi.stubGlobal("fetch", mockFetch(401, { error: { message: "not signed in" } }));
    await expect(request("/x")).rejects.toBeInstanceOf(ApiError);
    expect(on401).toHaveBeenCalledOnce();
  });

  it("does not notify handler on non-401 errors", async () => {
    const on401 = vi.fn();
    setUnauthorizedHandler(on401);
    vi.stubGlobal("fetch", mockFetch(500, { error: { message: "boom" } }));
    await expect(request("/x")).rejects.toBeInstanceOf(ApiError);
    expect(on401).not.toHaveBeenCalled();
  });

  it("wraps network failure in ApiError with status 0", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("failed to fetch")));
    const err = await request("/x").catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(0);
  });

  it("sets Content-Type only when a body is present", async () => {
    const spy = mockFetch(200, {});
    vi.stubGlobal("fetch", spy);
    await request("/x", { method: "POST", body: JSON.stringify({ a: 1 }) });
    const headers = spy.mock.calls[0]?.[1]?.headers as Headers;
    expect(headers.get("Content-Type")).toBe("application/json");
  });
});
