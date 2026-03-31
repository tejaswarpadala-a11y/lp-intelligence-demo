import { AddToShortlistDropdown } from "@/components/AddToShortlistDropdown";
import { BackButton } from "@/components/BackButton";
import { CopyButton } from "@/components/CopyButton";
import { ExportButton } from "@/components/ExportButton";
import { OutreachSection } from "@/components/OutreachSection";
import { ProfileToastButton } from "@/components/ProfileToastButton";
import {
  calculateScore,
  getScoringConfig,
  parseSupabaseLps,
} from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import type { Enrichment, LP, ScoreResult } from "@/lib/types";
import { notFound } from "next/navigation";
import { ExternalLink, Link as LinkIcon, Mail } from "lucide-react";

function externalHref(url: string | null): string | null {
  if (!url?.trim()) return null;
  const u = url.trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return `https://${u}`;
}

function formatLocation(lp: LP): string | null {
  const loc = lp.location?.trim();
  const country = lp.country?.trim();
  if (loc && country) return `${loc}, ${country}`;
  return loc || country || null;
}

function fitLabelBadgeClass(label: ScoreResult["label"]): string {
  if (label === "Strong fit")
    return "bg-emerald-50 text-emerald-700 border border-emerald-200";
  if (label === "Moderate fit")
    return "bg-amber-50 text-amber-700 border border-amber-200";
  if (label === "Weak fit")
    return "bg-slate-100 text-slate-600 border border-slate-200";
  return "bg-slate-50 text-slate-400 border border-slate-200";
}

function tagClass(base: string): string {
  return `text-[10px] uppercase tracking-widest font-medium rounded-sm px-2 py-0.5 border ${base}`;
}

function scoreBoxBg(score: ScoreResult): string {
  return score.is_scored ? "bg-slate-900 text-white" : "bg-slate-50 text-slate-300 border border-slate-200";
}

function signalScoreColor(score: number, max: number): string {
  if (max > 0 && score >= max) return "text-emerald-600";
  if (score > 0) return "text-amber-600";
  return "text-slate-400";
}

function dotClass(state: "positive" | "partial" | "negative" | "unknown"): string {
  if (state === "positive") return "bg-emerald-500";
  if (state === "partial") return "bg-amber-400";
  if (state === "negative") return "bg-red-500";
  return "bg-slate-300";
}

function sanitizeFilenameBase(name: string): string {
  const s = name.replace(/[/\\?%*:|"<>]/g, "-").trim();
  return s.length > 0 ? s : "lp";
}

function buildCsvRows(
  lp: LP,
  enrichment: Enrichment | null,
): Record<string, string>[] {
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(lp)) {
    flat[`lp_${k}`] = v == null ? "" : String(v);
  }
  if (enrichment) {
    for (const [k, v] of Object.entries(enrichment)) {
      flat[`enrichment_${k}`] = v == null ? "" : String(v);
    }
  }
  return [flat];
}

// DetailLink no longer used (command bar links handle metadata).

export default async function LPProfilePage({
  params,
}: {
  params: { id: string };
}) {
  const supabase = createClient();
  const { data: raw, error } = await supabase
    .from("lps")
    .select("*, enrichment(*)")
    .eq("id", params.id)
    .single();

  if (error) {
    if (error.code === "PGRST116") notFound();
    throw error;
  }
  if (!raw) notFound();

  const [row] = parseSupabaseLps([raw]);
  if (!row) notFound();

  const lp = row;
  const enrichment = row.enrichment;
  const config = await getScoringConfig(supabase);
  const score = calculateScore(lp, enrichment, config);

  const locationLine = formatLocation(lp);
  const website = externalHref(lp.website);
  const crunchbase = externalHref(lp.crunchbase_url);
  const dmLinkedin = externalHref(enrichment?.decision_maker_linkedin ?? null);
  const email =
    enrichment?.enriched_email?.trim() || lp.contact_email?.trim() || null;

  const csvRows = buildCsvRows(lp, enrichment);
  const fileBase = sanitizeFilenameBase(lp.name);

  const lpType = lp.lp_category?.trim() || "LP";
  const loc = locationLine ?? "—";
  const websiteLabel = website ? "Website" : null;
  const crunchbaseLabel = crunchbase ? "Crunchbase" : null;
  const yearLabel = lp.yr_founded != null ? `Est. ${lp.yr_founded}` : null;

  const tags: Array<{ key: string; label: string; cls: string }> = [];
  if (enrichment?.open_to_emerging_managers === true) {
    tags.push({
      key: "em",
      label: "EMERGING MANAGER",
      cls: "bg-emerald-50 text-emerald-700 border-emerald-200",
    });
  }
  if (enrichment?.healthcare_focus === "true") {
    tags.push({
      key: "hc",
      label: "HEALTHCARE",
      cls: "bg-blue-50 text-blue-700 border-blue-200",
    });
  } else if (enrichment?.healthcare_focus === "partial") {
    tags.push({
      key: "hcp",
      label: "HEALTHCARE PARTIAL",
      cls: "bg-amber-50 text-amber-600 border-amber-200",
    });
  }
  if (enrichment?.invests_in_funds === "true") {
    tags.push({
      key: "funds",
      label: "FUND INVESTOR",
      cls: "bg-slate-50 text-slate-600 border-slate-200",
    });
  }
  if (lp.lp_category?.trim()) {
    tags.push({
      key: "cat",
      label: lp.lp_category.toUpperCase(),
      cls: "bg-slate-50 text-slate-500 border-slate-200",
    });
  }
  if (lp.list_segment?.trim()) {
    tags.push({
      key: "seg",
      label: lp.list_segment.toUpperCase(),
      cls: "bg-slate-50 text-slate-500 border-slate-200",
    });
  }

  const evidenceRows: Array<{
    key: string;
    label: string;
    max: number;
    score: number;
    ratio: number;
  }> = [
    { key: "healthcare", label: "Healthcare focus", max: score.breakdown.healthcare.max, score: score.breakdown.healthcare.score, ratio: score.breakdown.healthcare.max ? score.breakdown.healthcare.score / score.breakdown.healthcare.max : 0 },
    { key: "funds", label: "Invests in VC funds", max: score.breakdown.invests_in_funds.max, score: score.breakdown.invests_in_funds.score, ratio: score.breakdown.invests_in_funds.max ? score.breakdown.invests_in_funds.score / score.breakdown.invests_in_funds.max : 0 },
    { key: "value", label: "Value-based orientation", max: score.breakdown.value_based.max, score: score.breakdown.value_based.score, ratio: score.breakdown.value_based.max ? score.breakdown.value_based.score / score.breakdown.value_based.max : 0 },
    { key: "check", label: "Check size match", max: score.breakdown.check_size.max, score: score.breakdown.check_size.score, ratio: score.breakdown.check_size.max ? score.breakdown.check_size.score / score.breakdown.check_size.max : 0 },
    { key: "geo", label: "Invests in US funds", max: score.breakdown.geography.max, score: score.breakdown.geography.score, ratio: score.breakdown.geography.max ? score.breakdown.geography.score / score.breakdown.geography.max : 0 },
  ];

  const confidence = enrichment?.confidence_score ?? null;

  return (
    <div className="mx-auto max-w-[860px] px-8 py-8">
      <div className="mb-4 block">
        <BackButton />
      </div>

      {/* Command bar header */}
      <div className="mb-6 border-b border-slate-100 pb-5">
        <div className="flex items-start justify-between">
          <div className="min-w-0">
            <h1 className="font-serif text-2xl font-semibold text-slate-900">
              {lp.name}
            </h1>
            <p className="mt-1 text-sm text-slate-400">
              {lpType} · {loc}
            </p>

            <div className="mt-2 flex flex-wrap gap-1.5">
              {tags.slice(0, 3).map((t) => (
                <span key={t.key} className={tagClass(t.cls)}>
                  {t.label}
                </span>
              ))}
            </div>

            <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-slate-400">
              {websiteLabel ? (
                <a
                  href={website!}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-slate-700"
                >
                  {websiteLabel} <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
              {websiteLabel && (crunchbaseLabel || yearLabel) ? (
                <span>·</span>
              ) : null}
              {crunchbaseLabel ? (
                <a
                  href={crunchbase!}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 hover:text-slate-700"
                >
                  {crunchbaseLabel} <ExternalLink className="h-3 w-3" />
                </a>
              ) : null}
              {crunchbaseLabel && yearLabel ? <span>·</span> : null}
              {yearLabel ? <span>{yearLabel}</span> : null}
            </div>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-2">
            <div
              className={`flex h-[80px] w-[80px] flex-col items-center justify-center ${scoreBoxBg(
                score,
              )}`}
            >
              <div className="font-mono text-4xl font-medium leading-none">
                {score.is_scored ? score.total_score : "—"}
              </div>
              <div className="mt-1 text-[9px] uppercase tracking-[0.15em] text-slate-400">
                FIT SCORE
              </div>
            </div>
            <span className={`rounded-sm px-2 py-0.5 text-xs font-medium ${fitLabelBadgeClass(score.label)}`}>
              {score.is_scored ? score.label : "Not scored"}
            </span>
          </div>
        </div>
      </div>

      {/* Bento grid */}
      <div className="mb-6 grid grid-cols-3 gap-px bg-slate-100">
        {/* Tile 1 — Evidence */}
        <div className="bg-white p-5">
          <div className="mb-4 text-[10px] uppercase tracking-widest text-slate-400">
            EVIDENCE
          </div>

          {!score.is_scored ? (
            <p className="text-xs text-slate-400 italic">
              Not yet scored — enrichment data needed to calculate fit
            </p>
          ) : (
            <div>
              <div className="grid grid-cols-[1fr_auto_auto_auto] gap-x-3 text-[10px] uppercase tracking-widest text-slate-400">
                <div>Signal</div>
                <div className="text-right">Weight</div>
                <div className="text-right">Score</div>
                <div className="text-right"> </div>
              </div>
              <div className="mt-2">
                {evidenceRows.map((r) => (
                  <div
                    key={r.key}
                    className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3 border-b border-slate-50 py-2 last:border-b-0"
                  >
                    <div className="font-serif text-sm text-slate-600">
                      {r.label}
                    </div>
                    <div className="text-right text-xs font-mono text-slate-400">
                      {r.max}
                    </div>
                    <div
                      className={`text-right text-sm font-mono font-medium ${signalScoreColor(
                        r.score,
                        r.max,
                      )}`}
                    >
                      {Math.round(r.score)}
                    </div>
                    <div className="flex justify-end">
                      <div className="h-[2px] w-[40px] bg-slate-100">
                        <div
                          className="h-[2px] bg-emerald-400"
                          style={{
                            width: `${Math.max(
                              0,
                              Math.min(100, Math.round(r.ratio * 100)),
                            )}%`,
                          }}
                        />
                      </div>
                    </div>
                  </div>
                ))}

                <div className="mt-1 border-t border-slate-200 pt-2 font-medium">
                  <div className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-x-3">
                    <div className="text-sm text-slate-600">Total</div>
                    <div className="text-right text-xs font-mono text-slate-400">
                      100
                    </div>
                    <div className="text-right text-sm font-mono font-medium text-slate-900">
                      {score.total_score}
                    </div>
                    <div />
                  </div>
                </div>
              </div>

              <div
                className={`mt-3 text-[10px] font-mono text-slate-400 ${
                  confidence != null && confidence < 60 ? "text-amber-500" : ""
                }`}
              >
                CONFIDENCE: {confidence ?? 0}%
              </div>
            </div>
          )}
        </div>

        {/* Tile 2 — Intelligence */}
        <div className="bg-emerald-50 p-5">
          <div className="mb-3 text-[10px] uppercase tracking-widest text-emerald-600">
            AI ANALYSIS
          </div>
          {enrichment?.thesis_notes?.trim() ? (
            <p className="font-serif text-sm italic leading-relaxed text-slate-700">
              {enrichment.thesis_notes}
            </p>
          ) : (
            <p className="text-xs italic text-slate-400">
              Run enrichment to generate analysis
            </p>
          )}

          <div className="mt-4 space-y-2">
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span
                className={`h-1.5 w-1.5 rounded-full ${dotClass(
                  enrichment?.healthcare_focus === "true"
                    ? "positive"
                    : enrichment?.healthcare_focus === "partial"
                      ? "partial"
                      : enrichment?.healthcare_focus === "false"
                        ? "negative"
                        : "unknown",
                )}`}
              />
              <span>Healthcare</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span
                className={`h-1.5 w-1.5 rounded-full ${dotClass(
                  enrichment?.invests_in_funds === "true"
                    ? "positive"
                    : enrichment?.invests_in_funds === "false"
                      ? "negative"
                      : "unknown",
                )}`}
              />
              <span>Invests in funds</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-600">
              <span
                className={`h-1.5 w-1.5 rounded-full ${dotClass(
                  enrichment?.investment_philosophy === "value_based"
                    ? "positive"
                    : enrichment?.investment_philosophy === "growth_oriented"
                      ? "partial"
                      : enrichment?.investment_philosophy === "unicorn_focused"
                        ? "negative"
                        : "unknown",
                )}`}
              />
              <span>Philosophy</span>
            </div>
          </div>
        </div>

        {/* Tile 3 — Network */}
        <div className="bg-white p-5">
          <div className="mb-4 text-[10px] uppercase tracking-widest text-slate-400">
            NETWORK
          </div>

          <div>
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-serif text-sm text-slate-900">
                  {enrichment?.decision_maker_name?.trim() || "Not found"}
                </div>
                <div className="text-xs text-slate-400">
                  {lp.lp_category?.trim() || "—"}
                </div>
                {email ? (
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-xs font-mono text-slate-500">
                    <span className="break-all">{email}</span>
                    <CopyButton text={email} />
                  </div>
                ) : (
                  <div className="mt-1 text-xs font-mono text-slate-400">—</div>
                )}
              </div>

              <div className="flex shrink-0 items-center gap-2">
                {dmLinkedin ? (
                  <a
                    href={dmLinkedin}
                    target="_blank"
                    rel="noreferrer"
                    title="LinkedIn"
                    className="text-slate-400 hover:text-blue-600"
                  >
                    <LinkIcon className="h-4 w-4" />
                  </a>
                ) : (
                  <span
                    title="LinkedIn not found"
                    className="text-slate-200"
                  >
                    <LinkIcon className="h-4 w-4" />
                  </span>
                )}

                {email ? (
                  <a
                    href={`mailto:${email}`}
                    title={email}
                    className="text-slate-400 hover:text-emerald-600"
                  >
                    <Mail className="h-4 w-4" />
                  </a>
                ) : (
                  <span title="Email not found" className="text-slate-200">
                    <Mail className="h-4 w-4" />
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3 text-[10px] uppercase tracking-widest">
              {enrichment?.open_to_emerging_managers === true ? (
                <span className="text-emerald-600">
                  ✓ EMERGING MANAGER FRIENDLY
                </span>
              ) : enrichment?.open_to_emerging_managers === false ? (
                <span className="text-red-600">✗ REQUIRES TRACK RECORD</span>
              ) : (
                <span className="text-slate-400">—</span>
              )}
            </div>

            <div className="mt-4">
              <ProfileToastButton
                label="↻ Re-enrich"
                toastMessage="Re-enrichment queued — demo mode, no API call will run"
                className="rounded-sm border border-slate-200 px-2 py-1 text-xs text-slate-400 hover:text-slate-600"
              />
            </div>
          </div>
        </div>
      </div>

      {/* Tags row */}
      <div className="mb-6 flex flex-wrap gap-1.5">
        {tags.map((t) => (
          <span key={t.key} className={tagClass(t.cls)}>
            {t.label}
          </span>
        ))}
      </div>

      {/* Summary */}
      <section className="mb-6">
        <div className="rounded-sm border border-slate-100 bg-slate-50/50 p-4 font-serif text-sm italic leading-relaxed text-slate-600">
          {lp.summary?.trim() ? lp.summary : "—"}
        </div>
      </section>

      <OutreachSection
        lpId={lp.id}
        lp={lp}
        enrichment={enrichment}
        score={score}
      />

      {/* Section 6 — Actions */}
      <section className="flex flex-wrap gap-3">
        <AddToShortlistDropdown
          items={[
            {
              lpId: lp.id,
              fitScore: Math.round(score.total_score),
              lpName: lp.name,
            },
          ]}
          buttonLabel="Add to Shortlist"
          className="rounded-sm border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50 disabled:opacity-50"
        />
        <ExportButton
          rows={csvRows}
          filenameBase={fileBase}
          className="rounded-sm border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600 hover:bg-slate-50"
        />
      </section>
    </div>
  );
}
