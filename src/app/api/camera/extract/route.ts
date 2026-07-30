import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { cameraProxyLimiter } from "@/lib/rateLimiters";
import { getClientIp } from "@/lib/rateLimit";
import { safeFetch } from "@/lib/security/ssrf";

const MAX_EXTRACT_DURATION_MS = 10 * 1000; // 10 seconds timeout for HTML
const MAX_EXTRACT_BYTES = 5 * 1024 * 1024;

/** Parsed-hostname check — a substring test on the whole URL is trivially spoofed via query strings. */
function isBalticLiveCam(urlStr: string): boolean {
    try {
        const { hostname } = new URL(urlStr);
        return hostname === "balticlivecam.com" || hostname.endsWith(".balticlivecam.com");
    } catch {
        return false;
    }
}

export async function GET(req: NextRequest) {
    const rateLimited = cameraProxyLimiter.check(getClientIp(req));
    if (rateLimited) return rateLimited;

    const session = await auth();
    if (!session?.user) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const targetUrl = req.nextUrl.searchParams.get("url");
    if (!targetUrl) {
        return NextResponse.json({ error: "Missing 'url' parameter" }, { status: 400 });
    }

    if (!isBalticLiveCam(targetUrl)) {
        return NextResponse.json({ error: "Unsupported extractor platform" }, { status: 400 });
    }

    try {
        const response = await safeFetch(targetUrl, {
            headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
            timeout: MAX_EXTRACT_DURATION_MS,
            maxSize: MAX_EXTRACT_BYTES,
        });
        const html = await response.text();

        const idMatch = html.match(/id:\s*(\d+)/);
        if (!idMatch) {
            return NextResponse.json({ error: "Could not find camera ID on balticlivecam" }, { status: 400 });
        }
        const cameraId = idMatch[1];

        const ajaxUrl = `https://balticlivecam.com/wp-admin/admin-ajax.php?action=auth_token&id=${cameraId}&embed=1&main_referer=`;
        const ajaxRes = await safeFetch(ajaxUrl, {
            headers: {
                "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                Referer: targetUrl
            },
            timeout: MAX_EXTRACT_DURATION_MS,
            maxSize: MAX_EXTRACT_BYTES,
        });
        const ajaxHtml = await ajaxRes.text();

        const streamMatch = ajaxHtml.match(/src:\s*'([^']+m3u8[^']+)'/);
        if (streamMatch && streamMatch[1]) {
            return NextResponse.json({ streamUrl: streamMatch[1] });
        }
        return NextResponse.json({ error: "Could not find m3u8 stream on balticlivecam backend" }, { status: 404 });
    } catch (error: unknown) {
        const message = error instanceof Error ? error.message : "Unknown error";
        console.error("[CameraExtractor] Error:", message);
        const status = message.includes("SSRF Error") ? 403 : 502;
        return NextResponse.json({ error: "Failed to extract stream" }, { status });
    }
}
