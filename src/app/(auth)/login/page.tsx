"use client";

import { Suspense, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { isDemo } from "@/core/edition";
import { loginAction } from "@/app/login/actions";
import styles from "@/app/setup/setup.module.css";
import { AuthSplitLayout } from "@/components/auth/AuthSplitLayout";
import { getSafeRedirect } from "@/lib/navigation/safeRedirect";

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
            const target = getSafeRedirect(callbackUrl, window.location.origin);
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
