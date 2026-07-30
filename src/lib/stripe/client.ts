import Stripe from "stripe";

let client: Stripe | null = null;

/**
 * Stripe client, constructed on first use.
 *
 * Built lazily rather than at module load so `next build` — which runs without
 * runtime secrets — still works, matching how src/lib/db.ts handles a missing
 * DATABASE_URL. The previous `"dummy_key"` fallback made a deployment with no
 * STRIPE_SECRET_KEY look configured, then failed at the Stripe API instead of
 * at the boundary.
 */
export function getStripe(): Stripe {
    if (client) return client;

    const secretKey = process.env.STRIPE_SECRET_KEY;
    if (!secretKey) {
        throw new Error("STRIPE_SECRET_KEY is not set — billing is not configured.");
    }

    client = new Stripe(secretKey, { apiVersion: "2026-05-27.dahlia" });
    return client;
}

/** True when billing is configured on this deployment. */
export function isBillingConfigured(): boolean {
    return Boolean(process.env.STRIPE_SECRET_KEY);
}

/**
 * Price ids this deployment will sell, from STRIPE_PRICE_IDS (comma-separated).
 * The checkout route takes a price id from the request body, so without an
 * allowlist a caller could subscribe themselves to any price in the account.
 */
export function allowedPriceIds(): Set<string> {
    return new Set(
        (process.env.STRIPE_PRICE_IDS ?? "")
            .split(",")
            .map((id) => id.trim())
            .filter(Boolean),
    );
}
