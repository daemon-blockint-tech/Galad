import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAuthEnabled } from "@/core/edition";
import { cameraProxyLimiter } from "@/lib/rateLimiters";
import { getClientIp } from "@/lib/rateLimit";
import { safeFetch } from "@/lib/security/ssrf";

const MAX_IFRAME_DURATION_MS = 10 * 1000; // 10 seconds timeout for HTML
const MAX_IFRAME_BYTES = 5 * 1024 * 1024;

/** Escapes a URL for use inside a double-quoted HTML attribute. */
function escapeAttribute(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/"/g, "&quot;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
}

/**
 * Proxy for iframe HTML pages.
 * Fetches the target HTML, strips X-Frame-Options and CSP, and injects a <base href="...">
 * so that relative scripts/styles load correctly from the original origin.
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

    const targetUrl = new URL(req.url).searchParams.get("url");
    if (!targetUrl) {
        return NextResponse.json({ error: "Missing 'url' parameter" }, { status: 400 });
    }

    try {
        const upstream = await safeFetch(targetUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
                Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            },
            timeout: MAX_IFRAME_DURATION_MS,
            maxSize: MAX_IFRAME_BYTES,
        });

        if (!upstream.ok) {
            return NextResponse.json(
                { error: `Upstream returned ${upstream.status}` },
                { status: upstream.status },
            );
        }

        const contentType = upstream.headers.get("content-type") || "text/html";

        // If it's not HTML, just proxy the stream directly (fallback)
        if (!contentType.includes("text/html")) {
            return new Response(upstream.body as ReadableStream, {
                status: 200,
                headers: {
                    "Content-Type": contentType,
                    "Cache-Control": "no-store",
                    "X-Content-Type-Options": "nosniff",
                    "Content-Security-Policy": "sandbox allow-scripts",
                    "Access-Control-Allow-Origin": "*",
                },
            });
        }

        let html = await upstream.text();

        // Inject <base href="..."> right after <head> or at the very beginning of the document
        const baseTag = `<base href="${escapeAttribute(targetUrl)}">\n`;
        if (html.includes("<head>")) {
            html = html.replace("<head>", `<head>\n${baseTag}`);
        } else if (html.includes("<HEAD>")) {
            html = html.replace("<HEAD>", `<HEAD>\n${baseTag}`);
        } else {
            html = baseTag + html;
        }

        return new Response(html, {
            status: 200,
            headers: {
                "Content-Type": contentType,
                "Cache-Control": "no-store",
                "X-Content-Type-Options": "nosniff",
                // The upstream document is served from this app's origin, so its
                // scripts would otherwise run with access to our cookies and
                // storage. `sandbox` without allow-same-origin forces an opaque
                // origin; allow-scripts keeps camera viewers working.
                "Content-Security-Policy": "sandbox allow-scripts",
                "Access-Control-Allow-Origin": "*",
                "Access-Control-Allow-Methods": "GET, OPTIONS",
            },
        });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[IframeProxy] Error:", message);
        const status = message.includes("SSRF Error") ? 403 : 502;
        return NextResponse.json(
            { error: message || "Failed to proxy iframe" },
            { status },
        );
    }
}

export async function OPTIONS() {
    return new Response(null, {
        status: 204,
        headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Max-Age": "86400",
        },
    });
}
