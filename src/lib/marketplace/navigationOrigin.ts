import { allowedMarketplaceOrigins } from "./cors";

/**
 * Whether a state-changing GET navigation may be honoured.
 *
 * `/api/marketplace/install-redirect` writes an InstalledPlugin row on a GET, and
 * the session cookie is SameSite=Lax, so it rides along on any cross-site
 * navigation an attacker can cause. Requiring an admin does not help — it just
 * means the victim has to be one. CORS does not apply either: a navigation or an
 * `<img>` is not a preflighted request.
 *
 * The legitimate flow really is cross-site (the marketplace links into the app),
 * so same-origin cannot simply be required. Instead:
 *  - it must be a top-level document navigation, which rules out `<img>`,
 *    `<script>` and `fetch` triggers; and
 *  - a cross-site navigation must come from a marketplace we trust.
 *
 * Fails closed when the Sec-Fetch headers are absent. Every browser that can run
 * this app sends them, and this path installs code that runs for the whole
 * workspace.
 */
export function isTrustedInstallNavigation(request: Request): boolean {
    if (request.headers.get("sec-fetch-dest") !== "document") return false;

    const site = request.headers.get("sec-fetch-site");
    if (site === "same-origin" || site === "same-site" || site === "none") return true;
    if (site !== "cross-site") return false;

    // A cross-site navigation carries no Origin, so the referring page is the
    // only signal for who sent the user here.
    const referer = request.headers.get("referer");
    if (!referer) return false;
    try {
        return allowedMarketplaceOrigins().has(new URL(referer).origin);
    } catch {
        return false;
    }
}
