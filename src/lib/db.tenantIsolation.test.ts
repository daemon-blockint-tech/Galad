/**
 * The tenant extension injects `tenantId` into where/data clauses. Prisma rejects
 * an unknown argument outright, so injecting it into a model that has no such
 * column turns every query on that model into a validation error at runtime —
 * only on the cloud edition, where a workspace subdomain is present. These tests
 * pin the set to the datamodel so it cannot drift as models are added.
 */
import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma";
import { TENANT_SCOPED_MODELS } from "./db";

const modelsWithTenantId = Prisma.dmmf.datamodel.models
    .filter((model) => model.fields.some((field) => field.name === "tenantId"))
    .map((model) => model.name);

const modelsWithoutTenantId = Prisma.dmmf.datamodel.models
    .filter((model) => !model.fields.some((field) => field.name === "tenantId"))
    .map((model) => model.name);

describe("tenant isolation model set", () => {
    it("matches exactly the models declaring a tenantId column", () => {
        expect([...TENANT_SCOPED_MODELS].sort()).toEqual([...modelsWithTenantId].sort());
    });

    it("excludes every model without a tenantId column", () => {
        for (const model of modelsWithoutTenantId) {
            expect(TENANT_SCOPED_MODELS.has(model)).toBe(false);
        }
    });

    it("excludes the user-scoped ops models", () => {
        // Regression: these were injected into because the guard hardcoded only
        // Workspace/WorkspaceMember, breaking all task and alert routes on cloud.
        expect(TENANT_SCOPED_MODELS.has("OpsTask")).toBe(false);
        expect(TENANT_SCOPED_MODELS.has("OpsAlert")).toBe(false);
    });

    it("still excludes the workspace models the guard originally named", () => {
        expect(TENANT_SCOPED_MODELS.has("Workspace")).toBe(false);
        expect(TENANT_SCOPED_MODELS.has("WorkspaceMember")).toBe(false);
    });

    it("covers the tenanted models the ops surface actually writes", () => {
        for (const model of ["Alert", "AlertEvent", "EntityClassification"]) {
            expect(TENANT_SCOPED_MODELS.has(model)).toBe(true);
        }
    });
});
