import { NextResponse } from "next/server";
import { getStripe, isBillingConfigured } from "@/lib/stripe/client";

export async function POST(req: Request) {
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
    if (!isBillingConfigured() || !webhookSecret) {
        return NextResponse.json({ error: "Billing is not configured" }, { status: 501 });
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
        return new NextResponse("Missing stripe-signature", { status: 400 });
    }

    const body = await req.text();

    let event;
    try {
        event = getStripe().webhooks.constructEvent(body, signature, webhookSecret);
    } catch (err) {
        const message = err instanceof Error ? err.message : "invalid payload";
        return new NextResponse(`Webhook Error: ${message}`, { status: 400 });
    }

    if (event.type === "checkout.session.completed") {
        // Fulfilment is not implemented: nothing here grants the plan the
        // customer just paid for. Returning 200 would tell Stripe the event was
        // handled and it would never be retried, silently losing the purchase —
        // so fail loudly instead and let Stripe's retry schedule hold the event
        // until fulfilment exists.
        console.error(
            `[billing] Unfulfilled checkout.session.completed ${event.id} — no plan was granted.`,
        );
        return NextResponse.json(
            { error: "Checkout fulfilment is not implemented" },
            { status: 501 },
        );
    }

    return new NextResponse(null, { status: 200 });
}
