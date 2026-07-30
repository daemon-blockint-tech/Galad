import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn(async () => ({ sub: "user-1" })) }));

/**
 * Reads back the tenant as downstream `headers()` would see it.
 *
 * Middleware forwards request headers by encoding them onto the response as
 * `x-middleware-request-*`, listed in `x-middleware-override-headers`. Next
 * replays those onto the request before the route handler runs, so this is the
 * value `headers().get("x-tenant-subdomain")` resolves to. A plain
 * `res.headers.set()` produces no override entry and is invisible downstream.
 */
function tenantSeenDownstream(res: Response): string | null {
    const overrides = res.headers.get("x-middleware-override-headers");
    if (!overrides) throw new Error("middleware did not forward any request headers");
    if (!overrides.split(",").includes("x-tenant-subdomain")) return null;
    return res.headers.get("x-middleware-request-x-tenant-subdomain");
}

function request(host: string, path: string, extraHeaders: Record<string, string> = {}) {
    return new NextRequest(`http://${host}${path}`, { headers: { host, ...extraHeaders } });
}

async function loadProxy(edition: string) {
    process.env.NEXT_PUBLIC_MAVEN_EDITION = edition;
    vi.resetModules(); // `isDemo` is resolved at module load
    return (await import("@/proxy")).default;
}

describe("proxy tenant header", () => {
    beforeEach(() => {
        // Workspace lookup for cloud hosts; unresolved workspaces short-circuit to a 404.
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "active" })));
    });

    // One case per `NextResponse.next()` call site in the non-demo flow.
    const tenantPaths = [
        ["/api/ops/alerts", "static/api early-return"],
        ["/login", "setup/login"],
        ["/dashboard", "authenticated"],
    ] as const;

    // Same three call sites, on a host that carries no tenant.
    const tenantlessPaths = [
        ["/api/ops/alerts", "static/api early-return"],
        ["/login", "setup/login"],
        ["/settings", "authenticated"],
    ] as const;

    it.each(tenantPaths)("forwards the subdomain to the request for %s (%s)", async (path) => {
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("acme.localhost:3000", path));
        expect(tenantSeenDownstream(res!)).toBe("acme");
    });

    it.each(tenantPaths)("overwrites a client-supplied header for %s (%s)", async (path) => {
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("acme.localhost:3000", path, { "x-tenant-subdomain": "victim" }));
        expect(tenantSeenDownstream(res!)).toBe("acme");
    });

    it.each(tenantlessPaths)("strips a spoofed header on a tenantless host for %s (%s)", async (path) => {
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("app.grond.dev", path, { "x-tenant-subdomain": "victim" }));
        expect(tenantSeenDownstream(res!)).toBeNull();
    });

    it("strips a spoofed header in the demo edition", async () => {
        const proxy = await loadProxy("demo");
        const res = await proxy(request("acme.localhost:3000", "/dashboard", { "x-tenant-subdomain": "victim" }));
        expect(tenantSeenDownstream(res!)).toBeNull();
    });
});
