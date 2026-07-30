import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { allowedPriceIds, getStripe, isBillingConfigured } from "@/lib/stripe/client";

export async function POST(req: Request) {
    const session = await auth();
    if (!session?.user) return new NextResponse("Unauthorized", { status: 401 });

    if (!isBillingConfigured()) {
        return NextResponse.json({ error: "Billing is not configured" }, { status: 501 });
    }

    const { priceId } = await req.json().catch(() => ({ priceId: undefined }));

    // The price id comes from the client, so it has to be checked against what
    // this deployment actually sells — otherwise a caller can name any price in
    // the Stripe account, including a cheaper or free one, for a paid plan.
    const allowed = allowedPriceIds();
    if (allowed.size === 0) {
        return NextResponse.json(
            { error: "No purchasable plans are configured" },
            { status: 501 },
        );
    }
    if (typeof priceId !== "string" || !allowed.has(priceId)) {
        return NextResponse.json({ error: "Unknown plan" }, { status: 400 });
    }

    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!appUrl) {
        return NextResponse.json(
            { error: "NEXT_PUBLIC_APP_URL is not set" },
            { status: 500 },
        );
    }

    try {
        const checkoutSession = await getStripe().checkout.sessions.create({
            mode: "subscription",
            payment_method_types: ["card"],
            line_items: [{ price: priceId, quantity: 1 }],
            success_url: `${appUrl}/settings?success=true`,
            cancel_url: `${appUrl}/settings?canceled=true`,
            client_reference_id: session.user.id,
        });

        return NextResponse.json({ url: checkoutSession.url });
    } catch (e) {
        console.error("POST /api/billing/checkout", e);
        return NextResponse.json({ error: "Could not start checkout" }, { status: 502 });
    }
}
