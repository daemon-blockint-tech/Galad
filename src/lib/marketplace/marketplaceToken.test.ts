// @vitest-environment node
import {
 describe, it, expect, beforeEach
} from "vitest";

import { issueMarketplaceToken, verifyMarketplaceToken } from "./marketplaceToken";

// Set a test secret before importing the module
beforeEach(() => {
    process.env.AUTH_SECRET = "test-secret-at-least-32-chars-long!!";
});

const TEST_USER_ID = "user-123-abc";
const TEST_TENANT = "acme";
const TEST_ROLE = "admin";

describe("marketplaceToken", () => {
    describe("issueMarketplaceToken", () => {
        it("returns a non-empty JWT string", async () => {
            const token = await issueMarketplaceToken(TEST_USER_ID, TEST_TENANT, TEST_ROLE);
            expect(typeof token).toBe("string");
            expect(token.split(".")).toHaveLength(3); // header.payload.signature
        });
    });

    describe("verifyMarketplaceToken", () => {
        it("verifies a freshly issued token and returns correct claims", async () => {
            const token = await issueMarketplaceToken(TEST_USER_ID, TEST_TENANT, TEST_ROLE);
            const payload = await verifyMarketplaceToken(token);
            expect(payload.scope).toBe("marketplace");
            expect(payload.sub).toBe(TEST_USER_ID);
            expect(payload.iss).toBe("grond");
            expect(payload.aud).toBe("grond-marketplace");
            expect(payload.tenant).toBe(TEST_TENANT);
            expect(payload.role).toBe(TEST_ROLE);
        });

        it("keeps a null tenant as an explicit claim on the untenanted editions", async () => {
            const token = await issueMarketplaceToken(TEST_USER_ID, null, "user");
            const payload = await verifyMarketplaceToken(token);
            expect(payload.tenant).toBeNull();
        });

        it("throws on a token minted before the tenant binding existed", async () => {
            const { SignJWT } = await import("jose");
            const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
            const legacy = await new SignJWT({ scope: "marketplace" })
                .setProtectedHeader({ alg: "HS256" })
                .setSubject(TEST_USER_ID)
                .setIssuer("grond")
                .setAudience("grond-marketplace")
                .setIssuedAt()
                .setExpirationTime("1d")
                .sign(secret);
            await expect(verifyMarketplaceToken(legacy)).rejects.toThrow("tenant");
        });

        it("throws on a token carrying no role", async () => {
            const { SignJWT } = await import("jose");
            const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
            const noRole = await new SignJWT({ scope: "marketplace", tenant: TEST_TENANT })
                .setProtectedHeader({ alg: "HS256" })
                .setSubject(TEST_USER_ID)
                .setIssuer("grond")
                .setAudience("grond-marketplace")
                .setIssuedAt()
                .setExpirationTime("1d")
                .sign(secret);
            await expect(verifyMarketplaceToken(noRole)).rejects.toThrow("role");
        });

        it("throws on a tampered token", async () => {
            const token = await issueMarketplaceToken(TEST_USER_ID, TEST_TENANT, TEST_ROLE);
            const [h, p, s] = token.split(".");
            const tampered = `${h}.${p}x.${s}`;
            await expect(verifyMarketplaceToken(tampered)).rejects.toThrow();
        });

        it("throws on a token signed with a different secret", async () => {
            const token = await issueMarketplaceToken(TEST_USER_ID, TEST_TENANT, TEST_ROLE);
            process.env.AUTH_SECRET = "a-completely-different-secret-here!!";
            await expect(verifyMarketplaceToken(token)).rejects.toThrow();
        });

        it("throws on a token with wrong scope", async () => {
            const { SignJWT } = await import("jose");
            const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
            const wrongScopeToken = await new SignJWT({ scope: "admin" })
                .setProtectedHeader({ alg: "HS256" })
                .setSubject(TEST_USER_ID)
                .setIssuer("grond")
                .setAudience("grond-marketplace")
                .setIssuedAt()
                .setExpirationTime("1d")
                .sign(secret);
            await expect(verifyMarketplaceToken(wrongScopeToken)).rejects.toThrow("scope");
        });

        it("throws on a token with wrong issuer", async () => {
            const { SignJWT } = await import("jose");
            const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
            const badIssuer = await new SignJWT({ scope: "marketplace" })
                .setProtectedHeader({ alg: "HS256" })
                .setSubject(TEST_USER_ID)
                .setIssuer("evil-issuer")
                .setAudience("grond-marketplace")
                .setIssuedAt()
                .setExpirationTime("1d")
                .sign(secret);
            await expect(verifyMarketplaceToken(badIssuer)).rejects.toThrow();
        });

        it("throws on a token with wrong audience", async () => {
            const { SignJWT } = await import("jose");
            const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
            const badAudience = await new SignJWT({ scope: "marketplace" })
                .setProtectedHeader({ alg: "HS256" })
                .setSubject(TEST_USER_ID)
                .setIssuer("grond")
                .setAudience("wrong-audience")
                .setIssuedAt()
                .setExpirationTime("1d")
                .sign(secret);
            await expect(verifyMarketplaceToken(badAudience)).rejects.toThrow();
        });

        it("throws on a token without a subject", async () => {
            const { SignJWT } = await import("jose");
            const secret = new TextEncoder().encode(process.env.AUTH_SECRET);
            const noSub = await new SignJWT({ scope: "marketplace" })
                .setProtectedHeader({ alg: "HS256" })
                .setIssuer("grond")
                .setAudience("grond-marketplace")
                .setIssuedAt()
                .setExpirationTime("1d")
                .sign(secret);
            await expect(verifyMarketplaceToken(noSub)).rejects.toThrow("subject");
        });
    });

    describe("revokeMarketplaceToken", () => {
        it("revokes a token and rejects it on verify", async () => {
            const { revokeMarketplaceToken } = await import("./marketplaceToken");
            const token = await issueMarketplaceToken(TEST_USER_ID, TEST_TENANT, TEST_ROLE);
            const payload = await verifyMarketplaceToken(token);

            expect(payload.jti).toBeDefined();

            // Revoke it
            revokeMarketplaceToken(payload.jti!);

            // Now it should throw
            await expect(verifyMarketplaceToken(token)).rejects.toThrow("revoked");
        });

        it("does nothing when passed an empty jti", async () => {
            const { revokeMarketplaceToken } = await import("./marketplaceToken");
            expect(() => revokeMarketplaceToken("")).not.toThrow();
        });
    });
});
