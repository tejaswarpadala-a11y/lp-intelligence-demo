"use client";

import { useRouter } from "next/navigation";

export function BackButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      onClick={() => router.back()}
      className="mb-4 block text-xs text-slate-400 hover:text-slate-700"
    >
      ← Back to results
    </button>
  );
}
