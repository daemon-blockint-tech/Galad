/**
 * The tenant extension injects a filter only when a subdomain resolved, so a
 * cloud request that reached the origin on a host carrying no workspace used to
 * run every tenant-scoped query unfiltered. These tests pin the fail-closed
 * guard — and, just as importantly, pin that it stays a no-op on the local and
 * demo editions, which have no tenants at all.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_EDITION = process.env.NEXT_PUBLIC_MAVEN_EDITION;

async function loadGuard(edition?: string) {
    if (edition === undefined) {
        delete process.env.NEXT_PUBLIC_MAVEN_EDITION;
    } else {
        process.env.NEXT_PUBLIC_MAVEN_EDITION = edition;
    }
    vi.resetModules(); // `isCloud` is resolved at module load
    return (await import("./db")).assertTenantResolved;
}

afterEach(() => {
    if (ORIGINAL_EDITION === undefined) {
        delete process.env.NEXT_PUBLIC_MAVEN_EDITION;
    } else {
        process.env.NEXT_PUBLIC_MAVEN_EDITION = ORIGINAL_EDITION;
    }
});

describe("cloud edition fails closed", () => {
    it("throws on a tenant-scoped query that resolved no workspace", async () => {
        const assertTenantResolved = await loadGuard("cloud");
        expect(() => assertTenantResolved("Alert", "findMany", null, true))
            .toThrow(/Refusing to run Alert.findMany unscoped/);
    });

    it("names the operation so the offending call site is identifiable", async () => {
        const assertTenantResolved = await loadGuard("cloud");
        expect(() => assertTenantResolved("InstalledPlugin", "deleteMany", null, true))
            .toThrow(/InstalledPlugin\.deleteMany/);
    });

    it("allows the query once a workspace is resolved", async () => {
        const assertTenantResolved = await loadGuard("cloud");
        expect(() => assertTenantResolved("Alert", "findMany", "acme", true)).not.toThrow();
    });

    it("allows models that carry no tenantId column", async () => {
        const assertTenantResolved = await loadGuard("cloud");
        expect(() => assertTenantResolved("Workspace", "findUnique", null, true)).not.toThrow();
        expect(() => assertTenantResolved("OpsTask", "findMany", null, true)).not.toThrow();
    });

    it("allows background jobs, which run outside a request scope by design", async () => {
        const assertTenantResolved = await loadGuard("cloud");
        expect(() => assertTenantResolved("Alert", "findMany", null, false)).not.toThrow();
    });
});

describe("other editions are unaffected", () => {
    // Self-hosted local is the primary deployment target: no subdomain, no
    // workspace, getTenantId() null by design. Nothing here may ever throw.
    it.each(["local", "demo", undefined])("never throws on edition %s", async (edition) => {
        const assertTenantResolved = await loadGuard(edition);
        for (const model of ["Alert", "InstalledPlugin", "User", "Setting"]) {
            expect(() => assertTenantResolved(model, "findMany", null, true)).not.toThrow();
        }
    });
});
