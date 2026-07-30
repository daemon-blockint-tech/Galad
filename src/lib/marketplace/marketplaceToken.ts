import { SignJWT, jwtVerify } from "jose";
import { randomUUID } from "crypto";

const SCOPE = "marketplace";
import { MARKETPLACE_JWT_AUDIENCE, MARKETPLACE_JWT_ISSUER } from "@/core/grondEnv";

const ISSUER = MARKETPLACE_JWT_ISSUER;
const AUDIENCE = MARKETPLACE_JWT_AUDIENCE;
const EXPIRY = "4h";

// Simple in-memory revocation list for JWT tokens (resets on restart)
// In a distributed setup, this should be backed by Redis.
const revokedJtis = new Set<string>();

function getSecret(): Uint8Array {
    const secret = process.env.AUTH_SECRET;
    if (!secret) throw new Error("AUTH_SECRET is not set");
    return new TextEncoder().encode(secret);
}

/**
 * Issue a JWT scoped to marketplace API access, bound to a specific user,
 * workspace and role. Signed with AUTH_SECRET — no database required.
 *
 * `tenant` and `role` are required, not optional: AUTH_SECRET is one global
 * value, so a token minted on one workspace verifies on every other one and the
 * claims are the only thing that distinguishes them. `tenant` is null on the
 * editions that have no workspaces (local, demo) — that is still a binding, and
 * a token carrying it is rejected on a tenanted host.
 */
export async function issueMarketplaceToken(
    userId: string,
    tenant: string | null,
    role: string,
): Promise<string> {
    return new SignJWT({ scope: SCOPE, tenant, role })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject(userId)
        .setIssuer(ISSUER)
        .setAudience(AUDIENCE)
        .setJti(randomUUID())
        .setIssuedAt()
        .setExpirationTime(EXPIRY)
        .sign(getSecret());
}

export interface MarketplaceTokenPayload {
    scope: string;
    /** Workspace subdomain the token was issued on; null on local/demo. */
    tenant: string | null;
    /** Role the issuing session held, so the demo gate survives the redirect. */
    role: string;
    sub: string;
    iss: string;
    aud: string;
    iat: number;
    exp: number;
    jti?: string;
}

/**
 * Revoke a specific marketplace JWT by its JTI claim.
 */
export function revokeMarketplaceToken(jti: string): void {
    if (jti) revokedJtis.add(jti);
}

/**
 * Verify a marketplace JWT. Throws if invalid, expired, wrong scope,
 * or missing required claims (sub, iss, aud).
 */
export async function verifyMarketplaceToken(
    token: string,
): Promise<MarketplaceTokenPayload> {
    const { payload } = await jwtVerify(token, getSecret(), {
        issuer: ISSUER,
        audience: AUDIENCE,
    });
    if (payload.scope !== SCOPE) {
        throw new Error("Token scope mismatch");
    }
    if (!payload.sub) {
        throw new Error("Token missing subject");
    }
    // Absent (not null) means a token minted before the binding existed. Those
    // are unbound to any workspace, so they are refused rather than trusted.
    if (payload.tenant !== null && typeof payload.tenant !== "string") {
        throw new Error("Token missing tenant binding");
    }
    if (typeof payload.role !== "string") {
        throw new Error("Token missing role binding");
    }
    if (payload.jti && revokedJtis.has(payload.jti as string)) {
        throw new Error("Token has been revoked");
    }
    return payload as unknown as MarketplaceTokenPayload;
}
