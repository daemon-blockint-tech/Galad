import { redirect } from "next/navigation";

import { AdminShell } from "@/components/admin/AdminShell";
import { isPlatformAdmin } from "@/core/edition";
import { auth } from "@/lib/auth";

/**
 * Second gate on the admin console. `src/proxy.ts` already redirects a non-admin,
 * but middleware should not be the only thing between a visitor and this tree — a
 * matcher change, or any path that skips middleware, would otherwise expose the
 * whole console. `/admin/forbidden` lives outside this layout so it stays
 * reachable.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
    const session = await auth();
    if (!isPlatformAdmin(session)) {
        redirect("/admin/forbidden");
    }

    return <AdminShell>{children}</AdminShell>;
}
