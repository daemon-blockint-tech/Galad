"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isDemo } from "@/core/edition";
import { loginAction } from "@/app/login/actions";
import styles from "@/app/setup/setup.module.css";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";

/**
 * Where to land after a successful login.
 *
 * Resolved against the current origin rather than string-matched: "//evil.com/x"
 * starts with "/" but is not a path, and would have been an open redirect.
 *
 * API routes are refused outright. `/api/marketplace/install-redirect` writes a
 * plugin manifest on a GET and trusts a same-origin navigation, so letting
 * callbackUrl aim there turned this page into the delivery vehicle for it: send
 * a logged-out admin here with a crafted callbackUrl and their own login
 * performs the install. A logged-out install therefore lands on /ops and has to
 * be started again from the marketplace, now signed in.
 */
function getSafeRedirect(url: string | null): string {
    if (!url) return "/ops";
    try {
        const resolved = new URL(url, window.location.origin);
        if (resolved.origin !== window.location.origin) return "/ops";
        if (resolved.pathname.startsWith("/api")) return "/ops";

        const path = `${resolved.pathname}${resolved.search}${resolved.hash}`;
        // Resolving is not enough on its own: "/..//evil.com/x" pops the ".."
        // after the host is parsed, so it resolves same-origin with a pathname of
        // "//evil.com/x" — and router.push re-parses that string, where a leading
        // "//" is once again an authority. The value has to survive the same test
        // it was resolved under.
        if (path.startsWith("//")) return "/ops";
        return path;
    } catch {
        return "/ops";
    }
}

function LoginForm() {
    const router = useRouter();
    const searchParams = useSearchParams();
    const callbackUrl = searchParams.get("callbackUrl");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
        e.preventDefault();
        setError("");
        setLoading(true);

        const formData = new FormData(e.currentTarget);
        const result = await loginAction(formData);

        if (result.success) {
            const target = getSafeRedirect(callbackUrl);
            router.push(target);
            router.refresh();
        } else {
            setError(result.error ?? "Login failed.");
            setLoading(false);
        }
    }

    return (
      <AuthSplitLayout>
        <div className={styles.card}>
          <div className={styles.logo}>G</div>
          <h1 className={styles.title}>Sign in to Grond</h1>
          <p className={styles.subtitle}>Enter your credentials to open Operations</p>

          <form onSubmit={handleSubmit} method="post" className={styles.form}>
            <label className={styles.label} htmlFor="email">
              {isDemo ? "Username" : "Email"}
              <input
                id="email"
                name="email"
                type={isDemo ? "text" : "email"}
                required
                className={styles.input}
                placeholder={isDemo ? "admin" : "admin@example.com"}
              />
            </label>

            <label className={styles.label} htmlFor="password">
              Password
              <input
                id="password"
                name="password"
                type="password"
                required
                className={styles.input}
              />
            </label>

            {error && <p className={styles.error}>{error}</p>}

            <button type="submit" className={styles.button} disabled={loading}>
              {loading ? "Signing in…" : "Sign in"}
            </button>
          </form>
        </div>
      </AuthSplitLayout>
    );
}

export default function LoginPage() {
    return (
      <Suspense fallback={<div className={styles.container}>Loading…</div>}>
        <LoginForm />
      </Suspense>
    );
}
