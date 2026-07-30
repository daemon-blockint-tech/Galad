/**
 * The email channel has no SMTP client. It previously returned
 * `{ success: true, messageId }` for every alert and reported itself healthy,
 * so an operator who set EMAIL_SMTP_HOST believed critical alerts were being
 * delivered while nothing was sent. A silently undelivered alert is the worst
 * failure an alerting system can have — it must report failure until SMTP
 * actually exists.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import { AlertChannelEmail } from "./AlertChannelEmail";

const channel = () =>
    new AlertChannelEmail({
        smtpHost: "smtp.example.com",
        smtpPort: 587,
        from: "ops@example.com",
        recipients: ["oncall@example.com"],
    });

const alert = {
    severity: "critical",
    title: "Perimeter breach",
    description: "Unauthorized access detected",
    entityId: "sensor-1",
    enrichedContext: {},
};

describe("AlertChannelEmail", () => {
    beforeEach(() => {
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("reports failure rather than a delivery that never happened", async () => {
        const result = await channel().send("alert-1", alert);

        expect(result.success).toBe(false);
        expect(result.error).toMatch(/not implemented/i);
        expect(result.messageId).toBeUndefined();
    });

    it("reports itself unhealthy even when recipients are configured", async () => {
        await expect(channel().verify()).resolves.toBe(false);
    });

    it("fails fast instead of retrying a permanent failure", async () => {
        const start = Date.now();
        await channel().send("alert-1", alert);

        // The old retry loop slept 1s + 2s before giving up on every alert.
        expect(Date.now() - start).toBeLessThan(500);
    });

    it("logs the undelivered recipients so the miss is visible in logs", async () => {
        await channel().send("alert-1", alert);

        expect(console.error).toHaveBeenCalledWith(
            expect.stringContaining("oncall@example.com"),
        );
    });
});
