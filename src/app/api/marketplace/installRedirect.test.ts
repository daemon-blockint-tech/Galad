// @vitest-environment node
/**
 * GET /api/marketplace/install-redirect writes the manifest that every member of
 * the workspace then dynamically imports. It used to accept any authenticated
 * session (the only role check was demo-only) and stamped trust from the
 * caller-supplied `pluginId`, so a request could bind a seeded, registry-verified
 * id such as "aviation" to an attacker's entry URL — and the client skips its
 * approval dialog for verified plugins. Being a GET, a top-level navigation from
 * any site carried the SameSite=Lax session cookie along with it.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/auth", () => ({ auth: vi.fn() }));
vi.mock("@/lib/tenant", () => ({ getTenantId: vi.fn(async () => null) }));
vi.mock("@/lib/marketplace/repository", () => ({ upsertPlugin: vi.fn(async () => ({})) }));
vi.mock("@/lib/marketplace/registryClient", () => ({
    // "aviation" is a default-seeded id that the signed registry lists as verified.
    getVerifiedPluginIds: vi.fn(async () => new Set(["aviation"])),
}));

import { auth } from "@/lib/auth";
import { upsertPlugin } from "@/lib/marketplace/repository";
import { GET } from "./install-redirect/route";

const REDIRECT_TO = "https://worldwideview.dev/manage";

function manifestParam(overrides: Record<string, unknown> = {}) {
    const manifest = {
        id: "aviation",
        name: "Aviation",
        version: "9.9.9",
        type: "data-layer",
        trust: "verified",
        capabilities: ["entities"],
        format: "bundle",
        entry: "https://unpkg.com/evil-layer@1.0.0/dist/frontend.mjs",
        ...overrides,
    };
    return Buffer.from(JSON.stringify(manifest)).toString("base64");
}

function installRequest(
    pluginId: string,
    manifest: string,
    headers: Record<string, string> = { "sec-fetch-dest": "document", "sec-fetch-site": "same-origin" },
) {
    const url = new URL("https://app.local/api/marketplace/install-redirect");
    url.searchParams.set("pluginId", pluginId);
    url.searchParams.set("manifest", manifest);
    url.searchParams.set("version", "9.9.9");
    url.searchParams.set("redirectTo", REDIRECT_TO);
    // The route reads request.nextUrl; a NextRequest-shaped stand-in is enough.
    return Object.assign(new Request(url, { headers }), { nextUrl: url }) as never;
}

function signedInAs(role: string) {
    vi.mocked(auth).mockResolvedValue({ user: { id: "u1", role } } as never);
}

beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-at-least-32-chars-long!!";
    vi.mocked(upsertPlugin).mockClear();
});

afterEach(() => {
    vi.mocked(auth).mockReset();
});

describe("GET /api/marketplace/install-redirect", () => {
    it("refuses a non-admin session and writes nothing", async () => {
        signedInAs("user");

        const res = await GET(installRequest("aviation", manifestParam()));

        expect(res.status).toBe(403);
        expect(upsertPlugin).not.toHaveBeenCalled();
    });

    it("refuses a pluginId that does not match the manifest id", async () => {
        signedInAs("admin");

        const res = await GET(installRequest("aviation", manifestParam({ id: "something-else" })));

        expect(res.status).toBe(400);
        expect(upsertPlugin).not.toHaveBeenCalled();
    });

    it("never stores a caller-supplied manifest as verified, even for a verified id", async () => {
        signedInAs("admin");

        await GET(installRequest("aviation", manifestParam()));

        expect(upsertPlugin).toHaveBeenCalledTimes(1);
        const stored = JSON.parse(vi.mocked(upsertPlugin).mock.calls[0][2] as string);
        expect(stored.trust).toBe("unverified");
    });

    it("rejects a manifest whose entry is not on the allowlist", async () => {
        signedInAs("admin");

        const res = await GET(
            installRequest("aviation", manifestParam({ entry: "//attacker.example/pwn.js" })),
        );

        expect(res.status).toBe(400);
        expect(upsertPlugin).not.toHaveBeenCalled();
    });

    describe("cross-site request forgery", () => {
        // The handler writes on a GET and the session cookie is SameSite=Lax, so
        // without a navigation check any page the victim opens could install as them.
        it("refuses a subresource load such as an <img> tag", async () => {
            signedInAs("admin");

            const res = await GET(
                installRequest("aviation", manifestParam(), {
                    "sec-fetch-dest": "image",
                    "sec-fetch-site": "cross-site",
                }),
            );

            expect(res.status).toBe(403);
            expect(upsertPlugin).not.toHaveBeenCalled();
        });

        it("refuses a cross-site navigation from an unknown page", async () => {
            signedInAs("admin");

            const res = await GET(
                installRequest("aviation", manifestParam(), {
                    "sec-fetch-dest": "document",
                    "sec-fetch-site": "cross-site",
                    referer: "https://evil.example/trap",
                }),
            );

            expect(res.status).toBe(403);
            expect(upsertPlugin).not.toHaveBeenCalled();
        });

        it("allows the real flow: a navigation referred by the marketplace", async () => {
            signedInAs("admin");

            const res = await GET(
                installRequest("aviation", manifestParam(), {
                    "sec-fetch-dest": "document",
                    "sec-fetch-site": "cross-site",
                    referer: "https://marketplace.maven-system.dev/plugins/aviation",
                }),
            );

            expect(res.status).not.toBe(403);
            expect(upsertPlugin).toHaveBeenCalledTimes(1);
        });

        it("fails closed when the Sec-Fetch headers are absent", async () => {
            signedInAs("admin");

            const res = await GET(installRequest("aviation", manifestParam(), {}));

            expect(res.status).toBe(403);
            expect(upsertPlugin).not.toHaveBeenCalled();
        });
    });
});

describe("same-site is not trusted on its own", () => {
    // Cloud workspaces are subdomains of one registrable domain, so a sibling
    // subdomain — another tenant, or one an attacker got hold of — reads as
    // same-site. No legitimate flow needs it, so it must still prove a referrer.
    it("refuses a same-site navigation from an unknown sibling subdomain", async () => {
        signedInAs("admin");

        const res = await GET(
            installRequest("aviation", manifestParam(), {
                "sec-fetch-dest": "document",
                "sec-fetch-site": "same-site",
                referer: "https://evil.app.grond.dev/trap",
            }),
        );

        expect(res.status).toBe(403);
        expect(upsertPlugin).not.toHaveBeenCalled();
    });

    it("still allows same-origin, which is the in-app path", async () => {
        signedInAs("admin");

        const res = await GET(
            installRequest("aviation", manifestParam(), {
                "sec-fetch-dest": "document",
                "sec-fetch-site": "same-origin",
            }),
        );

        expect(res.status).not.toBe(403);
        expect(upsertPlugin).toHaveBeenCalledTimes(1);
    });
});
