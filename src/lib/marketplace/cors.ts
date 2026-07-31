import { NextResponse } from "next/server";

import { getMarketplaceUrl } from "@/core/grondEnv";
import { isPrivateIP } from "@/lib/security/ssrf";

/**
 * Default marketplace when none is configured. Must stay in step with the
 * registry host in registryClient.ts and the manifest host the install and
 * check-updates routes fetch from — those decide what is "verified", so a
 * different default here meant trusting one brand and fetching from another.
 */
const DEFAULT_MARKETPLACE_ORIGIN = "https://marketplace.maven-system.dev";

/** Pre-rebrand marketplace, still accepted while deployments migrate. */
const LEGACY_MARKETPLACE_ORIGIN = "https://marketplace.worldwideview.dev";

function originOf(url: string): string | null {
    try {
        return new URL(url).origin;
    } catch {
        return null;
    }
}

function hostnameOf(url: string): string | null {
    try {
        return new URL(url).hostname;
    } catch {
        return null;
    }
}

/**
 * Origins allowed to call the marketplace bridge: the configured marketplace,
 * plus anything an operator lists in MARKETPLACE_ALLOWED_ORIGINS (comma-separated)
 * for a self-hosted one.
 *
 * These routes previously reflected whatever `Origin` the caller sent and set
 * Access-Control-Allow-Private-Network, so any public web page could drive a
 * marketplace endpoint on a Galad instance inside the user's private network.
 */
export function allowedMarketplaceOrigins(): Set<string> {
    const configured = getMarketplaceUrl();
    const origins = [
        originOf(configured ?? DEFAULT_MARKETPLACE_ORIGIN) ?? DEFAULT_MARKETPLACE_ORIGIN,
        // Only while no marketplace is configured. An operator who named their own
        // should not also be trusting the pre-rebrand host they never mentioned;
        // if they still need it, MARKETPLACE_ALLOWED_ORIGINS says so explicitly.
        ...(configured ? [] : [LEGACY_MARKETPLACE_ORIGIN]),
        ...(process.env.MARKETPLACE_ALLOWED_ORIGINS ?? "")
            .split(",")
            .map((entry) => originOf(entry.trim()))
            .filter((entry): entry is string => Boolean(entry)),
    ];
    return new Set(origins);
}

/**
 * Whether an origin may make a private-network request to this instance.
 *
 * The origin reflection above is deliberate — a marketplace can be self-hosted on
 * any domain — and is safe on its own because no Access-Control-Allow-Credentials
 * is sent, so cookies never ride along. Private-Network access is the part that
 * is not safe to hand to everyone: it is what allows a page on the public
 * internet to reach a Galad instance inside the user's LAN. Grant it only to the
 * configured marketplace and to origins that are already local, which covers
 * dev on localhost and a marketplace hosted on the same network.
 */
function mayAccessPrivateNetwork(origin: string): boolean {
    if (allowedMarketplaceOrigins().has(origin)) return true;

    const hostname = hostnameOf(origin);
    if (!hostname) return false;
    return hostname === "localhost" || isPrivateIP(hostname);
}

/** Build CORS headers for the marketplace bridge API. */
export function corsHeaders(request: Request): Record<string, string> {
    const origin = request.headers.get("origin");

    // Same-origin and server-to-server calls send no Origin and need no headers.
    if (!origin) return {};

    const headers: Record<string, string> = {
        "Access-Control-Allow-Origin": origin,
        "Vary": "Origin",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
        "Access-Control-Allow-Headers": "Content-Type, Authorization, x-marketplace-ping",
        "Access-Control-Max-Age": "86400",
    };

    if (mayAccessPrivateNetwork(origin)) {
        headers["Access-Control-Allow-Private-Network"] = "true";
    }

    return headers;
}

/** Standard preflight response. */
export function handlePreflight(request: Request): NextResponse {
    return new NextResponse(null, {
        status: 204,
        headers: corsHeaders(request),
    });
}

/** Wrap a NextResponse with CORS headers. */
export function withCors(response: NextResponse, request: Request): NextResponse {
    const headers = corsHeaders(request);
    for (const [key, value] of Object.entries(headers)) {
        response.headers.set(key, value);
    }
    return response;
}
