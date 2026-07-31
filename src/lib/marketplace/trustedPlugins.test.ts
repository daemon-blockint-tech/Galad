// @vitest-environment jsdom
/**
 * Approval gates whether an unverified plugin bundle is imported into the user's
 * browser. It is keyed on a fingerprint of (id, version, entry) so that
 * re-pointing `entry` after approval re-prompts.
 */
import { beforeEach, describe, expect, it } from "vitest";

import {
    approveUnverifiedPlugin,
    getApprovedUnverifiedManifests,
    isManifestApproved,
    manifestFingerprint,
} from "./trustedPlugins";

const base = { id: "aviation", version: "1.0.0", entry: "https://unpkg.com/good@1/dist/f.mjs" };

beforeEach(() => localStorage.clear());

describe("manifestFingerprint", () => {
    it("distinguishes manifests whose fields differ", () => {
        expect(manifestFingerprint(base)).not.toBe(
            manifestFingerprint({ ...base, entry: "https://unpkg.com/evil@1/dist/f.mjs" }),
        );
        expect(manifestFingerprint(base)).not.toBe(manifestFingerprint({ ...base, version: "1.0.1" }));
    });

    it("cannot be collided by smuggling a separator into version", () => {
        // A delimiter join let these two produce the same fingerprint: approve the
        // benign entry once, then swap in the attacker's and reuse the approval.
        const approved = {
            id: "aviation",
            version: "9.9.9\nhttps://unpkg.com/evil@1/dist/f.mjs#",
            entry: "https://unpkg.com/good@1/dist/f.mjs",
        };
        const swapped = {
            id: "aviation",
            version: "9.9.9",
            entry: "https://unpkg.com/evil@1/dist/f.mjs#\nhttps://unpkg.com/good@1/dist/f.mjs",
        };

        expect(manifestFingerprint(approved)).not.toBe(manifestFingerprint(swapped));
    });
});

describe("isManifestApproved", () => {
    it("accepts only the exact manifest that was approved", () => {
        approveUnverifiedPlugin(base);
        const approved = getApprovedUnverifiedManifests();

        expect(isManifestApproved(base, approved)).toBe(true);
        expect(isManifestApproved({ ...base, entry: "https://unpkg.com/evil@1/f.mjs" }, approved)).toBe(false);
        expect(isManifestApproved({ ...base, version: "2.0.0" }, approved)).toBe(false);
        expect(isManifestApproved({ ...base, id: "other" }, approved)).toBe(false);
    });

    it("ignores legacy id-only approvals rather than honouring them", () => {
        // Migrating those forward would migrate the hole forward with them.
        localStorage.setItem("grond_approved_unverified_plugins", JSON.stringify(["aviation"]));

        expect(isManifestApproved(base, getApprovedUnverifiedManifests())).toBe(false);
    });

    it("survives corrupt storage without approving anything", () => {
        localStorage.setItem("grond_approved_unverified_manifests", "{not json");

        expect(getApprovedUnverifiedManifests().size).toBe(0);
    });
});
