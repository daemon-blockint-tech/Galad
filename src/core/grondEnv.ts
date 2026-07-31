/**
 * Resolved Grond environment variables with one-release legacy `WWV_*` fallback.
 */

let legacyPublicEnvWarned = false;
let legacyServerEnvWarned = false;

/**
 * Every `NEXT_PUBLIC_*` value, read as a static member expression.
 *
 * Next only substitutes `process.env.NEXT_PUBLIC_X` when it is written literally;
 * a computed `process.env[key]` is left alone, so in the browser bundle it read
 * undefined and every edition flag silently fell back to its default — a demo or
 * cloud deployment rendered as local on the client. Server code was unaffected
 * because Node has a real `process.env`. Adding a public var means adding it here.
 */
const PUBLIC_ENV: Record<string, string | undefined> = {
    NEXT_PUBLIC_MAVEN_EDITION: process.env.NEXT_PUBLIC_MAVEN_EDITION,
    NEXT_PUBLIC_WWV_EDITION: process.env.NEXT_PUBLIC_WWV_EDITION,
    NEXT_PUBLIC_MAVEN_PLUGIN_DATA_ENGINE_URL: process.env.NEXT_PUBLIC_MAVEN_PLUGIN_DATA_ENGINE_URL,
    NEXT_PUBLIC_WWV_PLUGIN_DATA_ENGINE_URL: process.env.NEXT_PUBLIC_WWV_PLUGIN_DATA_ENGINE_URL,
    NEXT_PUBLIC_MAVEN_MARKETPLACE_URL: process.env.NEXT_PUBLIC_MAVEN_MARKETPLACE_URL,
    NEXT_PUBLIC_WWV_MARKETPLACE_URL: process.env.NEXT_PUBLIC_WWV_MARKETPLACE_URL,
    NEXT_PUBLIC_MAVEN_MARKETING_URL: process.env.NEXT_PUBLIC_MAVEN_MARKETING_URL,
    NEXT_PUBLIC_WWV_MARKETING_URL: process.env.NEXT_PUBLIC_WWV_MARKETING_URL,
    NEXT_PUBLIC_MAVEN_HUB_URL: process.env.NEXT_PUBLIC_MAVEN_HUB_URL,
    NEXT_PUBLIC_WWV_HUB_URL: process.env.NEXT_PUBLIC_WWV_HUB_URL,
    NEXT_PUBLIC_MAVEN_ANALYTICS: process.env.NEXT_PUBLIC_MAVEN_ANALYTICS,
    NEXT_PUBLIC_WWV_ANALYTICS: process.env.NEXT_PUBLIC_WWV_ANALYTICS,
    NEXT_PUBLIC_MAVEN_AGENT_BUS_ENABLED: process.env.NEXT_PUBLIC_MAVEN_AGENT_BUS_ENABLED,
    NEXT_PUBLIC_WWV_AGENT_BUS_ENABLED: process.env.NEXT_PUBLIC_WWV_AGENT_BUS_ENABLED,
    NEXT_PUBLIC_MAVEN_BUILD_ID: process.env.NEXT_PUBLIC_MAVEN_BUILD_ID,
    NEXT_PUBLIC_WWV_BUILD_ID: process.env.NEXT_PUBLIC_WWV_BUILD_ID,
    NEXT_PUBLIC_MAVEN_BUILD_AT: process.env.NEXT_PUBLIC_MAVEN_BUILD_AT,
    NEXT_PUBLIC_WWV_BUILD_AT: process.env.NEXT_PUBLIC_WWV_BUILD_AT,
    NEXT_PUBLIC_OPS_BANNER_ENABLED: process.env.NEXT_PUBLIC_OPS_BANNER_ENABLED,
    NEXT_PUBLIC_OPS_BANNER_URL: process.env.NEXT_PUBLIC_OPS_BANNER_URL,
};

function readPublicEnv(grondKey: string, legacyKey: string): string | undefined {
    const grond = PUBLIC_ENV[grondKey]?.trim();
    if (grond) return grond;
    const legacy = PUBLIC_ENV[legacyKey]?.trim();
    if (legacy && !legacyPublicEnvWarned) {
        legacyPublicEnvWarned = true;
        console.warn(`[grondEnv] Using legacy env ${legacyKey}; prefer ${grondKey}`);
    }
    return legacy;
}

function readServerEnv(grondKey: string, legacyKey: string): string | undefined {
    const grond = process.env[grondKey]?.trim();
    if (grond) return grond;
    const legacy = process.env[legacyKey]?.trim();
    if (legacy && !legacyServerEnvWarned) {
        legacyServerEnvWarned = true;
        console.warn(`[grondEnv] Using legacy env ${legacyKey}; prefer ${grondKey}`);
    }
    return legacy;
}

/** Public build-time edition: local | cloud | demo */
export function getPublicEdition(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_MAVEN_EDITION", "NEXT_PUBLIC_WWV_EDITION");
}

export function getPluginDataEngineUrl(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_MAVEN_PLUGIN_DATA_ENGINE_URL", "NEXT_PUBLIC_WWV_PLUGIN_DATA_ENGINE_URL");
}

export function getMarketplaceUrl(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_MAVEN_MARKETPLACE_URL", "NEXT_PUBLIC_WWV_MARKETPLACE_URL");
}

export function getMarketingUrl(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_MAVEN_MARKETING_URL", "NEXT_PUBLIC_WWV_MARKETING_URL");
}

export function getHubUrl(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_MAVEN_HUB_URL", "NEXT_PUBLIC_WWV_HUB_URL");
}

export function getPublicAnalyticsFlag(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_MAVEN_ANALYTICS", "NEXT_PUBLIC_WWV_ANALYTICS");
}

export function getAgentBusEnabled(): boolean {
    const v = readPublicEnv("NEXT_PUBLIC_MAVEN_AGENT_BUS_ENABLED", "NEXT_PUBLIC_WWV_AGENT_BUS_ENABLED");
    return v === "true";
}

export function getBuildId(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_MAVEN_BUILD_ID", "NEXT_PUBLIC_WWV_BUILD_ID");
}

export function getBuildAt(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_MAVEN_BUILD_AT", "NEXT_PUBLIC_WWV_BUILD_AT");
}

export function getOpsBannerEnabled(): boolean {
    return readPublicEnv("NEXT_PUBLIC_OPS_BANNER_ENABLED", "NEXT_PUBLIC_OPS_BANNER_ENABLED") === "true";
}

export function getOpsBannerUrl(): string | undefined {
    return readPublicEnv("NEXT_PUBLIC_OPS_BANNER_URL", "NEXT_PUBLIC_OPS_BANNER_URL");
}

export function getDemoAdminSecret(): string | undefined {
    return readServerEnv("MAVEN_DEMO_ADMIN_SECRET", "WWV_DEMO_ADMIN_SECRET");
}

export function getBridgeToken(): string | undefined {
    return readServerEnv("MAVEN_BRIDGE_TOKEN", "WWV_BRIDGE_TOKEN");
}

export function getProxyAllowLocal(): boolean {
    return readServerEnv("MAVEN_PROXY_ALLOW_LOCAL", "WWV_PROXY_ALLOW_LOCAL") === "true";
}

export function getSkipDefaultPlugins(): boolean {
    return readServerEnv("MAVEN_SKIP_DEFAULT_PLUGINS", "WWV_SKIP_DEFAULT_PLUGINS") === "true";
}

export function getTeardownDbOnExit(): boolean {
    const v = readServerEnv("MAVEN_TEARDOWN_DB_ON_EXIT", "WWV_TEARDOWN_DB_ON_EXIT");
    return v === "true" || v === "1";
}

export const THEME_STORAGE_KEY = "grond-theme";
export const LEGACY_THEME_STORAGE_KEY = "wwv-theme";
export const CACHE_DB_NAME = "grond-cache";
export const LEGACY_CACHE_DB_NAME = "worldwideview-cache";

export const MARKETPLACE_JWT_ISSUER = "grond";
export const MARKETPLACE_JWT_AUDIENCE = "grond-marketplace";
