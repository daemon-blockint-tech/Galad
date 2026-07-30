import { headers } from "next/headers";
import { auth } from "@/lib/auth";

/**
 * Resolves the authenticated user id for ops API routes.
 */
export async function getOpsUserId(): Promise<string | null> {
    const session = await auth();
    return session?.user?.id ?? null;
}

/**
 * Resolves the tenant scope of the current request.
 *
 * Tenancy is keyed by workspace subdomain: `src/proxy.ts` derives it from the
 * host and sets `x-tenant-subdomain`, and the Prisma extension in `src/lib/db.ts`
 * injects that same value into every query. Routes that persist `tenantId`
 * themselves must read it from here so both agree on one value.
 *
 * Returns null when there is no tenant context (self-hosted/demo, background
 * jobs, or any call made outside a request scope) — matching the nullable
 * `tenantId` columns in the schema.
 *
 * Not derived from the session: the auth callbacks never put a tenant on the
 * JWT, so `session.user` carries no tenant identity.
 */
export async function getTenantId(): Promise<string | null> {
    try {
        const headersList = await headers();
        return headersList.get("x-tenant-subdomain");
    } catch {
        // Not in a request context (scripts, background jobs).
        return null;
    }
}
