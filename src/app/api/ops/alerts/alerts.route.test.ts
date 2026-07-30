import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/session", () => ({
    getOpsUserId: vi.fn(),
    getTenantId: vi.fn(),
}));
vi.mock("@/lib/db", () => ({
    prisma: {
        alert: {
            findUnique: vi.fn(),
            update: vi.fn(),
            updateMany: vi.fn(),
        },
        alertEvent: {
            create: vi.fn(),
        },
        $transaction: vi.fn(),
    },
}));

import { prisma } from "@/lib/db";
import { getOpsUserId, getTenantId } from "@/lib/ops/session";
import { PATCH as escalate } from "./[id]/escalate/route";
import { PATCH as resolve } from "./[id]/resolve/route";
import { PATCH as suppress } from "./[id]/suppress/route";

const USER = "user-1";
const ALERT_ID = "alert-1";

const storedAlert = {
    id: ALERT_ID,
    tenantId: null,
    sourceAlertIds: "[]",
    aggregatedCount: 1,
    type: "threat",
    severity: "critical",
    title: "Perimeter breach",
    description: "Contact inside the fence line",
    sourcePluginId: "firms",
    entityId: "AC-4471",
    enrichedContext: "{}",
    status: "active",
    escalationLevel: 1,
    routes: "[]",
    createdAt: new Date("2026-01-01T00:00:00Z"),
    lastSeen: new Date("2026-01-01T00:00:00Z"),
    resolvedAt: null,
    suppressedUntil: null,
    updatedAt: new Date("2026-01-01T00:00:00Z"),
};

const storedEvent = {
    id: "event-1",
    tenantId: null,
    alertId: ALERT_ID,
    eventType: "escalated",
    eventData: null,
    actorUserId: USER,
    actorAction: "escalated",
    actorNotes: null,
    createdAt: new Date("2026-01-01T00:00:00Z"),
};

type Handler = (
    request: Request,
    ctx: { params: Promise<{ id: string }> },
) => Promise<Response>;

function patch(handler: Handler, body: unknown = {}) {
    return handler(
        new Request(`http://localhost/api/ops/alerts/${ALERT_ID}`, {
            method: "PATCH",
            body: JSON.stringify(body),
        }),
        { params: Promise.resolve({ id: ALERT_ID }) },
    );
}

/** Operations of the single `$transaction([...])` call the handler made. */
function transactionOps(): unknown[] {
    expect(prisma.$transaction).toHaveBeenCalledTimes(1);
    return vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown as unknown[];
}

describe("PATCH /api/ops/alerts/[id] actions", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        vi.mocked(getOpsUserId).mockResolvedValue(USER);
        vi.mocked(getTenantId).mockResolvedValue(null);
        vi.mocked(prisma.alert.findUnique).mockResolvedValue(storedAlert);
        vi.mocked(prisma.alert.update).mockResolvedValue(storedAlert);
        vi.mocked(prisma.alert.updateMany).mockResolvedValue({ count: 1 });
        vi.mocked(prisma.alertEvent.create).mockResolvedValue(storedEvent);
        // Prisma runs the batch in order; Promise.all is enough for the mocks.
        vi.mocked(prisma.$transaction).mockImplementation(
            (ops: unknown) => Promise.all(ops as unknown[]) as never,
        );
    });

    it("escalates with an atomic increment instead of a read-modify-write", async () => {
        const res = await patch(escalate, { reason: "spreading" });

        expect(res.status).toBe(200);
        expect(prisma.alert.updateMany).toHaveBeenCalledWith({
            where: { id: ALERT_ID, escalationLevel: { lte: 2 } },
            data: { escalationLevel: { increment: 1 } },
        });
    });

    it("never lets the increment carry a fractional level past the cap", async () => {
        await patch(escalate);

        // Levels in (2, 3) — dedup nudges them by 0.1 — are pinned to the cap
        // before the increment runs, so the increment can only see levels <= 2.
        expect(prisma.alert.updateMany).toHaveBeenCalledWith({
            where: { id: ALERT_ID, escalationLevel: { gt: 2, lt: 3 } },
            data: { escalationLevel: 3 },
        });
        const [clamp, increment] = vi.mocked(prisma.alert.updateMany).mock.calls;
        expect(clamp[0].where?.escalationLevel).toEqual({ gt: 2, lt: 3 });
        expect(increment[0].where?.escalationLevel).toEqual({ lte: 2 });
    });

    it("writes the escalation and its audit event in one transaction", async () => {
        await patch(escalate, { reason: "spreading" });

        expect(transactionOps()).toHaveLength(4);
        expect(prisma.alertEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                alertId: ALERT_ID,
                eventType: "escalated",
                actorUserId: USER,
                actorNotes: "spreading",
            }),
        });
    });

    it("returns 404 and opens no transaction for an unknown alert", async () => {
        vi.mocked(prisma.alert.findUnique).mockResolvedValue(null);

        const res = await patch(escalate);

        expect(res.status).toBe(404);
        expect(prisma.$transaction).not.toHaveBeenCalled();
        expect(prisma.alert.updateMany).not.toHaveBeenCalled();
    });

    it("requires authentication to escalate", async () => {
        vi.mocked(getOpsUserId).mockResolvedValue(null);

        const res = await patch(escalate);

        expect(res.status).toBe(401);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("writes the resolve and its audit event in one transaction", async () => {
        const res = await patch(resolve, { notes: "handled" });

        expect(res.status).toBe(200);
        expect(transactionOps()).toHaveLength(2);
        expect(prisma.alertEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ eventType: "resolved", actorNotes: "handled" }),
        });
    });

    it("writes the suppress and its audit event in one transaction", async () => {
        const res = await patch(suppress, { durationMs: 60_000 });

        expect(res.status).toBe(200);
        expect(transactionOps()).toHaveLength(2);
        expect(prisma.alertEvent.create).toHaveBeenCalledWith({
            data: expect.objectContaining({ eventType: "suppressed" }),
        });
    });

    it("rejects an out-of-range suppression before touching the database", async () => {
        const res = await patch(suppress, { durationMs: -1 });

        expect(res.status).toBe(400);
        expect(prisma.$transaction).not.toHaveBeenCalled();
    });
});
