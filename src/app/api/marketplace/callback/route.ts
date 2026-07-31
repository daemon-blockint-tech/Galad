import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { encryptCredential } from "@/lib/auth/encryption";
import { prisma as db } from "@/lib/db";
import { getMarketplaceUrl } from "@/core/grondEnv";
import { validateMarketplaceAuth } from "@/lib/marketplace/auth";
import { getTenantId } from "@/lib/tenant";

/** Must match the path used when the cookies were set in ../connect. */
const PKCE_COOKIE_PATH = "/";

export async function GET(req: NextRequest) {
    // This stores a marketplace credential for the workspace, so it is not a
    // public endpoint even though the OAuth provider is the one redirecting here.
    const authError = await validateMarketplaceAuth(req, { requireAdmin: true });
    if (authError) return authError;

    const isHttps = req.nextUrl.protocol === "https:";
    const cookiePrefix = isHttps ? "__Host-" : "";

    const stateCookie = req.cookies.get(`${cookiePrefix}pkce_state`)?.value;
    const verifierCookie = req.cookies.get(`${cookiePrefix}pkce_verifier`)?.value;
    const urlState = req.nextUrl.searchParams.get("state");

    if (!stateCookie || urlState !== stateCookie) {
        return NextResponse.json({ error: "State mismatch" }, { status: 400 });
    }

    if (!verifierCookie) {
        return NextResponse.json({ error: "Missing code_verifier" }, { status: 400 });
    }

    const marketplaceUrl = getMarketplaceUrl() || "https://app.worldwideview.dev";
    const issuer = new URL(marketplaceUrl);
    const server = {
        issuer: issuer.toString(),
        authorization_endpoint: new URL("/oauth/authorize", issuer).toString(),
        token_endpoint: new URL("/api/tickets/exchange", issuer).toString(),
    };
    const config = { server, clientId: "local-app" };
    
    try {
        const tokens = await client.authorizationCodeGrant(
            config as any,
            new URL(req.url),
            { expectedState: stateCookie, pkceCodeVerifier: verifierCookie }
        );

        if (tokens.access_token) {
            const encrypted = await encryptCredential(tokens.access_token);
            // Hardcoding "local" read as though every cloud workspace shared one
            // row. The Prisma tenant extension does override it there, but relying
            // on that was invisible and would break the moment this model left the
            // tenanted set. "local" stays only as the key for untenanted
            // deployments, where getTenantId() is null by design.
            const tenantId = (await getTenantId()) ?? "local";
            await db.marketplaceCredential.upsert({
                where: { tenantId },
                update: {
                    version: encrypted.version,
                    salt: encrypted.salt,
                    nonce: encrypted.nonce,
                    ciphertext: encrypted.ciphertext
                },
                create: {
                    tenantId,
                    version: encrypted.version,
                    salt: encrypted.salt,
                    nonce: encrypted.nonce,
                    ciphertext: encrypted.ciphertext
                }
            });
        }
    } catch (err: any) {
        console.error("[PKCE] Exchange failed:", err.message);
        return NextResponse.json({ error: "Failed to exchange authorization code" }, { status: 500 });
    }

    const res = NextResponse.redirect(new URL("/", req.nextUrl.origin), 302);

    res.cookies.set(`${cookiePrefix}pkce_state`, "", {
        httpOnly: true,
        secure: isHttps,
        sameSite: "lax",
        path: PKCE_COOKIE_PATH,
        maxAge: 0
    });

    res.cookies.set(`${cookiePrefix}pkce_verifier`, "", {
        httpOnly: true,
        secure: isHttps,
        sameSite: "lax",
        path: PKCE_COOKIE_PATH,
        maxAge: 0
    });

    return res;
}
