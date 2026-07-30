import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { getOpsUserId } from "@/lib/ops/session";
import { agentBus, isOpsTaskStatus, type OpsTaskStatus } from "@/lib/agent/bus";
import { OPS_TASK_TITLE_MAX, toOpsTaskPayload } from "@/lib/ops/tasks";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * PATCH /api/ops/tasks/[id] — update task status or title.
 */
export async function PATCH(request: Request, context: RouteContext) {
    const userId = await getOpsUserId();
    if (!userId) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await context.params;

    try {
        const body = await request.json();

        if (body.status !== undefined && !isOpsTaskStatus(body.status)) {
            return NextResponse.json({ error: "Invalid status" }, { status: 400 });
        }
        const status: OpsTaskStatus | undefined = body.status;

        const title = typeof body.title === "string" ? body.title.trim() : undefined;
        if (body.title !== undefined && !title) {
            return NextResponse.json(
                { error: "Title must be a non-empty string" },
                { status: 400 },
            );
        }
        if (title && title.length > OPS_TASK_TITLE_MAX) {
            return NextResponse.json(
                { error: `Title must be ${OPS_TASK_TITLE_MAX} characters or fewer` },
                { status: 400 },
            );
        }

        if (status === undefined && title === undefined) {
            return NextResponse.json(
                { error: "Provide status or title to update" },
                { status: 400 },
            );
        }

        const existing = await prisma.opsTask.findFirst({ where: { id, userId } });
        if (!existing) {
            return NextResponse.json({ error: "Not found" }, { status: 404 });
        }

        const task = await prisma.opsTask.update({
            where: { id },
            data: {
                ...(status ? { status } : {}),
                ...(title ? { title } : {}),
            },
        });

        agentBus.publish(userId, { action: "task_updated", task: toOpsTaskPayload(task) });

        return NextResponse.json({ task });
    } catch (e) {
        console.error("PATCH /api/ops/tasks/[id]", e);
        return NextResponse.json({ error: "Could not save task." }, { status: 500 });
    }
}
