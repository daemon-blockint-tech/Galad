import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { auth } from "@/lib/auth";
import { issueMarketplaceToken } from "@/lib/marketplace/marketplaceToken";
import { grantTokenLimiter } from "@/lib/rateLimiters";
import { getClientIp } from "@/lib/rateLimit";
import { isPluginInstallEnabled, isDemo, isDemoAdmin } from "@/core/edition";
import { getRequestOrigin } from "@/lib/origin";
import { getTenantId } from "@/lib/tenant";
import { isTrustedInstallNavigation } from "@/lib/marketplace/navigationOrigin";
import { allowedMarketplaceOrigins } from "@/lib/marketplace/cors";

const ALLOWED_REDIRECT_HOSTS = new Set(["localhost", "127.0.0.1"]);

function isSafeRedirect(url: string): boolean {
    try {
        const parsed = new URL(url);
        // The token is delivered in the fragment of this URL, so "any port on
        // loopback" meant any local listener could collect an admin token. Plain
        // http to loopback is a development convenience and stays out of
        // production entirely.
        const isLoopback = ALLOWED_REDIRECT_HOSTS.has(parsed.hostname);
        if (isLoopback) return process.env.NODE_ENV !== "production";
        if (parsed.protocol !== "https:") return false;
        return parsed.hostname === "worldwideview.dev"
            || parsed.hostname.endsWith(".worldwideview.dev")
            || allowedMarketplaceOrigins().has(parsed.origin);
    } catch {
        return false;
    }
}

/**
 * GET /api/marketplace/grant-token
 * Issues a marketplace JWT for an authenticated user without requiring an install.
 * Used by the Manage page when the user configures their instance URL directly.
 *
 * Query params:
 *   redirectTo - URL to redirect to with ?token=<jwt> appended (must be allowlisted)
 */
export async function GET(request: NextRequest) {
    if (!isPluginInstallEnabled) {
        return NextResponse.json(
            { error: "Marketplace tokens are not available on this instance" },
            { status: 403 },
        );
    }

    const rateLimited = grantTokenLimiter.check(getClientIp(request));
    if (rateLimited) return rateLimited;

    // Same exposure as install-redirect: a cookie-riding GET that hands back an
    // admin-scoped marketplace token, so it needs the same navigation gate.
    if (!isTrustedInstallNavigation(request)) {
        return NextResponse.json(
            { error: "Token grant must be started from the marketplace or from within the app" },
            { status: 403 },
        );
    }

    const { searchParams } = request.nextUrl;
    const redirectTo = searchParams.get("redirectTo") ?? "";

    try {
        const session = await auth();

        if (!session?.user) {
            const origin = getRequestOrigin(request);
            const loginUrl = new URL("/login", origin);

            // Construct a relative path for callback to ensure it redirects back to the identical host
            const callbackPath = request.nextUrl.pathname + request.nextUrl.search;
            loginUrl.searchParams.set("callbackUrl", callbackPath);
            return NextResponse.redirect(loginUrl);
        }

        if (isDemo && !isDemoAdmin(session)) {
            return NextResponse.json({ error: "Admin access required on Demo edition" }, { status: 403 });
        }

        if (!redirectTo || !isSafeRedirect(redirectTo)) {
            return NextResponse.json({ error: "Invalid or missing redirectTo" }, { status: 400 });
        }

        const token = await issueMarketplaceToken(
            session.user.id ?? "",
            await getTenantId(),
            (session.user as { role?: string }).role ?? "user",
        );
        const dest = new URL(redirectTo);
        // Token in fragment — never sent to server in logs/referer
        return NextResponse.redirect(`${dest.toString()}#token=${token}`);
    } catch (err) {
        console.error("[grant-token] Unexpected error:", err);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
