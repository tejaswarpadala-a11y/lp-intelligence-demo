"use client";

import { draftOutreachEmail } from "@/app/actions/draft-email";
import { isLPInAnyShortlist } from "@/app/actions/shortlists";
import { FUND_CONFIG, isDemoMode } from "@/lib/config";
import type { Enrichment, LP, ScoreResult } from "@/lib/types";
import { useEffect, useMemo, useRef, useState } from "react";

type OutreachSectionProps = {
  lpId: string;
  lp: LP;
  enrichment: Enrichment | null;
  score: ScoreResult;
};

function Spinner() {
  return (
    <span
      aria-hidden
      className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700"
    />
  );
}

type DotTone = "green" | "amber" | "red" | "slate";

function dotClass(tone: DotTone): string {
  if (tone === "green") return "bg-green-500";
  if (tone === "amber") return "bg-amber-500";
  if (tone === "red") return "bg-red-500";
  return "bg-slate-400";
}

function terminalBaseClassName(): string {
  return "bg-slate-950 text-slate-100 rounded-sm p-5 min-h-[200px] font-mono text-sm leading-relaxed relative";
}

export function OutreachSection({
  lpId,
  enrichment,
  score,
}: OutreachSectionProps) {
  const [allowed, setAllowed] = useState<boolean>(isDemoMode);
  const [checking, setChecking] = useState<boolean>(!isDemoMode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fullDraft, setFullDraft] = useState<string | null>(null);
  const [typedDraft, setTypedDraft] = useState<string>("");
  const [isTyping, setIsTyping] = useState(false);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const typingTimerRef = useRef<number | null>(null);

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
    return () => {
      if (typingTimerRef.current) {
        window.clearInterval(typingTimerRef.current);
        typingTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!fullDraft) return;
    setEditing(false);
    setEditText(fullDraft);
    setTypedDraft("");
    setIsTyping(true);

    if (typingTimerRef.current) {
      window.clearInterval(typingTimerRef.current);
      typingTimerRef.current = null;
    }

    let i = 0;
    typingTimerRef.current = window.setInterval(() => {
      i += 1;
      setTypedDraft(fullDraft.slice(0, i));
      if (i >= fullDraft.length) {
        if (typingTimerRef.current) {
          window.clearInterval(typingTimerRef.current);
          typingTimerRef.current = null;
        }
        setIsTyping(false);
      }
    }, 18);
  }, [fullDraft]);

  useEffect(() => {
    if (!copied) return;
    const t = window.setTimeout(() => setCopied(false), 1500);
    return () => window.clearTimeout(t);
  }, [copied]);

  const showButton = isDemoMode || allowed;

  async function onDraft() {
    setBusy(true);
    setError(null);
    setFullDraft(null);
    setTypedDraft("");
    setIsTyping(false);
    try {
      const res = await draftOutreachEmail(lpId);
      if ("error" in res) {
        setError(res.error);
        return;
      }
      setFullDraft(res.draft);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Drafting failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyToClipboard() {
    if (!fullDraft) return;
    try {
      await navigator.clipboard.writeText(fullDraft);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const gmailHref = useMemo(() => {
    if (!fullDraft) return null;
    const su = `Introduction — ${FUND_CONFIG.fundName}`;
    const body = encodeURIComponent(fullDraft);
    return `https://mail.google.com/mail/?view=cm&su=${encodeURIComponent(su)}&body=${body}`;
  }, [fullDraft]);

  const reasoningBullets = useMemo(() => {
    const hc = enrichment?.healthcare_focus ?? null;
    const funds = enrichment?.invests_in_funds ?? null;
    const philos = enrichment?.investment_philosophy ?? null;

    const b1 =
      hc === "true"
        ? { tone: "green" as const, text: "Healthcare: Confirmed LP in healthcare funds" }
        : hc === "partial"
          ? { tone: "amber" as const, text: "Healthcare: Partial — mixed portfolio" }
          : { tone: "slate" as const, text: "Healthcare: Signal not confirmed" };

    const b2 =
      funds === "true"
        ? { tone: "green" as const, text: "Fund LP: Confirmed fund-of-funds investor" }
        : funds === "false"
          ? { tone: "red" as const, text: "Fund LP: Direct investing focus — lower fit" }
          : { tone: "slate" as const, text: "Fund LP: Investment structure unknown" };

    const b3 =
      philos === "value_based"
        ? { tone: "green" as const, text: "Philosophy: Value-based — strong alignment" }
        : philos === "growth_oriented"
          ? { tone: "amber" as const, text: "Philosophy: Growth-oriented — partial" }
          : philos === "unicorn_focused"
            ? { tone: "red" as const, text: "Philosophy: Unicorn focus — misaligned" }
            : { tone: "slate" as const, text: "Philosophy: Not determined" };

    const b4 = {
      tone:
        score.label === "Strong fit"
          ? ("green" as const)
          : score.label === "Moderate fit"
            ? ("amber" as const)
            : score.label === "Weak fit"
              ? ("amber" as const)
              : ("slate" as const),
      text: `Overall fit: ${score.total_score}/100 — ${score.label}`,
    };

    return [b1, b2, b3, b4];
  }, [enrichment, score]);

  const hasDraft = Boolean(fullDraft);
  const cursor = (
    <span className="animate-[blink_1s_infinite]" aria-hidden>
      |
    </span>
  );

  return (
    <section className="mb-12">
      <h2 className="mb-2 text-lg font-semibold text-gray-900">Outreach</h2>

      {showButton ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => void onDraft()}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-70"
        >
          {busy ? <Spinner /> : null}
          {busy ? "Composing..." : "✉ Draft outreach email"}
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

      {busy && !hasDraft ? (
        <div className="mt-4">
          <div className={terminalBaseClassName()}>
            <span className="text-slate-400">Composing outreach...</span> {cursor}
          </div>
        </div>
      ) : null}

      {hasDraft ? (
        <div className="mt-4">
          <div className="grid grid-cols-5 gap-0 rounded-sm border border-slate-200">
            <div className="col-span-3">
              {editing ? (
                <textarea
                  className={`${terminalBaseClassName()} w-full resize-none border-0 outline-none`}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  onBlur={() => {
                    setFullDraft(editText);
                    setTypedDraft(editText);
                    setIsTyping(false);
                    setEditing(false);
                  }}
                />
              ) : (
                <div className={terminalBaseClassName()}>
                  <span className="whitespace-pre-wrap">
                    {typedDraft}
                    {isTyping ? cursor : null}
                  </span>
                </div>
              )}
            </div>

            <aside className="col-span-2 border-l border-slate-200 bg-slate-50 p-4">
              <div className="mb-3 border-b border-slate-100 pb-2 text-xs uppercase tracking-widest text-slate-400">
                REASONING
              </div>
              <ul className="space-y-2">
                {reasoningBullets.map((b, idx) => (
                  <li
                    key={idx}
                    className="flex items-start gap-2 text-xs text-slate-600"
                  >
                    <span
                      className={`mt-1.5 h-1.5 w-1.5 flex-shrink-0 rounded-full ${dotClass(
                        b.tone,
                      )}`}
                    />
                    <span className="leading-relaxed">{b.text}</span>
                  </li>
                ))}
              </ul>
            </aside>

            <div className="col-span-5 flex h-10 items-center gap-3 border-t border-slate-200 bg-white px-4">
              <button
                type="button"
                onClick={() => {
                  if (!fullDraft) return;
                  setEditing((v) => {
                    const next = !v;
                    if (next) setEditText(fullDraft);
                    return next;
                  });
                }}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                Edit draft
              </button>
              <span className="text-slate-200">|</span>
              <button
                type="button"
                onClick={() => void copyToClipboard()}
                className="flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-900"
              >
                {copied ? "✓ Copied" : "⧉ Copy to clipboard"}
              </button>
              <span className="text-slate-200">|</span>
              {gmailHref ? (
                <a
                  href={gmailHref}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs font-medium text-slate-500 hover:text-slate-900"
                >
                  Open in Gmail
                </a>
              ) : (
                <span className="text-xs font-medium text-slate-300">
                  Open in Gmail
                </span>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}

