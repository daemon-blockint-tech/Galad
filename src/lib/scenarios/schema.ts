import { z } from "zod";

const entityTemplateSchema = z.object({
    id: z.string().min(1),
    label: z.string().min(1),
    domain: z.enum(["surface", "air", "subsurface", "land"]),
    disposition: z.enum(["friend", "hostile", "neutral", "unknown"]),
    latitude: z.number(),
    longitude: z.number(),
    altitude: z.number().optional(),
    heading: z.number().optional(),
    speed: z.number().optional(),
    properties: z.record(z.string(), z.unknown()).optional(),
});

const motionSchema = z.object({
    entityId: z.string().min(1),
    headingDelta: z.number().optional(),
    latDelta: z.number().optional(),
    lonDelta: z.number().optional(),
});

const ruleSchema = z.object({
    id: z.string().min(1),
    type: z.enum(["proximity", "geofence"]),
    once: z.boolean().optional(),
    proximity: z
        .object({
            entityA: z.string(),
            entityB: z.string(),
            thresholdNm: z.number().positive(),
            alertSeverity: z.enum(["info", "warn", "critical"]).optional(),
            alertTitle: z.string().optional(),
            createTask: z.boolean().optional(),
            taskTitle: z.string().optional(),
            flyTo: z.boolean().optional(),
        })
        .optional(),
    geofence: z
        .object({
            entityId: z.string(),
            polygon: z.array(z.tuple([z.number(), z.number()])).min(3),
            alertSeverity: z.enum(["info", "warn", "critical"]).optional(),
            alertTitle: z.string().optional(),
        })
        .optional(),
});

export const scenarioDefinitionSchema = z.object({
    id: z.string().min(1),
    title: z.string().min(1),
    description: z.string().optional(),
    tickIntervalMs: z.number().int().positive().optional(),
    entities: z.array(entityTemplateSchema).min(1),
    motions: z.array(motionSchema).optional(),
    rules: z.array(ruleSchema).optional(),
});

/**
 * Parse and validate a scenario definition JSON object.
 */
export function parseScenarioDefinition(raw: unknown) {
    return scenarioDefinitionSchema.parse(raw);
}
