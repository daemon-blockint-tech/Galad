import { NextResponse } from "next/server";
import { getOpsUserId } from "@/lib/ops/session";
import { isScenariosEnabled } from "@/lib/scenarios/guard";
import { getScenarioEntities } from "@/lib/scenarios/runtime-store";
import { scenarioStatusForUser, touchScenario } from "@/lib/scenarios/runner";

/**
 * GET /api/ops/scenarios/state — active scenario status and current entities.
 */
export async function GET() {
    if (!isScenariosEnabled()) {
        return NextResponse.json({ error: "Scenarios disabled" }, { status: 403 });
    }
    const userId = await getOpsUserId();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // This poll is the only signal that a client is still watching.
    touchScenario(userId);

    const status = scenarioStatusForUser(userId);
    const entities = getScenarioEntities(userId).map((e) => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
    }));

    return NextResponse.json({ ...status, entities });
}
