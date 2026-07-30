"use server";

import { hashSync } from "bcryptjs";
import { AuthError } from "next-auth";
import { prisma } from "@/lib/db";
import { signIn } from "@/lib/auth";
import { isCloud } from "@/core/edition";

interface SetupResult {
    success: boolean;
    error?: string;
}

/** Thrown inside the setup transaction when a user already exists. */
class SetupAlreadyCompleteError extends Error {}

/** Create the initial admin account. Rejects if any user already exists. */
export async function createAdminAccount(formData: FormData): Promise<SetupResult> {
    const name = formData.get("name") as string;
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;
    const confirm = formData.get("confirm") as string;

    if (!name || !email || !password) {
        return { success: false, error: "All fields are required." };
    }
    if (password.length < 8) {
        return { success: false, error: "Password must be at least 8 characters." };
    }
    if (password !== confirm) {
        return { success: false, error: "Passwords do not match." };
    }

    // Cloud workspaces are provisioned, not first-run set up. The tenant extension
    // scopes this count to the request's workspace, so on cloud it reads 0 for any
    // workspace that has no user yet — and an anonymous visitor to
    // <subdomain>.<host>/setup could claim admin on it. Nothing in this repo
    // provisions a workspace's first user, so refusing here loses no flow.
    if (isCloud) {
        return {
            success: false,
            error: "First-run setup is not available on this deployment.",
        };
    }

    const hashedPassword = hashSync(password, 12);

    // Count and create in one serializable transaction. Read-then-write across two
    // statements let two concurrent first-run submissions with different emails
    // both see zero users and both become admins — the unique index on email does
    // not collide, so nothing else would have caught it. Postgres aborts one of the
    // two here instead.
    try {
        await prisma.$transaction(
            async (tx) => {
                if ((await tx.user.count()) > 0) {
                    throw new SetupAlreadyCompleteError();
                }
                await tx.user.create({
                    data: { name, email, hashedPassword, role: "admin" },
                });
            },
            { isolationLevel: "Serializable" },
        );
    } catch (e) {
        if (e instanceof SetupAlreadyCompleteError) {
            return { success: false, error: "Admin account already exists." };
        }
        console.error("[setup] createAdminAccount failed", e);
        return { success: false, error: "Could not create the admin account." };
    }

    return { success: true };
}

/**
 * Creates the first admin, then signs in so /ops is reachable immediately.
 */
export async function setupAction(formData: FormData): Promise<SetupResult> {
    const result = await createAdminAccount(formData);
    if (!result.success) return result;

    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    try {
        await signIn("credentials", { email, password, redirect: false });
    } catch (error) {
        if (error instanceof AuthError) {
            return {
                success: false,
                error: "Account created but sign-in failed. Try logging in manually.",
            };
        }
        throw error;
    }

    return { success: true };
}
