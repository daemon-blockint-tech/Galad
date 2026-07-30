/**
 * anomaly_timeline used to fill every bucket with Math.random(), and POST
 * /api/ops/query served the result as intelligence. An analyst cannot tell
 * invented anomaly scores from measured ones, so the query must fail loudly
 * until a real behaviour source exists.
 */
import { describe, expect, it } from "vitest";

import { AnomalyDetectionEngine } from "@/core/ml/AnomalyDetectionEngine";
import { SemanticStore } from "@/core/semantic/semanticStore";
import { PrismaClient } from "@/generated/prisma";

import { TemporalQueryEngine } from "./TemporalQueryEngine";

function makeEngine(): TemporalQueryEngine {
    const store = new SemanticStore();
    return new TemporalQueryEngine(
        {} as PrismaClient,
        new AnomalyDetectionEngine(store),
        store,
    );
}

describe("TemporalQueryEngine anomaly_timeline", () => {
    it("rejects the query instead of returning synthesised scores", async () => {
        await expect(
            makeEngine().query({
                type: "anomaly_timeline",
                entityIds: ["AC-4471"],
                timeRange: [0, 86_400_000],
                aggregation: "hourly",
            }),
        ).rejects.toThrow(/not implemented/i);
    });

    it("rejects it for an empty entity list too, rather than returning an empty timeline", async () => {
        await expect(
            makeEngine().query({
                type: "anomaly_timeline",
                entityIds: [],
                timeRange: [0, 86_400_000],
            }),
        ).rejects.toThrow(/not implemented/i);
    });
});
