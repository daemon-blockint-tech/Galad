import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";

/**
 * Checkout is closed because nothing fulfils what it would sell.
 *
 * A Stripe subscription started here would complete, charge the customer, and
 * then hit a `checkout.session.completed` handler that grants no plan (see
 * ../webhook/route.ts). Taking the money and delivering nothing is worse than
 * being unavailable, so the flow refuses at the front door instead.
 *
 * To re-open: implement fulfilment in the webhook, then restore the session
 * creation here — it needs `STRIPE_SECRET_KEY`, `STRIPE_PRICE_IDS` (the
 * allowlist the request's `priceId` must belong to, so a caller cannot name an
 * arbitrary price) and `NEXT_PUBLIC_APP_URL`.
 */
export async function POST() {
    const session = await auth();
    if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

    return NextResponse.json(
        { error: "Checkout is unavailable: subscription fulfilment is not implemented" },
        { status: 501 },
    );
}
