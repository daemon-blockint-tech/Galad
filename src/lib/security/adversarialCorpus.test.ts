// @vitest-environment node
/**
 * The whole corpus, run against every parser boundary, asserting INVARIANTS
 * rather than a hand-written verdict per payload.
 *
 * The point is that a payload added because it defeated one boundary is then
 * tested against all of them, and that no payload needs a hand-labelled
 * expectation — so this cannot lock in whatever the implementation happens to do
 * today. Each of the three historical bypasses violates one of these properties,
 * so an equivalent trick fails here even though nobody thought to list it.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getSafeRedirect } from "@/lib/navigation/safeRedirect";
import { resolveEntryUrl } from "@/core/plugins/validateManifest";
import { ENTRY_PAYLOADS, REDIRECT_PAYLOADS } from "./adversarialCorpus";

// The entry rules relax for the plugin CLI's dev server outside production, so
// the invariants are asserted against the posture that actually ships.
beforeAll(() => vi.stubEnv("NODE_ENV", "production"));
afterAll(() => vi.unstubAllEnvs());

const APP_ORIGIN = "https://app.example";

/** Bases the browser might resolve against; a canonical value must not care. */
const BASES = [
    `${APP_ORIGIN}/`,
    `${APP_ORIGIN}/ops`,
    `${APP_ORIGIN}/_next/static/chunks/main-abc.js`,
    `${APP_ORIGIN}/deep/nested/page?q=1`,
];

const ALLOWED_ENTRY_HOST =
    /^https:\/\/([^/]*\.)?(unpkg\.com|cdn\.jsdelivr\.net|grond\.dev|worldwideview\.dev|maven-system\.dev)\//;

describe("entry payloads", () => {
    it("has a corpus worth running", () => {
        expect(ENTRY_PAYLOADS.length).toBeGreaterThan(40);
    });

    it("only ever admits a value that lands on this origin or an allowlisted host", () => {
        for (const payload of ENTRY_PAYLOADS) {
            const canonical = resolveEntryUrl(payload);
            if (canonical === null) continue;

            for (const base of BASES) {
                const href = new URL(canonical, base).href;
                const ok = href.startsWith(`${APP_ORIGIN}/`) || ALLOWED_ENTRY_HOST.test(href);

                expect(ok, `${JSON.stringify(payload)} -> ${canonical} -> ${href}`).toBe(true);
            }
        }
    });

    it("admits nothing that lands on this origin outside a bundle directory", () => {
        // Same-origin is not sufficient — /api/camera/proxy/* relays a remote body
        // under a caller-chosen content type, which would be a module on our origin.
        for (const payload of ENTRY_PAYLOADS) {
            const canonical = resolveEntryUrl(payload);
            if (canonical === null) continue;

            const href = new URL(canonical, BASES[2]).href;
            if (!href.startsWith(`${APP_ORIGIN}/`)) continue;

            const { pathname } = new URL(href);
            const underBundleDir = ["/plugins/", "/plugins-local/", "/e2e-fixtures/"].some((p) =>
                pathname.startsWith(p),
            );

            expect(underBundleDir, `${JSON.stringify(payload)} -> ${pathname}`).toBe(true);
        }
    });

    it("resolves a value it admits to one URL regardless of base", () => {
        for (const payload of ENTRY_PAYLOADS) {
            const canonical = resolveEntryUrl(payload);
            if (canonical === null) continue;

            const perBase = new Set(BASES.map((base) => new URL(canonical, base).href));

            expect(perBase.size, `${JSON.stringify(payload)} -> ${canonical}`).toBe(1);
        }
    });

    it("is a fixed point: re-validating its own output does not drift", () => {
        for (const payload of ENTRY_PAYLOADS) {
            const once = resolveEntryUrl(payload);
            if (once === null) continue;

            expect(resolveEntryUrl(once), JSON.stringify(payload)).toBe(once);
        }
    });

    it("accepts the legitimate CDN forms, so the rule is not just 'reject everything'", () => {
        const admitted = ENTRY_PAYLOADS.filter((p) => resolveEntryUrl(p) !== null);

        expect(admitted.length).toBeGreaterThan(0);
    });
});

describe("redirect payloads", () => {
    it("never returns a target that leaves this origin", () => {
        for (const payload of REDIRECT_PAYLOADS) {
            const target = getSafeRedirect(payload, APP_ORIGIN);
            const landed = new URL(target, APP_ORIGIN);

            expect(landed.origin, `${JSON.stringify(payload)} -> ${target}`).toBe(APP_ORIGIN);
        }
    });

    it("never returns a target under /api, which mutates on GET", () => {
        for (const payload of REDIRECT_PAYLOADS) {
            const target = getSafeRedirect(payload, APP_ORIGIN);

            expect(new URL(target, APP_ORIGIN).pathname.startsWith("/api")).toBe(false);
        }
    });

    it("is a fixed point, so the value handed to the router cannot re-parse elsewhere", () => {
        // "/..//evil.com" resolved same-origin but returned a pathname that the
        // router re-parsed as an authority. Feeding the output back in catches that.
        for (const payload of REDIRECT_PAYLOADS) {
            const once = getSafeRedirect(payload, APP_ORIGIN);

            expect(getSafeRedirect(once, APP_ORIGIN), JSON.stringify(payload)).toBe(once);
        }
    });

    it("still passes ordinary in-app destinations through", () => {
        expect(getSafeRedirect("/ops", APP_ORIGIN)).toBe("/ops");
        expect(getSafeRedirect("/ops?tab=1#a", APP_ORIGIN)).toBe("/ops?tab=1#a");
        expect(getSafeRedirect("/admin/overview", APP_ORIGIN)).toBe("/admin/overview");
        expect(getSafeRedirect(null, APP_ORIGIN)).toBe("/ops");
    });
});
