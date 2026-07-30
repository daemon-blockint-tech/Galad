import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { compareSync } from "bcryptjs";
import { timingSafeEqual } from "crypto";
import { prisma } from "@/lib/db";
import {
 isDemo, isCloud, getDemoAdminSecret, DEMO_ADMIN_ROLE
} from "@/core/edition";
import { authConfig } from "@/lib/auth.config";
import { getTenantId } from "@/lib/tenant";
import { SupabaseAdapter } from "@auth/supabase-adapter";
import { resolveSupabaseConfig } from "@/lib/supabase-config";

// Extract local credentials logic to a helper
const localCredentialsProvider = Credentials({
    credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
    },
    async authorize(credentials) {
        const email = credentials?.email as string | undefined;
        const password = credentials?.password as string | undefined;

        if (!email || !password) return null;

        // Demo edition: virtual admin login (no DB user required)
        const adminSecret = getDemoAdminSecret();
        const secretMatch = adminSecret
            && password.length === adminSecret.length
            && timingSafeEqual(Buffer.from(password), Buffer.from(adminSecret));
        if (isDemo && secretMatch && email === "admin") {
            return {
                id: "demo-admin",
                name: "Demo Admin",
                email: "admin",
                role: DEMO_ADMIN_ROLE,
                tenantId: null,
            };
        }

        // Cloud: the workspace is part of the identity. Without one the lookup
        // would match a user in *any* tenant — `@@unique([tenantId, email])`
        // only makes email unique within a workspace. Named explicitly rather
        // than left to the Prisma extension so the intent survives a refactor.
        const tenantId = await getTenantId();
        if (isCloud && !tenantId) return null;

        const user = await prisma.user.findFirst({
            where: isCloud ? { email, tenantId } : { email },
        });
        if (!user) return null;

        const isValid = compareSync(password, user.hashedPassword);
        if (!isValid) return null;

        return {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
            tenantId: user.tenantId,
        };
    },
});

export const {
 handlers, auth, signIn, signOut
} = NextAuth({
    ...authConfig,
    session: { strategy: "jwt" },
    adapter: isCloud
        ? (() => {
            const supabase = resolveSupabaseConfig();
            if (!supabase?.url || !supabase.serviceRoleKey) return undefined;
            return SupabaseAdapter({
                url: supabase.url,
                secret: supabase.serviceRoleKey,
            }) as any;
        })()
        : undefined,
    providers: [localCredentialsProvider],
    callbacks: {
        ...authConfig.callbacks,
        async jwt({ token, user }) {
            if (user) {
                token.role = (user as { role?: string }).role ?? "user";
                token.id = user.id;
                // Binds the session to the workspace it was minted on. AUTH_SECRET
                // is one global value, so without this claim a tenant-A cookie
                // verifies on tenant B and `src/proxy.ts` has nothing to compare.
                token.tenantId = (user as { tenantId?: string | null }).tenantId ?? null;
            }
            return token;
        },
        async session({ session, token }) {
            if (session.user) {
                session.user.id = token.id as string;
                (session.user as { role?: string }).role = token.role as string;
                (session.user as { tenantId?: string | null }).tenantId = (token.tenantId as string | null) ?? null;
            }
            return session;
        },
    },
});
