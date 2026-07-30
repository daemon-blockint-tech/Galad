import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAuthEnabled } from "@/core/edition";
import { cameraProxyLimiter } from "@/lib/rateLimiters";
import { getClientIp } from "@/lib/rateLimit";
import { safeFetch } from "@/lib/security/ssrf";

const TIMEOUT_MS = 30_000;

/**
 * Reachability probe for a camera stream URL.
 *
 * `safeFetch` is the guard that matters here: https-only, private IPs rejected
 * before *and* after DNS resolution, and the connection pinned to the resolved
 * address — so the probe cannot be aimed at the deploy network. The error
 * branches deliberately return one generic message: echoing the underlying
 * socket error code turns this route into an open/closed/filtered port-scan
 * oracle.
 */
export async function GET(req: NextRequest) {
    const rateLimited = cameraProxyLimiter.check(getClientIp(req));
    if (rateLimited) return rateLimited;

    if (isAuthEnabled) {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    const url = req.nextUrl.searchParams.get("url");
    if (!url) {
        return NextResponse.json({ status: "error", error: "Missing url parameter" }, { status: 400 });
    }

    const probe = (method: string) => safeFetch(url, {
        method,
        headers: { "User-Agent": "Grond/1.0" },
        timeout: TIMEOUT_MS,
    });

    const startTime = Date.now();
    try {
        let response: Response;
        try {
            response = await probe("HEAD");
        } catch (headError: unknown) {
            // Primitive IP camera servers (like Insecam sources) often aggressively drop the TCP
            // connection instead of returning 405 when they see an unsupported HTTP method like
            // HEAD. If the socket was closed unexpectedly, retry with GET.
            const headMessage = headError instanceof Error ? headError.message : "";
            if (!headMessage.includes("fetch failed")) throw headError;
            response = await probe("GET");
        }

        // If HEAD completes but with 405 (Method Not Allowed) or 403, try GET instead.
        if (response.status === 405 || response.status === 403) {
            void response.body?.cancel();
            response = await probe("GET");
        }

        const result = NextResponse.json({
            status: response.status,
            contentType: response.headers.get("content-type"),
            latencyMs: Date.now() - startTime,
        });
        // Nothing reads the body — release the socket rather than holding an
        // open MJPEG stream for the life of the process.
        void response.body?.cancel();
        return result;
    } catch (error: unknown) {
        const latencyMs = Date.now() - startTime;
        const message = error instanceof Error ? error.message : "Unknown error";

        if (message.includes("SSRF Error")) {
            return NextResponse.json({ status: "error", error: message, latencyMs }, { status: 403 });
        }
        if (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError")) {
            return NextResponse.json({ status: "timeout", error: "Connection timed out", latencyMs });
        }
        return NextResponse.json({ status: "error", error: "Request failed", latencyMs });
    }
}
