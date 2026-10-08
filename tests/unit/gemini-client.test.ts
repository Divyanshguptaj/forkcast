import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { GeminiClient, GeminiError, createGeminiClient } from "@/server/providers/gemini/client";
import { loadEnv } from "@/config/env";

const KEY = "AIzaSyFAKE-KEY-FOR-TESTS-1234567890";
const Schema = z.object({ answer: z.string() });
const request = { label: "t", system: "sys", parts: [{ kind: "text" as const, text: "hi" }], schema: Schema, jsonSchema: { type: "OBJECT" } };

const ok = (data: unknown, usage = { promptTokenCount: 100, candidatesTokenCount: 20 }) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(data) }] } }], usageMetadata: usage }), { status: 200 });
const fail = (status: number, body: unknown = { error: { status: "UNAVAILABLE" } }) => new Response(JSON.stringify(body), { status });
const perDay = () => fail(429, { error: { status: "RESOURCE_EXHAUSTED", details: [{ violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }] }] } });

function client(responses: Array<Response | Error>, models = ["gemini-2.5-flash", "gemini-3.5-flash-lite"]) {
  const queue = [...responses];
  const fetchImpl = vi.fn(async () => {
    const next = queue.shift();
    if (!next) throw new Error("no more responses");
    if (next instanceof Error) throw next;
    return next;
  });
  const sleeps: number[] = [];
  const c = new GeminiClient({ apiKey: KEY, models, fetchImpl: fetchImpl as unknown as typeof fetch, sleep: async (ms) => void sleeps.push(ms) });
  return { c, fetchImpl, sleeps };
}

const bodyOf = (fetchImpl: ReturnType<typeof vi.fn>, n: number) => JSON.parse((fetchImpl.mock.calls[n][1] as RequestInit).body as string);
const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e instanceof GeminiError ? e.code : `other:${String(e)}`;
  }
  return "no-error";
};

describe("GeminiClient", () => {
  it("returns validated data with usage and sends the key only as a header", async () => {
    const { c, fetchImpl } = client([ok({ answer: "hola" })]);
    const out = await c.generateStructured(request);
    expect(out).toMatchObject({ data: { answer: "hola" }, model: "gemini-2.5-flash", inputTokens: 100, outputTokens: 20 });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain("models/gemini-2.5-flash:generateContent");
    expect(url).not.toContain(KEY);
    expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe(KEY);
    const body = bodyOf(fetchImpl, 0);
    expect(body.generationConfig).toMatchObject({ responseMimeType: "application/json", temperature: 0, thinkingConfig: { thinkingBudget: 0 } });
    expect(body.systemInstruction.parts[0].text).toBe("sys");
    expect(c.stats).toMatchObject({ requests: 1, inputTokens: 100, outputTokens: 20, byModel: { "gemini-2.5-flash": 1 } });
  });

  it("encodes inline images and PDFs and omits thinking config for other models", async () => {
    const { c, fetchImpl } = client([ok({ answer: "x" })], ["gemini-3.5-flash-lite"]);
    await c.generateStructured({ ...request, parts: [{ kind: "text", text: "see" }, { kind: "inline", mimeType: "application/pdf", data: new Uint8Array([1, 2, 3]) }] });
    const body = bodyOf(fetchImpl, 0);
    expect(body.contents[0].parts[1]).toEqual({ inlineData: { mimeType: "application/pdf", data: "AQID" } });
    expect(body.generationConfig.thinkingConfig).toBeUndefined();
  });

  it("retries 503 with backoff on the same model", async () => {
    const { c, sleeps } = client([fail(503), fail(503), ok({ answer: "late" })]);
    const out = await c.generateStructured(request);
    expect(out.model).toBe("gemini-2.5-flash");
    expect(sleeps).toEqual([800, 1600]);
    expect(c.stats.retries).toBe(2);
  });

  it("falls back to the next model when retries are exhausted", async () => {
    const { c } = client([fail(503), fail(503), fail(503), ok({ answer: "fallback" })]);
    expect((await c.generateStructured(request)).model).toBe("gemini-3.5-flash-lite");
  });

  it("does not retry a daily quota 429; it moves to the next model immediately", async () => {
    const { c, sleeps, fetchImpl } = client([perDay(), ok({ answer: "next" })]);
    const out = await c.generateStructured(request);
    expect(out.model).toBe("gemini-3.5-flash-lite");
    expect(sleeps).toEqual([]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("retries a per-minute 429 and skips an unavailable model (404)", async () => {
    const { c, sleeps } = client([fail(429, { error: { status: "RESOURCE_EXHAUSTED", details: [{ violations: [{ quotaId: "GenerateRequestsPerMinute" }] }] } }), ok({ answer: "ok" })]);
    expect((await c.generateStructured(request)).model).toBe("gemini-2.5-flash");
    expect(sleeps).toEqual([800]);
    const second = client([fail(404), ok({ answer: "ok" })]);
    expect((await second.c.generateStructured(request)).model).toBe("gemini-3.5-flash-lite");
  });

  it("fails fast on a bad request instead of burning the model chain", async () => {
    const { c, fetchImpl } = client([fail(400, { error: { status: "INVALID_ARGUMENT" } })]);
    expect(await codeOf(c.generateStructured(request))).toBe("bad_request");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("reports unavailable when every model fails", async () => {
    const { c } = client([perDay(), perDay()]);
    const err = (await c.generateStructured(request).catch((e: unknown) => e)) as GeminiError;
    expect(err.code).toBe("unavailable");
    expect(err.message).not.toContain(KEY);
  });

  it("rejects malformed model output", async () => {
    expect(await codeOf(client([new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "not json" }] } }] }), { status: 200 })]).c.generateStructured(request))).toBe("invalid_response");
    expect(await codeOf(client([ok({ wrong: 1 })]).c.generateStructured(request))).toBe("invalid_response");
    expect(await codeOf(client([new Response("{}", { status: 200 })]).c.generateStructured(request))).toBe("invalid_response");
    expect(await codeOf(client([new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 })]).c.generateStructured(request))).toBe("blocked");
  });

  it("maps timeouts and aborts without leaking the key", async () => {
    const hang = (_u: unknown, init?: RequestInit) => new Promise<Response>((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("a", "AbortError"))));
    const slow = new GeminiClient({ apiKey: KEY, models: ["m"], fetchImpl: hang as unknown as typeof fetch });
    expect(await codeOf(slow.generateStructured({ ...request, timeoutMs: 30 }))).toBe("timeout");
    const controller = new AbortController();
    const pending = slow.generateStructured({ ...request, timeoutMs: 5000 }, { signal: controller.signal });
    setTimeout(() => controller.abort(), 20);
    expect(await codeOf(pending)).toBe("aborted");
  });

  it("treats network errors as retryable and never exposes the key", async () => {
    const { c } = client([new TypeError(`fetch failed ${KEY}`), ok({ answer: "ok" })]);
    expect((await c.generateStructured(request)).data.answer).toBe("ok");
    expect(JSON.stringify(c)).not.toContain(KEY);
    expect(Object.keys(c)).not.toContain("apiKey");
  });

  it("requires a key and builds from the environment", () => {
    expect(() => createGeminiClient(loadEnv({}))).toThrow(/not configured/);
    expect(createGeminiClient(loadEnv({ GEMINI_API_KEY: KEY }))).toBeInstanceOf(GeminiClient);
  });
});
