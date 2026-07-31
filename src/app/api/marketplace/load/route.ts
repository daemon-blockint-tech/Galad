import { NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { prisma } from "@/lib/db";
import { handlePreflight, withCors } from "@/lib/marketplace/cors";
import { validateManifest } from "@/core/plugins/validateManifest";
import { validateMarketplaceAuth } from "@/lib/marketplace/auth";
import type { PluginManifest } from "@/core/plugins/PluginManifest";
import { getVerifiedPluginIds } from "@/lib/marketplace/registryClient";

import { isDemo, isDemoAdmin } from "@/core/edition";
import { auth } from "@/lib/auth";
import { seedDefaultPlugins } from "@/lib/marketplace/seedDefaultPlugins";
import * as Sentry from "@sentry/nextjs";

export async function OPTIONS(request: Request) {
    return handlePreflight(request);
}

/**
 * Returns manifests of all installed marketplace plugins that are valid
 * and need dynamic loading (i.e. not built-in plugins already in AppShell).
 * Called by the client at startup to load installed plugins.
 *
 * Trust is re-stamped against the live registry so that plugins removed
 * from the verified list are correctly flagged as unverified.
 */
export async function GET(request: Request) {
    // Seed default plugins on fresh installs (idempotent — runs once)
    await seedDefaultPlugins();

    // On demo, all installed plugins are visible to everyone (admin vetted them)
    if (!isDemo) {
        const authError = await validateMarketplaceAuth(request);
        if (authError) return withCors(authError, request);
    }

    try {
        const [records, verifiedIds] = await Promise.all([
            // Disabling must actually stop the bundle being imported, not just
            // move it into a "disabled" list in the UI.
            prisma.installedPlugin.findMany({ where: { enabled: true } }),
            getVerifiedPluginIds(),
        ]);

        // Support local sandbox workflows by checking /public/plugins-local
        const localPlugins: any[] = [];
        try {
            if (process.env.NODE_ENV === "development" || process.env.WWV_PLUGIN_DEV === "true") {
                const pluginsDir = path.join(process.cwd(), "public", "plugins-local");
                if (fs.existsSync(pluginsDir)) {
                    for (const folder of fs.readdirSync(pluginsDir)) {
                        const manifestPath = path.join(pluginsDir, folder, "plugin.json");
                        if (fs.existsSync(manifestPath)) {
                            try {
                                const config = fs.readFileSync(manifestPath, "utf-8");
                                localPlugins.push({ pluginId: folder, config });
                            } catch (e) {
                                console.error(`Error reading local plugin ${folder}:`, e);
                            }
                        }
                    }
                }
            }
        } catch (e) {
            console.error("Error scanning local plugins directory:", e);
        }

        const allRecords = [...records, ...localPlugins];

        const manifests = allRecords
            .map((r: any): PluginManifest | null => {
                try {
                    const manifest = JSON.parse(r.config);
                    if (!manifest.id) manifest.id = r.pluginId;

                    return manifest as PluginManifest;
                } catch {
                    return null;
                }
            })
            .filter((m: any): m is PluginManifest => {
                if (!m) return false;
                // Skip built-in plugins — already registered by AppShell
                if (m.trust === "built-in") return false;

                // Skip stale/malformed records (e.g. old empty-config installs for built-ins)
                // If it lacks basic required fields, it's a legacy record and we drop it silently
                // to avoid log spam on every poll.
                if (!m.entry || !m.name || !m.version) return false;

                // Skip bundle plugins whose entry is a bare module specifier
                // (e.g. "camera") — cannot be dynamically imported in the browser.
                if (
                    m.format === "bundle"
                    && !m.entry.startsWith("/")
                    && !m.entry.startsWith("./")
                    && !m.entry.startsWith("http")
                ) return false;

                // For anything that looks like a real manifest, validate it and log if it fails
                const validation = validateManifest(m);
                if (!validation.valid) {
                    const errorMessage = `Manifest validation failed for ${m.id}`;
                    console.error(`[Marketplace API] ${errorMessage}:`, validation.errors);

                    // Capture in Sentry so we have visibility into malformed third-party plugins
                    Sentry.captureMessage(errorMessage, {
                        level: "error",
                        extra: {
                            pluginId: m.id,
                            validationErrors: validation.errors,
                            manifest: m
                        }
                    });
                }
                return validation.valid;
            })
            .map((m: any) => {
                // Re-stamp against the live registry so a revoked plugin is gated by
                // the unverified dialog on the client. Demote only, never promote:
                // the registry signs a list of ids, not manifests, so id membership
                // says nothing about a stored manifest's entry URL. Promoting on id
                // alone would hand "verified" — and so a skipped approval dialog — to
                // any manifest installed under a verified plugin's name, undoing the
                // stamping rule in the install routes.
                if (m.trust === "verified" && !verifiedIds.has(m.id)) {
                    m.trust = "unverified";
                    m.revoked = true;
                }
                return m;
            })
            // Demoting relies on the client's unverified dialog to gate the plugin,
            // but demo skips that dialog (installs there are demo-admin-only, so the
            // admin is taken to have vetted them). A revoked plugin was vetted under
            // a claim the registry has since withdrawn, so on demo it is dropped
            // outright rather than loaded silently into every anonymous visitor.
            .filter((m: any) => !(isDemo && m.revoked));

        // Strip sensitive configuration fields on demo for non-admin visitors
        if (isDemo && !isDemoAdmin(await auth())) {
            for (const m of manifests) {
                if (m.format === "declarative" && m.dataSource) {
                    // Only omit headers and potentially sensitive auth params.
                    // The URL might be needed by the client for polling, but headers like Bearer tokens shouldn't leak.
                    // If the audit explicitly asks to strip URL, maybe just replace it entirely if it's sensitive,
                    // but usually headers are the sensitive part. We strip headers.
                    if (m.dataSource.headers) {
                        m.dataSource.headers = {};
                    }
                }
            }
        }

        return withCors(NextResponse.json({ manifests }), request);
    } catch (err) {
        console.error("[Marketplace/load] Error:", err);
        return withCors(NextResponse.json({ manifests: [] }), request);
    }
}
