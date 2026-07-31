import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";
import { isDemo, isDemoAdmin, isPlatformAdmin } from "@/core/edition";
import { getPublicEdition } from "@/core/grondEnv";
import { readJsonResponse } from "@/lib/http/readJsonResponse";
import { internalRequestHeaders } from "@/lib/security/internalRequest";

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

/**
 * Hosts on which the app reaches itself.
 *
 * `resolveWorkspace` below self-fetches `internalAppUrl()`, which defaults to
 * loopback. Those requests carry no workspace subdomain and no session cookie,
 * so the cloud host guard must let them through or the middleware 404s its own
 * workspace lookup and every page with it.
 */
function isLoopbackHost(hostname: string): boolean {
    const host = hostname.toLowerCase().replace(/:\d+$/, "").replace(/^\[|\]$/g, "");
    return host === "127.0.0.1" || host === "localhost" || host === "::1";
}

/** Domains under which a workspace is addressed as a single leading label. */
const APP_DOMAINS = ["app.grond.dev", "app.worldwideview.dev", "localhost"];

/**
 * The workspace this Host addresses, or null.
 *
 * Derived by splitting labels rather than by `includes` + chained `replace`. That
 * pair was not injective: `acme.localhost.app.grond.dev` stripped down to "acme",
 * the same tenant as `acme.app.grond.dev`, and `acme.app.grond.dev.evil.tld`
 * passed the substring test and yielded "acme.evil.tld". This value keys every
 * tenant-scoped query, so two hosts must never collapse to one tenant.
 */
export function tenantFromHost(host: string): string | null {
    const hostname = host.toLowerCase().split(":")[0].replace(/\.$/, "");

    for (const domain of APP_DOMAINS) {
        const suffix = `.${domain}`;
        if (!hostname.endsWith(suffix)) continue;

        const label = hostname.slice(0, -suffix.length);
        // Exactly one label: "acme" yes, "acme.localhost" no.
        if (!/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label)) return null;
        if (label === "app" || label === "localhost") return null;
        return label;
    }
    return null;
}

/** Apex-only paths that predate workspaces and belong on the marketing hub. */
const HUB_REDIRECT_PATHS = new Set(["/", "/register", "/dashboard", "/create-workspace"]);

function readToken(req: NextRequest) {
    const xfProto = req.headers.get("x-forwarded-proto");
    const authUrl = process.env.AUTH_URL ?? process.env.NEXTAUTH_URL ?? "";
    const isSecure = xfProto === "https"
        || authUrl.startsWith("https://")
        || req.nextUrl.protocol === "https:";
    return getToken({
        req,
        secret: process.env.AUTH_SECRET,
        secureCookie: isSecure,
    });
}

/**
 * The single gate for cross-tenant session replay.
 *
 * Every cookie-authenticated surface — ops routes, agent routes, favorites, the
 * marketplace session branch, server actions, pages — passes through the
 * middleware before its handler runs, so the check lives here instead of in
 * dozens of route bodies. `AUTH_SECRET` is one global value: a JWT minted on
 * `a.app.grond.dev` verifies fine on `b.app.grond.dev`, and only the `tenantId`
 * claim tells them apart.
 *
 * A token minted before the claim existed reads as no tenant and is refused —
 * cloud sessions from an older build must sign in again.
 *
 * `/api/auth/*` is exempt so a stale cookie can never lock a user out of signing
 * in to the workspace they are actually on. Those routes expose the caller's own
 * identity, never tenant data.
 */
async function denyForeignTenant(
    req: NextRequest,
    tenantSubdomain: string,
): Promise<NextResponse | null> {
    if (req.nextUrl.pathname.startsWith("/api/auth")) return null;

    const token = await readToken(req);
    if (!token) return null;

    const tokenTenant = typeof token.tenantId === "string" ? token.tenantId : null;
    if (tokenTenant === tenantSubdomain) return null;

    return new NextResponse("Forbidden: this session belongs to a different workspace", {
        status: 403,
    });
}

async function resolveWorkspace(subdomain: string) {
    const cached = workspaceCache.get(subdomain);
    if (cached && Date.now() < cached.expiresAt) return cached;

    try {
        const url = new URL(`/api/internal/workspace/${subdomain}`, internalAppUrl());
        const res = await fetch(url.toString(), {
            headers: { "User-Agent": "Grond-Middleware", ...internalRequestHeaders() },
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
            headers: { "User-Agent": "Grond-Middleware", ...internalRequestHeaders() },
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
        tenantSubdomain = tenantFromHost(hostname);
    }

    // Cloud host guard. `/api/internal/*` is the middleware's own lane — it is
    // the target of the self-fetch above and reads only `Workspace`, which
    // carries no tenantId — so exempting it cannot leak tenant data and keeps
    // the lookup working even when `internalAppUrl()` is pointed off loopback.
    if (isCloudDeploy && !isLoopbackHost(hostname) && !path.startsWith("/api/internal")) {
        if (!tenantSubdomain) {
            // Nothing maps this host to a workspace. Continuing would run every
            // tenant-scoped query unfiltered — see the fail-closed backstop in
            // src/lib/db.ts.
            if (HUB_REDIRECT_PATHS.has(path)) {
                return NextResponse.redirect("https://grond.dev/hub");
            }
            return new NextResponse("Workspace not found", { status: 404 });
        }

        const denied = await denyForeignTenant(req, tenantSubdomain);
        if (denied) return denied;
    }

    const isAdminPath = path.startsWith("/admin") && !path.startsWith("/admin/forbidden");

    // Demo serves everything else anonymously, but the admin console is exactly what
    // the demo-admin role exists to keep separate — so it is gated before that.
    if (isDemo && isAdminPath) {
        const demoToken = await readToken(req);
        if (!demoToken || !isDemoAdmin({ user: { role: demoToken.role } })) {
            return NextResponse.redirect(new URL("/admin/forbidden", req.nextUrl));
        }
    }

    if (isDemo) {
        return continueWithTenant(req, tenantSubdomain);
    }

    // `path.includes(".")` treats anything with a dot as a static asset, which
    // would let /admin/anything.json skip the gate below. An auth check must not
    // sit under a filename heuristic.
    if (
        !isAdminPath
        && (path.startsWith("/_next")
            || path.startsWith("/api")
            || path.startsWith("/data")
            || path.startsWith("/cesium")
            || path.includes("."))
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

    // Cloud workspaces are provisioned, so createAdminAccount refuses there. Serving
    // the form anyway would present a sign-up that can only ever fail — and it is
    // the page an anonymous visitor would reach on a workspace with no users yet.
    if (isCloudDeploy && path.startsWith("/setup")) {
        return NextResponse.redirect(new URL("/login", req.nextUrl));
    }

    if (path.startsWith("/setup") || path.startsWith("/login")) {
        return continueWithTenant(req, tenantSubdomain);
    }

    const token = await readToken(req);

    if (isAdminPath) {
        if (!token) {
            return NextResponse.redirect(new URL("/login", req.nextUrl));
        }
        // getToken returns the flat JWT payload; isPlatformAdmin expects a session
        // shape, so passing the token straight in made `session.user` undefined and
        // sent every real admin to /admin/forbidden.
        if (!isPlatformAdmin({ user: { role: token.role } })) {
            return NextResponse.redirect(new URL("/admin/forbidden", req.nextUrl));
        }
    }

    if (token) {
        return continueWithTenant(req, tenantSubdomain);
    }

    // Not on cloud: the probe is a single global `user.count()`, which is both
    // unscoped (the fail-closed guard in src/lib/db.ts now rejects it) and wrong
    // there — one tenant having users said nothing about this one. Cloud
    // workspaces are provisioned rather than first-run set up, and /setup stays
    // reachable by hand, correctly tenant-scoped.
    if (!isCloudDeploy && await needsFirstRunSetup()) {
        return NextResponse.redirect(new URL("/setup", req.nextUrl));
    }

    return NextResponse.redirect(new URL("/login", req.nextUrl));
}

export const config = {
    matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
