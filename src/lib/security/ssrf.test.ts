/**
 * isPrivateIP guards every camera proxy against SSRF. It used to prefix-match on
 * the dotted string, which let 100.64.0.0/10 (CGNAT — Tailscale's whole range),
 * 192.0.0.0/24, 198.18.0.0/15, multicast and reserved space through to the
 * socket, and did not recognise IPv4-mapped IPv6 forms of loopback.
 */
import { describe, expect, it } from "vitest";

import { isPrivateIP, validateOrigin } from "./ssrf";

describe("isPrivateIP", () => {
    it.each([
        ["127.0.0.1", "loopback"],
        ["127.1.2.3", "loopback, non-.1 host"],
        ["10.0.0.5", "RFC1918 /8"],
        ["172.16.0.1", "RFC1918 /12 lower bound"],
        ["172.31.255.254", "RFC1918 /12 upper bound"],
        ["192.168.1.1", "RFC1918 /16"],
        ["169.254.169.254", "cloud metadata"],
        ["0.0.0.0", "this network"],
        ["100.64.0.1", "CGNAT lower bound"],
        ["100.127.255.254", "CGNAT upper bound"],
        ["192.0.0.1", "IETF protocol assignments"],
        ["198.18.0.1", "benchmarking"],
        ["198.19.255.254", "benchmarking upper bound"],
        ["224.0.0.1", "multicast"],
        ["240.0.0.1", "reserved"],
        ["255.255.255.255", "broadcast"],
        ["::1", "IPv6 loopback"],
        ["::", "IPv6 unspecified"],
        ["fd00::1", "unique local"],
        ["fe80::1", "link local"],
        ["::ffff:127.0.0.1", "IPv4-mapped loopback"],
        ["::ffff:169.254.169.254", "IPv4-mapped metadata"],
        ["[::1]", "bracketed IPv6 loopback"],
        ["fe80::1%eth0", "link local with a zone id"],
        ["ff02::1", "IPv6 multicast"],
        ["2002:7f00:1::", "6to4 embedding 127.0.0.1"],
        ["2001:0:0:0:0:0:0:1", "Teredo"],
        ["64:ff9b::a00:1", "NAT64 embedding 10.0.0.1"],
        ["100::1", "discard-only"],
    ])("blocks %s (%s)", (ip) => {
        expect(isPrivateIP(ip)).toBe(true);
    });

    it.each([
        ["8.8.8.8", "public DNS"],
        ["1.1.1.1", "public DNS"],
        ["172.15.0.1", "just below the RFC1918 /12"],
        ["172.32.0.1", "just above the RFC1918 /12"],
        ["100.63.255.255", "just below CGNAT"],
        ["100.128.0.0", "just above CGNAT"],
        ["192.0.1.1", "just above the protocol-assignments /24"],
        ["223.255.255.255", "just below multicast"],
        ["2606:4700:4700::1111", "public IPv6"],
    ])("allows %s (%s)", (ip) => {
        expect(isPrivateIP(ip)).toBe(false);
    });

    it("treats a hostname as not-an-address so the caller resolves it first", () => {
        expect(isPrivateIP("example.com")).toBe(false);
        expect(isPrivateIP("localhost")).toBe(false);
    });

    it("rejects zero-padded octets rather than misreading them as decimal", () => {
        // 0177.0.0.1 is octal for 127.0.0.1. It is not a form dns.lookup returns,
        // so it must not be parsed as a public dotted-quad either.
        expect(isPrivateIP("0177.0.0.1")).toBe(false);
        expect(isPrivateIP("010.0.0.1")).toBe(false);
    });
});

describe("validateOrigin", () => {
    it("allows https only", () => {
        expect(validateOrigin("https://example.com")).toBe(true);
        expect(validateOrigin("http://example.com")).toBe(false);
        expect(validateOrigin("file:///etc/passwd")).toBe(false);
        expect(validateOrigin("gopher://example.com")).toBe(false);
        expect(validateOrigin("not a url")).toBe(false);
    });
});
