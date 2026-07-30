/**
 * The actuating C2 commands (restart, isolate, collect, block_ip, quarantine)
 * have no endpoint integration. They previously returned hardcoded success
 * payloads — an operator issuing "isolate" saw network_isolation_initiated for a
 * host nothing had touched. On an operations product a fabricated containment
 * result is worse than an error, so they must fail explicitly until a real
 * integration exists.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { C2CommandExecutor } from "./C2CommandExecutor";

const ACTUATING_COMMANDS = ["restart", "isolate", "collect", "block_ip", "quarantine"] as const;

function createDb() {
    return {
        alert: {
            findFirst: vi.fn().mockResolvedValue({
                severity: "critical",
                createdAt: new Date("2026-01-01T00:00:00Z"),
            }),
            count: vi.fn().mockResolvedValue(3),
        },
    };
}

describe("C2CommandExecutor", () => {
    let executor: C2CommandExecutor;

    beforeEach(() => {
        vi.spyOn(console, "log").mockImplementation(() => {});
        // The executor only touches db.alert; the narrow stub is deliberate.
        executor = new C2CommandExecutor(createDb() as never, "tenant-1");
    });

    for (const commandId of ACTUATING_COMMANDS) {
        it(`fails "${commandId}" instead of reporting a containment that never happened`, async () => {
            const result = await executor.execute({
                commandId,
                entityId: "host-1",
                parameters: { ip_address: "10.0.0.1", file_path: "/tmp/x", artifact_type: "logs" },
            });

            expect(result.status).toBe("failed");
            expect(result.error).toMatch(/not implemented/i);
            expect(result.error).toContain("host-1");
            expect(result.result).toBeUndefined();
        });
    }

    it("still serves the status command, which reads real alert data", async () => {
        const result = await executor.execute({ commandId: "status", entityId: "host-1" });

        expect(result.status).toBe("success");
        expect(result.result).toMatchObject({ entityId: "host-1", alertCount: 3 });
    });

    it("rejects an unknown command", async () => {
        const result = await executor.execute({ commandId: "launch", entityId: "host-1" });

        expect(result.status).toBe("failed");
        expect(result.error).toMatch(/Invalid command/);
    });
});
