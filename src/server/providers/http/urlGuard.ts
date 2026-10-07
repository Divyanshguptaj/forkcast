import dns from "node:dns";
import { BlockList, isIP } from "node:net";
import { FETCH_LIMITS } from "@/config/limits";

export type UrlGuardCode =
  | "invalid_url"
  | "url_too_long"
  | "bad_protocol"
  | "credentials_in_url"
  | "blocked_host"
  | "blocked_ip"
  | "bad_port"
  | "dns_failed";

export class UrlGuardError extends Error {
  constructor(
    readonly code: UrlGuardCode,
    message: string,
  ) {
    super(message);
    this.name = "UrlGuardError";
  }
}

export class GuardedLookupError extends Error {
  readonly code = "ECONNREFUSED";
  constructor(readonly guardCode: UrlGuardCode) {
    super(`Blocked by URL guard: ${guardCode}`);
    this.name = "GuardedLookupError";
  }
}

export interface UrlGuardOptions {
  allowHttp?: boolean;
  allowLoopback?: boolean;
  allowedPorts?: readonly number[];
}

const MAX_URL_LENGTH = 2048;

const IPV4_BLOCKED: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

const IPV6_BLOCKED: Array<[string, number]> = [
  ["::", 128],
  ["::1", 128],
  ["64:ff9b::", 96],
  ["100::", 64],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["fc00::", 7],
  ["fe80::", 10],
  ["fec0::", 10],
  ["ff00::", 8],
];

const blockList = new BlockList();
for (const [net, prefix] of IPV4_BLOCKED) blockList.addSubnet(net, prefix, "ipv4");
for (const [net, prefix] of IPV6_BLOCKED) blockList.addSubnet(net, prefix, "ipv6");

const loopbackList = new BlockList();
loopbackList.addSubnet("127.0.0.0", 8, "ipv4");
loopbackList.addAddress("::1", "ipv6");

const MAPPED_V4 = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;
const MAPPED_HEX = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/i;

function unmapIpv4(ip: string): string | undefined {
  const dotted = MAPPED_V4.exec(ip);
  if (dotted) return dotted[1];
  const hex = MAPPED_HEX.exec(ip);
  if (hex) {
    const hi = parseInt(hex[1], 16);
    const lo = parseInt(hex[2], 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return undefined;
}

export function isBlockedIp(ip: string, opts: { allowLoopback?: boolean } = {}): boolean {
  const family = isIP(ip);
  if (family === 0) return true;
  const unmapped = family === 6 ? unmapIpv4(ip) : undefined;
  const addr = unmapped ?? ip;
  const fam = unmapped ? "ipv4" : family === 6 ? "ipv6" : "ipv4";
  if (opts.allowLoopback && loopbackList.check(addr, fam)) return false;
  return blockList.check(addr, fam);
}

const BLOCKED_SUFFIXES = [
  ".localhost",
  ".local",
  ".internal",
  ".localdomain",
  ".lan",
  ".home",
  ".corp",
  ".intranet",
  ".private",
];

function stripBrackets(host: string): string {
  return host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
}

export function validateUrl(input: string | URL, opts: UrlGuardOptions = {}): URL {
  const raw = typeof input === "string" ? input : input.toString();
  if (raw.length > MAX_URL_LENGTH) throw new UrlGuardError("url_too_long", "URL too long");

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new UrlGuardError("invalid_url", "Invalid URL");
  }

  const protocolOk = url.protocol === "https:" || (opts.allowHttp === true && url.protocol === "http:");
  if (!protocolOk) throw new UrlGuardError("bad_protocol", `Protocol not allowed: ${url.protocol}`);
  if (url.username || url.password) {
    throw new UrlGuardError("credentials_in_url", "Credentials in URL are not allowed");
  }

  const host = stripBrackets(url.hostname).toLowerCase().replace(/\.$/, "");
  if (!host) throw new UrlGuardError("invalid_url", "Missing hostname");

  const literal = isIP(host) !== 0;
  if (literal) {
    if (isBlockedIp(host, { allowLoopback: opts.allowLoopback })) {
      throw new UrlGuardError("blocked_ip", "IP address is not publicly routable");
    }
  } else {
    if (host === "localhost" || BLOCKED_SUFFIXES.some((s) => host.endsWith(s)) || !host.includes(".")) {
      throw new UrlGuardError("blocked_host", "Hostname is not allowed");
    }
  }

  const loopbackHost = opts.allowLoopback === true && (literal ? isBlockedIp(host) : host === "localhost");
  if (url.port !== "" && !loopbackHost) {
    const allowed = opts.allowedPorts ?? FETCH_LIMITS.allowedPorts;
    if (!allowed.includes(Number(url.port))) throw new UrlGuardError("bad_port", `Port not allowed: ${url.port}`);
  }

  return url;
}

export interface ResolvedAddress {
  address: string;
  family: 4 | 6;
}

export type Resolver = (hostname: string) => Promise<ResolvedAddress[]>;

export const defaultResolver: Resolver = async (hostname) => {
  const results = await dns.promises.lookup(hostname, { all: true, verbatim: true });
  return results.map((r) => ({ address: r.address, family: r.family === 6 ? 6 : 4 }));
};

export async function resolvePublicAddresses(
  hostname: string,
  opts: { allowLoopback?: boolean; resolver?: Resolver } = {},
): Promise<ResolvedAddress[]> {
  const resolver = opts.resolver ?? defaultResolver;
  let addresses: ResolvedAddress[];
  try {
    addresses = await resolver(stripBrackets(hostname));
  } catch {
    throw new UrlGuardError("dns_failed", "DNS lookup failed");
  }
  if (addresses.length === 0) throw new UrlGuardError("dns_failed", "DNS returned no addresses");
  for (const a of addresses) {
    if (isBlockedIp(a.address, { allowLoopback: opts.allowLoopback })) {
      throw new UrlGuardError("blocked_ip", "Hostname resolves to a non-public address");
    }
  }
  return addresses;
}

type LookupCallback = (
  err: NodeJS.ErrnoException | null,
  address: string | dns.LookupAddress[],
  family?: number,
) => void;

export function createGuardedLookup(opts: { allowLoopback?: boolean; resolver?: Resolver } = {}) {
  return (hostname: string, options: dns.LookupOptions, callback: LookupCallback): void => {
    resolvePublicAddresses(hostname, opts).then(
      (addresses) => {
        if (options?.all) {
          callback(
            null,
            addresses.map((a) => ({ address: a.address, family: a.family })),
          );
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
      (err: unknown) => {
        callback(new GuardedLookupError(err instanceof UrlGuardError ? err.code : "dns_failed"), "");
      },
    );
  };
}
