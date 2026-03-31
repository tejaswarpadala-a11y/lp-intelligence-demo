"use client";

import { FUND_CONFIG, isDemoMode } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import { useState } from "react";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const redirectTo = `${process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") || (typeof window !== "undefined" ? window.location.origin : "")}/auth/callback`;

  async function signInWithGoogle() {
    setBusy(true);
    setError(null);
    try {
      const supabase = createClient();
      const { error: e } = await supabase.auth.signInWithOAuth({
        provider: "google",
        options: { redirectTo },
      });
      if (e) setError(e.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] flex-col items-center justify-center px-6 py-12">
      <div className="w-full max-w-sm text-center">
        <h1 className="text-3xl font-bold tracking-tight text-gray-900">
          {FUND_CONFIG.fundName}
        </h1>
        <p className="mt-2 text-sm text-gray-600">LP Intelligence Platform</p>

        {isDemoMode ? (
          <div
            role="note"
            className="mt-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-950"
          >
            Demo mode — sign in with any Google account to explore the
            platform
          </div>
        ) : null}

        {error ? (
          <p className="mt-4 text-sm text-red-600">{error}</p>
        ) : null}

        <button
          type="button"
          disabled={busy}
          onClick={() => void signInWithGoogle()}
          className="mt-8 w-full rounded-lg border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-800 shadow-sm hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? "Redirecting…" : "Sign in with Google"}
        </button>
      </div>
    </div>
  );
}
