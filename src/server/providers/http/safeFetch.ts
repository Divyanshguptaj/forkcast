import { Agent, fetch as undiciFetch } from "undici";
import { FETCH_LIMITS } from "@/config/limits";
import { sniffKind, type SniffedKind } from "./sniff";
import {
  createGuardedLookup,
  GuardedLookupError,
  UrlGuardError,
  validateUrl,
  type Resolver,
  type UrlGuardCode,
} from "./urlGuard";

export type SafeFetchErrorCode =
  | UrlGuardCode
  | "timeout"
  | "aborted"
  | "network"
  | "too_many_redirects"
  | "too_large"
  | "unsupported_type";

export class SafeFetchError extends Error {
  constructor(
    readonly code: SafeFetchErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "SafeFetchError";
  }
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxRedirects?: number;
  maxHtmlBytes?: number;
  maxPdfBytes?: number;
  maxImageBytes?: number;
  allowedKinds?: readonly SniffedKind[];
  allowHttp?: boolean;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  resolver?: Resolver;
  unsafeAllowLoopbackForTests?: boolean;
}

export interface SafeFetchResult {
  ok: boolean;
  status: number;
  url: string;
  redirects: string[];
  declaredType: string;
  kind: SniffedKind;
  bytes: Uint8Array;
  blockedByServer: boolean;
  durationMs: number;
}

const DEFAULT_KINDS: readonly SniffedKind[] = ["html", "text", "pdf", "jpeg", "png", "webp"];
const ERROR_BODY_CAP = 64 * 1024;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const BLOCKED_STATUSES = new Set([401, 403, 429]);

const DEFAULT_HEADERS: Record<string, string> = {
  "user-agent": "Mozilla/5.0 (compatible; ForkcastBot/0.1)",
  accept: "text/html,application/pdf,image/*;q=0.8,*/*;q=0.5",
  "accept-language": "es,ca;q=0.9,en;q=0.8",
};

function capForKind(kind: SniffedKind, o: Required<Pick<SafeFetchOptions, "maxHtmlBytes" | "maxPdfBytes" | "maxImageBytes">>): number {
  if (kind === "pdf") return o.maxPdfBytes;
  if (kind === "jpeg" || kind === "png" || kind === "webp") return o.maxImageBytes;
  return o.maxHtmlBytes;
}

function toFetchError(err: unknown, signal: AbortSignal, external?: AbortSignal): SafeFetchError {
  if (err instanceof SafeFetchError) return err;
  if (err instanceof UrlGuardError) return new SafeFetchError(err.code, err.message);
  if (external?.aborted) return new SafeFetchError("aborted", "Request aborted");
  if (signal.aborted) return new SafeFetchError("timeout", "Request timed out");
  let cause: unknown = (err as { cause?: unknown })?.cause;
  for (let depth = 0; cause && depth < 5; depth++) {
    if (cause instanceof GuardedLookupError) return new SafeFetchError(cause.guardCode, cause.message);
    if (cause instanceof UrlGuardError) return new SafeFetchError(cause.code, cause.message);
    cause = (cause as { cause?: unknown }).cause;
  }
  return new SafeFetchError("network", "Network error");
}

async function readCapped(
  body: ReadableStream<Uint8Array> | null,
  limits: Required<Pick<SafeFetchOptions, "maxHtmlBytes" | "maxPdfBytes" | "maxImageBytes">>,
  allowedKinds: readonly SniffedKind[],
  errorResponse: boolean,
): Promise<{ bytes: Uint8Array; kind: SniffedKind }> {
  if (!body) return { bytes: new Uint8Array(0), kind: "unknown" };
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let kind: SniffedKind | undefined;
  const absoluteCap = errorResponse
    ? ERROR_BODY_CAP
    : Math.max(limits.maxHtmlBytes, limits.maxPdfBytes, limits.maxImageBytes);

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      total += value.byteLength;

      if (kind === undefined && total >= 1024) {
        kind = sniffKind(concat(chunks, total));
        if (!errorResponse && !allowedKinds.includes(kind)) {
          throw new SafeFetchError("unsupported_type", `Content type not allowed: ${kind}`);
        }
      }
      const cap = errorResponse ? ERROR_BODY_CAP : kind ? capForKind(kind, limits) : absoluteCap;
      if (total > cap) {
        if (errorResponse) break;
        throw new SafeFetchError("too_large", "Response exceeds size limit");
      }
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }

  const bytes = concat(chunks, total);
  kind ??= sniffKind(bytes);
  if (!errorResponse) {
    if (!allowedKinds.includes(kind)) {
      throw new SafeFetchError("unsupported_type", `Content type not allowed: ${kind}`);
    }
    if (bytes.byteLength > capForKind(kind, limits)) {
      throw new SafeFetchError("too_large", "Response exceeds size limit");
    }
  }
  return { bytes, kind };
}

function concat(chunks: Uint8Array[], total: number): Uint8Array {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    out.set(c, offset);
    offset += c.byteLength;
  }
  return out;
}

export async function safeFetch(input: string, options: SafeFetchOptions = {}): Promise<SafeFetchResult> {
  if (options.unsafeAllowLoopbackForTests && process.env.NODE_ENV !== "test") {
    throw new Error("unsafeAllowLoopbackForTests is only available when NODE_ENV=test");
  }

  const started = Date.now();
  const timeoutMs = options.timeoutMs ?? FETCH_LIMITS.timeoutMs;
  const maxRedirects = options.maxRedirects ?? FETCH_LIMITS.maxRedirects;
  const allowedKinds = options.allowedKinds ?? DEFAULT_KINDS;
  const limits = {
    maxHtmlBytes: options.maxHtmlBytes ?? FETCH_LIMITS.maxHtmlBytes,
    maxPdfBytes: options.maxPdfBytes ?? FETCH_LIMITS.maxPdfBytes,
    maxImageBytes: options.maxImageBytes ?? FETCH_LIMITS.maxImageBytes,
  };
  const guard = {
    allowHttp: options.allowHttp ?? false,
    allowLoopback: options.unsafeAllowLoopbackForTests ?? false,
  };

  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = options.signal ? AbortSignal.any([timeoutSignal, options.signal]) : timeoutSignal;

  const agent = new Agent({
    connect: { lookup: createGuardedLookup({ allowLoopback: guard.allowLoopback, resolver: options.resolver }) },
  });

  const redirects: string[] = [];
  let current = input;

  try {
    current = validateUrl(input, guard).toString();
    for (let hop = 0; hop <= maxRedirects; hop++) {
      const response = await undiciFetch(current, {
        method: "GET",
        redirect: "manual",
        dispatcher: agent,
        signal,
        headers: { ...DEFAULT_HEADERS, ...options.headers },
      });

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel().catch(() => undefined);
        if (!location) throw new SafeFetchError("network", "Redirect without location");
        if (hop === maxRedirects) throw new SafeFetchError("too_many_redirects", "Too many redirects");
        current = validateUrl(new URL(location, current), guard).toString();
        redirects.push(current);
        continue;
      }

      const declared = response.headers.get("content-type") ?? "";
      const lengthHeader = Number(response.headers.get("content-length") ?? "0");
      const hardCap = Math.max(limits.maxHtmlBytes, limits.maxPdfBytes, limits.maxImageBytes);
      if (response.ok && lengthHeader > hardCap) {
        await response.body?.cancel().catch(() => undefined);
        throw new SafeFetchError("too_large", "Declared content length exceeds size limit");
      }

      const { bytes, kind } = await readCapped(response.body as unknown as ReadableStream<Uint8Array> | null, limits, allowedKinds, !response.ok);
      return {
        ok: response.ok,
        status: response.status,
        url: current,
        redirects,
        declaredType: declared,
        kind,
        bytes,
        blockedByServer: BLOCKED_STATUSES.has(response.status),
        durationMs: Date.now() - started,
      };
    }
    throw new SafeFetchError("too_many_redirects", "Too many redirects");
  } catch (err) {
    throw toFetchError(err, signal, options.signal);
  } finally {
    await agent.close().catch(() => undefined);
  }
}
