/**
 * Where to land after a successful login.
 *
 * Resolved against the app origin rather than string-matched, then the result is
 * re-checked before being returned. Both halves are load-bearing: "//evil.com/x"
 * starts with "/" but is not a path, and "/..//evil.com/x" resolves same-origin
 * with a pathname of "//evil.com/x" — which `router.push` re-parses as an
 * authority. Returning a value that has not survived the same test it was
 * resolved under is how this went wrong the first time.
 *
 * API routes are refused outright. `/api/marketplace/install-redirect` writes a
 * plugin manifest on a GET and trusts a same-origin navigation, so letting
 * callbackUrl aim there turns the login page into the delivery vehicle for it.
 */
export function getSafeRedirect(url: string | null, origin: string): string {
    if (!url) return "/ops";
    try {
        const resolved = new URL(url, origin);
        if (resolved.origin !== new URL(origin).origin) return "/ops";
        if (resolved.pathname.startsWith("/api")) return "/ops";

        const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
        if (!path.startsWith("/") || path.startsWith("//")) return "/ops";
        return path;
    } catch {
        return "/ops";
    }
}
