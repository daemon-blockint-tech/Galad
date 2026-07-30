import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/session", () => ({
    getOpsUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
    prisma: {
        opsTask: {
            findFirst: vi.fn(),
            update: vi.fn(),
        },
    },
}));
vi.mock("@/lib/agent/bus", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@/lib/agent/bus")>()),
    agentBus: { publish: vi.fn() },
}));

import { prisma } from "@/lib/db";
import { getOpsUserId } from "@/lib/ops/session";
import { PATCH } from "./[id]/route";

const USER = "user-1";
const TASK_ID = "task-1";

const storedTask = {
    id: TASK_ID,
    userId: USER,
    title: "Track vessel",
    status: "active",
    entityPluginId: null,
    entityId: null,
    lat: null,
    lon: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
};

function patch(body: unknown) {
    return PATCH(
        new Request("http://localhost/api/ops/tasks/task-1", {
            method: "PATCH",
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: TASK_ID }) },
    );
}

describe("PATCH /api/ops/tasks/[id]", () => {
    beforeEach(() => {
        vi.mocked(getOpsUserId).mockResolvedValue(USER);
        vi.mocked(prisma.opsTask.findFirst).mockResolvedValue(storedTask);
        vi.mocked(prisma.opsTask.update).mockResolvedValue(storedTask);
    });

    it("rejects a status outside the known set without touching the database", async () => {
        const res = await patch({ status: "pwned" });

        expect(res.status).toBe(400);
        expect(prisma.opsTask.update).not.toHaveBeenCalled();
    });

    it("rejects a title longer than the stored maximum", async () => {
        const res = await patch({ title: "x".repeat(501) });

        expect(res.status).toBe(400);
        expect(prisma.opsTask.update).not.toHaveBeenCalled();
    });

    it("rejects a request with no updatable field", async () => {
        const res = await patch({});

        expect(res.status).toBe(400);
        expect(prisma.opsTask.update).not.toHaveBeenCalled();
    });

    it("returns 404 for a task belonging to another user", async () => {
        vi.mocked(prisma.opsTask.findFirst).mockResolvedValue(null);

        const res = await patch({ status: "completed" });

        expect(res.status).toBe(404);
        expect(prisma.opsTask.update).not.toHaveBeenCalled();
    });

    it("applies a valid status change", async () => {
        vi.mocked(prisma.opsTask.update).mockResolvedValue({
            ...storedTask,
            status: "completed",
        });

        const res = await patch({ status: "completed" });

        expect(res.status).toBe(200);
        expect(prisma.opsTask.update).toHaveBeenCalledWith({
            where: { id: TASK_ID },
            data: { status: "completed" },
        });
    });

    it("requires authentication", async () => {
        vi.mocked(getOpsUserId).mockResolvedValue(null);

        const res = await patch({ status: "completed" });

        expect(res.status).toBe(401);
    });
});
