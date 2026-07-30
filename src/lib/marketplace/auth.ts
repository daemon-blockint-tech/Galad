import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isDemo, isDemoAdmin } from "@/core/edition";
import { getTenantId } from "@/lib/tenant";
import { verifyMarketplaceToken } from "./marketplaceToken";

/**
 * Validate marketplace API access. Accepts (in order):
 *   1. Active Auth.js session (browser redirect flow)
 *   2. Marketplace JWT issued at install time (cross-origin Manage page)
 * Returns null if authorized, or a NextResponse error if not.
 */
export async function validateMarketplaceAuth(
    request: Request,
): Promise<NextResponse | null> {
    // 1. Try session auth first
    const session = await auth();
    if (session?.user) {
        if (isDemo && !isDemoAdmin(session)) {
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
