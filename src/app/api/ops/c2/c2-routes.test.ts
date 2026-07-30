/**
 * The C2 surface must never report an outcome it did not produce. Playbooks are
 * not persisted and nothing executes them, so those routes have to say so
 * (501) instead of acknowledging a write or an execution; and deleting a C2
 * entity must only touch the placeholder rows this API created, never the
 * alerts other sources raised for the same entity id.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

// Held apart from `prisma` so the assertions never instantiate the Prisma
// client's types — doing so is enough to change how they resolve elsewhere.
const { updateMany } = vi.hoisted(() => ({ updateMany: vi.fn() }));

vi.mock("@/lib/ops/session", () => ({
    getOpsUserId: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
    prisma: { alert: { updateMany } },
}));

import { getOpsUserId } from "@/lib/ops/session";

import * as entities from "./entities/route";
import * as playbooks from "./playbooks/route";
import * as playbooksExecute from "./playbooks/execute/route";

const USER = "user-1";

const c2Entities: Record<string, unknown> = entities;
const deleteEntities = c2Entities.DELETE as (request: Request) => Promise<Response>;

const notImplemented: Array<[string, () => Promise<Response>]> = [
    ["GET /api/ops/c2/playbooks", playbooks.GET],
    ["POST /api/ops/c2/playbooks", playbooks.POST],
    ["PUT /api/ops/c2/playbooks", playbooks.PUT],
    ["DELETE /api/ops/c2/playbooks", playbooks.DELETE],
    ["GET /api/ops/c2/playbooks/execute", playbooksExecute.GET],
    ["POST /api/ops/c2/playbooks/execute", playbooksExecute.POST],
];

describe("playbook routes surface the gap instead of a fabricated result", () => {
    beforeEach(() => {
        vi.mocked(getOpsUserId).mockResolvedValue(USER);
    });

    for (const [name, handler] of notImplemented) {
        it(`${name} returns 501 and never claims success`, async () => {
            const res = await handler();

            expect(res.status).toBe(501);

            const body = (await res.json()) as { success?: boolean; error?: string };
            expect(body.success).toBeUndefined();
            expect(body.error).toMatch(/not implemented/i);
        });
    }
});

describe("DELETE /api/ops/c2/entities", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getOpsUserId).mockResolvedValue(USER);
        updateMany.mockResolvedValue({ count: 1 });
    });

    function del(body: unknown) {
        return deleteEntities(
            new Request("http://localhost/api/ops/c2/entities", {
                method: "DELETE",
                body: JSON.stringify(body),
            }),
        );
    }

    it("only resolves the placeholder rows this API created", async () => {
        const res = await del({ entityIds: ["AC-4471"] });

        expect(res.status).toBe(200);
        expect(updateMany).toHaveBeenCalledWith({
            where: {
                entityId: { in: ["AC-4471"] },
                sourcePluginId: "c2",
                type: "system",
            },
            data: { status: "resolved", resolvedAt: expect.any(Date) },
        });
    });

    it("rejects a non-array entityIds without touching the database", async () => {
        const res = await del({ entityIds: "AC-4471" });

        expect(res.status).toBe(400);
        expect(updateMany).not.toHaveBeenCalled();
    });
});
