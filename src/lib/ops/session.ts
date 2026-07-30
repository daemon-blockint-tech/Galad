import { auth } from "@/lib/auth";

/**
 * Re-exported so the dozens of routes that already import it here keep working;
 * the implementation lives in `@/lib/tenant` because `@/lib/auth` needs it too.
 */
export { getTenantId } from "@/lib/tenant";

/**
 * Resolves the authenticated user id for ops API routes.
 *
 * Carries no tenant check of its own: `src/proxy.ts` refuses a session whose
 * `tenantId` claim disagrees with the host before any handler runs.
 */
export async function getOpsUserId(): Promise<string | null> {
    const session = await auth();
    return session?.user?.id ?? null;
}
