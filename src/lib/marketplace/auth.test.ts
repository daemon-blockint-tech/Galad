// @vitest-environment node
/**
 * The bearer branch used to discard the verified payload entirely, so a token
 * minted on one workspace authorized install/uninstall/enable on any other one
 * — and it skipped the demo gate the session branch applies. These tests pin
 * both re-authorizations.
 */
import {
 afterEach, beforeEach, describe, expect, it, vi
} from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));
vi.mock("@/lib/tenant", () => ({ getTenantId: vi.fn(async () => null) }));

import { getTenantId } from "@/lib/tenant";

const ORIGINAL_EDITION = process.env.NEXT_PUBLIC_MAVEN_EDITION;

function bearerRequest(token: string): Request {
    return new Request("https://acme.app.grond.dev/api/marketplace/uninstall", {
        headers: { authorization: `Bearer ${token}` },
    });
}

async function load(edition: string) {
    process.env.NEXT_PUBLIC_MAVEN_EDITION = edition;
    vi.resetModules(); // `isDemo` is resolved at module load
    return {
        validateMarketplaceAuth: (await import("./auth")).validateMarketplaceAuth,
        issueMarketplaceToken: (await import("./marketplaceToken")).issueMarketplaceToken,
    };
}

beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-at-least-32-chars-long!!";
    vi.mocked(getTenantId).mockResolvedValue(null);
});

afterEach(() => {
    if (ORIGINAL_EDITION === undefined) {
        delete process.env.NEXT_PUBLIC_MAVEN_EDITION;
    } else {
        process.env.NEXT_PUBLIC_MAVEN_EDITION = ORIGINAL_EDITION;
    }
});

describe("marketplace bearer tokens are bound to their workspace", () => {
    it("rejects a token issued on another tenant", async () => {
        const { validateMarketplaceAuth, issueMarketplaceToken } = await load("cloud");
        vi.mocked(getTenantId).mockResolvedValue("victim");

        const mallorysToken = await issueMarketplaceToken("mallory", "mallory", "admin");
        const res = await validateMarketplaceAuth(bearerRequest(mallorysToken));

        expect(res?.status).toBe(403);
        await expect(res!.json()).resolves.toMatchObject({ error: expect.stringContaining("workspace") });
    });

    it("accepts a token replayed against the workspace that issued it", async () => {
        const { validateMarketplaceAuth, issueMarketplaceToken } = await load("cloud");
        vi.mocked(getTenantId).mockResolvedValue("acme");

        const token = await issueMarketplaceToken("user-1", "acme", "admin");
        expect(await validateMarketplaceAuth(bearerRequest(token))).toBeNull();
    });

    it("rejects a tenanted token on a request that resolved no workspace", async () => {
        const { validateMarketplaceAuth, issueMarketplaceToken } = await load("cloud");
        vi.mocked(getTenantId).mockResolvedValue(null);

        const token = await issueMarketplaceToken("user-1", "acme", "admin");
        expect((await validateMarketplaceAuth(bearerRequest(token)))?.status).toBe(403);
    });

    it("rejects a token minted before the binding existed", async () => {
        const { validateMarketplaceAuth } = await load("cloud");
        vi.mocked(getTenantId).mockResolvedValue("acme");

        const { SignJWT } = await import("jose");
        const legacy = await new SignJWT({ scope: "marketplace" })
            .setProtectedHeader({ alg: "HS256" })
            .setSubject("user-1")
            .setIssuer("grond")
            .setAudience("grond-marketplace")
            .setIssuedAt()
            .setExpirationTime("1d")
            .sign(new TextEncoder().encode(process.env.AUTH_SECRET));

        // Verification throws, so it falls through to the unauthenticated 401.
        expect((await validateMarketplaceAuth(bearerRequest(legacy)))?.status).toBe(401);
    });

    it("still 401s a request carrying neither session nor token", async () => {
        const { validateMarketplaceAuth } = await load("cloud");
        const res = await validateMarketplaceAuth(new Request("https://acme.app.grond.dev/x"));
        expect(res?.status).toBe(401);
    });
});

describe("the demo gate applies to bearer tokens too", () => {
    it("rejects a non-admin token", async () => {
        const { validateMarketplaceAuth, issueMarketplaceToken } = await load("demo");
        const token = await issueMarketplaceToken("user-1", null, "user");
        const res = await validateMarketplaceAuth(bearerRequest(token));

        expect(res?.status).toBe(403);
        await expect(res!.json()).resolves.toMatchObject({ error: "Admin access required" });
    });

    it("admits the demo admin's own token", async () => {
        const { validateMarketplaceAuth, issueMarketplaceToken } = await load("demo");
        const token = await issueMarketplaceToken("demo-admin", null, "demo-admin");
        expect(await validateMarketplaceAuth(bearerRequest(token))).toBeNull();
    });
});

describe("self-hosted local is unaffected", () => {
    it("accepts an untenanted token on an untenanted instance", async () => {
        const { validateMarketplaceAuth, issueMarketplaceToken } = await load("local");
        const token = await issueMarketplaceToken("user-1", null, "admin");
        expect(await validateMarketplaceAuth(bearerRequest(token))).toBeNull();
    });
});

describe("mutating routes require an admin", () => {
    // A plugin manifest's `entry` is dynamically imported into every member's
    // browser, so install/uninstall/enable/disable is code execution for the
    // whole workspace, not a per-user preference.
    it("rejects a non-admin session", async () => {
        const { validateMarketplaceAuth } = await load("local");
        const { auth } = await import("@/lib/auth");
        vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "user" } } as never);

        const request = new Request("https://app.local/api/marketplace/uninstall");
        const res = await validateMarketplaceAuth(request, { requireAdmin: true });

        expect(res?.status).toBe(403);
        vi.mocked(auth).mockResolvedValue(null as never);
    });

    it("admits an admin session", async () => {
        const { validateMarketplaceAuth } = await load("local");
        const { auth } = await import("@/lib/auth");
        vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "admin" } } as never);

        const request = new Request("https://app.local/api/marketplace/uninstall");
        await expect(
            validateMarketplaceAuth(request, { requireAdmin: true }),
        ).resolves.toBeNull();
        vi.mocked(auth).mockResolvedValue(null as never);
    });

    it("still admits a non-admin on read-only access", async () => {
        const { validateMarketplaceAuth } = await load("local");
        const { auth } = await import("@/lib/auth");
        vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role: "user" } } as never);

        const request = new Request("https://app.local/api/marketplace/load");
        await expect(validateMarketplaceAuth(request)).resolves.toBeNull();
        vi.mocked(auth).mockResolvedValue(null as never);
    });

    it("rejects a non-admin bearer token on a mutating route", async () => {
        const { validateMarketplaceAuth, issueMarketplaceToken } = await load("local");
        const token = await issueMarketplaceToken("member", null, "user");

        const res = await validateMarketplaceAuth(bearerRequest(token), { requireAdmin: true });

        expect(res?.status).toBe(403);
    });
});
