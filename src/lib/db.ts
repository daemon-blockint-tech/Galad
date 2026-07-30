import { PrismaPg } from "@prisma/adapter-pg";
import { Pool } from "pg";
import { headers } from "next/headers";
import { isCloud } from "@/core/edition";
import { Prisma, PrismaClient } from "../generated/prisma";

/**
 * Prisma client singleton — PostgreSQL only.
 *
 * Local dev:  Run `npx prisma dev` for a zero-install local Postgres.
 * Production: Set DATABASE_URL to your Supabase/Postgres connection string.
 *
 * Uses globalThis to survive Next.js HMR in development.
 */

const globalForPrisma = globalThis as unknown as {
    prisma: PrismaClient | undefined;
};

/**
 * Models carrying a `tenantId` column, read from the schema rather than listed
 * by hand. Injecting `tenantId` into a model without that column makes Prisma
 * reject the whole query, so this set must never drift from the datamodel —
 * `OpsTask` and `OpsAlert` are scoped by `userId` through the tenanted `User`.
 */
export const TENANT_SCOPED_MODELS = new Set(
    Prisma.dmmf.datamodel.models
        .filter((model) => model.fields.some((field) => field.name === "tenantId"))
        .map((model) => model.name),
);

/**
 * Fail closed on the cloud edition.
 *
 * The injection below is conditional on a resolved subdomain, so a request that
 * reached the origin on a host carrying no workspace — the apex, a custom
 * domain, the container's own address — used to run every tenant-scoped query
 * with no filter at all. `src/proxy.ts` now refuses those hosts; this is the
 * backstop for anything that gets past it.
 *
 * Only guards requests. Scripts, seeders and queue workers run outside a
 * request scope by design and pass their own `tenantId` explicitly, and the
 * other two editions have no tenants at all — both are left untouched.
 */
export function assertTenantResolved(
    model: string,
    operation: string,
    tenantSubdomain: string | null,
    inRequestScope: boolean,
): void {
    if (!isCloud || !inRequestScope || tenantSubdomain) return;
    if (!TENANT_SCOPED_MODELS.has(model)) return;
    throw new Error(
        `[db] Refusing to run ${model}.${operation} unscoped: this request resolved no workspace.`,
    );
}

/** Operations whose `where` the extension rewrites to pin the tenant. */
const WHERE_SCOPED_OPERATIONS = new Set([
    "findUnique", "findUniqueOrThrow", "findFirst", "findFirstOrThrow", "findMany",
    "update", "updateMany", "delete", "deleteMany", "count", "upsert",
]);

/** Operations that carry no `where` but are still safely scoped by data injection. */
const DATA_SCOPED_OPERATIONS = new Set(["create", "createMany", "createManyAndReturn"]);

/**
 * Refuses an operation on a tenanted model that this extension does not know how
 * to scope — `groupBy` and `aggregate` accept a `where` Prisma shapes differently,
 * and anything added to Prisma later lands here too. None are used today; the
 * point is that the first one someone writes fails loudly instead of silently
 * returning another tenant's rows.
 */
export function assertOperationIsScopable(model: string, operation: string): void {
    if (WHERE_SCOPED_OPERATIONS.has(operation) || DATA_SCOPED_OPERATIONS.has(operation)) return;
    throw new Error(
        `[db] ${model}.${operation} has no tenant scoping in the Prisma extension. `
        + `Add it to WHERE_SCOPED_OPERATIONS in src/lib/db.ts, or pass tenantId explicitly.`,
    );
}

function applyTenantIsolation(client: any) {
    // Use Prisma Client Extension to inject RLS
    return client.$extends({
        query: {
            $allModels: {
                async $allOperations({
 model, operation, args, query
}: { model: string, operation: string, args: any, query: any }) {
                    let tenantSubdomain: string | null = null;
                    let inRequestScope = false;
                    try {
                        const headersList = await headers();
                        inRequestScope = true;
                        tenantSubdomain = headersList.get("x-tenant-subdomain");
                    } catch {
                        // Not in a request context (e.g. scripts, background jobs)
                    }

                    assertTenantResolved(model, operation, tenantSubdomain, inRequestScope);

                    if (tenantSubdomain && TENANT_SCOPED_MODELS.has(model)) {
                        args = args || {};

                        // Inject into data for creates
                        if (operation === 'create' || operation === 'createMany') {
                            if (Array.isArray(args.data)) {
                                args.data = args.data.map((d: any) => ({ ...d, tenantId: tenantSubdomain }));
                            } else if (args.data) {
                                args.data.tenantId = tenantSubdomain;
                            }
                        }

                        // Inject into data for updates
                        if (operation === 'update' || operation === 'updateMany') {
                            if (args.data) args.data.tenantId = tenantSubdomain;
                        }
                        if (operation === 'upsert') {
                            if (args.create) args.create.tenantId = tenantSubdomain;
                            if (args.update) args.update.tenantId = tenantSubdomain;
                        }

                        // Inject into where filters
                        if (WHERE_SCOPED_OPERATIONS.has(operation)) {
                            args.where = { ...(args.where || {}), tenantId: tenantSubdomain };
                        }
                        assertOperationIsScopable(model, operation);

                        return query(args);
                    }
                    return query(args);
                },
            },
        },
    }) as unknown as PrismaClient; // Cast to avoid complex type issues in consuming code for now
}

function createPrismaClient(): PrismaClient {
    const connectionString = process.env.DATABASE_URL;

    // During Next.js build time, DATABASE_URL might not be set.
    // We shouldn't throw synchronously here to avoid breaking static generation.
    if (!connectionString) {
        console.warn("[db] DATABASE_URL is not set. Database operations will fail until it is provided.");
        // Return a dummy proxy that throws only when an operation is actually attempted
        return new Proxy({}, {
            get(target, prop) {
                if (prop === '$extends') return () => target; // needed for applyTenantIsolation
                throw new Error("[db] DATABASE_URL is missing. Please set it to a PostgreSQL connection string.");
            }
        }) as PrismaClient;
    }

    const pool = new Pool({ connectionString });
    const adapter = new PrismaPg(pool);
    const client = new PrismaClient({ adapter });

    return applyTenantIsolation(client);
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== "production") {
    globalForPrisma.prisma = prisma;
}
