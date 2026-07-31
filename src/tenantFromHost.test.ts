// @vitest-environment node
/**
 * The tenant derived from Host keys every tenant-scoped query and is what the
 * session's tenantId claim is checked against, so the host -> tenant map has to
 * be injective. It previously used `includes` to decide and a chain of
 * `replace` calls to derive, which is not: two different hosts collapsed to one
 * tenant, and a host merely containing the app domain produced a tenant at all.
 */
import { describe, expect, it } from "vitest";

import { tenantFromHost } from "./proxy";

describe("tenantFromHost", () => {
    it.each([
        ["acme.app.grond.dev", "acme"],
        ["acme.app.grond.dev:3000", "acme"],
        ["ACME.App.Grond.Dev", "acme"],
        ["acme.app.worldwideview.dev", "acme"],
        ["acme.localhost", "acme"],
        ["acme.localhost:3000", "acme"],
        ["a-b-1.app.grond.dev", "a-b-1"],
    ])("maps %s to %s", (host, tenant) => {
        expect(tenantFromHost(host)).toBe(tenant);
    });

    it.each([
        ["app.grond.dev", "the apex is not a workspace"],
        ["app.app.grond.dev", "the reserved app label"],
        ["localhost", "bare localhost"],
        ["localhost:3000", "bare localhost with a port"],
        ["grond.dev", "the marketing domain"],
        ["acme.app.grond.dev.evil.tld", "app domain as an infix, not a suffix"],
        ["acme.localhost.app.grond.dev", "two labels, not one"],
        ["sub.acme.app.grond.dev", "two labels, not one"],
        ["evil.tld", "an unrelated host"],
        ["", "an absent Host header"],
        [".app.grond.dev", "an empty label"],
        ["-acme.app.grond.dev", "a label that cannot be a hostname"],
    ])("refuses %s (%s)", (host) => {
        expect(tenantFromHost(host)).toBeNull();
    });

    it("never maps two different hosts to the same tenant", () => {
        // The collision that mattered: chained replace() turned both of these into
        // "acme", so a wildcard-covered alias impersonated a real workspace.
        expect(tenantFromHost("acme.localhost.app.grond.dev")).not.toBe(
            tenantFromHost("acme.app.grond.dev"),
        );
    });

    it("only ever returns a single hostname label", () => {
        for (const host of ["acme.app.grond.dev.evil.tld", "a.b.app.grond.dev", "x.y.localhost"]) {
            const tenant = tenantFromHost(host);
            if (tenant !== null) expect(tenant).not.toContain(".");
        }
    });
});
