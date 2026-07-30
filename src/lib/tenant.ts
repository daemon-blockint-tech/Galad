import { headers } from "next/headers";

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
 * Still derived from the header rather than the session: the session's
 * `tenantId` claim says which workspace the caller *belongs to*, and `src/proxy.ts`
 * refuses the request when the two disagree. The header stays the single value
 * that scopes data.
 *
 * Lives here rather than in `@/lib/ops/session` so `@/lib/auth` can read it
 * without that module's import of `auth` closing a cycle.
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
