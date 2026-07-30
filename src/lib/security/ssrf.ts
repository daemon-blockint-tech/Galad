import dns from "dns/promises";
import { fetch, Agent } from "undici";

/**
 * IPv4 ranges that must never be reachable from a user-supplied URL.
 * Prefix-matching on the dotted string missed several of these — notably
 * 100.64.0.0/10, which is CGNAT and is Tailscale's entire address space.
 */
const BLOCKED_V4_RANGES: ReadonlyArray<readonly [string, number]> = [
    ["0.0.0.0", 8], // this network
    ["10.0.0.0", 8], // RFC1918
    ["100.64.0.0", 10], // CGNAT / Tailscale
    ["127.0.0.0", 8], // loopback
    ["169.254.0.0", 16], // link-local, incl. cloud metadata
    ["172.16.0.0", 12], // RFC1918
    ["192.0.0.0", 24], // IETF protocol assignments
    ["192.0.2.0", 24], // TEST-NET-1
    ["192.168.0.0", 16], // RFC1918
    ["198.18.0.0", 15], // benchmarking
    ["198.51.100.0", 24], // TEST-NET-2
    ["203.0.113.0", 24], // TEST-NET-3
    ["224.0.0.0", 4], // multicast
    ["240.0.0.0", 4], // reserved, incl. 255.255.255.255
];

function toV4Int(ip: string): number | null {
    const parts = ip.split(".");
    if (parts.length !== 4) return null;
    let value = 0;
    for (const part of parts) {
        // Reject empty, non-decimal, and zero-padded forms; dns.lookup returns
        // canonical dotted-quad, so anything else is not an address we resolved.
        if (!/^\d{1,3}$/.test(part) || (part.length > 1 && part[0] === "0")) return null;
        const octet = Number(part);
        if (octet > 255) return null;
        value = value * 256 + octet;
    }
    return value;
}

/**
 * True when the address is one a server must not be talked into reaching.
 * Returns false for hostnames — callers resolve first and re-check the result.
 */
export function isPrivateIP(ip: string): boolean {
    const address = ip.trim().replace(/^\[|\]$/g, "");

    // IPv4-mapped and IPv4-compatible IPv6 (::ffff:127.0.0.1) reach the IPv4 host.
    const mapped = /^::(?:ffff:)?(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address);
    const v4 = toV4Int(mapped ? mapped[1] : address);
    if (v4 !== null) {
        return BLOCKED_V4_RANGES.some(([base, bits]) => {
            const baseInt = toV4Int(base);
            if (baseInt === null) return false;
            const mask = bits === 0 ? 0 : (-1 << (32 - bits)) >>> 0;
            return (v4 & mask) >>> 0 === (baseInt & mask) >>> 0;
        });
    }

    if (!address.includes(":")) return false; // a hostname, not an address

    // Drop any zone id (fe80::1%eth0) before matching.
    const v6 = address.toLowerCase().split("%")[0];
    if (v6 === "::" || v6 === "::1") return true; // unspecified, loopback
    if (/^f[cd]/.test(v6)) return true; // fc00::/7 unique-local
    if (/^fe[89ab]/.test(v6)) return true; // fe80::/10 link-local
    if (/^ff/.test(v6)) return true; // ff00::/8 multicast
    if (/^2002:/.test(v6)) return true; // 6to4 — embeds an arbitrary IPv4 destination
    if (/^2001:0*:/.test(v6)) return true; // Teredo
    if (/^64:ff9b:/.test(v6)) return true; // NAT64 — embeds an arbitrary IPv4 destination
    if (/^100::/.test(v6)) return true; // discard-only
    return false;
}

export function validateOrigin(urlStr: string): boolean {
    try {
        const url = new URL(urlStr);
        return url.protocol === "https:";
    } catch {
        return false;
    }
}

interface FetchOptions extends RequestInit {
    maxSize?: number;
    timeout?: number;
}

export async function safeFetch(urlStr: string, options: FetchOptions = {}): Promise<Response> {
    if (!validateOrigin(urlStr)) {
        throw new Error("SSRF Error: Invalid protocol. Only HTTPS is allowed.");
    }

    const url = new URL(urlStr);

    if (isPrivateIP(url.hostname)) {
        throw new Error("SSRF Error: Private IP provided in URL.");
    }

    let resolvedIp: string;
    let resolvedFamily: number;
    try {
        const lookupResult = await dns.lookup(url.hostname);
        resolvedIp = lookupResult.address;
        resolvedFamily = lookupResult.family;
        if (isPrivateIP(resolvedIp)) {
            throw new Error("SSRF Error: Host resolves to a private IP.");
        }
    } catch (err: any) {
        if (err.message.includes("SSRF")) throw err;
        throw new Error(`SSRF Error: DNS resolution failed - ${err.message}`);
    }

    const customAgent = new Agent({
        connect: {
            lookup: (hostname, opts, callback) => {
                callback(null, [{ address: resolvedIp, family: resolvedFamily }]);
            }
        }
    });

    const maxSize = options.maxSize || 5 * 1024 * 1024;
    const timeout = options.timeout || 10000;

    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), timeout);

    try {
        const fetchOptions: any = {
            ...options,
            dispatcher: customAgent,
            redirect: "manual",
            signal: controller.signal
        };
        const response = await fetch(urlStr, fetchOptions);

        if (response.body) {
            let totalSize = 0;
            const reader = response.body.getReader();
            const stream = new ReadableStream({
                async pull(controller) {
                    try {
                        const { done, value } = await reader.read();
                        if (done) {
                            controller.close();
                            return;
                        }
                        totalSize += value.byteLength;
                        if (totalSize > maxSize) {
                            controller.error(new Error("SSRF Error: Response size exceeded maximum limit."));
                            reader.cancel();
                            return;
                        }
                        controller.enqueue(value);
                    } catch (err) {
                        controller.error(err);
                    }
                },
                cancel() {
                    reader.cancel();
                }
            });

            return new Response(stream, {
                status: response.status,
                headers: response.headers as any
            });
        }

        return response as unknown as Response;
    } finally {
        clearTimeout(id);
    }
}
