import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * TinyFish client behaviour with a stubbed global fetch:
 * missing key, timeout, HTTP errors, invalid payloads, SSE parsing.
 */

async function loadClient(key: string | undefined) {
  vi.resetModules();
  if (key) process.env.TINYFISH_API_KEY = key;
  else delete process.env.TINYFISH_API_KEY;
  return import("@/lib/tinyfish");
}

beforeEach(() => {
  vi.unstubAllGlobals();
});
afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.TINYFISH_API_KEY;
});

describe("TinyFish client", () => {
  it("fails fast with NOT_CONFIGURED when the API key is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const tf = await loadClient(undefined);
    await expect(tf.tinyfishSearch("floods patna")).rejects.toMatchObject({ code: "NOT_CONFIGURED" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("maps aborts to TIMEOUT", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(Object.assign(new Error("timed out"), { name: "TimeoutError" })));
    const tf = await loadClient("k");
    await expect(tf.tinyfishSearch("q")).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("maps non-2xx responses to HTTP errors with status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("rate limited", { status: 429 })));
    const tf = await loadClient("k");
    await expect(tf.tinyfishSearch("q")).rejects.toMatchObject({ code: "HTTP", status: 429 });
  });

  it("rejects unexpected payload shapes", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ results: "nope" }), { status: 200 })));
    const tf = await loadClient("k");
    await expect(tf.tinyfishSearch("q")).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
  });

  it("sends the X-API-Key header and never forwards unsafe URLs to Fetch", async () => {
    const spy = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ results: [{ url: "https://a.gov.in/", final_url: "https://a.gov.in/", title: "A", text: "hello" }], errors: [] })),
    );
    vi.stubGlobal("fetch", spy);
    const tf = await loadClient("secret-key");
    const r = await tf.tinyfishFetch(["https://a.gov.in/", "http://169.254.169.254/latest", "https://localhost/"]);
    expect(r.pages).toHaveLength(1);
    const [, init] = spy.mock.calls[0] as [string, RequestInit];
    expect((init.headers as Record<string, string>)["X-API-Key"]).toBe("secret-key");
    expect(JSON.parse(String(init.body)).urls).toEqual(["https://a.gov.in/"]);
  });

  it("parses Agent SSE progress and COMPLETE events", async () => {
    const sse = [
      'data: {"type":"STARTED","run_id":"run_1","timestamp":"t"}',
      'data: {"type":"PROGRESS","run_id":"run_1","purpose":"Opening disaster page","timestamp":"t"}',
      'data: {"type":"COMPLETE","run_id":"run_1","status":"COMPLETED","result":{"shelters":[],"contacts":[]},"timestamp":"t"}',
      "",
    ].join("\n\n");
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(sse, { status: 200, headers: { "Content-Type": "text/event-stream" } })));
    const tf = await loadClient("k");
    const progress: string[] = [];
    const out = await tf.tinyfishAgentRun({ url: "https://patna.nic.in", goal: "g" }, (p) => {
      progress.push(p);
    });
    expect(progress).toEqual(["Opening disaster page"]);
    expect(out).toMatchObject({ runId: "run_1", status: "COMPLETED" });
  });
});
