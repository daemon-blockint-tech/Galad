// @vitest-environment node
import {
 describe, it, expect, vi, beforeEach
} from "vitest";
import { NextRequest } from "next/server";
import { GET as connectRoute } from "./connect/route";
import { GET as callbackRoute } from "./callback/route";

vi.mock("openid-client", () => ({
    randomState: vi.fn(() => "mock-state"),
    randomPKCECodeVerifier: vi.fn(() => "mock-verifier"),
    calculatePKCECodeChallenge: vi.fn(() => "mock-challenge"),
    discoveryRequest: vi.fn(),
    processAuthorizationResponse: vi.fn(),
    validateAuthResponse: vi.fn(),
    authorizationCodeGrant: vi.fn().mockResolvedValue({ access_token: "mock-token" })
}));

vi.mock("@/lib/marketplace/auth", () => ({
    // The callback now requires an admin; these tests cover the PKCE exchange.
    validateMarketplaceAuth: vi.fn(async () => null),
}));

vi.mock("@/lib/tenant", () => ({ getTenantId: vi.fn(async () => null) }));

vi.mock("@/lib/auth/encryption", () => ({
    encryptCredential: vi.fn().mockResolvedValue({
        version: 1,
        salt: "mock-salt",
        nonce: "mock-nonce",
        ciphertext: "mock-ciphertext"
    })
}));

vi.mock("@/lib/db", () => ({
    prisma: {
        marketplaceCredential: {
            upsert: vi.fn().mockResolvedValue({})
        }
    }
}));

describe("PKCE Flow", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    describe("Connect Route", () => {
        it("should generate PKCE parameters and redirect with secure cookies", async () => {
            const req = new NextRequest("https://localhost:3000/api/marketplace/connect");
            const res = await connectRoute(req);

            expect(res.status).toBe(302);

            // Check redirect URL
            const location = res.headers.get("Location");
            expect(location).toContain("response_type=code");
            expect(location).toContain("code_challenge_method=S256");

            // Check cookie flags
            const cookies = res.headers.get("Set-Cookie");
            expect(cookies).toBeDefined();
            expect(cookies).toContain("HttpOnly");
            expect(cookies).toContain("Secure");
            expect(cookies).toContain("SameSite=lax");
            // __Host- cookies are rejected unless Path is exactly "/". Scoping them
            // to the callback route meant the browser stored nothing, so every HTTPS
            // deployment failed the state check and the connect flow could not finish.
            expect(cookies).toContain("Path=/");
            expect(cookies).not.toContain("Path=/api/marketplace/callback");
            // Check __Host- prefix if in production (assuming https testing context)
            expect(cookies).toMatch(/__Host-pkce_verifier/);
        });
    });

    describe("Callback Route", () => {
        it("should reject if state does not match", async () => {
            const req = new NextRequest("https://localhost:3000/api/marketplace/callback?state=wrong-state&code=test-code");
            req.cookies.set("__Host-pkce_state", "correct-state");

            const res = await callbackRoute(req);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: "State mismatch" });
        });

        it("should reject if code verifier is missing (expired)", async () => {
            const req = new NextRequest("https://localhost:3000/api/marketplace/callback?state=correct-state&code=test-code");
            req.cookies.set("__Host-pkce_state", "correct-state");
            // code_verifier cookie is intentionally omitted

            const res = await callbackRoute(req);
            expect(res.status).toBe(400);
            expect(await res.json()).toEqual({ error: "Missing code_verifier" });
        });

        it("should clear the state cookie after use to prevent replay", async () => {
            const req = new NextRequest("https://localhost:3000/api/marketplace/callback?state=correct-state&code=test-code");
            req.cookies.set("__Host-pkce_state", "correct-state");
            req.cookies.set("__Host-pkce_verifier", "mock-verifier");

            const res = await callbackRoute(req);

            const cookies = res.headers.get("Set-Cookie");
            expect(cookies).toContain("__Host-pkce_state=;");
            expect(cookies).toContain("Max-Age=0");
        });

        it("should perform openid-client exchange and save encrypted token", async () => {
            const req = new NextRequest("https://localhost:3000/api/marketplace/callback?state=correct-state&code=test-code");
            req.cookies.set("__Host-pkce_state", "correct-state");
            req.cookies.set("__Host-pkce_verifier", "mock-verifier");

            const res = await callbackRoute(req);
            expect(res.status).toBe(302); // Redirect back to marketplace or app
        });
    });
});
