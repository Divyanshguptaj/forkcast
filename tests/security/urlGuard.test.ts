import { describe, expect, it } from "vitest";
import {
  GuardedLookupError,
  UrlGuardError,
  createGuardedLookup,
  isBlockedIp,
  resolvePublicAddresses,
  validateUrl,
  type Resolver,
} from "@/server/providers/http/urlGuard";

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof UrlGuardError ? e.code : "other";
  }
  return undefined;
}

describe("validateUrl: accepted", () => {
  it.each([
    "https://example.com/",
    "https://www.restaurant.es/carta.pdf",
    "https://sub.domain.example.org/menu?lang=ca",
    "https://example.com:443/menu",
    "https://8.8.8.8/",
    "https://[2606:4700:4700::1111]/",
  ])("%s", (url) => {
    expect(codeOf(() => validateUrl(url))).toBeUndefined();
  });

  it("allows http only when asked", () => {
    expect(codeOf(() => validateUrl("http://example.com/"))).toBe("bad_protocol");
    expect(codeOf(() => validateUrl("http://example.com/", { allowHttp: true }))).toBeUndefined();
  });
});

describe("validateUrl: protocol and syntax", () => {
  it.each(["file:///etc/passwd", "ftp://example.com/x", "javascript:alert(1)", "data:text/html,hi", "gopher://example.com/", "ws://example.com/"])(
    "rejects %s",
    (url) => {
      expect(codeOf(() => validateUrl(url, { allowHttp: true }))).toBe("bad_protocol");
    },
  );

  it.each(["", "not a url", "https://", "//example.com"])("rejects malformed %j", (url) => {
    expect(codeOf(() => validateUrl(url))).toBe("invalid_url");
  });

  it("rejects credentials in the URL", () => {
    expect(codeOf(() => validateUrl("https://user:pass@example.com/"))).toBe("credentials_in_url");
    expect(codeOf(() => validateUrl("https://user@example.com/"))).toBe("credentials_in_url");
  });

  it("rejects overlong URLs", () => {
    expect(codeOf(() => validateUrl(`https://example.com/${"a".repeat(2100)}`))).toBe("url_too_long");
  });
});

describe("validateUrl: private and special hosts", () => {
  it.each([
    "https://127.0.0.1/",
    "https://127.1.2.3/",
    "https://10.0.0.1/",
    "https://10.255.255.255/",
    "https://172.16.0.1/",
    "https://172.31.255.255/",
    "https://192.168.1.1/",
    "https://169.254.169.254/latest/meta-data/",
    "https://100.64.0.1/",
    "https://0.0.0.0/",
    "https://224.0.0.1/",
    "https://255.255.255.255/",
    "https://198.18.0.1/",
    "https://[::1]/",
    "https://[::]/",
    "https://[fe80::1]/",
    "https://[fc00::1]/",
    "https://[fd12:3456:789a::1]/",
    "https://[::ffff:127.0.0.1]/",
    "https://[::ffff:10.0.0.1]/",
    "https://[::ffff:a9fe:a9fe]/",
    "https://[64:ff9b::7f00:1]/",
    "https://[2002:7f00:1::1]/",
  ])("blocks %s", (url) => {
    expect(codeOf(() => validateUrl(url))).toBe("blocked_ip");
  });

  it.each([
    "https://2130706433/",
    "https://0x7f.0.0.1/",
    "https://0177.0.0.1/",
    "https://017700000001/",
    "https://127.1/",
    "https://0/",
  ])("blocks numeric loopback encoding %s", (url) => {
    expect(codeOf(() => validateUrl(url))).toBe("blocked_ip");
  });

  it.each([
    "https://localhost/",
    "https://LOCALHOST/",
    "https://localhost./",
    "https://app.localhost/",
    "https://printer.local/",
    "https://db.internal/",
    "https://router.lan/",
    "https://intranet/",
    "https://metadata.google.internal/",
  ])("blocks hostname %s", (url) => {
    expect(codeOf(() => validateUrl(url))).toBe("blocked_host");
  });

  it("blocks non-standard ports", () => {
    for (const port of [22, 25, 3306, 6379, 8080, 8443]) {
      expect(codeOf(() => validateUrl(`https://example.com:${port}/`)), String(port)).toBe("bad_port");
    }
  });

  it("allows loopback only with the explicit test option", () => {
    expect(codeOf(() => validateUrl("https://127.0.0.1:5555/", { allowLoopback: true }))).toBeUndefined();
    expect(codeOf(() => validateUrl("https://127.0.0.1:5555/"))).toBe("blocked_ip");
    expect(codeOf(() => validateUrl("https://10.0.0.1/", { allowLoopback: true }))).toBe("blocked_ip");
    expect(codeOf(() => validateUrl("https://169.254.169.254/", { allowLoopback: true }))).toBe("blocked_ip");
  });
});

describe("isBlockedIp", () => {
  it.each(["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111", "172.15.0.1", "172.32.0.1", "100.63.255.255", "100.128.0.1"])(
    "public %s is allowed",
    (ip) => {
      expect(isBlockedIp(ip)).toBe(false);
    },
  );

  it("treats unparseable input as blocked", () => {
    expect(isBlockedIp("not-an-ip")).toBe(true);
    expect(isBlockedIp("")).toBe(true);
  });

  it("unmaps IPv4-mapped IPv6 addresses", () => {
    expect(isBlockedIp("::ffff:8.8.8.8")).toBe(false);
    expect(isBlockedIp("::ffff:7f00:1")).toBe(true);
  });
});

describe("DNS resolution guard", () => {
  const fixed =
    (...addresses: string[]): Resolver =>
    async () =>
      addresses.map((address) => ({ address, family: address.includes(":") ? 6 : 4 }));

  it("accepts hostnames that resolve to public addresses", async () => {
    const out = await resolvePublicAddresses("example.com", { resolver: fixed("93.184.216.34") });
    expect(out[0].address).toBe("93.184.216.34");
  });

  it("rejects hostnames that resolve to private addresses (DNS rebinding)", async () => {
    await expect(resolvePublicAddresses("evil.example", { resolver: fixed("10.0.0.5") })).rejects.toMatchObject({
      code: "blocked_ip",
    });
    await expect(resolvePublicAddresses("evil.example", { resolver: fixed("169.254.169.254") })).rejects.toMatchObject({
      code: "blocked_ip",
    });
  });

  it("rejects when any one of several records is private", async () => {
    await expect(
      resolvePublicAddresses("mixed.example", { resolver: fixed("93.184.216.34", "127.0.0.1") }),
    ).rejects.toMatchObject({ code: "blocked_ip" });
    await expect(
      resolvePublicAddresses("mixed.example", { resolver: fixed("93.184.216.34", "::1") }),
    ).rejects.toMatchObject({ code: "blocked_ip" });
  });

  it("maps resolver failures to dns_failed", async () => {
    const failing: Resolver = async () => {
      throw new Error("ENOTFOUND");
    };
    await expect(resolvePublicAddresses("nope.example", { resolver: failing })).rejects.toMatchObject({
      code: "dns_failed",
    });
    await expect(resolvePublicAddresses("empty.example", { resolver: fixed() })).rejects.toMatchObject({
      code: "dns_failed",
    });
  });

  it("guarded lookup returns the validated address for connection pinning", async () => {
    const lookup = createGuardedLookup({ resolver: fixed("93.184.216.34") });
    const single = await new Promise<{ err: unknown; address: unknown; family: unknown }>((resolve) =>
      lookup("example.com", {}, (err, address, family) => resolve({ err, address, family })),
    );
    expect(single).toEqual({ err: null, address: "93.184.216.34", family: 4 });

    const all = await new Promise<{ err: unknown; address: unknown }>((resolve) =>
      lookup("example.com", { all: true }, (err, address) => resolve({ err, address })),
    );
    expect(all.address).toEqual([{ address: "93.184.216.34", family: 4 }]);
  });

  it("guarded lookup errors for a rebinding answer", async () => {
    const lookup = createGuardedLookup({ resolver: fixed("192.168.0.10") });
    const result = await new Promise<{ err: unknown }>((resolve) =>
      lookup("rebind.example", {}, (err) => resolve({ err })),
    );
    expect(result.err).toBeInstanceOf(GuardedLookupError);
    expect((result.err as GuardedLookupError).guardCode).toBe("blocked_ip");
  });
});
