// @vitest-environment node
/**
 * The JWT carried role and id but no tenant, so nothing downstream could tell a
 * tenant-A session apart from a tenant-B one — `src/proxy.ts` has to compare
 * against something. These tests capture the config handed to NextAuth and pin
 * the claim, plus the tenant-scoped credential lookup that produces it.
 */
import {
 afterEach, beforeEach, describe, expect, it, vi
} from "vitest";
import type { NextAuthConfig, User } from "next-auth";

type AuthorizeFn = (credentials: Record<string, unknown>) => Promise<User | null>;
type Callbacks = NonNullable<NextAuthConfig["callbacks"]>;
type JwtParams = Parameters<NonNullable<Callbacks["jwt"]>>[0];
type SessionParams = Parameters<NonNullable<Callbacks["session"]>>[0];

const captured: { authorize?: AuthorizeFn; callbacks?: NextAuthConfig["callbacks"] } = {};

vi.mock("next-auth", () => ({
    default: (config: NextAuthConfig) => {
        captured.callbacks = config.callbacks;
        return {
 handlers: {}, auth: vi.fn(), signIn: vi.fn(), signOut: vi.fn()
};
    },
}));
vi.mock("next-auth/providers/credentials", () => ({
    default: (config: { authorize: AuthorizeFn }) => {
        captured.authorize = config.authorize;
        return config;
    },
}));
vi.mock("bcryptjs", () => ({ compareSync: () => true, hashSync: (s: string) => s }));
vi.mock("@/lib/db", () => ({ prisma: { user: { findFirst: vi.fn() } } }));
vi.mock("@/lib/tenant", () => ({ getTenantId: vi.fn(async () => null) }));
vi.mock("@auth/supabase-adapter", () => ({ SupabaseAdapter: () => ({}) }));

import { prisma } from "@/lib/db";
import { getTenantId } from "@/lib/tenant";

const ORIGINAL_EDITION = process.env.NEXT_PUBLIC_MAVEN_EDITION;

const DB_USER = {
    id: "user-1",
    name: "Ops",
    email: "ops@example.com",
    hashedPassword: "hash",
    role: "admin",
    createdAt: new Date(),
    tenantId: "acme",
};

const CREDENTIALS = { email: "ops@example.com", password: "hunter2hunter2" };

async function load(edition: string) {
    process.env.NEXT_PUBLIC_MAVEN_EDITION = edition;
    vi.resetModules(); // `isCloud` is resolved at module load
    await import("./auth");
    return captured;
}

beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.user.findFirst).mockResolvedValue(DB_USER);
    vi.mocked(getTenantId).mockResolvedValue(null);
});

afterEach(() => {
    if (ORIGINAL_EDITION === undefined) {
        delete process.env.NEXT_PUBLIC_MAVEN_EDITION;
    } else {
        process.env.NEXT_PUBLIC_MAVEN_EDITION = ORIGINAL_EDITION;
    }
});

describe("credential lookup on cloud", () => {
    it("scopes the lookup to the workspace the request resolved", async () => {
        const { authorize } = await load("cloud");
        vi.mocked(getTenantId).mockResolvedValue("acme");

        await authorize!(CREDENTIALS);

        expect(prisma.user.findFirst).toHaveBeenCalledWith({
            where: { email: CREDENTIALS.email, tenantId: "acme" },
        });
    });

    it("refuses to authenticate when no workspace resolved", async () => {
        // The apex used to authenticate a tenant-A user against a global lookup.
        const { authorize } = await load("cloud");
        vi.mocked(getTenantId).mockResolvedValue(null);

        expect(await authorize!(CREDENTIALS)).toBeNull();
        expect(prisma.user.findFirst).not.toHaveBeenCalled();
    });

    it("returns the user's workspace so the callbacks can claim it", async () => {
        const { authorize } = await load("cloud");
        vi.mocked(getTenantId).mockResolvedValue("acme");

        expect(await authorize!(CREDENTIALS)).toMatchObject({ id: "user-1", tenantId: "acme" });
    });
});

describe("credential lookup on self-hosted local", () => {
    it("adds no tenant filter and authenticates as before", async () => {
        const { authorize } = await load("local");

        expect(await authorize!(CREDENTIALS)).toMatchObject({ id: "user-1" });
        expect(prisma.user.findFirst).toHaveBeenCalledWith({ where: { email: CREDENTIALS.email } });
    });
});

describe("session token carries the workspace", () => {
    it("puts tenantId on the JWT at sign-in and onto the session", async () => {
        const { callbacks } = await load("cloud");

        const token = await callbacks!.jwt!({
            token: {},
            user: { id: "user-1", role: "admin", tenantId: "acme" },
        } as JwtParams);

        expect(token).toMatchObject({ id: "user-1", role: "admin", tenantId: "acme" });

        const session = await callbacks!.session!({
            session: { user: {} },
            token,
        } as SessionParams);

        expect(session.user).toMatchObject({ tenantId: "acme" });
    });

    it("claims a null tenant on the editions that have no workspaces", async () => {
        const { callbacks } = await load("local");

        const token = await callbacks!.jwt!({
            token: {},
            user: { id: "user-1", role: "admin", tenantId: null },
        } as JwtParams);

        expect(token).toMatchObject({ tenantId: null });
    });
});
