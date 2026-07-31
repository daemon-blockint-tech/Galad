/**
 * Edition detection module.
 *
 * Reads `NEXT_PUBLIC_MAVEN_EDITION` with legacy `NEXT_PUBLIC_WWV_EDITION` fallback.
 */

import { getDemoAdminSecret as readDemoAdminSecret, getPublicEdition } from "@/core/grondEnv";

export type Edition = "local" | "cloud" | "demo";

const VALID_EDITIONS: ReadonlySet<string> = new Set<Edition>([
    "local",
    "cloud",
    "demo",
]);

/**
 * Resolve the current edition from the environment.
 * Falls back to `"local"` when the env var is unset or invalid.
 */
export function resolveEdition(raw?: string): Edition {
    const value = (raw ?? "").trim().toLowerCase();
    if (VALID_EDITIONS.has(value)) return value as Edition;
    return "local";
}

/** Current deployment edition — determined once at module load. */
export const edition: Edition = resolveEdition(getPublicEdition());

export const isLocal: boolean = edition === "local";
export const isCloud: boolean = edition === "cloud";
export const isDemo: boolean = edition === "demo";

const DEMO_ADMIN_SECRET: string | undefined = readDemoAdminSecret();

export const isDemoAdminConfigured: boolean = isDemo && !!DEMO_ADMIN_SECRET;

export const isAuthEnabled: boolean = !isDemo;
export const isPluginInstallEnabled: boolean = !isDemo || isDemoAdminConfigured;
export const isSettingsEditable: boolean = !isDemo;
export const isHistoryEnabled: boolean = !isDemo;

export function getDemoAdminSecret(): string | undefined {
    if (!isDemo) return undefined;
    return DEMO_ADMIN_SECRET;
}

export const DEMO_ADMIN_ROLE = "demo-admin";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isDemoAdmin(session: any): boolean {
    return isDemo && session?.user?.role === DEMO_ADMIN_ROLE;
}

/** True when session may access `/admin/*` routes. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function isPlatformAdmin(session: any): boolean {
    if (!session?.user) return false;
    // On demo the console belongs to the operator holding the demo secret, not to
    // any account that happens to carry role "admin". The middleware already
    // enforced that; accepting a plain admin here made the two gates disagree.
    if (isDemo) return isDemoAdmin(session);
    return session.user.role === "admin";
}
