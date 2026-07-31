import type { PluginManifest } from "@/core/plugins/PluginManifest";

const STORAGE_KEY = "grond_approved_unverified_manifests";

/**
 * Legacy keys held a bare array of plugin ids. Those approvals are deliberately
 * NOT migrated: an id-only approval is exactly the weakness this replaces, so
 * carrying it forward would keep the hole open. Users re-approve once.
 */
const LEGACY_KEYS = [
    "grond_approved_unverified_plugins",
    "wwv_approved_unverified_plugins",
];

/**
 * Identifies the exact manifest a user approved.
 *
 * Approval used to be keyed on plugin id alone, so once "wildfire" had been
 * approved, any later manifest claiming that id — including one whose `entry`
 * had been re-pointed at an attacker's bundle — loaded with no dialog at all.
 * The entry URL is what actually gets imported, so it has to be part of what
 * the user consented to.
 */
export function manifestFingerprint(manifest: Pick<PluginManifest, "id" | "version" | "entry">): string {
    return [manifest.id, manifest.version ?? "", manifest.entry ?? ""].join("\n");
}

/** Fingerprints of the manifests this browser has approved, keyed by plugin id. */
export function getApprovedUnverifiedManifests(): Map<string, string> {
    if (typeof window === "undefined") return new Map();
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return new Map();
        const parsed: unknown = JSON.parse(raw);
        // An array is the legacy id-only shape; treat it as no approvals.
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return new Map();
        return new Map(Object.entries(parsed as Record<string, string>));
    } catch {
        return new Map();
    }
}

/** True when this exact manifest — not merely its id — was approved before. */
export function isManifestApproved(
    manifest: Pick<PluginManifest, "id" | "version" | "entry">,
    approved: Map<string, string>,
): boolean {
    const stored = approved.get(manifest.id);
    return stored !== undefined && stored === manifestFingerprint(manifest);
}

/** Record the user's approval of this specific manifest. */
export function approveUnverifiedPlugin(
    manifest: Pick<PluginManifest, "id" | "version" | "entry">,
): void {
    const approved = getApprovedUnverifiedManifests();
    approved.set(manifest.id, manifestFingerprint(manifest));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(approved)));
    for (const key of LEGACY_KEYS) localStorage.removeItem(key);
}
