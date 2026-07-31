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
    if (site === "same-origin" || site === "none") return true;

    // "same-site" is deliberately NOT trusted on its own. Cloud workspaces are
    // subdomains of one registrable domain, so tenant-to-tenant counts as
    // same-site, as would any sibling subdomain an attacker got hold of. No
    // legitimate flow needs it — the marketplace is a different registrable
    // domain (cross-site) and in-app links are same-origin — so it is held to the
    // same referrer check as cross-site rather than waved through.
    if (site !== "cross-site" && site !== "same-site") return false;

    // These navigations carry no Origin, so the referring page is the only signal
    // for who sent the user here.
    const referer = request.headers.get("referer");
    if (!referer) return false;
    try {
        return allowedMarketplaceOrigins().has(new URL(referer).origin);
    } catch {
        return false;
    }
}
