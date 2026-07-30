import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";
import { isCloud } from "@/core/edition";
import { isInternalRequest } from "@/lib/security/internalRequest";

export async function GET(
    request: Request,
    { params }: { params: Promise<{ subdomain: string }> }
) {
    // Middleware-only: the response reveals whether a workspace exists and which
    // plan it is on, which would otherwise be anonymously enumerable.
    if (!isInternalRequest(request)) {
        return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    if (!isCloud) {
        return NextResponse.json({ status: "active", plan: "basic" });
    }

    // Await params as required in Next.js 15+
    const resolvedParams = await params;
    const {subdomain} = resolvedParams;

    try {
        const workspace = await prisma.workspace.findUnique({
            where: { subdomain },
            select: { status: true, plan: true }
        });

        if (!workspace) {
            return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
        }

        return NextResponse.json(workspace);
    } catch (e) {
        console.error("Failed to lookup workspace", e);
        return NextResponse.json({ error: "Internal server error" }, { status: 500 });
    }
}
