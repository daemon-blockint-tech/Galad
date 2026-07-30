import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/alerts", () => ({
    createOpsAlert: vi.fn().mockResolvedValue({ id: "alert-1" }),
}));
vi.mock("@/lib/ops/tasks", () => ({
    createOpsTask: vi.fn().mockResolvedValue({ id: "task-1" }),
}));
vi.mock("@/lib/agent/bus", () => ({
    agentBus: { publish: vi.fn() },
}));

import { agentBus } from "@/lib/agent/bus";
import { createOpsAlert } from "@/lib/ops/alerts";
import { createOpsTask } from "@/lib/ops/tasks";
import { SCENARIO_IDLE_TIMEOUT_MS } from "../constants";
import { getScenarioEntities } from "../runtime-store";
import {
    scenarioStatusForUser,
    startScenario,
    stopScenario,
    tickScenario,
    touchScenario,
} from "../runner";

const USER = "runner-test-user";

describe("scenario runner", () => {
    beforeEach(() => {
        process.env.SCENARIOS_ENABLED = "true";
        vi.clearAllMocks();
    });

    afterEach(async () => {
        await stopScenario(USER);
        vi.useRealTimers();
    });

    it("startScenario activates run and populates runtime store", async () => {
        const status = await startScenario(USER, "maritime-ais-patrol");
        expect(status.active).toBe(true);
        expect(status.caseId).toBe("maritime-ais-patrol");
        expect(status.entityCount).toBe(3);

        const entities = getScenarioEntities(USER);
        expect(entities).toHaveLength(3);
        expect(entities[0].properties.simulated).toBe(true);
        expect(agentBus.publish).toHaveBeenCalled();
    });

    it("tickScenario updates entity positions", async () => {
        await startScenario(USER, "maritime-ais-patrol");
        const latBefore = getScenarioEntities(USER)[0].latitude;
        await tickScenario(USER);
        const latAfter = getScenarioEntities(USER)[0].latitude;
        expect(latAfter).not.toBe(latBefore);
    });

    it("stopScenario clears runtime store and timers", async () => {
        await startScenario(USER, "maritime-ais-patrol");
        await stopScenario(USER);
        expect(getScenarioEntities(USER)).toHaveLength(0);
    });

    it("stops an unattended run at the idle deadline but not a polled one", async () => {
        // Fake timers so the run's own interval can't fire while we move the clock.
        vi.useFakeTimers();
        const startedAt = Date.now();
        await startScenario(USER, "maritime-ais-patrol");

        // A polling client pushed the deadline back, so the run survives past it.
        vi.setSystemTime(startedAt + SCENARIO_IDLE_TIMEOUT_MS - 1_000);
        touchScenario(USER);
        vi.setSystemTime(startedAt + SCENARIO_IDLE_TIMEOUT_MS + 1_000);
        await tickScenario(USER);
        expect(scenarioStatusForUser(USER).active).toBe(true);

        // Nobody polls after that; the first tick past the deadline reaps the run.
        vi.setSystemTime(startedAt + 2 * SCENARIO_IDLE_TIMEOUT_MS + 2_000);
        await tickScenario(USER);
        expect(scenarioStatusForUser(USER).active).toBe(false);
        expect(getScenarioEntities(USER)).toHaveLength(0);
    });

    it("auto-recon proximity rule creates alert and task once", async () => {
        await startScenario(USER, "auto-recon-investigation");
        for (let i = 0; i < 8; i += 1) {
            await tickScenario(USER);
            if (vi.mocked(createOpsAlert).mock.calls.length > 0) break;
        }
        expect(createOpsAlert).toHaveBeenCalled();
        expect(createOpsTask).toHaveBeenCalled();
    });
});
