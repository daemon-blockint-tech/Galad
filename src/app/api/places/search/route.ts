import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { isAuthEnabled } from "@/core/edition";
import { placesLimiter } from "@/lib/rateLimiters";
import { getClientIp } from "@/lib/rateLimit";

// Server-side cache: keyed by normalised input, 1-hour TTL, bounded so an
// attacker-controlled key space cannot grow the process heap without limit.
const cache = new Map<string, { data: unknown; expiresAt: number }>();
const TTL_MS = 60 * 60 * 1000; // 1 hour
const MAX_CACHE_ENTRIES = 1000;
const UPSTREAM_TIMEOUT_MS = 10_000;

export async function GET(request: Request) {
    const rateLimited = placesLimiter.check(getClientIp(request));
    if (rateLimited) return rateLimited;

    if (isAuthEnabled) {
        const session = await auth();
        if (!session?.user) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }
    }

    const { searchParams } = new URL(request.url);
    const input = searchParams.get("input");

    if (!input || typeof input !== "string") {
        return NextResponse.json({ error: "Input is required" }, { status: 400 });
    }

    // Use user-provided key if present in header AND looks valid, otherwise fall back to .env
    const userKey = request.headers.get("X-User-Google-Key");
    const isValidUserKey = userKey && userKey.length >= 20;
    const apiKey = isValidUserKey ? userKey : process.env.GOOGLE_MAPS_API_KEY;
    if (!apiKey) {
        console.error("GOOGLE_MAPS_API_KEY is not defined and no user key provided");
        return NextResponse.json(
            { error: "places_unconfigured", predictions: [] },
            { status: 503 }
        );
    }

    // Separate cache entries for user-provided keys vs default. Keyed off the
    // *accepted* key, so a too-short header cannot namespace the server key's cache.
    const cachePrefix = isValidUserKey ? `user:${userKey.slice(0, 8)}:` : "";
    const cacheKey = `${cachePrefix}${input.toLowerCase().trim()}`;
    const cached = cache.get(cacheKey);
    if (cached && Date.now() < cached.expiresAt) {
        return NextResponse.json(cached.data);
    }
    if (cached) cache.delete(cacheKey); // expired — evict rather than leave it forever

    try {
        // No type restriction — returns addresses, establishments, landmarks, regions, etc.
        const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(
            input
        )}&key=${apiKey}`;

        const response = await fetch(url, { signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS) });
        const data = await response.json();

        if (data.status !== "OK" && data.status !== "ZERO_RESULTS") {
            console.error("Google Places API Error:", data);
            return NextResponse.json({ error: "Failed to fetch predictions" }, { status: 500 });
        }

        const predictions = data.predictions.map((p: any) => ({
            description: p.description,
            placeId: p.place_id,
            mainText: p.structured_formatting?.main_text || p.description,
            secondaryText: p.structured_formatting?.secondary_text || "",
            types: p.types,
        }));

        const result = { predictions };
        cache.set(cacheKey, { data: result, expiresAt: Date.now() + TTL_MS });
        // Map iterates in insertion order, so the first key is the oldest (FIFO eviction).
        if (cache.size > MAX_CACHE_ENTRIES) {
            const oldest = cache.keys().next().value;
            if (oldest !== undefined) cache.delete(oldest);
        }
        return NextResponse.json(result);
    } catch (error) {
        console.error("Error in Places Autocomplete route:", error);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
