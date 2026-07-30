/**
 * @file presets.ts
 * @description Named Earth Engine imagery presets for Grond basemap layers.
 */

import type { EeImage } from "@google/earthengine";

import type { EarthEngineModule } from "./client";

export const EARTH_ENGINE_PRESET_IDS = [
    "gee-sentinel-rgb",
    "gee-landsat-rgb",
    "gee-wri-forest-loss-drivers",
    "gee-wri-forest-loss-perm-ag",
    "gee-spot-brazil-rgb",
] as const;

export type EarthEnginePresetId = (typeof EARTH_ENGINE_PRESET_IDS)[number];

export interface EarthEnginePresetDefinition {
    id: EarthEnginePresetId;
    name: string;
    description: string;
}

export const EARTH_ENGINE_PRESET_DEFINITIONS: EarthEnginePresetDefinition[] = [
    {
        id: "gee-sentinel-rgb",
        name: "Earth Engine — Sentinel-2",
        description:
            "Sentinel-2 median composite with Google Cloud Score+ per-pixel masking (true color)",
    },
    {
        id: "gee-landsat-rgb",
        name: "Earth Engine — Landsat",
        description: "Landsat 8/9 median composite (true color)",
    },
    {
        id: "gee-wri-forest-loss-drivers",
        name: "Earth Engine — Forest loss drivers",
        description:
            "WRI Global Drivers of Forest Loss classification (1 km, 2001–2023); requires asset access",
    },
    {
        id: "gee-wri-forest-loss-perm-ag",
        name: "Earth Engine — Permanent agriculture probability",
        description:
            "WRI forest-loss driver probability band (permanent agriculture); requires asset access",
    },
    {
        id: "gee-spot-brazil-rgb",
        name: "Earth Engine — SPOT Brazil (2007–2009)",
        description:
            "Airbus SPOT mosaic over Brazil; requires dataset access form + EE permission",
    },
];

/**
 * Returns whether a string is a supported Earth Engine preset id.
 */
export function isEarthEnginePresetId(id: string): id is EarthEnginePresetId {
    return (EARTH_ENGINE_PRESET_IDS as readonly string[]).includes(id);
}

export interface PresetBuildResult {
    image: EeImage;
    visParams: Record<string, unknown>;
}

/**
 * Builds the `ee.Image` and visualization params for a preset.
 */
export function buildPresetImage(
    ee: EarthEngineModule,
    presetId: EarthEnginePresetId,
): PresetBuildResult {
    const end = ee.Date(Date.now());
    const start = end.advance(-12, "month");

    switch (presetId) {
        case "gee-sentinel-rgb": {
            // Cloud Score+ QA bands linked to harmonized Sentinel-2 SR scenes.
            // https://developers.google.com/earth-engine/datasets/catalog/GOOGLE_CLOUD_SCORE_PLUS_V1_S2_HARMONIZED
            const QA_BAND = "cs_cdf";
            const CLEAR_THRESHOLD = 0.6;
            const csPlus = ee.ImageCollection("GOOGLE/CLOUD_SCORE_PLUS/V1/S2_HARMONIZED");
            const collection = ee
                .ImageCollection("COPERNICUS/S2_SR_HARMONIZED")
                .filterDate(start, end)
                .filter(ee.Filter.lt("CLOUDY_PIXEL_PERCENTAGE", 20))
                .linkCollection(csPlus, [QA_BAND])
                .map((scene) => scene.updateMask(scene.select(QA_BAND).gte(CLEAR_THRESHOLD)));
            return {
                image: collection.median(),
                visParams: {
                    bands: ["B4", "B3", "B2"],
                    min: 0,
                    max: 3000,
                    gamma: 1.1,
                },
            };
        }
        case "gee-landsat-rgb": {
            const collection = ee
                .ImageCollection("LANDSAT/LC08/C02/T1_L2")
                .merge(ee.ImageCollection("LANDSAT/LC09/C02/T1_L2"))
                .filterDate(start, end)
                .filter(ee.Filter.lt("CLOUD_COVER", 20));
            const image = collection
                .median()
                .select(["SR_B4", "SR_B3", "SR_B2"], ["red", "green", "blue"]);
            return {
                image,
                visParams: {
                    bands: ["red", "green", "blue"],
                    min: 7000,
                    max: 20000,
                },
            };
        }
        case "gee-wri-forest-loss-drivers": {
            const drivers = ee.Image(
                "projects/landandcarbon/assets/wri_gdm_drivers_forest_loss_1km/v1_1_2001_2023",
            );
            return {
                image: drivers.select("classification"),
                visParams: {
                    min: 1,
                    max: 7,
                    palette: [
                        "E39D29",
                        "E58074",
                        "e9d700",
                        "51a44e",
                        "895128",
                        "a354a0",
                        "3a209a",
                    ],
                },
            };
        }
        case "gee-wri-forest-loss-perm-ag": {
            const drivers = ee.Image(
                "projects/landandcarbon/assets/wri_gdm_drivers_forest_loss_1km/v1_1_2001_2023",
            );
            return {
                image: drivers.select("probability_1"),
                visParams: {
                    min: 0,
                    max: 250,
                    palette: [
                        "#440154",
                        "#481567",
                        "#482677",
                        "#453781",
                        "#3b528b",
                        "#2c728e",
                        "#21908d",
                        "#27ad81",
                        "#5ec962",
                        "#aadc32",
                        "#fde725",
                    ],
                },
            };
        }
        case "gee-spot-brazil-rgb": {
            // https://developers.google.com/earth-engine/datasets — access via Google form
            const collection = ee.ImageCollection(
                "AIRBUS/SPOT_2_4_5/BRAZIL/2007_2009/MS_NC/V1",
            );
            const masked = collection.map((scene) =>
                scene.updateMask(scene.select("cloud_mask")),
            );
            return {
                image: masked.mosaic(),
                visParams: {
                    bands: ["R", "G", "B"],
                    min: 0,
                    max: 255,
                },
            };
        }
        default: {
            const _exhaustive: never = presetId;
            throw new Error(`Unknown preset: ${_exhaustive}`);
        }
    }
}
