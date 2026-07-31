import { NextResponse } from "next/server";
import { validateMarketplaceAuth } from "@/lib/marketplace/auth";
import { getInstalledPlugins } from "@/lib/marketplace/repository";
import { handlePreflight, withCors } from "@/lib/marketplace/cors";
import { marketplaceApiLimiter } from "@/lib/rateLimiters";
import { getClientIp } from "@/lib/rateLimit";
import { isDemo, isDemoAdmin } from "@/core/edition";
import { auth } from "@/lib/auth";

export async function OPTIONS(request: Request) {
    return handlePreflight(request);
}

/**
 * The stored `config` is the whole manifest, which for a declarative plugin
 * includes `dataSource.headers` — Bearer tokens and API keys. This route is
 * anonymous on demo and reflects any Origin, so returning rows verbatim published
 * those keys to any page that asked. The plugin list only needs three fields out
 * of the manifest to render, so it gets exactly those.
 */
function toListedPlugin(record: { pluginId: string; version: string; config: string; installedAt: Date | string; enabled?: boolean }) {
    let display: { name?: unknown; icon?: unknown; trust?: unknown } = {};
    try {
        const parsed: unknown = JSON.parse(record.config);
        if (parsed && typeof parsed === "object") display = parsed as typeof display;
    } catch {
        // A row we cannot parse simply has no display fields.
    }

    return {
        pluginId: record.pluginId,
        version: record.version,
        installedAt: record.installedAt,
        enabled: record.enabled,
        config: JSON.stringify({
            name: typeof display.name === "string" ? display.name : undefined,
            icon: typeof display.icon === "string" ? display.icon : undefined,
            trust: typeof display.trust === "string" ? display.trust : undefined,
        }),
    };
}

export async function GET(request: Request) {
    const rateLimited = marketplaceApiLimiter.check(getClientIp(request));
    if (rateLimited) return withCors(rateLimited, request);

    // In demo mode, the plugin list is public (read-only for non-admins)
    // For local/cloud, we continue to enforce authentication

    if (!isDemo) {
        const authError = await validateMarketplaceAuth(request);
        if (authError) return withCors(authError, request);
    }

    try {
        const dbPlugins = await getInstalledPlugins();

        // All DB plugins, enabled and disabled, reduced to display fields.
        const plugins = dbPlugins.map(toListedPlugin);

        let canManagePlugins = !isDemo;
        if (isDemo) {
            const authError = await validateMarketplaceAuth(request);
            canManagePlugins = authError === null;
        }

        return withCors(NextResponse.json({ plugins, canManagePlugins }), request);
    } catch (err) {
        console.error("[marketplace/status] Error:", err);
        let canManagePlugins = !isDemo;
        if (isDemo) {
            const authError = await validateMarketplaceAuth(request);
            canManagePlugins = authError === null;
        }

        return withCors(NextResponse.json({ plugins: [], canManagePlugins }), request);
    }
}
