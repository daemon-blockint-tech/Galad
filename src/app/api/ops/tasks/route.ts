import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOpsUserId } from "@/lib/ops/session";
import { createOpsTask, OPS_TASK_TITLE_MAX } from "@/lib/ops/tasks";

/**
 * GET /api/ops/tasks — list tasks for the current user.
 * POST /api/ops/tasks — create a new task.
 */
export async function GET() {
    const userId = await getOpsUserId();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const tasks = await prisma.opsTask.findMany({
            where: { userId },
            orderBy: { updatedAt: "desc" },
        });
        return NextResponse.json({ tasks });
    } catch (e) {
        console.error("GET /api/ops/tasks", e);
        return NextResponse.json({ error: "Failed to fetch tasks" }, { status: 500 });
    }
}

export async function POST(request: Request) {
    const userId = await getOpsUserId();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    try {
        const body = await request.json();
        const title = typeof body.title === "string" ? body.title.trim() : "";
        if (!title) {
            return NextResponse.json({ error: "Title is required" }, { status: 400 });
        }
        if (title.length > OPS_TASK_TITLE_MAX) {
            return NextResponse.json(
                { error: `Title must be ${OPS_TASK_TITLE_MAX} characters or fewer` },
                { status: 400 },
            );
        }

        const task = await createOpsTask({
            userId,
            title,
            entityPluginId: typeof body.entityPluginId === "string" ? body.entityPluginId : undefined,
            entityId: typeof body.entityId === "string" ? body.entityId : undefined,
            lat: typeof body.lat === "number" ? body.lat : undefined,
            lon: typeof body.lon === "number" ? body.lon : undefined,
        });

        return NextResponse.json({ task });
    } catch (e) {
        console.error("POST /api/ops/tasks", e);
        return NextResponse.json({ error: "Could not save task." }, { status: 500 });
    }
}
