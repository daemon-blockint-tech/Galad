import {
 beforeEach, describe, expect, it, vi
} from "vitest";
import { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

vi.mock("next-auth/jwt", () => ({ getToken: vi.fn() }));

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
        vi.mocked(getToken).mockResolvedValue({ sub: "user-1", tenantId: "acme" });
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

    it.each(tenantlessPaths)("refuses a tenantless cloud host outright for %s (%s)", async (path) => {
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("app.grond.dev", path, { "x-tenant-subdomain": "victim" }));
        // Passing through untenanted is what let an apex request read across
        // every workspace; a spoofed header must not turn into a 200 either.
        expect(res!.status).toBe(404);
    });

    it("strips a spoofed header in the demo edition", async () => {
        const proxy = await loadProxy("demo");
        const res = await proxy(request("acme.localhost:3000", "/dashboard", { "x-tenant-subdomain": "victim" }));
        expect(tenantSeenDownstream(res!)).toBeNull();
    });
});

describe("cross-tenant session replay", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "active" })));
    });

    // AUTH_SECRET is one global value, so a JWT minted on one workspace verifies
    // on every other one. Only the tenantId claim distinguishes them.
    const replayPaths = ["/api/ops/system-alerts", "/api/marketplace/uninstall", "/ops"] as const;

    it.each(replayPaths)("rejects a foreign workspace's session on %s", async (path) => {
        vi.mocked(getToken).mockResolvedValue({ sub: "mallory", tenantId: "mallory" });
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("victim.app.grond.dev", path));
        expect(res!.status).toBe(403);
    });

    it("rejects a session minted before the tenant claim existed", async () => {
        vi.mocked(getToken).mockResolvedValue({ sub: "user-1" });
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("acme.app.grond.dev", "/api/ops/alerts"));
        expect(res!.status).toBe(403);
    });

    it("admits a session minted on this workspace", async () => {
        vi.mocked(getToken).mockResolvedValue({ sub: "user-1", tenantId: "acme" });
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("acme.app.grond.dev", "/api/ops/alerts"));
        expect(tenantSeenDownstream(res!)).toBe("acme");
    });

    it("leaves anonymous requests to the route's own gate", async () => {
        vi.mocked(getToken).mockResolvedValue(null);
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("acme.app.grond.dev", "/api/marketplace/status"));
        expect(tenantSeenDownstream(res!)).toBe("acme");
    });

    it("exempts /api/auth so a stale cookie cannot block signing in here", async () => {
        vi.mocked(getToken).mockResolvedValue({ sub: "mallory", tenantId: "mallory" });
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("victim.app.grond.dev", "/api/auth/callback/credentials"));
        expect(tenantSeenDownstream(res!)).toBe("victim");
    });
});

describe("cloud host guard", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "active" })));
        vi.mocked(getToken).mockResolvedValue(null);
    });

    it("lets the middleware's own loopback self-fetch through untenanted", async () => {
        // internalAppUrl() defaults to http://127.0.0.1:PORT — 404ing this
        // deadlocks the workspace lookup that gates every cloud page.
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("127.0.0.1:3000", "/api/internal/workspace/acme"));
        expect(tenantSeenDownstream(res!)).toBeNull();
    });

    it("lets /api/internal through even when the self-fetch is pointed off loopback", async () => {
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("app.grond.dev", "/api/internal/workspace/acme"));
        expect(tenantSeenDownstream(res!)).toBeNull();
    });

    it("still redirects the apex marketing paths to the hub", async () => {
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("app.grond.dev", "/"));
        expect(res!.status).toBe(307);
        expect(res!.headers.get("location")).toBe("https://grond.dev/hub");
    });

    it("refuses an unmapped custom domain", async () => {
        const proxy = await loadProxy("cloud");
        const res = await proxy(request("intel.example.com", "/api/marketplace/check-updates"));
        expect(res!.status).toBe(404);
    });
});

describe("self-hosted editions are unaffected", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({ needsSetup: false })));
        vi.mocked(getToken).mockResolvedValue({ sub: "user-1" });
    });

    // Local has no subdomain, no workspace and no tenant claim. Every guard
    // above must be invisible to it.
    it.each(["local", "demo"])("passes a tenantless host through on edition %s", async (edition) => {
        const proxy = await loadProxy(edition);
        for (const path of ["/api/ops/alerts", "/settings", "/"]) {
            const res = await proxy(request("grond.internal", path));
            expect(tenantSeenDownstream(res!)).toBeNull();
        }
    });

    it("keeps the first-run setup redirect on local", async () => {
        vi.mocked(getToken).mockResolvedValue(null);
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({ needsSetup: true })));
        const proxy = await loadProxy("local");
        const res = await proxy(request("grond.internal", "/settings"));
        expect(res!.headers.get("location")).toContain("/setup");
    });
});

describe("admin route gate", () => {
    beforeEach(() => {
        vi.stubGlobal("fetch", vi.fn(async () => Response.json({ status: "active" })));
    });

    it("lets an admin through to /admin", async () => {
        // Regression: getToken returns the flat JWT payload, but isPlatformAdmin
        // expects a session shape. Passing the token straight in made
        // `session.user` undefined, so every real admin was bounced to
        // /admin/forbidden and the console was unreachable.
        const proxy = await loadProxy("local");
        vi.mocked(getToken).mockResolvedValue({ sub: "u1", role: "admin" });

        const res = await proxy(request("app.local", "/admin/overview"));

        expect(res.headers.get("location")).toBeNull();
    });

    it("bounces a non-admin to /admin/forbidden", async () => {
        const proxy = await loadProxy("local");
        vi.mocked(getToken).mockResolvedValue({ sub: "u1", role: "user" });

        const res = await proxy(request("app.local", "/admin/overview"));

        expect(res.headers.get("location")).toContain("/admin/forbidden");
    });

    it("sends an anonymous visitor to login", async () => {
        const proxy = await loadProxy("local");
        vi.mocked(getToken).mockResolvedValue(null);

        const res = await proxy(request("app.local", "/admin/overview"));

        expect(res.headers.get("location")).toContain("/login");
    });
});
