/**
 * Every C2 route mutates or exposes the operational picture (issuing commands,
 * running playbooks, deleting entities), so each handler must reject an
 * unauthenticated caller before doing any work.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ops/session", () => ({
    getOpsUserId: vi.fn(),
    getTenantId: vi.fn(async () => null),
}));
vi.mock("@/lib/db", () => ({
    prisma: new Proxy({}, {
        get() {
            throw new Error("database touched before the auth check");
        },
    }),
}));

import { getOpsUserId } from "@/lib/ops/session";

import * as automationRules from "./automation-rules/route";
import * as commands from "./commands/route";
import * as entities from "./entities/route";
import * as playbooks from "./playbooks/route";
import * as playbooksExecute from "./playbooks/execute/route";

type Handler = (request: Request) => Promise<Response>;

const routes: Array<[string, Record<string, unknown>]> = [
    ["c2/automation-rules", automationRules],
    ["c2/commands", commands],
    ["c2/entities", entities],
    ["c2/playbooks", playbooks],
    ["c2/playbooks/execute", playbooksExecute],
];

const VERBS = ["GET", "POST", "PATCH", "PUT", "DELETE"] as const;

describe("C2 routes reject unauthenticated callers", () => {
    beforeEach(() => {
        vi.mocked(getOpsUserId).mockResolvedValue(null);
    });

    for (const [name, mod] of routes) {
        for (const verb of VERBS) {
            const handler = mod[verb] as Handler | undefined;
            if (!handler) continue;

            it(`${verb} /api/ops/${name} returns 401`, async () => {
                const request = new Request(`http://localhost/api/ops/${name}`, {
                    method: verb,
                    ...(verb === "GET" || verb === "DELETE"
                        ? {}
                        : { body: "{}", headers: { "content-type": "application/json" } }),
                });

                const res = await handler(request);

                expect(res.status).toBe(401);
            });
        }
    }
});
