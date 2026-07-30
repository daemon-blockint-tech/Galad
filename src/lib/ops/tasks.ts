import type { OpsTask } from "@/generated/prisma";
import { prisma } from "@/lib/db";
import { agentBus, isOpsTaskStatus, type OpsTaskPayload } from "@/lib/agent/bus";

/** Upper bound on stored task titles; they are broadcast verbatim over the agent bus. */
export const OPS_TASK_TITLE_MAX = 500;

export type CreateOpsTaskInput = {
    userId: string;
    title: string;
    entityPluginId?: string;
    entityId?: string;
    lat?: number;
    lon?: number;
};

/**
 * Maps a persisted task to its bus/API payload.
 *
 * `status` is a free-form column, so rows written before status validation
 * (or by a direct DB edit) can hold a value outside the union; those are
 * reported as `active` rather than broadcast as a status the client cannot handle.
 */
export function toOpsTaskPayload(task: OpsTask): OpsTaskPayload {
    if (!isOpsTaskStatus(task.status)) {
        console.warn(`[ops/tasks] Task ${task.id} has unknown status "${task.status}"`);
    }
    return {
        id: task.id,
        title: task.title,
        status: isOpsTaskStatus(task.status) ? task.status : "active",
        entityPluginId: task.entityPluginId,
        entityId: task.entityId,
        lat: task.lat,
        lon: task.lon,
        createdAt: task.createdAt.toISOString(),
        updatedAt: task.updatedAt.toISOString(),
    };
}

/**
 * Persists a task and publishes to the user's AgentBus subscribers.
 */
export async function createOpsTask(input: CreateOpsTaskInput) {
    const task = await prisma.opsTask.create({
        data: {
            userId: input.userId,
            title: input.title,
            status: "active",
            entityPluginId: input.entityPluginId ?? null,
            entityId: input.entityId ?? null,
            lat: input.lat ?? null,
            lon: input.lon ?? null,
        },
    });
    agentBus.publish(input.userId, { action: "task_created", task: toOpsTaskPayload(task) });
    return task;
}
