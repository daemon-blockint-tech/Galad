import { afterEach, describe, it, expect, vi } from "vitest";
import { resolveEdition } from "./edition";
import type { Edition } from "./edition";

describe("resolveEdition", () => {
    it("defaults to 'local' when env var is undefined", () => {
        expect(resolveEdition(undefined)).toBe("local");
    });

    it("defaults to 'local' for an empty string", () => {
        expect(resolveEdition("")).toBe("local");
    });

    it("returns 'local' for value 'local'", () => {
        expect(resolveEdition("local")).toBe("local");
    });

    it("returns 'cloud' for value 'cloud'", () => {
        expect(resolveEdition("cloud")).toBe("cloud");
    });

    it("returns 'demo' for value 'demo'", () => {
        expect(resolveEdition("demo")).toBe("demo");
    });

    it("is case-insensitive", () => {
        expect(resolveEdition("CLOUD")).toBe("cloud");
        expect(resolveEdition("Demo")).toBe("demo");
    });

    it("trims whitespace", () => {
        expect(resolveEdition("  cloud  ")).toBe("cloud");
    });

    it("falls back to 'local' for invalid values", () => {
        const invalid: string[] = ["staging", "production", "test", "123"];
        for (const val of invalid) {
            expect(resolveEdition(val)).toBe("local" satisfies Edition);
        }
    });
});

describe("isHistoryEnabled (derived from edition)", () => {
    it("is disabled on demo edition", () => {
        // History unavailable on demo — shared credentials breach the non-transferable ToS clause
        expect(resolveEdition("demo")).toBe("demo");
        // Simulate the flag logic: !isDemo
        const historyEnabled = resolveEdition("demo") !== "demo";
        expect(historyEnabled).toBe(false);
    });

    it("is enabled on local edition", () => {
        const historyEnabled = resolveEdition("local") !== "demo";
        expect(historyEnabled).toBe(true);
    });

    it("is enabled on cloud edition", () => {
        const historyEnabled = resolveEdition("cloud") !== "demo";
        expect(historyEnabled).toBe(true);
    });
});

describe("isPlatformAdmin (who may reach /admin)", () => {
    // The middleware and the (admin) layout both gate the console. They used to
    // disagree on demo: the middleware required the demo-admin role while this
    // accepted any account carrying role "admin".
    const ORIGINAL = process.env.NEXT_PUBLIC_MAVEN_EDITION;

    async function load(edition: string) {
        process.env.NEXT_PUBLIC_MAVEN_EDITION = edition;
        vi.resetModules(); // isDemo is resolved at module load
        return import("./edition");
    }

    afterEach(() => {
        if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_MAVEN_EDITION;
        else process.env.NEXT_PUBLIC_MAVEN_EDITION = ORIGINAL;
    });

    it("admits role admin off demo", async () => {
        const { isPlatformAdmin } = await load("local");
        expect(isPlatformAdmin({ user: { role: "admin" } })).toBe(true);
    });

    it("refuses role user off demo", async () => {
        const { isPlatformAdmin } = await load("local");
        expect(isPlatformAdmin({ user: { role: "user" } })).toBe(false);
    });

    it("refuses a plain admin account on demo", async () => {
        const { isPlatformAdmin } = await load("demo");
        expect(isPlatformAdmin({ user: { role: "admin" } })).toBe(false);
    });

    it("admits the demo admin on demo", async () => {
        const { isPlatformAdmin, DEMO_ADMIN_ROLE } = await load("demo");
        expect(isPlatformAdmin({ user: { role: DEMO_ADMIN_ROLE } })).toBe(true);
    });

    it("refuses an absent session", async () => {
        const { isPlatformAdmin } = await load("local");
        expect(isPlatformAdmin(null)).toBe(false);
        expect(isPlatformAdmin({})).toBe(false);
    });
});
