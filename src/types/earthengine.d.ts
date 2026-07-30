/**
 * @file earthengine.d.ts
 * @description Minimal ambient types for `@google/earthengine`, which ships no
 * declarations. Only the surface Grond actually calls is typed — extend as needed.
 */

declare module "@google/earthengine" {
    import type { EeRawMapId } from "@/lib/earth-engine/types";

    export interface EeDate {
        advance(delta: number, unit: string): EeDate;
    }

    export interface EeFilter {
        readonly __eeFilter: unique symbol;
    }

    export interface EeImage {
        select(band: string): EeImage;
        select(bands: string[], renamedTo?: string[]): EeImage;
        updateMask(mask: EeImage): EeImage;
        gte(threshold: number): EeImage;
        getMapId(visParams: Record<string, unknown>): EeRawMapId | Promise<EeRawMapId>;
    }

    export interface EeImageCollection {
        filterDate(start: EeDate, end: EeDate): EeImageCollection;
        filter(filter: EeFilter): EeImageCollection;
        linkCollection(source: EeImageCollection, bands: string[]): EeImageCollection;
        merge(other: EeImageCollection): EeImageCollection;
        map(fn: (image: EeImage) => EeImage): EeImageCollection;
        median(): EeImage;
        mosaic(): EeImage;
    }

    interface EarthEngine {
        Date(millis: number): EeDate;
        Image(assetId: string): EeImage;
        ImageCollection(assetId: string): EeImageCollection;
        Filter: {
            lt(propertyName: string, value: number): EeFilter;
        };
        data: {
            authenticateViaPrivateKey(
                credentials: { client_email: string; private_key: string },
                onSuccess: () => void,
                onError: (error: Error) => void,
            ): void;
        };
        initialize(
            baseUrl: string | null,
            tileUrl: string | null,
            onSuccess: () => void,
            onError: (error: Error) => void,
            xsrfToken: string | null,
            project?: string,
        ): void;
    }

    const ee: EarthEngine;
    export default ee;
}
