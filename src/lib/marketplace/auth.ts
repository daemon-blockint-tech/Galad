import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDemo, isDemoAdmin, isPlatformAdmin } from "@/core/edition";
import { getTenantId } from "@/lib/tenant";
import { verifyMarketplaceToken } from "./marketplaceToken";

/**
 * Validate marketplace API access. Accepts (in order):
 *   1. Active Auth.js session (browser redirect flow)
 *   2. Marketplace JWT issued at install time (cross-origin Manage page)
 * Returns null if authorized, or a NextResponse error if not.
 *
 * `requireAdmin` gates the operations that change what every member of the
 * workspace loads: a plugin manifest's `entry` is dynamically imported into each
 * user's browser, so installing one is effectively running code on all of them.
 * The first user created by the setup flow is an admin, so a single-user
 * self-host is unaffected.
 */
export async function validateMarketplaceAuth(
    request: Request,
    options: { requireAdmin?: boolean } = {},
): Promise<NextResponse | null> {
    const adminRequired = options.requireAdmin === true;

    // 1. Try session auth first
    const session = await auth();
    if (session?.user) {
        if (isDemo && !isDemoAdmin(session)) {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }
        if (adminRequired && !isPlatformAdmin(session)) {
            return NextResponse.json({ error: "Admin access required" }, { status: 403 });
        }
        return null;
    }

    // 2. Try marketplace JWT bearer token
    const authHeader = request.headers.get("authorization");
    const bearer = authHeader?.startsWith("Bearer ") ? authHeader.slice(7) : undefined;
    if (bearer) {
        let payload;
        try {
            payload = await verifyMarketplaceToken(bearer);
        } catch {
            // not a valid marketplace JWT — fall through to 401
        }

        if (payload) {
            // Same gate as the session branch above: the token carries the role
            // its issuing session held, so a demo instance still only serves its
            // admin. A bearer token is otherwise indistinguishable from one.
            if (isDemo && !isDemoAdmin({ user: { role: payload.role } })) {
                return NextResponse.json({ error: "Admin access required" }, { status: 403 });
            }
            if (adminRequired && !isPlatformAdmin({ user: { role: payload.role } })) {
                return NextResponse.json({ error: "Admin access required" }, { status: 403 });
            }
            // The token verifies on every workspace — AUTH_SECRET is global — so
            // the issuing tenant has to match the one this request resolved to.
            if (payload.tenant !== await getTenantId()) {
                return NextResponse.json(
                    { error: "Token was issued for a different workspace" },
                    { status: 403 },
                );
            }
            return null;
        }
    }

    return NextResponse.json(
        { error: "Unauthorized — sign in to Grond or provide a valid token" },
        { status: 401 },
    );
}
