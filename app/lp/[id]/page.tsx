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
import type { Enrichment, LP, ScoreBreakdownSignal, ScoreResult } from "@/lib/types";
import { notFound } from "next/navigation";

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

function fmtMoney(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
  return `${n}`;
}

function formatCheckSizeRange(e: Enrichment | null): string {
  if (!e) return "Unknown";
  const mn = e.check_size_min;
  const mx = e.check_size_max;
  if (mn == null && mx == null) return "Unknown";
  if (mn != null && mx != null) return `$${fmtMoney(mn)} – $${fmtMoney(mx)}`;
  if (mn != null) return `$${fmtMoney(mn)}+`;
  return `≤$${fmtMoney(mx!)}`;
}

function reasonTone(
  signal: ScoreBreakdownSignal,
): "positive" | "negative" | "neutral" {
  if (signal.max > 0 && signal.score <= 0) return "negative";
  if (signal.max > 0 && signal.score >= signal.max) return "positive";
  return "neutral";
}

function reasonClass(signal: ScoreBreakdownSignal): string {
  const t = reasonTone(signal);
  if (t === "positive") return "text-green-700";
  if (t === "negative") return "text-red-600";
  return "text-gray-500";
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

function totalStatusClass(label: ScoreResult["label"]): string {
  if (label === "Strong fit") return "text-green-700";
  if (label === "Moderate fit") return "text-amber-700";
  if (label === "Weak fit") return "text-amber-700";
  return "text-gray-600";
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

function DetailLink({
  label,
  href,
}: {
  label: string;
  href: string | null;
}) {
  if (!href) {
    return (
      <div>
        <p className="text-xs font-medium text-gray-500">{label}</p>
        <p className="text-sm text-gray-400">—</p>
      </div>
    );
  }
  return (
    <div>
      <p className="text-xs font-medium text-gray-500">{label}</p>
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className="text-sm text-slate-600 hover:underline"
      >
        Open ↗
      </a>
    </div>
  );
}

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
  const linkedin = externalHref(lp.linkedin_url);
  const dmLinkedin = externalHref(enrichment?.decision_maker_linkedin ?? null);
  const email =
    enrichment?.enriched_email?.trim() || lp.contact_email?.trim() || null;

  const csvRows = buildCsvRows(lp, enrichment);
  const fileBase = sanitizeFilenameBase(lp.name);

  return (
    <div className="mx-auto max-w-[860px] px-8 py-8">
      <div className="mb-8">
        <BackButton />
      </div>

      {/* Section 1 — Overview */}
      <section className="mb-12">
        <h1 className="font-serif text-3xl font-bold tracking-tight text-gray-900">
          {lp.name}
        </h1>
        <div className="mt-3 flex flex-wrap gap-2">
          {lp.lp_category ? (
            <span className="rounded-sm border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm text-slate-600">
              {lp.lp_category}
            </span>
          ) : null}
          {lp.list_segment ? (
            <span className="rounded-sm border border-slate-200 bg-slate-50 px-2.5 py-1 text-sm text-slate-600">
              {lp.list_segment}
            </span>
          ) : null}
        </div>
        {locationLine ? (
          <p className="mt-2 text-sm text-gray-500">{locationLine}</p>
        ) : null}

        <div className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <DetailLink label="Website" href={website} />
          <DetailLink label="Crunchbase" href={crunchbase} />
          <DetailLink label="LinkedIn" href={linkedin} />
          <div>
            <p className="text-xs font-medium text-gray-500">Size</p>
            <p className="text-sm text-gray-900">
              {lp.size?.trim() ? lp.size : "—"}
            </p>
          </div>
          {lp.yr_founded != null ? (
            <div>
              <p className="text-xs font-medium text-gray-500">Year founded</p>
              <p className="text-sm text-gray-900">Est. {lp.yr_founded}</p>
            </div>
          ) : null}
        </div>

        {lp.summary?.trim() ? (
          <div className="mt-6 rounded-sm bg-slate-50 p-4 text-sm leading-relaxed text-slate-700">
            {lp.summary}
          </div>
        ) : null}
      </section>

      {/* Section 2 — Fit score */}
      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Fit score breakdown
        </h2>
        {!score.is_scored ? (
          <div className="rounded-sm bg-slate-50 px-4 py-6 text-sm text-slate-700">
            Not yet scored — enrichment data needed to calculate fit
          </div>
        ) : (
          <>
            <div className="mb-6 flex flex-wrap items-baseline gap-3">
              <span className="font-mono text-5xl font-bold text-gray-900">
                {score.total_score}
              </span>
              <span
                className={`rounded-sm px-2.5 py-1 text-sm font-medium ${fitLabelBadgeClass(
                  score.label,
                )}`}
              >
                {score.label}
              </span>
            </div>

            <div className="overflow-x-auto rounded-sm border border-slate-200">
              <table className="min-w-full text-left text-sm">
                <thead className="border-b border-slate-200 bg-slate-50">
                  <tr>
                    <th className="px-4 py-2 font-medium text-gray-700">
                      Signal
                    </th>
                    <th className="px-4 py-2 font-medium text-gray-700">
                      Score
                    </th>
                    <th className="px-4 py-2 font-medium text-gray-700">
                      Out of
                    </th>
                    <th className="px-4 py-2 font-medium text-gray-700">
                      Status
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(
                    [
                      ["Healthcare focus", score.breakdown.healthcare],
                      ["Invests in VC funds", score.breakdown.invests_in_funds],
                      [
                        "Value-based orient.",
                        score.breakdown.value_based,
                      ],
                      ["Check size match", score.breakdown.check_size],
                      [
                        "Invests in US funds",
                        score.breakdown.geography,
                      ],
                    ] as const
                  ).map(([label, signal]) => (
                    <tr key={label}>
                      <td className="px-4 py-2 text-gray-900">{label}</td>
                      <td className="px-4 py-2 font-mono text-gray-900">
                        {Math.round(signal.score)}
                      </td>
                      <td className="px-4 py-2 font-mono text-gray-600">
                        {signal.max}
                      </td>
                      <td className={`px-4 py-2 ${reasonClass(signal)}`}>
                        {signal.reason}
                      </td>
                    </tr>
                  ))}
                  <tr className="bg-slate-50 font-medium">
                    <td className="px-4 py-2 text-gray-900">TOTAL</td>
                    <td className="px-4 py-2 font-mono text-gray-900">
                      {score.total_score}
                    </td>
                    <td className="px-4 py-2 font-mono text-gray-600">
                      100
                    </td>
                    <td
                      className={`px-4 py-2 ${totalStatusClass(score.label)}`}
                    >
                      {score.label}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>

            {enrichment &&
            enrichment.confidence_score != null &&
            enrichment.confidence_score > 0 ? (
              <div className="mt-4 space-y-2 text-sm text-gray-600">
                <p>
                  Data confidence: {enrichment.confidence_score}% · AI enriched
                </p>
                {enrichment.confidence_score < 60 ? (
                  <p className="rounded-sm bg-amber-50 px-3 py-2 text-amber-900">
                    Low confidence — verify manually
                  </p>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </section>

      {/* Section 3 — Decision maker */}
      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Decision Maker
        </h2>
        {enrichment?.confidence_score != null && enrichment.confidence_score < 60 ? (
          <p className="mb-4 rounded-sm bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Low confidence — verify manually
          </p>
        ) : null}
        <dl className="space-y-3 text-sm">
          <div>
            <dt className="text-xs font-medium text-gray-500">Name</dt>
            <dd className="text-gray-900">
              {enrichment?.decision_maker_name?.trim() || "Not found"}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">LinkedIn</dt>
            <dd className="text-gray-900">
              {dmLinkedin ? (
                <a
                  href={dmLinkedin}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-slate-600 hover:underline"
                >
                  Profile ↗
                </a>
              ) : (
                "Not found"
              )}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-gray-500">Email</dt>
            <dd className="flex flex-wrap items-center text-gray-900">
              {email ? (
                <>
                  {email}
                  <CopyButton text={email} />
                </>
              ) : (
                "Not found"
              )}
            </dd>
          </div>
        </dl>

        <div className="mt-4 text-sm">
          <p className="text-xs font-medium text-gray-500">
            Emerging manager
          </p>
          {enrichment?.open_to_emerging_managers === true ? (
            <p className="mt-1 text-green-700">✓ Emerging manager friendly</p>
          ) : enrichment?.open_to_emerging_managers === false ? (
            <p className="mt-1 text-red-600">
              ✗ Does not back emerging managers
            </p>
          ) : (
            <p className="mt-1 text-gray-500">Unknown</p>
          )}
        </div>

        <div className="mt-4">
          <ProfileToastButton
            label="↻ Re-enrich this record"
            toastMessage="Re-enrichment queued — demo mode, no API call will run"
            className="rounded-sm border border-slate-300 bg-slate-50 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-100"
          />
        </div>
      </section>

      {/* Section 4 — Investment profile */}
      <section className="mb-12">
        <h2 className="mb-4 text-lg font-semibold text-gray-900">
          Investment Profile
        </h2>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="rounded-sm border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">
              Healthcare Focus
            </p>
            {enrichment?.healthcare_focus === "true" ? (
              <p className="mt-2 font-medium text-green-700">Confirmed ✓</p>
            ) : enrichment?.healthcare_focus === "partial" ? (
              <p className="mt-2 font-medium text-amber-700">Partial</p>
            ) : enrichment?.healthcare_focus === "false" ? (
              <p className="mt-2 font-medium text-red-600">No</p>
            ) : (
              <p className="mt-2 font-medium text-gray-500">Unknown</p>
            )}
          </div>
          <div className="rounded-sm border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">
              Invests in Funds
            </p>
            {enrichment?.invests_in_funds === "true" ? (
              <p className="mt-2 font-medium text-green-700">Yes ✓</p>
            ) : enrichment?.invests_in_funds === "false" ? (
              <p className="mt-2 font-medium text-red-600">Direct only</p>
            ) : (
              <p className="mt-2 font-medium text-gray-500">Unknown</p>
            )}
          </div>
          <div className="rounded-sm border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">
              Investment Philosophy
            </p>
            {enrichment?.investment_philosophy === "value_based" ? (
              <p className="mt-2 font-medium text-green-700">Value-based ✓</p>
            ) : enrichment?.investment_philosophy === "growth_oriented" ? (
              <p className="mt-2 font-medium text-amber-700">Growth-oriented</p>
            ) : enrichment?.investment_philosophy === "unicorn_focused" ? (
              <p className="mt-2 font-medium text-red-600">Unicorn-focused</p>
            ) : (
              <p className="mt-2 font-medium text-gray-500">Unknown</p>
            )}
          </div>
          <div className="rounded-sm border border-slate-200 bg-white p-4 shadow-sm">
            <p className="text-xs font-medium text-gray-500">Check Size</p>
            <p className="mt-2 font-mono font-medium text-gray-900">
              {formatCheckSizeRange(enrichment)}
            </p>
          </div>
        </div>
        <div className="mt-4 rounded-sm bg-slate-50 p-4 text-sm italic text-slate-700">
          {enrichment?.thesis_notes?.trim() ? (
            enrichment.thesis_notes
          ) : (
            <span className="not-italic text-gray-500">
              No thesis data available
            </span>
          )}
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
        />
        <ExportButton rows={csvRows} filenameBase={fileBase} />
      </section>
    </div>
  );
}
