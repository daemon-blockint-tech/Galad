import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { IonImageryProvider } from "cesium";
import { resetEarthEngineHealthCache } from "@/lib/earth-engine/healthClient";
import {
    createImageryProvider,
    createOsmProvider,
    createGeeImageryProvider,
    createBlueMarbleGibsProvider,
    hasCesiumIonAccess,
    migrateImageryLayerId,
} from "./ImageryProviderFactory";

vi.mock("cesium", () => {
    class UrlTemplateImageryProvider {
        _type = "UrlTemplate";
        url: string;
        subdomains?: string[];
        constructor(opts: { url: string; subdomains?: string[] }) {
            this.url = opts.url;
            this.subdomains = opts.subdomains;
        }
    }

    const IonImageryProvider = {
        fromAssetId: vi.fn().mockResolvedValue({ _type: "Ion" }),
    };

    const Ion = {
        defaultAccessToken: undefined as string | undefined,
    };

    const ArcGisMapServerImageryProvider = {
        fromUrl: vi.fn().mockResolvedValue({ _type: "ArcGis" }),
    };

    return {
        Ion,
        IonImageryProvider,
        ArcGisMapServerImageryProvider,
        UrlTemplateImageryProvider,
    };
});

const fetchMock = vi.fn();

beforeEach(() => {
    vi.clearAllMocks();
    resetEarthEngineHealthCache();
    vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe("migrateImageryLayerId", () => {
    it("maps legacy Bing ids to GEE or OSM", () => {
        expect(migrateImageryLayerId("bing-aerial")).toBe("gee-sentinel-rgb");
        expect(migrateImageryLayerId("bing-labels")).toBe("osm");
        expect(migrateImageryLayerId("bing-road")).toBe("osm");
        expect(migrateImageryLayerId("osm")).toBe("osm");
    });
});

describe("hasCesiumIonAccess", () => {
    it("is false without env token or Ion.defaultAccessToken", () => {
        expect(hasCesiumIonAccess()).toBe(false);
    });
});

describe("createBlueMarbleGibsProvider", () => {
    it("returns a UrlTemplateImageryProvider for NASA GIBS WMTS", () => {
        const provider = createBlueMarbleGibsProvider();
        expect((provider as { url: string }).url).toContain("gibs-a.earthdata.nasa.gov");
        expect((provider as { url: string }).url).toContain("BlueMarble_NextGeneration");
    });
});

describe("createOsmProvider", () => {
    it("returns a UrlTemplateImageryProvider for OSM tiles", () => {
        const provider = createOsmProvider();
        expect(provider).toBeDefined();
        expect((provider as { url: string }).url).toContain("openstreetmap.org");
    });
});

describe("createGeeImageryProvider", () => {
    it("fetches tile template from the Earth Engine API", async () => {
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({
                tileUrlTemplate:
                    "https://earthengine.googleapis.com/v1/test/tiles/{z}/{x}/{y}?token=t",
            }),
        });

        const provider = await createGeeImageryProvider("gee-sentinel-rgb");
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("/api/earth-engine/map?preset=gee-sentinel-rgb"),
        );
        expect((provider as { url: string }).url).toContain("earthengine.googleapis.com");
    });

    it("throws when the API returns an error", async () => {
        fetchMock.mockResolvedValue({
            ok: false,
            status: 503,
            text: async () => "not configured",
        });

        await expect(createGeeImageryProvider("gee-sentinel-rgb")).rejects.toThrow(/503/);
    });
});

describe("createImageryProvider", () => {
    it("returns GEE provider for gee-sentinel-rgb when health is configured", async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ configured: true }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tileUrlTemplate:
                        "https://earthengine.googleapis.com/v1/a/tiles/{z}/{x}/{y}",
                }),
            });

        const provider = await createImageryProvider("gee-sentinel-rgb");
        expect((provider as { url: string }).url).toContain("earthengine.googleapis.com");
    });

    it("uses OSM when Earth Engine health reports not configured", async () => {
        fetchMock.mockResolvedValueOnce({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ configured: false }),
        });

        const provider = await createImageryProvider("gee-sentinel-rgb");
        expect((provider as { url: string }).url).toContain("openstreetmap.org");
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock).toHaveBeenCalledWith("/api/earth-engine/health");
    });

    it("migrates bing-aerial to GEE sentinel when configured", async () => {
        fetchMock
            .mockResolvedValueOnce({
                ok: true,
                status: 200,
                text: async () => JSON.stringify({ configured: true }),
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({
                    tileUrlTemplate:
                        "https://earthengine.googleapis.com/v1/a/tiles/{z}/{x}/{y}",
                }),
            });

        const provider = await createImageryProvider("bing-aerial");
        expect(fetchMock).toHaveBeenCalledWith(
            expect.stringContaining("preset=gee-sentinel-rgb"),
        );
        expect((provider as { url: string }).url).toContain("earthengine.googleapis.com");
    });

    it("migrates bing-road to OSM", async () => {
        const provider = await createImageryProvider("bing-road");
        expect((provider as { url: string }).url).toContain("openstreetmap.org");
        expect(fetchMock).not.toHaveBeenCalled();
    });

    it("uses NASA GIBS when Cesium Ion token is not configured", async () => {
        const provider = await createImageryProvider("blue-marble");
        expect((provider as { url: string }).url).toContain("gibs-a.earthdata.nasa.gov");
        expect(IonImageryProvider.fromAssetId).not.toHaveBeenCalled();
    });

    it("uses Ion for blue-marble when Cesium Ion token is configured", async () => {
        vi.stubEnv("NEXT_PUBLIC_CESIUM_ION_TOKEN", "test-ion-token");
        const provider = await createImageryProvider("blue-marble");
        expect(IonImageryProvider.fromAssetId).toHaveBeenCalledWith(3845);
        expect((provider as unknown as { _type: string })._type).toBe("Ion");
        vi.unstubAllEnvs();
    });

    it("returns OSM for unknown layer ids", async () => {
        const provider = await createImageryProvider("nonexistent-layer");
        expect((provider as { url: string }).url).toContain("openstreetmap.org");
    });

    it("returns OSM for osm layer directly", async () => {
        const provider = await createImageryProvider("osm");
        expect((provider as { url: string }).url).toContain("openstreetmap.org");
    });
});
