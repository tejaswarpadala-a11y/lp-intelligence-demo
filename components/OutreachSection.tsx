"use client";

import { draftOutreachEmail } from "@/app/actions/draft-email";
import { isLPInAnyShortlist } from "@/app/actions/shortlists";
import { isDemoMode } from "@/lib/config";
import { useEffect, useRef, useState } from "react";

type OutreachSectionProps = {
  lpId: string;
};

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700"
    />
  );
}

export function OutreachSection({ lpId }: OutreachSectionProps) {
  const [allowed, setAllowed] = useState<boolean>(isDemoMode);
  const [checking, setChecking] = useState<boolean>(!isDemoMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (isDemoMode) return;
    let cancelled = false;
    (async () => {
      setChecking(true);
      try {
        const ok = await isLPInAnyShortlist(lpId);
        if (!cancelled) setAllowed(ok);
      } finally {
        if (!cancelled) setChecking(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [lpId]);

  useEffect(() => {
    if (!draft) return;
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${el.scrollHeight}px`;
  }, [draft]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 2000);
    return () => window.clearTimeout(t);
  }, [copied]);

  const showButton = isDemoMode || allowed;

  async function onDraft() {
    setBusy(true);
    setError(null);
    setDraft(null);
    try {
      const res = await draftOutreachEmail(lpId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setDraft(res.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drafting failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyToClipboard() {
    if (!draft) return;
    try {
      await navigator.clipboard.writeText(draft);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  return (
    <section className="mb-12">
      <h2 className="mb-2 text-lg font-semibold text-gray-900">Outreach</h2>

      {showButton ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDraft()}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
        >
          {busy ? <Spinner /> : null}
          {busy ? "Drafting..." : "✉ Draft outreach email"}
        </button>
      ) : (
        <p className="text-sm text-gray-500">
          (Available after adding this LP to your shortlist)
        </p>
      )}

      {checking && !isDemoMode ? (
        <p className="mt-2 text-xs text-gray-500">Checking access…</p>
      ) : null}

      {error ? <p className="mt-3 text-sm text-red-600">{error}</p> : null}

      {draft ? (
        <div className="mt-4 space-y-3">
          <textarea
            ref={textareaRef}
            readOnly
            className="w-full resize-none rounded-md border border-gray-200 bg-white p-3 text-sm leading-relaxed text-gray-900"
            value={draft}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => void copyToClipboard()}
              className="rounded-md border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              {copied ? "✓ Copied" : "Copy to clipboard"}
            </button>
            <p className="text-xs text-gray-500">
              Review and edit before sending · Draft only
            </p>
          </div>
        </div>
      ) : null}
    </section>
  );
}

