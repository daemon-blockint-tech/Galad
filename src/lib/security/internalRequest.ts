import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Header carrying proof that a request came from this deployment's own
 * middleware rather than from the internet.
 *
 * `src/proxy.ts` self-fetches internal endpoints over loopback, but loopback
 * cannot be checked reliably behind a reverse proxy — and those endpoints answer
 * questions ("does workspace X exist, and what plan is it on") that must not be
 * open to anonymous enumeration. Both sides run in the same deployment, so a
 * value derived from AUTH_SECRET is enough to tell them apart.
 */
export const INTERNAL_REQUEST_HEADER = "x-internal-request";

function internalToken(): string | null {
    const secret = process.env.AUTH_SECRET;
    if (!secret) return null;
    return createHmac("sha256", secret).update("internal-request").digest("hex");
}

/** Header pair to attach to a middleware self-fetch; empty when unconfigured. */
export function internalRequestHeaders(): Record<string, string> {
    const token = internalToken();
    return token ? { [INTERNAL_REQUEST_HEADER]: token } : {};
}

/** True when the request carries this deployment's internal token. */
export function isInternalRequest(request: Request): boolean {
    const expected = internalToken();
    if (!expected) return false;

    const provided = request.headers.get(INTERNAL_REQUEST_HEADER);
    if (!provided || provided.length !== expected.length) return false;

    return timingSafeEqual(Buffer.from(provided), Buffer.from(expected));
}
