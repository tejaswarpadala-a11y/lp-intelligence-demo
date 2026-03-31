"use client";

import { useEffect, useState } from "react";

type ProfileToastButtonProps = {
  label: string;
  toastMessage: string;
  className?: string;
};

export function ProfileToastButton({
  label,
  toastMessage,
  className,
}: ProfileToastButtonProps) {
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  return (
    <>
      {toast ? (
        <div
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}
      <button
        type="button"
        onClick={() => setToast(toastMessage)}
        className={
          className ??
          "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-slate-50"
        }
      >
        {label}
      </button>
    </>
  );
}
