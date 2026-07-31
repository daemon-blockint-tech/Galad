// @vitest-environment node
/**
 * Every entry-validation bypass in this codebase has had the same shape: the
 * value that was checked and the value that was executed were not the same
 * string. validateManifest checked `manifest.entry.trim()` while the loader
 * imported the raw `manifest.entry`, and the browser re-resolved that against the
 * current chunk URL rather than the validator's sentinel base.
 *
 * resolveEntryUrl closes that by construction: it hands back the exact string to
 * import. These tests pin the property, not the individual tricks.
 */
import { describe, expect, it } from "vitest";

import { isAllowedEntryUrl, resolveEntryUrl } from "./validateManifest";

/** Bases a browser might resolve a relative entry against. */
const BASES = [
    "https://app.example/",
    "https://app.example/ops",
    "https://app.example/_next/static/chunks/main-abc.js",
    "https://app.example/deep/nested/page?q=1",
];

const HOSTILE = [
    "//evil.example/x.js",
    " //evil.example/x.js",
    "/\\evil.example/x.js",
    "\\\\evil.example/x.js",
    "/\\/evil.example/x.js",
    "/\n/evil.example/x.js",
    "/\r/evil.example/x.js",
    "/\t/evil.example/x.js",
    "/plugins/../api/camera/proxy/iframe?url=https://evil.example/x.js",
    "/api/camera/proxy/iframe?url=https://evil.example/x.js",
    "https://evil.example/x.js",
    "https://unpkg.com@evil.example/x.js",
    "https://unpkg.com.evil.example/x.js",
    "javascript:alert(1)",
    "data:text/javascript,alert(1)",
];

const LEGITIMATE = [
    "/plugins/aviation.mjs",
    "/plugins-local/demo/frontend.mjs",
    "/e2e-fixtures/mock-plugin.js",
    "https://unpkg.com/pkg@1.0.0/dist/frontend.mjs",
    "https://cdn.jsdelivr.net/npm/pkg/dist/frontend.mjs",
    "https://plugins.grond.dev/aviation.mjs",
];

const ALLOWED_HOST = /^https:\/\/([^/]*\.)?(unpkg\.com|cdn\.jsdelivr\.net|grond\.dev|worldwideview\.dev|maven-system\.dev)\//;

describe("resolveEntryUrl", () => {
    it.each(HOSTILE)("refuses %j", (entry) => {
        expect(resolveEntryUrl(entry)).toBeNull();
        expect(isAllowedEntryUrl(entry)).toBe(false);
    });

    it.each(LEGITIMATE)("accepts %j", (entry) => {
        expect(resolveEntryUrl(entry)).not.toBeNull();
    });

    it("returns a value that means the same thing under every base", () => {
        // The property that matters: whatever the loader is handed must resolve to
        // one URL regardless of which chunk URL the browser resolves it against. A
        // bare relative entry would not — hence root-absolute paths.
        for (const entry of LEGITIMATE) {
            const canonical = resolveEntryUrl(entry)!;
            const perBase = new Set(BASES.map((base) => new URL(canonical, base).href));

            expect(perBase.size).toBe(1);
        }
    });

    it("never returns something that re-parses to a foreign origin", () => {
        for (const entry of [...LEGITIMATE, ...HOSTILE]) {
            const canonical = resolveEntryUrl(entry);
            if (canonical === null) continue;

            for (const base of BASES) {
                const href = new URL(canonical, base).href;

                expect(href.startsWith("https://app.example/") || ALLOWED_HOST.test(href)).toBe(true);
            }
        }
    });

    it("is idempotent, so re-validating its own output cannot drift", () => {
        for (const entry of LEGITIMATE) {
            const once = resolveEntryUrl(entry)!;

            expect(resolveEntryUrl(once)).toBe(once);
        }
    });
});
