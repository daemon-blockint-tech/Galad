import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

vi.mock("@/lib/userApiKeys", () => ({
    getUserApiKey: vi.fn(() => ""),
}));

// The module under test pulls in Cesium; whichever test imports it first pays a
// multi-second cold transform, which overruns the 5s default under a full run.
describe("googlePhotorealistic3d", { timeout: 60000 }, () => {
    const originalEnv = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

    beforeEach(() => {
        vi.resetModules();
        delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
    });

    afterEach(() => {
        if (originalEnv === undefined) {
            delete process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
        } else {
            process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = originalEnv;
        }
    });

    it("resolveGoogleMapsApiKey returns env key when long enough", async () => {
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "AIzaSyB123456789012345678901234";
        const { resolveGoogleMapsApiKey, hasGoogleMapsApiKey } = await import("./googlePhotorealistic3d");
        expect(resolveGoogleMapsApiKey()).toBe(process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY);
        expect(hasGoogleMapsApiKey()).toBe(true);
    });

    it("resolveGoogleMapsApiKey returns null when no key configured", async () => {
        const { resolveGoogleMapsApiKey, hasGoogleMapsApiKey } = await import("./googlePhotorealistic3d");
        expect(resolveGoogleMapsApiKey()).toBeNull();
        expect(hasGoogleMapsApiKey()).toBe(false);
    });

    it("prefers user key over env when both are set", async () => {
        process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY = "AIzaSyEnvKey123456789012345678";
        const userKey = "AIzaSyUserKey1234567890123456789";
        const { getUserApiKey } = await import("@/lib/userApiKeys");
        vi.mocked(getUserApiKey).mockReturnValue(userKey);

        const { resolveGoogleMapsApiKey } = await import("./googlePhotorealistic3d");
        expect(resolveGoogleMapsApiKey()).toBe(userKey);
    });
});
