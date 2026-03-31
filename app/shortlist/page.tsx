"use client";

import {
  createShortlist,
  getShortlistWithLPs,
  getUserShortlists,
  removeLPFromShortlist,
  renameShortlist,
} from "@/app/actions/shortlists";
import type { ShortlistWithLPs, UserShortlistSummary } from "@/lib/shortlist";
import { CopyButton } from "@/components/CopyButton";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

function formatCheckSize(
  mn: number | null | undefined,
  mx: number | null | undefined,
): string {
  if (mn == null && mx == null) return "Unknown";
  if (mn != null && mx != null) return `$${fmtMoney(mn)} – $${fmtMoney(mx)}`;
  if (mn != null) return `$${fmtMoney(mn)}+`;
  return `≤$${fmtMoney(mx!)}`;
}

function externalHref(url: string | null | undefined): string | null {
  if (!url?.trim()) return null;
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `https://${u}`;
}

function formatAddedDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function snapshotBadgeClasses(score: number): string {
  if (score >= 80) return "bg-green-100 text-green-800";
  if (score >= 60) return "bg-blue-100 text-blue-800";
  if (score >= 40) return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-600";
}

function snapshotLabel(score: number): string {
  if (score >= 80) return "Strong fit";
  if (score >= 60) return "Moderate fit";
  if (score >= 40) return "Weak fit";
  return "Poor fit";
}

function snapshotBadge(score: number): string {
  return `${score} · ${snapshotLabel(score)}`;
}

function sanitizeFilePart(s: string): string {
  return s.replace(/[/\\?%*:|"<>]/g, "-").trim() || "shortlist";
}

export default function ShortlistPage() {
  const [summary, setSummary] = useState<UserShortlistSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ShortlistWithLPs | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [editingName, setEditingName] = useState(false);
  const [nameDraft, setNameDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copyEmailsMsg, setCopyEmailsMsg] = useState<string | null>(null);

  const refreshSummary = useCallback(async () => {
    setLoadingList(true);
    setError(null);
    try {
      const rows = await getUserShortlists();
      setSummary(rows);
      setSelectedId((prev) => {
        if (prev && rows.some((r) => r.id === prev)) return prev;
        return rows[0]?.id ?? null;
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load shortlists");
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    void refreshSummary();
  }, [refreshSummary]);

  useEffect(() => {
    if (!detail || editingName) return;
    setNameDraft(detail.shortlist.name);
  }, [detail, editingName]);

  useEffect(() => {
    if (!selectedId) {
      setDetail(null);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoadingDetail(true);
      setError(null);
      try {
        const data = await getShortlistWithLPs(selectedId);
        if (!cancelled) setDetail(data);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load shortlist");
        }
      } finally {
        if (!cancelled) setLoadingDetail(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  useEffect(() => {
    if (!copyEmailsMsg) return;
    const t = window.setTimeout(() => setCopyEmailsMsg(null), 2000);
    return () => window.clearTimeout(t);
  }, [copyEmailsMsg]);

  const stats = useMemo(() => {
    const rows = detail?.lps ?? [];
    const n = rows.length;
    if (n === 0) return { n: 0, avg: 0 };
    const sum = rows.reduce((s, r) => s + r.fit_score, 0);
    return { n, avg: Math.round((sum / n) * 10) / 10 };
  }, [detail]);

  async function onRenameCommit() {
    if (!selectedId || !detail) return;
    const next = nameDraft.trim();
    if (!next || next === detail.shortlist.name) {
      setEditingName(false);
      setNameDraft(detail.shortlist.name);
      return;
    }
    try {
      await renameShortlist(selectedId, next);
      setDetail((d) =>
        d ? { ...d, shortlist: { ...d.shortlist, name: next } } : d,
      );
      await refreshSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Rename failed");
    } finally {
      setEditingName(false);
    }
  }

  async function onNewShortlist() {
    const when = new Date().toLocaleDateString(undefined, {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
    const title = `New Shortlist ${when}`;
    try {
      const { id } = await createShortlist(title);
      await refreshSummary();
      setSelectedId(id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not create");
    }
  }

  async function onRemove(lpId: string) {
    if (!selectedId) return;
    try {
      await removeLPFromShortlist(selectedId, lpId);
      setDetail((d) =>
        d ? { ...d, lps: d.lps.filter((r) => r.lp.id !== lpId) } : d,
      );
      await refreshSummary();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Remove failed");
    }
  }

  function exportCsv() {
    if (!detail || detail.lps.length === 0) return;
    const headers = [
      "LP Name",
      "Category",
      "Location",
      "Country",
      "Fit Score",
      "Check Size Min",
      "Check Size Max",
      "Decision Maker",
      "Email",
      "LinkedIn",
      "Healthcare Focus",
      "Invests in Funds",
      "Philosophy",
      "Added Date",
    ];
    const esc = (s: string) => `"${String(s).replace(/"/g, '""')}"`;
    const rows = detail.lps.map((r) => {
      const { lp, enrichment, fit_score, added_at } = r;
      const email =
        enrichment?.enriched_email?.trim() || lp.contact_email?.trim() || "";
      const dmLi = enrichment?.decision_maker_linkedin ?? "";
      return [
        lp.name,
        lp.lp_category ?? "",
        lp.location ?? "",
        lp.country ?? "",
        String(fit_score),
        enrichment?.check_size_min != null
          ? String(enrichment.check_size_min)
          : "",
        enrichment?.check_size_max != null
          ? String(enrichment.check_size_max)
          : "",
        enrichment?.decision_maker_name ?? "",
        email,
        dmLi,
        enrichment?.healthcare_focus ?? "",
        enrichment?.invests_in_funds ?? "",
        enrichment?.investment_philosophy ?? "",
        formatAddedDate(added_at),
      ].map((c) => esc(c));
    });
    const namePart = sanitizeFilePart(detail.shortlist.name);
    const datePart = new Date().toISOString().slice(0, 10);
    const csv = [headers.map(esc).join(","), ...rows.map((r) => r.join(","))].join(
      "\n",
    );
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `shortlist-${namePart}-${datePart}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function copyAllEmails() {
    if (!detail) return;
    const emails = detail.lps
      .map(
        (r) =>
          r.enrichment?.enriched_email?.trim() || r.lp.contact_email?.trim(),
      )
      .filter((e): e is string => Boolean(e));
    if (emails.length === 0) {
      setCopyEmailsMsg("✓ 0 emails copied");
      return;
    }
    try {
      await navigator.clipboard.writeText(emails.join(", "));
      setCopyEmailsMsg(`✓ ${emails.length} emails copied`);
    } catch {
      setCopyEmailsMsg("✓ 0 emails copied");
    }
  }

  const selectedSummary = summary.find((s) => s.id === selectedId);

  return (
    <div className="mx-auto max-w-6xl px-8 py-8 text-gray-900">
      <div className="mb-8 flex flex-wrap items-center gap-4">
        <Link href="/" className="text-sm text-blue-600 hover:underline">
          ← Filter &amp; Search
        </Link>
      </div>

      <h1 className="sr-only">Shortlists</h1>

      {error ? (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-800">
          {error}
        </p>
      ) : null}

      {loadingList ? (
        <p className="text-sm text-gray-500">Loading shortlists…</p>
      ) : summary.length === 0 ? (
        <div className="rounded-lg border border-gray-200 bg-gray-50 p-8 text-center">
          <p className="text-gray-800">
            No shortlists yet. Add LPs from Filter &amp; Search.
          </p>
          <Link
            href="/"
            className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Go to Filter &amp; Search
          </Link>
        </div>
      ) : (
        <>
          <div className="mb-6 flex flex-col gap-4 border-b border-gray-200 pb-6 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              {editingName && detail ? (
                <input
                  autoFocus
                  className="w-full max-w-md rounded border border-gray-300 px-2 py-1 text-2xl font-bold"
                  value={nameDraft}
                  onChange={(e) => setNameDraft(e.target.value)}
                  onBlur={() => void onRenameCommit()}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onRenameCommit();
                    if (e.key === "Escape") {
                      setEditingName(false);
                      setNameDraft(detail.shortlist.name);
                    }
                  }}
                />
              ) : (
                <button
                  type="button"
                  className="text-left text-2xl font-bold text-gray-900 hover:text-blue-700"
                  onClick={() => {
                    if (detail) {
                      setNameDraft(detail.shortlist.name);
                      setEditingName(true);
                    }
                  }}
                >
                  {detail?.shortlist.name ?? selectedSummary?.name ?? "Shortlist"}
                </button>
              )}
              <p className="mt-2 text-sm text-gray-600">
                {stats.n} LPs · Avg score: {stats.n ? stats.avg : "—"}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <label htmlFor="sl-pick" className="sr-only">
                Shortlist
              </label>
              <select
                id="sl-pick"
                value={selectedId ?? ""}
                onChange={(e) => setSelectedId(e.target.value || null)}
                className="rounded-md border border-gray-300 bg-white px-2 py-2 text-sm"
              >
                {summary.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.lp_count})
                  </option>
                ))}
              </select>
              <button
                type="button"
                onClick={() => void onNewShortlist()}
                className="rounded-md border border-blue-600 bg-white px-3 py-2 text-sm font-medium text-blue-700 hover:bg-blue-50"
              >
                + New shortlist
              </button>
            </div>
          </div>

          {loadingDetail ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : !detail || detail.lps.length === 0 ? (
            <div className="rounded-lg border border-dashed border-gray-300 bg-white p-12 text-center">
              <p className="text-gray-800">This shortlist is empty.</p>
              <Link
                href="/"
                className="mt-4 inline-block rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Go to Filter &amp; Search
              </Link>
            </div>
          ) : (
            <>
              <div className="overflow-x-auto rounded-lg border border-gray-200">
                <table className="min-w-[1100px] w-full divide-y divide-gray-100 text-left text-sm">
                  <thead className="bg-gray-50 text-xs uppercase tracking-wide text-gray-500">
                    <tr>
                      <th className="px-3 py-2">LP Name</th>
                      <th className="px-3 py-2">Category</th>
                      <th className="px-3 py-2">Location</th>
                      <th className="px-3 py-2">Fit Score</th>
                      <th className="px-3 py-2">Check Size</th>
                      <th className="px-3 py-2">Decision Maker</th>
                      <th className="px-3 py-2">Email</th>
                      <th className="px-3 py-2">LinkedIn</th>
                      <th className="px-3 py-2">Added</th>
                      <th className="px-3 py-2 w-10" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100 bg-white">
                    {detail.lps.map((r) => {
                      const { lp, enrichment, fit_score, added_at } = r;
                      const email =
                        enrichment?.enriched_email?.trim() ||
                        lp.contact_email?.trim() ||
                        null;
                      const dmLi = externalHref(
                        enrichment?.decision_maker_linkedin ?? null,
                      );
                      return (
                        <tr key={lp.id} className="hover:bg-gray-50">
                          <td className="px-3 py-2 font-semibold">
                            <Link
                              href={`/lp/${lp.id}`}
                              className="text-blue-700 hover:underline"
                            >
                              {lp.name}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            {lp.lp_category ? (
                              <span className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-700">
                                {lp.lp_category}
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600">
                            {lp.location ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            <span
                              className={`inline-flex rounded px-2 py-0.5 text-xs font-medium ${snapshotBadgeClasses(
                                fit_score,
                              )}`}
                            >
                              {snapshotBadge(fit_score)}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {formatCheckSize(
                              enrichment?.check_size_min,
                              enrichment?.check_size_max,
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-700">
                            {enrichment?.decision_maker_name?.trim() ?? "—"}
                          </td>
                          <td className="px-3 py-2">
                            {email ? (
                              <span className="inline-flex items-center gap-1 break-all">
                                {email}
                                <CopyButton text={email} />
                              </span>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2">
                            {dmLi ? (
                              <a
                                href={dmLi}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="inline-flex text-blue-600 hover:underline"
                                title="LinkedIn"
                              >
                                <span aria-hidden>🔗</span>
                                <span className="sr-only">LinkedIn</span>
                              </a>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td className="px-3 py-2 text-gray-600 whitespace-nowrap">
                            {formatAddedDate(added_at)}
                          </td>
                          <td className="px-3 py-2">
                            <button
                              type="button"
                              className="text-lg font-bold text-red-600 hover:text-red-800"
                              title="Remove from shortlist"
                              onClick={() => void onRemove(lp.id)}
                            >
                              ×
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div className="mt-6 flex flex-wrap items-center gap-3">
                <button
                  type="button"
                  onClick={exportCsv}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  ↓ Export as CSV
                </button>
                <button
                  type="button"
                  onClick={() => void copyAllEmails()}
                  className="rounded-md border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
                >
                  ⧉ Copy all emails
                </button>
                {copyEmailsMsg ? (
                  <span className="text-sm text-green-700">{copyEmailsMsg}</span>
                ) : null}
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}
