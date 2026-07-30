import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isDemo, isPlatformAdmin } from "@/core/edition";
import { getPublicEdition } from "@/core/grondEnv";
import { readJsonResponse } from "@/lib/http/readJsonResponse";

const workspaceCache = new Map<string, { status: string; expiresAt: number }>();
const CACHE_TTL = 60_000;

/**
 * Ceiling on the self-fetches below. Without it a stalled handler pins the
 * middleware invocation for undici's 300s default, and every anonymous page
 * request queues behind it.
 */
const SELF_FETCH_TIMEOUT_MS = 2_000;

function internalAppUrl() {
    return process.env.NEXT_PUBLIC_APP_URL || process.env.APP_URL || `http://127.0.0.1:${process.env.PORT || "3000"}`;
}

async function resolveWorkspace(subdomain: string) {
    const cached = workspaceCache.get(subdomain);
    if (cached && Date.now() < cached.expiresAt) return cached;

    try {
        const url = new URL(`/api/internal/workspace/${subdomain}`, internalAppUrl());
        const res = await fetch(url.toString(), {
            headers: { "User-Agent": "Grond-Middleware" },
            signal: AbortSignal.timeout(SELF_FETCH_TIMEOUT_MS),
        });

        if (res.ok) {
            const data = await readJsonResponse<{ status: string }>(res);
            workspaceCache.set(subdomain, { ...data, expiresAt: Date.now() + CACHE_TTL });
            return data;
        }
        return null;
    } catch (e) {
        console.error("[proxy.ts] Workspace resolution failed:", e);
        return null;
    }
}

let setupStatusCache: { needsSetup: boolean; expiresAt: number } | null = null;

/**
 * Whether this instance still needs first-run setup.
 *
 * Cached like `workspaceCache` — the answer flips at most once per install, so
 * without this every anonymous page request paid a self-HTTP round trip plus a
 * `user.count()` against Postgres. The TTL is deliberate rather than a one-shot
 * memo: a wiped or re-pointed database must be able to ask for /setup again.
 * A failed lookup is cached as "no setup needed" for the same window, which is
 * the fall-through the caller already had, and keeps a DB outage from turning
 * every crawler hit into another timeout.
 */
async function needsFirstRunSetup(): Promise<boolean> {
    if (setupStatusCache && Date.now() < setupStatusCache.expiresAt) {
        return setupStatusCache.needsSetup;
    }

    let needsSetup = false;
    try {
        const url = new URL("/api/auth/setup-status", internalAppUrl());
        const res = await fetch(url.toString(), {
            headers: { "User-Agent": "Grond-Middleware" },
            signal: AbortSignal.timeout(SELF_FETCH_TIMEOUT_MS),
        });
        const data = await readJsonResponse<{ needsSetup?: boolean }>(res);
        needsSetup = data.needsSetup === true;
    } catch (e) {
        console.error("[proxy.ts] Failed to fetch setup status:", e);
    }

    setupStatusCache = { needsSetup, expiresAt: Date.now() + CACHE_TTL };
    return needsSetup;
}

/**
 * Continues the request with the resolved tenant pinned onto it.
 *
 * The header must ride on the *request* — `NextResponse.next()` + `res.headers.set()`
 * only sets an outgoing response header, which `headers()` in route handlers and
 * server components never sees. Set/delete is unconditional so an inbound
 * client-supplied `x-tenant-subdomain` can never survive.
 */
function continueWithTenant(req: NextRequest, tenantSubdomain: string | null) {
    const requestHeaders = new Headers(req.headers);
    if (tenantSubdomain) {
        requestHeaders.set("x-tenant-subdomain", tenantSubdomain);
    } else {
        requestHeaders.delete("x-tenant-subdomain");
    }
    return NextResponse.next({ request: { headers: requestHeaders } });
}

/**
 * Route protection proxy.
 */
export default async function proxy(req: NextRequest) {
    const path = req.nextUrl.pathname;

    const hostname = req.headers.get("host") || "";
    let tenantSubdomain: string | null = null;
    const isCloudDeploy = getPublicEdition() === "cloud";

    if (isCloudDeploy) {
        const isApp = hostname.includes(".app.grond.dev") || hostname.includes(".app.worldwideview.dev") || hostname.includes(".localhost");
        if (isApp) {
            const subdomain = hostname.replace(".app.grond.dev", "").replace(".app.worldwideview.dev", "").replace(".localhost", "").split(":")[0];
            if (subdomain && subdomain !== "app" && subdomain !== "localhost") {
                tenantSubdomain = subdomain;
            }
        }
    }

    if (isDemo) {
        return continueWithTenant(req, tenantSubdomain);
    }

    if (
        path.startsWith("/_next")
        || path.startsWith("/api")
        || path.startsWith("/data")
        || path.startsWith("/cesium")
        || path.includes(".")
    ) {
        return continueWithTenant(req, tenantSubdomain);
    }

    if (isCloudDeploy && tenantSubdomain) {
        const workspaceInfo = await resolveWorkspace(tenantSubdomain);
        if (!workspaceInfo) {
            return new NextResponse("Workspace not found", { status: 404 });
        }
        if (workspaceInfo.status === "suspended" && !path.startsWith("/suspended")) {
            return NextResponse.redirect(new URL("/suspended", req.url));
        }
    }

    if (path.startsWith("/setup") || path.startsWith("/login")) {
        return continueWithTenant(req, tenantSubdomain);
    }

    if (isCloudDeploy && !tenantSubdomain) {
        if (path === "/" || path === "/register" || path === "/dashboard" || path === "/create-workspace") {
            return NextResponse.redirect("https://grond.dev/hub");
        }
    }

    const xfProto = req.headers.get("x-forwarded-proto");
    const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
    const isSecure = xfProto === "https"
        || authUrl.startsWith("https://")
        || req.nextUrl.protocol === "https:";
    const token = await getToken({
        req,
        secret: process.env.AUTH_SECRET,
        secureCookie: isSecure,
    });

    if (path.startsWith("/admin") && !path.startsWith("/admin/forbidden")) {
        if (!token) {
            return NextResponse.redirect(new URL("/login", req.nextUrl));
        }
        if (!isPlatformAdmin(token)) {
            return NextResponse.redirect(new URL("/admin/forbidden", req.nextUrl));
        }
    }

    if (token) {
        return continueWithTenant(req, tenantSubdomain);
    }

    if (await needsFirstRunSetup()) {
        return NextResponse.redirect(new URL("/setup", req.nextUrl));
    }

    return NextResponse.redirect(new URL("/login", req.nextUrl));
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
