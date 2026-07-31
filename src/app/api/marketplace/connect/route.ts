import { NextRequest, NextResponse } from "next/server";
import * as client from "openid-client";
import { getMarketplaceUrl } from "@/core/grondEnv";

/**
 * `__Host-` cookies are rejected unless Path is exactly "/", so scoping these to
 * the callback route meant the browser dropped them and every HTTPS deployment
 * failed the state check — the connect flow could not complete at all. They are
 * short-lived PKCE values, cleared by the callback.
 */
const PKCE_COOKIE_PATH = "/";

export async function GET(req: NextRequest) {
    const state = client.randomState();
    const code_verifier = client.randomPKCECodeVerifier();
    const code_challenge = await client.calculatePKCECodeChallenge(code_verifier);

    const marketplaceUrl = getMarketplaceUrl() || "https://app.worldwideview.dev";

    const url = new URL("/oauth/authorize", marketplaceUrl);
    url.searchParams.set("client_id", "local-app");
    url.searchParams.set("response_type", "code");
    url.searchParams.set("code_challenge", code_challenge);
    url.searchParams.set("code_challenge_method", "S256");
    url.searchParams.set("state", state);
    url.searchParams.set("redirect_uri", `${req.nextUrl.origin}/api/marketplace/callback`);
    url.searchParams.set("scope", "plugins:read");

    const res = NextResponse.redirect(url.toString(), 302);

    const isHttps = req.nextUrl.protocol === "https:";
    const cookiePrefix = isHttps ? "__Host-" : "";

    res.cookies.set(`${cookiePrefix}pkce_state`, state, {
        httpOnly: true,
        secure: isHttps,
        sameSite: "lax",
        path: PKCE_COOKIE_PATH,
        maxAge: 60 * 10 // 10 minutes
    });

    res.cookies.set(`${cookiePrefix}pkce_verifier`, code_verifier, {
        httpOnly: true,
        secure: isHttps,
        sameSite: "lax",
        path: PKCE_COOKIE_PATH,
        maxAge: 60 * 10 // 10 minutes
    });

    return res;
}
