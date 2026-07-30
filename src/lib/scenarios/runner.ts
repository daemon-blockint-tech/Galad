import type { GeoEntity } from "@/core/plugins/PluginTypes";
import { agentBus } from "@/lib/agent/bus";
import { createOpsAlert } from "@/lib/ops/alerts";
import { createOpsTask } from "@/lib/ops/tasks";
import {
    DEFAULT_SCENARIO_TICK_MS,
    SCENARIO_IDLE_TIMEOUT_MS,
    SIM_SCENARIOS_PLUGIN_ID,
} from "./constants";
import { applyMotions, entitiesFromDefinition } from "./entities";
import { assertScenariosEnabled } from "./guard";
import { getScenario } from "./registry";
import { evaluateRules } from "./rules";
import {
    clearScenario,
    getScenarioStatus,
    isScenarioActive,
    setScenarioEntities,
} from "./runtime-store";
import type { RuleSideEffect, ScenarioDefinition, ScenarioRunStatus } from "./types";

type ActiveRun = {
    userId: string;
    caseId: string;
    definition: ScenarioDefinition;
    entities: GeoEntity[];
    tick: number;
    firedRuleIds: Set<string>;
    timer: ReturnType<typeof setInterval> | null;
    /** Epoch ms after which an unattended run stops itself; see `touchScenario`. */
    expiresAt: number;
};

const activeRuns = new Map<string, ActiveRun>();

declare global {
    // eslint-disable-next-line no-var
    var __MAVEN_SCENARIO_RUNS__: Map<string, ActiveRun> | undefined;
}

const runs: Map<string, ActiveRun> =
    globalThis.__MAVEN_SCENARIO_RUNS__ ?? (globalThis.__MAVEN_SCENARIO_RUNS__ = activeRuns);

/**
 * Start a scenario for the given user; stops any prior run.
 */
export async function startScenario(userId: string, caseId: string): Promise<ScenarioRunStatus> {
    assertScenariosEnabled();
    const definition = getScenario(caseId);
    if (!definition) {
        throw new Error(`Unknown scenario case: ${caseId}`);
    }

    await stopScenario(userId);

    const entities = entitiesFromDefinition(definition, caseId);
    const run: ActiveRun = {
        userId,
        caseId,
        definition,
        entities,
        tick: 0,
        firedRuleIds: new Set(),
        timer: null,
        expiresAt: Date.now() + SCENARIO_IDLE_TIMEOUT_MS,
    };
    runs.set(userId, run);
    setScenarioEntities(userId, caseId, entities, 0);

    const intervalMs = definition.tickIntervalMs ?? DEFAULT_SCENARIO_TICK_MS;
    run.timer = setInterval(() => {
        void tickScenario(userId).catch((err) => {
            console.error("[scenario-runner] tick failed", err);
        });
    }, intervalMs);

    agentBus.publish(userId, {
        action: "layer_toggle",
        pluginId: SIM_SCENARIOS_PLUGIN_ID,
        enabled: true,
    });

    return getScenarioStatus(userId);
}

/**
 * Stop the active scenario for a user.
 */
export async function stopScenario(userId: string): Promise<void> {
    const run = runs.get(userId);
    if (run?.timer) {
        clearInterval(run.timer);
    }
    runs.delete(userId);
    clearScenario(userId);
}

/**
 * Push back the idle deadline of a user's run.
 *
 * Called by the state poll: an open Sim panel keeps its scenario alive, and a
 * closed tab stops polling, which is what lets `tickScenario` reap it.
 */
export function touchScenario(userId: string): void {
    const run = runs.get(userId);
    if (run) {
        run.expiresAt = Date.now() + SCENARIO_IDLE_TIMEOUT_MS;
    }
}

/**
 * Advance one tick: motion, rules, side effects.
 */
export async function tickScenario(userId: string): Promise<void> {
    const run = runs.get(userId);
    if (!run) return;

    if (Date.now() > run.expiresAt) {
        await stopScenario(userId);
        return;
    }

    run.tick += 1;
    run.entities = applyMotions(
        run.entities.map((e) => ({ ...e, properties: { ...e.properties } })),
        run.definition.motions,
    );

    const effects = evaluateRules(run.definition.rules, {
        entities: run.entities,
        tick: run.tick,
        firedRuleIds: run.firedRuleIds,
    });

    for (const effect of effects) {
        await applySideEffect(userId, effect, run.entities);
    }

    setScenarioEntities(userId, run.caseId, run.entities, run.tick);
}

async function applySideEffect(
    userId: string,
    effect: RuleSideEffect,
    entities: GeoEntity[],
): Promise<void> {
    if (effect.type === "alert") {
        const entity = entities.find((e) => e.id === effect.entityId);
        await createOpsAlert({
            userId,
            severity: effect.severity,
            title: effect.title,
            body: effect.body,
            source: "scenario-runner",
            entityPluginId: SIM_SCENARIOS_PLUGIN_ID,
            entityId: effect.entityId,
        });
        return;
    }
    if (effect.type === "task") {
        await createOpsTask({
            userId,
            title: effect.title,
            entityPluginId: SIM_SCENARIOS_PLUGIN_ID,
            entityId: effect.entityId,
            lat: effect.lat,
            lon: effect.lon,
        });
        return;
    }
    if (effect.type === "fly_to") {
        agentBus.publish(userId, {
            action: "fly_to",
            lat: effect.lat,
            lon: effect.lon,
            distance: effect.distance,
        });
    }
}

/**
 * Expose status for API routes.
 */
export function scenarioStatusForUser(userId: string): ScenarioRunStatus {
    if (!isScenarioActive(userId) && !runs.has(userId)) {
        return getScenarioStatus(userId);
    }
    return getScenarioStatus(userId);
}
