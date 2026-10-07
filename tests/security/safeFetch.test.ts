import http from "node:http";
import zlib from "node:zlib";
import type { AddressInfo } from "node:net";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { SafeFetchError, safeFetch } from "@/server/providers/http/safeFetch";
import { sniffKind } from "@/server/providers/http/sniff";

const PDF = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.alloc(2048, 0x20)]);
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(2048, 1)]);
const ZIP = Buffer.concat([Buffer.from("PK\x03\x04"), Buffer.alloc(2048, 7)]);
const HTML = "<!doctype html><html><head><title>Carta</title></head><body>" + "x".repeat(2000) + "</body></html>";

let server: http.Server;
let base: string;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const url = req.url ?? "/";
    if (url === "/html") return void res.writeHead(200, { "content-type": "text/html" }).end(HTML);
    if (url === "/pdf") return void res.writeHead(200, { "content-type": "application/octet-stream" }).end(PDF);
    if (url === "/png") return void res.writeHead(200, { "content-type": "text/html" }).end(PNG);
    if (url === "/zip") return void res.writeHead(200, { "content-type": "text/html" }).end(ZIP);
    if (url === "/big-html") {
      res.writeHead(200, { "content-type": "text/html" });
      res.write("<html><body>");
      const chunk = "a".repeat(64 * 1024);
      let n = 0;
      const timer = setInterval(() => {
        if (res.destroyed || n++ > 200) {
          clearInterval(timer);
          return void res.end();
        }
        res.write(chunk);
      }, 1);
      return;
    }
    if (url === "/declared-huge") {
      res.writeHead(200, { "content-type": "text/html", "content-length": String(500 * 1024 * 1024) });
      return void res.end("<html></html>");
    }
    if (url === "/slow") return void setTimeout(() => res.writeHead(200).end(HTML), 3000);
    if (url === "/r1") return void res.writeHead(302, { location: "/html" }).end();
    if (url === "/loop") return void res.writeHead(302, { location: "/loop" }).end();
    if (url === "/to-metadata") return void res.writeHead(302, { location: "http://169.254.169.254/latest/meta-data/" }).end();
    if (url === "/to-private") return void res.writeHead(302, { location: "http://10.0.0.5/admin" }).end();
    if (url === "/to-file") return void res.writeHead(302, { location: "file:///etc/passwd" }).end();
    if (url === "/to-port") return void res.writeHead(302, { location: "https://example.com:6379/" }).end();
    if (url === "/403") return void res.writeHead(403, { "content-type": "text/html" }).end("<html>blocked</html>");
    if (url === "/404") return void res.writeHead(404, { "content-type": "text/html" }).end("<html>missing</html>");
    if (url === "/gzip-bomb") {
      const bomb = zlib.gzipSync(Buffer.from("<html><body>" + "z".repeat(8 * 1024 * 1024)));
      return void res.writeHead(200, { "content-type": "text/html", "content-encoding": "gzip" }).end(bomb);
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(() => new Promise<void>((r) => server.close(() => r())));

const local = { unsafeAllowLoopbackForTests: true, allowHttp: true } as const;

async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (e) {
    return e instanceof SafeFetchError ? e.code : `other:${String(e)}`;
  }
  return "no-error";
}

describe("safeFetch: happy paths", () => {
  it("fetches HTML and sniffs the kind from bytes", async () => {
    const r = await safeFetch(`${base}/html`, local);
    expect(r.ok).toBe(true);
    expect(r.kind).toBe("html");
    expect(Buffer.from(r.bytes).toString()).toContain("Carta");
  });

  it("ignores a lying content-type", async () => {
    const pdf = await safeFetch(`${base}/pdf`, local);
    expect(pdf.declaredType).toContain("octet-stream");
    expect(pdf.kind).toBe("pdf");
    const png = await safeFetch(`${base}/png`, local);
    expect(png.declaredType).toContain("text/html");
    expect(png.kind).toBe("png");
  });

  it("follows redirects and reports them", async () => {
    const r = await safeFetch(`${base}/r1`, local);
    expect(r.kind).toBe("html");
    expect(r.redirects).toEqual([`${base}/html`]);
    expect(r.url).toBe(`${base}/html`);
  });

  it("returns non-2xx responses without throwing", async () => {
    const r404 = await safeFetch(`${base}/404`, local);
    expect(r404.ok).toBe(false);
    expect(r404.status).toBe(404);
    expect(r404.blockedByServer).toBe(false);
    const r403 = await safeFetch(`${base}/403`, local);
    expect(r403.status).toBe(403);
    expect(r403.blockedByServer).toBe(true);
  });
});

describe("safeFetch: SSRF protection", () => {
  it("refuses loopback targets by default", async () => {
    expect(await failure(safeFetch(`${base}/html`, { allowHttp: true }))).toBe("blocked_ip");
    expect(await failure(safeFetch("https://127.0.0.1/", {}))).toBe("blocked_ip");
    expect(await failure(safeFetch("https://localhost/", {}))).toBe("blocked_host");
  });

  it("refuses non-http schemes and credentials", async () => {
    expect(await failure(safeFetch("file:///etc/passwd", local))).toBe("bad_protocol");
    expect(await failure(safeFetch("ftp://example.com/a", local))).toBe("bad_protocol");
    expect(await failure(safeFetch("https://user:pw@example.com/", {}))).toBe("credentials_in_url");
  });

  it("blocks redirects to cloud metadata and private ranges", async () => {
    expect(await failure(safeFetch(`${base}/to-metadata`, local))).toBe("blocked_ip");
    expect(await failure(safeFetch(`${base}/to-private`, local))).toBe("blocked_ip");
  });

  it("blocks redirects to other schemes and ports", async () => {
    expect(await failure(safeFetch(`${base}/to-file`, local))).toBe("bad_protocol");
    expect(await failure(safeFetch(`${base}/to-port`, local))).toBe("bad_port");
  });

  it("stops redirect loops", async () => {
    expect(await failure(safeFetch(`${base}/loop`, local))).toBe("too_many_redirects");
    expect(await failure(safeFetch(`${base}/r1`, { ...local, maxRedirects: 0 }))).toBe("too_many_redirects");
  });

  it("blocks hostnames that resolve to private addresses at connect time", async () => {
    const resolver = async () => [{ address: "10.1.2.3", family: 4 as const }];
    expect(await failure(safeFetch("https://rebind.example.com/", { resolver }))).toBe("blocked_ip");
  });

  it("blocks when DNS answers include a metadata address", async () => {
    const resolver = async () => [{ address: "169.254.169.254", family: 4 as const }];
    expect(await failure(safeFetch("https://rebind.example.com/", { resolver }))).toBe("blocked_ip");
  });

  it("does not expose the loopback escape hatch outside tests", async () => {
    const previous = process.env.NODE_ENV;
    (process.env as Record<string, string>).NODE_ENV = "production";
    try {
      await expect(safeFetch(`${base}/html`, local)).rejects.toThrow(/NODE_ENV=test/);
    } finally {
      (process.env as Record<string, string>).NODE_ENV = previous ?? "test";
    }
  });
});

describe("safeFetch: limits", () => {
  it("rejects bodies that grow past the HTML limit", async () => {
    expect(await failure(safeFetch(`${base}/big-html`, { ...local, maxHtmlBytes: 128 * 1024 }))).toBe("too_large");
  });

  it("rejects a declared content length above the hard cap", async () => {
    expect(await failure(safeFetch(`${base}/declared-huge`, local))).toBe("too_large");
  });

  it("applies the per-kind PDF and image caps", async () => {
    expect(await failure(safeFetch(`${base}/pdf`, { ...local, maxPdfBytes: 1024 }))).toBe("too_large");
    expect(await failure(safeFetch(`${base}/png`, { ...local, maxImageBytes: 1024 }))).toBe("too_large");
  });

  it("rejects content types outside the allowlist", async () => {
    expect(await failure(safeFetch(`${base}/zip`, local))).toBe("unsupported_type");
    expect(await failure(safeFetch(`${base}/pdf`, { ...local, allowedKinds: ["html"] }))).toBe("unsupported_type");
  });

  it("times out slow responses", async () => {
    expect(await failure(safeFetch(`${base}/slow`, { ...local, timeoutMs: 200 }))).toBe("timeout");
  });

  it("honours a caller abort signal", async () => {
    const controller = new AbortController();
    const pending = safeFetch(`${base}/slow`, { ...local, signal: controller.signal, timeoutMs: 5000 });
    setTimeout(() => controller.abort(), 100);
    expect(await failure(pending)).toBe("aborted");
  });

  it("caps decoded size of a compressed response", async () => {
    expect(await failure(safeFetch(`${base}/gzip-bomb`, { ...local, maxHtmlBytes: 1024 * 1024 }))).toBe("too_large");
  });
});

describe("sniffKind", () => {
  it("detects binary formats by magic bytes", () => {
    expect(sniffKind(PDF)).toBe("pdf");
    expect(sniffKind(PNG)).toBe("png");
    expect(sniffKind(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10]))).toBe("jpeg");
    expect(sniffKind(Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBPVP8 ")]))).toBe("webp");
  });

  it("separates HTML, plain text and unknown binary", () => {
    expect(sniffKind(Buffer.from(HTML))).toBe("html");
    expect(sniffKind(Buffer.from("Pa amb tomàquet 4,50\nEscalivada 9,80\n"))).toBe("text");
    expect(sniffKind(ZIP)).toBe("unknown");
    expect(sniffKind(Buffer.alloc(0))).toBe("unknown");
    expect(sniffKind(Buffer.from([0x7f, 0x45, 0x4c, 0x46, 0, 0, 0, 0]))).toBe("unknown");
  });
});
