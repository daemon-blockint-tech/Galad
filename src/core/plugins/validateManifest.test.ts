import { describe, it, expect } from "vitest";
import { validateManifest, isAllowedEntryUrl } from "./validateManifest";

describe("validateManifest", () => {
  it("should validate a correct manifest", () => {
    const manifest: any = {
      id: "test-plugin",
      name: "Test Plugin",
      version: "1.0.0",
      type: "data-layer",
      trust: "verified",
      capabilities: ["streaming"],
      entry: "/plugins/test.js"
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it("should flag missing required fields", () => {
    const result = validateManifest({});
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Missing required field: id");
    expect(result.errors).toContain("Missing required field: name");
    expect(result.errors).toContain("Missing required field: version");
    expect(result.errors).toContain("Missing required field: entry");
  });

  it("should flag invalid entry URLs", () => {
    const manifest: any = {
      id: "p1",
name: "n1",
version: "1",
type: "data-layer",
trust: "verified",
      capabilities: ["c1"],
entry: "https://hacker.com/malicious.js"
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("entry URL must be a relative path, CDN, localhost, or grond.dev domain");
  });

  it("should require extends for extensions", () => {
    const manifest: any = {
      id: "p1",
name: "n1",
version: "1",
type: "extension",
trust: "verified",
      capabilities: ["c1"],
entry: "/p.js"
    };
    const result = validateManifest(manifest);
    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Extension plugins require a non-empty extends array");
  });
});

describe("entry URL allowlist", () => {
    // Each of these was ACCEPTED by the old substring matcher and becomes
    // attacker-controlled JS executing on the app origin via `await import(entry)`.
    it.each([
        ["//attacker.example/pwn.js", "protocol-relative resolves to a foreign origin"],
        ["/\\evil.com/x.js", "slash-backslash is an authority to the URL parser"],
        ["\\\\evil.com/x.js", "double backslash authority"],
        ["/\\/evil.com/x.js", "mixed slash run"],
        ["\u0020//evil.com/x.js", "leading space the parser strips"],
        ["\u0009/\\evil.com/x.js", "leading tab the parser strips"],
        ["/\u000a/evil.com/x.js", "interior LF the parser strips"],
        ["/\u000d/evil.com/x.js", "interior CR the parser strips"],
        ["/\u0009/evil.com/x.js", "interior tab the parser strips"],
        ["/\u000a\u000d/evil.com/x.js", "interior CRLF the parser strips"],
        ["https://attacker.example/pwn.js#.grond.dev", "allowlisted host in the fragment"],
        ["https://attacker.example/pwn.js?x=.worldwideview.dev", "allowlisted host in the query"],
        ["https://.grond.dev.attacker.example/pwn.js", "allowlisted host as a subdomain prefix"],
        ["https://grond.dev.attacker.example/pwn.js", "allowlisted host as a label prefix"],
        ["https://notgrond.dev/pwn.js", "suffix without the dot boundary"],
        ["http://attacker.example/pwn.js", "plain http remote"],
        ["javascript:alert(1)", "non-http scheme"],
        ["https://unpkg.com.attacker.example/pwn.js", "CDN name as a subdomain"],
        ["http://localhost.attacker.example/pwn.js", "localhost as a label prefix"],
    ])("rejects %s (%s)", (entry) => {
        expect(isAllowedEntryUrl(entry)).toBe(false);
    });

    it.each([
        "/plugins/aviation.mjs",
        "./local.mjs",
        "https://cdn.jsdelivr.net/npm/pkg/dist/frontend.mjs",
        "https://unpkg.com/pkg@1.0.0/dist/frontend.mjs",
        "https://plugins.grond.dev/aviation.mjs",
        "https://grond.dev/aviation.mjs",
        "https://cdn.worldwideview.dev/x.mjs",
        "https://marketplace.maven-system.dev/x.mjs",
        "http://localhost:5173/src/plugin.ts",
        "http://127.0.0.1:5173/src/plugin.ts",
    ])("allows %s", (entry) => {
        expect(isAllowedEntryUrl(entry)).toBe(true);
    });
});
