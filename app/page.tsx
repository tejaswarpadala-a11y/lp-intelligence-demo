"use client";

import { AddToShortlistDropdown } from "@/components/AddToShortlistDropdown";
import { createClient } from "@/lib/supabase/client";
import {
  calculateScore,
  getScoringConfig,
  parseSupabaseLps,
  type LPWithEnrichment,
} from "@/lib/scoring";
import type { ScoreResult, ScoringWeights } from "@/lib/types";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

const LIST_SEGMENTS = [
  "US Family Offices",
  "Pension Funds",
  "European Family Offices",
  "Family Offices",
  "Fund of Funds",
] as const;

const LP_CATEGORIES = [
  "Family Office",
  "Institutional",
  "Venture/VC",
  "Fund of Funds",
  "Other",
] as const;

const WEIGHT_ORDER: (keyof ScoringWeights)[] = [
  "healthcare",
  "invests_in_funds",
  "value_based",
  "check_size",
  "geography",
];

const WEIGHT_LABELS: Record<keyof ScoringWeights, string> = {
  healthcare: "Healthcare focus",
  invests_in_funds: "Invests in VC funds",
  value_based: "Value-based orientation",
  check_size: "Check size match",
  geography: "Invests in US funds",
};

function weightsFromConfig(config: Record<string, number>): ScoringWeights {
  return {
    healthcare: Math.round(config.healthcare_weight ?? 40),
    invests_in_funds: Math.round(config.invests_in_funds_weight ?? 25),
    value_based: Math.round(config.value_based_weight ?? 20),
    check_size: Math.round(config.checksize_weight ?? 10),
    geography: Math.round(config.geo_weight ?? 5),
  };
}

function rebalanceWeights(
  prev: ScoringWeights,
  changed: keyof ScoringWeights,
  newValue: number,
): ScoringWeights {
  const clamped = Math.max(0, Math.min(100, Math.round(newValue)));
  const others = WEIGHT_ORDER.filter((k) => k !== changed);
  const remaining = 100 - clamped;
  const out: ScoringWeights = { ...prev, [changed]: clamped };

  if (remaining <= 0) {
    others.forEach((k) => {
      out[k] = 0;
    });
  } else {
    const sumOld = others.reduce((s, k) => s + prev[k], 0);
    if (sumOld === 0) {
      const base = Math.floor(remaining / others.length);
      const rem = remaining - base * others.length;
      others.forEach((k, i) => {
        out[k] = base + (i < rem ? 1 : 0);
      });
    } else {
      const raw = others.map((k) => (remaining * prev[k]) / sumOld);
      const floors = raw.map((x) => Math.floor(x));
      const deficit = remaining - floors.reduce((a, b) => a + b, 0);
      const order = others
        .map((k, i) => ({ k, frac: raw[i] - floors[i] }))
        .sort((a, b) => b.frac - a.frac);
      others.forEach((k, i) => {
        out[k] = floors[i];
      });
      for (let j = 0; j < deficit; j++) {
        out[order[j].k] += 1;
      }
    }
  }

  const sum = WEIGHT_ORDER.reduce((s, k) => s + out[k], 0);
  if (sum !== 100) {
    const maxK = WEIGHT_ORDER.reduce((a, b) => (out[a] >= out[b] ? a : b));
    out[maxK] += 100 - sum;
  }
  return out;
}

function countryKey(lp: LPWithEnrichment): string {
  const c = lp.country?.trim();
  return c && c.length > 0 ? c : "Unknown";
}

function countryStats(
  lps: LPWithEnrichment[],
): { code: string; count: number }[] {
  const m = new Map<string, number>();
  for (const lp of lps) {
    const k = countryKey(lp);
    m.set(k, (m.get(k) ?? 0) + 1);
  }
  return Array.from(m.entries())
    .map(([code, count]) => ({ code, count }))
    .sort((a, b) => a.code.localeCompare(b.code));
}

function lpCategoryBucket(lp: LPWithEnrichment): string {
  const c = lp.lp_category;
  if (!c) return "Other";
  if (
    c === "Family Office" ||
    c === "Institutional" ||
    c === "Venture/VC" ||
    c === "Fund of Funds"
  ) {
    return c;
  }
  return "Other";
}

function passesListSegment(
  lp: LPWithEnrichment,
  selected: string[],
): boolean {
  const s = lp.list_segment;
  if (!s) return false;
  return selected.includes(s);
}

function passesCategory(lp: LPWithEnrichment, selected: string[]): boolean {
  return selected.includes(lpCategoryBucket(lp));
}

function passesCountry(lp: LPWithEnrichment, selected: string[]): boolean {
  return selected.includes(countryKey(lp));
}

function formatCheckSize(enrichment: LPWithEnrichment["enrichment"]): string {
  if (!enrichment) return "Unknown";
  const mn = enrichment.check_size_min;
  const mx = enrichment.check_size_max;
  if (mn == null && mx == null) return "Unknown";

  const fmt = (n: number): string => {
    if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
    if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
    if (n >= 1_000) return `${Math.round(n / 1_000)}K`;
    return `${n}`;
  };

  if (mn != null && mx != null) return `$${fmt(mn)} – $${fmt(mx)}`;
  if (mn != null) return `$${fmt(mn)}+`;
  return `≤$${fmt(mx!)}`;
}

function scoreBadgeClasses(score: ScoreResult): string {
  if (!score.is_scored) return "bg-gray-100 text-gray-600";
  const t = score.total_score;
  if (t >= 80) return "bg-green-100 text-green-800";
  if (t >= 60) return "bg-blue-100 text-blue-800";
  if (t >= 40) return "bg-amber-100 text-amber-800";
  return "bg-gray-100 text-gray-600";
}

function scoreBadgeLabel(score: ScoreResult): string {
  if (!score.is_scored) return "Not scored";
  return `${score.total_score} · ${score.label}`;
}

type SortBy = "score" | "name" | "country";

type Row = LPWithEnrichment & { score: ScoreResult };

export default function Home() {
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [config, setConfig] = useState<Record<string, number> | null>(null);
  const [allLPs, setAllLPs] = useState<LPWithEnrichment[]>([]);
  const [emergingManagerFilter, setEmergingManagerFilter] = useState(true);
  const [weights, setWeights] = useState<ScoringWeights>({
    healthcare: 40,
    invests_in_funds: 25,
    value_based: 20,
    check_size: 10,
    geography: 5,
  });
  const [selectedListSegments, setSelectedListSegments] = useState<string[]>([
    ...LIST_SEGMENTS,
  ]);
  const [selectedCategories, setSelectedCategories] = useState<string[]>([
    ...LP_CATEGORIES,
  ]);
  const [selectedCountries, setSelectedCountries] = useState<string[]>([]);
  const [minScoreThreshold, setMinScoreThreshold] = useState(0);
  const [sortBy, setSortBy] = useState<SortBy>("score");
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setFetchError(null);
      try {
        const supabase = createClient();
        const [cfg, res] = await Promise.all([
          getScoringConfig(supabase),
          supabase.from("lps").select("*, enrichment(*)"),
        ]);
        if (res.error) throw res.error;
        if (cancelled) return;
        setConfig(cfg);
        const rows = parseSupabaseLps(res.data as unknown[]);
        setAllLPs(rows);
        setWeights(weightsFromConfig(cfg));
        const stats = countryStats(rows);
        setSelectedCountries(stats.map((s) => s.code));
      } catch (e) {
        if (!cancelled) {
          setFetchError(e instanceof Error ? e.message : "Failed to load data");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(t);
  }, [toast]);

  const countries = useMemo(() => countryStats(allLPs), [allLPs]);

  const emergingExcludedCount = useMemo(
    () =>
      allLPs.filter((lp) => lp.enrichment?.open_to_emerging_managers === false)
        .length,
    [allLPs],
  );

  const filteredAndScored = useMemo((): Row[] => {
    if (!config) return [];

    const rows = allLPs.filter((lp) => {
      if (emergingManagerFilter && lp.enrichment?.open_to_emerging_managers === false) {
        return false;
      }
      if (!passesListSegment(lp, selectedListSegments)) return false;
      if (!passesCategory(lp, selectedCategories)) return false;
      if (!passesCountry(lp, selectedCountries)) return false;
      return true;
    });

    const withScores: Row[] = rows.map((lp) => ({
      ...lp,
      score: calculateScore(lp, lp.enrichment, config, weights),
    }));

    const afterMin = withScores.filter((r) => {
      if (!r.score.is_scored) return true;
      return r.score.total_score >= minScoreThreshold;
    });

    if (sortBy === "score") {
      const scored = afterMin.filter((r) => r.score.is_scored);
      const unscored = afterMin.filter((r) => !r.score.is_scored);
      scored.sort((a, b) => b.score.total_score - a.score.total_score);
      return [...scored, ...unscored];
    }

    if (sortBy === "name") {
      return [...afterMin].sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
      );
    }

    return [...afterMin].sort((a, b) => {
      const ca = countryKey(a);
      const cb = countryKey(b);
      const cmp = ca.localeCompare(cb);
      if (cmp !== 0) return cmp;
      return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
    });
  }, [
    allLPs,
    config,
    emergingManagerFilter,
    selectedListSegments,
    selectedCategories,
    selectedCountries,
    minScoreThreshold,
    sortBy,
    weights,
  ]);

  const weightSum = WEIGHT_ORDER.reduce((s, k) => s + weights[k], 0);

  function showToast(message: string) {
    setToast(message);
  }

  function resetAllFilters() {
    if (config) setWeights(weightsFromConfig(config));
    else
      setWeights({
        healthcare: 40,
        invests_in_funds: 25,
        value_based: 20,
        check_size: 10,
        geography: 5,
      });
    setEmergingManagerFilter(true);
    setSelectedListSegments([...LIST_SEGMENTS]);
    setSelectedCategories([...LP_CATEGORIES]);
    setSelectedCountries(countries.map((c) => c.code));
    setMinScoreThreshold(0);
    setSortBy("score");
  }

  function toggleSegment(seg: string) {
    setSelectedListSegments((prev) =>
      prev.includes(seg) ? prev.filter((s) => s !== seg) : [...prev, seg],
    );
  }

  function toggleCategory(cat: string) {
    setSelectedCategories((prev) =>
      prev.includes(cat) ? prev.filter((c) => c !== cat) : [...prev, cat],
    );
  }

  function toggleCountry(code: string) {
    setSelectedCountries((prev) =>
      prev.includes(code) ? prev.filter((c) => c !== code) : [...prev, code],
    );
  }

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] border-t border-gray-200 bg-white">
      {toast ? (
        <div
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}

      {/* Left panel */}
      <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-gray-200 bg-gray-50">
        <div className="space-y-8 p-5">
          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Pre-filters
            </h2>
            <div className="flex items-start gap-3">
              <button
                type="button"
                role="switch"
                aria-checked={emergingManagerFilter}
                onClick={() => setEmergingManagerFilter((v) => !v)}
                className={`relative mt-0.5 h-6 w-11 shrink-0 rounded-full transition-colors ${
                  emergingManagerFilter ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`absolute left-0.5 top-0.5 block h-5 w-5 rounded-full bg-white shadow transition-transform ${
                    emergingManagerFilter ? "translate-x-5" : "translate-x-0"
                  }`}
                />
              </button>
              <div>
                <p className="text-sm font-medium text-gray-900">
                  Emerging manager friendly only
                </p>
                <p className="mt-1 text-xs text-gray-600">
                  Hides LPs that explicitly require an established track record
                </p>
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Scoring weights — must sum to 100%
            </h2>
            <div className="space-y-4">
              {WEIGHT_ORDER.map((key) => (
                <div key={key}>
                  <div className="mb-1 flex justify-between text-sm">
                    <label htmlFor={`w-${key}`} className="text-gray-800">
                      {WEIGHT_LABELS[key]}
                    </label>
                    <span className="tabular-nums text-gray-600">
                      {weights[key]}%
                    </span>
                  </div>
                  <input
                    id={`w-${key}`}
                    type="range"
                    min={0}
                    max={100}
                    step={1}
                    value={weights[key]}
                    disabled={loading || !config}
                    onChange={(e) =>
                      setWeights(
                        rebalanceWeights(weights, key, Number(e.target.value)),
                      )
                    }
                    className="w-full accent-blue-600 disabled:opacity-50"
                  />
                </div>
              ))}
            </div>
            <p
              className={`mt-2 text-sm tabular-nums ${
                weightSum !== 100 ? "font-medium text-red-600" : "text-gray-600"
              }`}
            >
              Sum: {weightSum}%
            </p>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Filter by
            </h2>
            <div className="space-y-5">
              <div>
                <p className="mb-2 text-sm font-medium text-gray-800">
                  List segment
                </p>
                <ul className="space-y-2">
                  {LIST_SEGMENTS.map((seg) => (
                    <li key={seg}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={selectedListSegments.includes(seg)}
                          onChange={() => toggleSegment(seg)}
                          disabled={loading}
                        />
                        {seg}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-800">
                  LP Category
                </p>
                <ul className="space-y-2">
                  {LP_CATEGORIES.map((cat) => (
                    <li key={cat}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={selectedCategories.includes(cat)}
                          onChange={() => toggleCategory(cat)}
                          disabled={loading}
                        />
                        {cat}
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <p className="mb-2 text-sm font-medium text-gray-800">
                  Country
                </p>
                <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
                  {countries.map(({ code, count }) => (
                    <li key={code}>
                      <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          checked={selectedCountries.includes(code)}
                          onChange={() => toggleCountry(code)}
                          disabled={loading}
                        />
                        {code} ({count})
                      </label>
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <div className="mb-1 flex justify-between text-sm">
                  <label htmlFor="min-score" className="text-gray-800">
                    Show LPs scoring {minScoreThreshold} or above
                  </label>
                  <span className="tabular-nums text-gray-600">
                    {minScoreThreshold}
                  </span>
                </div>
                <input
                  id="min-score"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={minScoreThreshold}
                  onChange={(e) =>
                    setMinScoreThreshold(Number(e.target.value))
                  }
                  className="w-full accent-blue-600"
                />
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Saved presets
            </h2>
            <select
              disabled
              className="mb-2 w-full rounded border border-gray-300 bg-white px-2 py-2 text-sm text-gray-500"
              defaultValue=""
            >
              <option value="" disabled>
                Select a preset...
              </option>
            </select>
            <button
              type="button"
              onClick={() =>
                showToast("Coming in D7")
              }
              className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Save current filters as preset
            </button>
          </section>
        </div>
      </aside>

      {/* Right panel */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-white">
        <div className="border-b border-gray-100 px-6 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm text-gray-700">
              <span className="font-medium text-gray-900">
                {loading ? "…" : filteredAndScored.length} LPs
              </span>{" "}
              match your filters
              {emergingManagerFilter &&
              emergingExcludedCount > 0 &&
              !loading ? (
                <span className="ml-2 text-amber-700">
                  · {emergingExcludedCount} excluded by pre-filter
                </span>
              ) : null}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <AddToShortlistDropdown
                items={filteredAndScored.map((lp) => ({
                  lpId: lp.id,
                  fitScore: Math.round(lp.score.total_score),
                  lpName: lp.name,
                }))}
                buttonLabel={`Add all ${filteredAndScored.length} to shortlist`}
                disabled={loading || filteredAndScored.length === 0}
              />
              <label htmlFor="sort" className="text-sm text-gray-600">
                Sort
              </label>
              <select
                id="sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900"
              >
                <option value="score">Fit Score ↓</option>
                <option value="name">Name A-Z</option>
                <option value="country">Country</option>
              </select>
            </div>
          </div>
          {fetchError ? (
            <p className="mt-2 text-sm text-red-600">{fetchError}</p>
          ) : null}
        </div>

        <div className="px-6 py-4">
          {loading ? (
            <ul className="space-y-3">
              {Array.from({ length: 8 }).map((_, i) => (
                <li
                  key={i}
                  className="animate-pulse rounded-lg border border-gray-100 bg-gray-50 p-4"
                >
                  <div className="h-4 w-1/3 rounded bg-gray-200" />
                  <div className="mt-3 h-3 w-2/3 rounded bg-gray-200" />
                  <div className="mt-2 h-3 w-1/2 rounded bg-gray-200" />
                </li>
              ))}
            </ul>
          ) : filteredAndScored.length === 0 ? (
            <div className="mx-auto max-w-md py-16 text-center">
              <p className="text-base font-medium text-gray-900">
                No LPs match your current settings.
              </p>
              <p className="mt-2 text-sm text-gray-600">
                Try lowering the minimum score or selecting more filter
                options.
              </p>
              <button
                type="button"
                onClick={resetAllFilters}
                className="mt-6 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
              >
                Reset all filters
              </button>
            </div>
          ) : (
            <ul className="divide-y divide-gray-100">
              {filteredAndScored.map((lp) => (
                <li
                  key={lp.id}
                  className="group flex flex-col gap-3 py-4 transition-colors hover:bg-gray-50 sm:flex-row sm:items-center sm:justify-between"
                >
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/lp/${lp.id}`}
                        className="font-semibold text-gray-900 hover:text-blue-700 hover:underline"
                      >
                        {lp.name}
                      </Link>
                      {lp.lp_category ? (
                        <span className="rounded bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                          {lp.lp_category}
                        </span>
                      ) : null}
                      <span
                        className={`rounded px-2 py-0.5 text-xs font-medium ${scoreBadgeClasses(
                          lp.score,
                        )}`}
                      >
                        {scoreBadgeLabel(lp.score)}
                      </span>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500">
                      {lp.location ? <span>{lp.location}</span> : null}
                      {lp.list_segment ? (
                        <span className="rounded bg-gray-100 px-1.5 py-px text-gray-600">
                          {lp.list_segment}
                        </span>
                      ) : null}
                      <span>Check size: {formatCheckSize(lp.enrichment)}</span>
                    </div>
                  </div>
                  <AddToShortlistDropdown
                    items={[
                      {
                        lpId: lp.id,
                        fitScore: Math.round(lp.score.total_score),
                        lpName: lp.name,
                      },
                    ]}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </main>
    </div>
  );
}
