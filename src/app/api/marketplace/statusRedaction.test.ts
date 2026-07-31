// @vitest-environment node
/**
 * /api/marketplace/status is anonymous on the demo edition and reflects any
 * Origin, so anything it returns is public. The stored `config` is the whole
 * manifest, which for a declarative plugin carries dataSource.headers — Bearer
 * tokens and API keys. It must be reduced to display fields before it leaves.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/marketplace/repository", () => ({ getInstalledPlugins: vi.fn() }));
vi.mock("@/lib/auth", () => ({ auth: vi.fn(async () => null) }));

import { getInstalledPlugins } from "@/lib/marketplace/repository";

const ORIGINAL_EDITION = process.env.NEXT_PUBLIC_MAVEN_EDITION;

/** Demo is the exposed case: the route skips auth there and reflects any Origin. */
async function loadDemoRoute() {
    process.env.NEXT_PUBLIC_MAVEN_EDITION = "demo";
    vi.resetModules(); // isDemo is resolved at module load
    return (await import("./status/route")).GET;
}

const SECRET = "Bearer SUPER-SECRET-KEY";

beforeEach(() => {
    vi.mocked(getInstalledPlugins).mockResolvedValue([
        {
            pluginId: "weather",
            version: "1.0.0",
            enabled: true,
            installedAt: new Date("2026-01-01T00:00:00Z"),
            config: JSON.stringify({
                id: "weather",
                name: "Weather",
                icon: "🌦",
                trust: "unverified",
                entry: "https://unpkg.com/weather@1/dist/f.mjs",
                dataSource: { url: "https://api.example/v1", headers: { Authorization: SECRET } },
            }),
        },
    ] as never);
});

afterEach(() => {
    if (ORIGINAL_EDITION === undefined) delete process.env.NEXT_PUBLIC_MAVEN_EDITION;
    else process.env.NEXT_PUBLIC_MAVEN_EDITION = ORIGINAL_EDITION;
});

async function listedPlugins() {
    const GET = await loadDemoRoute();
    const res = await GET(new Request("https://demo.example/api/marketplace/status"));
    const body = await res.json();
    return body.plugins as Array<{ pluginId: string; config: string }>;
}

describe("GET /api/marketplace/status", () => {
    it("never returns dataSource credentials", async () => {
        const raw = JSON.stringify(await listedPlugins());

        expect(raw).not.toContain(SECRET);
        expect(raw).not.toContain("dataSource");
    });

    it("still returns the fields the plugin list renders", async () => {
        const [plugin] = await listedPlugins();
        const display = JSON.parse(plugin.config);

        expect(plugin.pluginId).toBe("weather");
        expect(display).toMatchObject({ name: "Weather", icon: "🌦", trust: "unverified" });
    });

    it("does not leak the entry URL either", async () => {
        const [plugin] = await listedPlugins();

        expect(plugin.config).not.toContain("unpkg.com");
    });

    it("tolerates a row whose config is not valid JSON", async () => {
        vi.mocked(getInstalledPlugins).mockResolvedValue([
            { pluginId: "broken", version: "1", enabled: true, installedAt: new Date(), config: "{oops" },
        ] as never);

        const [plugin] = await listedPlugins();

        expect(plugin.pluginId).toBe("broken");
        expect(() => JSON.parse(plugin.config)).not.toThrow();
    });
});
