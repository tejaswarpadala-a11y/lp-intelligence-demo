"use client";

import { AddToShortlistDropdown } from "@/components/AddToShortlistDropdown";
import { FitMeter } from "@/components/FitMeter";
import { Switch } from "@/components/ui/switch";
import {
  deletePreset,
  listPresets,
  loadPreset,
  savePreset,
  type PresetRecord,
} from "@/app/actions/presets";
import { FUND_CONFIG } from "@/lib/config";
import { createClient } from "@/lib/supabase/client";
import {
  calculateScore,
  getScoringConfig,
  parseSupabaseLps,
  type LPWithEnrichment,
} from "@/lib/scoring";
import type { ScoreResult, ScoringWeights } from "@/lib/types";
import { ChevronDownIcon } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

function RangeSlider({
  value,
  min,
  max,
  step,
  disabled,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onChange: (next: number) => void;
}) {
  const clamped = Math.max(min, Math.min(max, value));
  const pct = max === min ? 0 : ((clamped - min) / (max - min)) * 100;
  return (
    <input
      type="range"
      min={min}
      max={max}
      step={step}
      value={clamped}
      disabled={disabled}
      onChange={(e) => onChange(Number(e.target.value))}
      className="w-full appearance-none bg-transparent disabled:opacity-50"
      style={{
        background: `linear-gradient(to right, rgb(16 185 129) 0%, rgb(16 185 129) ${pct}%, rgb(241 245 249) ${pct}%, rgb(241 245 249) 100%)`,
        height: "3px",
      }}
    />
  );
}

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

function matchSnippet(lp: LPWithEnrichment, score: ScoreResult): string {
  const e = lp.enrichment;
  if (!e) return "";

  const thesis = e.thesis_notes?.trim();
  if (thesis) {
    const first = thesis.split(/(?<=[.!?])\s+/)[0]?.trim() || thesis;
    const t = first.length > 80 ? `${first.slice(0, 77).trimEnd()}…` : first;
    return t;
  }

  if (e.open_to_emerging_managers === true)
    return "Emerging manager program active";
  if (e.healthcare_focus === "true") return "Confirmed healthcare fund investor";
  if (e.invests_in_funds === "true") return "Active fund-of-funds LP";

  if (score.is_scored) {
    const b = score.breakdown;
    const signals = [
      { name: "Healthcare focus", v: b.healthcare.score, max: b.healthcare.max },
      {
        name: "Invests in VC funds",
        v: b.invests_in_funds.score,
        max: b.invests_in_funds.max,
      },
      {
        name: "Value-based orientation",
        v: b.value_based.score,
        max: b.value_based.max,
      },
      { name: "Check size match", v: b.check_size.score, max: b.check_size.max },
      { name: "Invests in US funds", v: b.geography.score, max: b.geography.max },
    ];
    signals.sort((a, b) => {
      const ra = a.max > 0 ? a.v / a.max : 0;
      const rb = b.max > 0 ? b.v / b.max : 0;
      if (rb !== ra) return rb - ra;
      return b.v - a.v;
    });
    const top = signals[0]?.name;
    if (top) return `Matched on ${top}`;
  }

  return "";
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
  const [presets, setPresets] = useState<PresetRecord[]>([]);
  const [presetMenuOpen, setPresetMenuOpen] = useState(false);
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [savingPreset, setSavingPreset] = useState(false);
  const [presetNameDraft, setPresetNameDraft] = useState("");
  const [isScanning, setIsScanning] = useState(false);
  const [openFilterSection, setOpenFilterSection] = useState<string | null>(
    null,
  );

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
    if (loading) return;
    setIsScanning(true);
    const t = window.setTimeout(() => setIsScanning(false), 1200);
    return () => window.clearTimeout(t);
  }, [
    loading,
    emergingManagerFilter,
    weights,
    selectedListSegments,
    selectedCategories,
    selectedCountries,
    minScoreThreshold,
  ]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const rows = await listPresets();
        if (!cancelled) setPresets(rows);
      } catch {
        // ignore
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

  useEffect(() => {
    if (loading) return;
    document.title = `${filteredAndScored.length} LPs — LP Intelligence`;
  }, [loading, filteredAndScored.length]);

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

  async function onApplyPreset(presetId: string) {
    try {
      const p = await loadPreset(presetId);
      if (!p) return;
      setSelectedPresetId(p.id);
      setWeights({
        healthcare: p.healthcare_weight,
        invests_in_funds: p.invests_in_funds_weight,
        value_based: p.value_based_weight,
        check_size: p.checksize_weight,
        geography: p.geo_weight,
      });
      setEmergingManagerFilter(Boolean(p.emerging_manager_filter));
      setMinScoreThreshold(Number(p.min_score_threshold) || 0);
      if (p.list_segment_filter) setSelectedListSegments(p.list_segment_filter);
      if (p.lp_category_filter) setSelectedCategories(p.lp_category_filter);
      if (p.country_filter) setSelectedCountries(p.country_filter);
      showToast(`Preset '${p.name}' loaded`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not load preset");
    } finally {
      setPresetMenuOpen(false);
    }
  }

  async function onDeletePreset(presetId: string) {
    try {
      await deletePreset(presetId);
      setPresets((prev) => prev.filter((p) => p.id !== presetId));
      if (selectedPresetId === presetId) setSelectedPresetId(null);
      showToast("Preset deleted");
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not delete preset");
    }
  }

  async function onSavePresetCommit() {
    const name = presetNameDraft.trim();
    if (!name) {
      setSavingPreset(false);
      return;
    }
    try {
      const { id } = await savePreset(
        name,
        weights,
        {
          emergingManagerFilter,
          selectedListSegments,
          selectedCategories,
          selectedCountries,
          minScoreThreshold,
        },
      );
      const rows = await listPresets();
      setPresets(rows);
      setSelectedPresetId(id);
      showToast(`Preset '${name}' saved`);
    } catch (e) {
      showToast(e instanceof Error ? e.message : "Could not save preset");
    } finally {
      setSavingPreset(false);
      setPresetNameDraft("");
    }
  }

  return (
    <div className="flex min-h-[calc(100dvh-3rem)] border-t border-slate-200 bg-white">
      {toast ? (
        <div
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md bg-gray-900 px-4 py-2 text-sm text-white shadow-lg"
          role="status"
        >
          {toast}
        </div>
      ) : null}

      {/* Left panel */}
      <aside className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-r border-slate-100 bg-white px-4 py-4">
        <div className="mb-3">
          <div className="font-serif text-base font-semibold text-slate-900">
            {FUND_CONFIG.fundName}
          </div>
          <div className="mt-0.5 text-xs uppercase tracking-widest text-slate-400">
            LP Intelligence Platform
          </div>
        </div>
        <div className="border-t border-slate-100 my-3" />
        <div className="space-y-6">
          <section>
            <h2 className="mb-3 text-xs font-medium uppercase tracking-widest text-slate-500">
              Pre-filters
            </h2>
            <div className="flex items-start gap-3">
              <Switch
                checked={emergingManagerFilter}
                onCheckedChange={(v) => setEmergingManagerFilter(Boolean(v))}
                className="data-checked:bg-emerald-600 data-unchecked:bg-slate-200"
              />
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
            <div className="flex items-baseline justify-between">
              <h2 className="text-xs font-medium uppercase tracking-widest text-slate-500">
                Scoring weights
              </h2>
              <span className="text-xs text-slate-400">
                must sum to <span className="font-mono">100%</span>
              </span>
            </div>
            <div className="space-y-4">
              {WEIGHT_ORDER.map((key) => (
                <div key={key}>
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-medium uppercase tracking-widest text-slate-500">
                      {WEIGHT_LABELS[key]}
                    </span>
                    <span className="font-mono text-xs font-medium text-emerald-600">
                      {weights[key]}%
                    </span>
                  </div>
                  <RangeSlider
                    value={weights[key]}
                    min={0}
                    max={100}
                    step={1}
                    disabled={loading || !config}
                    onChange={(next) =>
                      setWeights(rebalanceWeights(weights, key, next))
                    }
                  />
                </div>
              ))}
            </div>
            <p
              className={`mt-2 text-xs font-mono ${
                weightSum !== 100 ? "font-medium text-red-500" : "text-slate-500"
              }`}
            >
              Sum: {weightSum}%
            </p>
          </section>

          <div className="border-t border-slate-100 my-3" />

          <section>
            <div className="divide-y divide-slate-100">
              <div className="py-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenFilterSection((v) =>
                      v === "list-segment" ? null : "list-segment",
                    )
                  }
                  className="flex justify-between items-center w-full py-2 text-left"
                >
                  <span className="text-xs uppercase tracking-widest text-slate-500 font-medium">
                    List segment
                  </span>
                  <ChevronDownIcon
                    className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                      openFilterSection === "list-segment"
                        ? "rotate-180"
                        : "rotate-0"
                    }`}
                  />
                </button>
                {openFilterSection === "list-segment" ? (
                  <div className="pb-3">
                    <ul className="space-y-2">
                      {LIST_SEGMENTS.map((seg) => (
                        <li key={seg}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
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
                ) : null}
              </div>

              <div className="py-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenFilterSection((v) =>
                      v === "lp-category" ? null : "lp-category",
                    )
                  }
                  className="flex justify-between items-center w-full py-2 text-left"
                >
                  <span className="text-xs uppercase tracking-widest text-slate-500 font-medium">
                    LP Category
                  </span>
                  <ChevronDownIcon
                    className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                      openFilterSection === "lp-category"
                        ? "rotate-180"
                        : "rotate-0"
                    }`}
                  />
                </button>
                {openFilterSection === "lp-category" ? (
                  <div className="pb-3">
                    <ul className="space-y-2">
                      {LP_CATEGORIES.map((cat) => (
                        <li key={cat}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
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
                ) : null}
              </div>

              <div className="py-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenFilterSection((v) =>
                      v === "country" ? null : "country",
                    )
                  }
                  className="flex justify-between items-center w-full py-2 text-left"
                >
                  <span className="text-xs uppercase tracking-widest text-slate-500 font-medium">
                    Country
                  </span>
                  <ChevronDownIcon
                    className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                      openFilterSection === "country" ? "rotate-180" : "rotate-0"
                    }`}
                  />
                </button>
                {openFilterSection === "country" ? (
                  <div className="pb-3">
                    <ul className="max-h-48 space-y-2 overflow-y-auto pr-1">
                      {countries.map(({ code, count }) => (
                        <li key={code}>
                          <label className="flex cursor-pointer items-start gap-2 text-sm text-gray-700">
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-slate-300 text-slate-700 focus:ring-slate-300"
                              checked={selectedCountries.includes(code)}
                              onChange={() => toggleCountry(code)}
                              disabled={loading}
                            />
                            {code} (<span className="font-mono">{count}</span>)
                          </label>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>

              <div className="py-1">
                <button
                  type="button"
                  onClick={() =>
                    setOpenFilterSection((v) =>
                      v === "min-score" ? null : "min-score",
                    )
                  }
                  className="flex justify-between items-center w-full py-2 text-left"
                >
                  <span className="text-xs uppercase tracking-widest text-slate-500 font-medium">
                    Minimum fit score
                  </span>
                  <ChevronDownIcon
                    className={`h-4 w-4 text-slate-400 transition-transform duration-200 ${
                      openFilterSection === "min-score"
                        ? "rotate-180"
                        : "rotate-0"
                    }`}
                  />
                </button>
                {openFilterSection === "min-score" ? (
                  <div className="pb-3">
                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs uppercase tracking-widest text-slate-500 font-medium">
                          Threshold
                        </span>
                        <span className="font-mono text-xs font-medium text-emerald-600">
                          {minScoreThreshold}
                        </span>
                      </div>
                      <RangeSlider
                        value={minScoreThreshold}
                        min={0}
                        max={100}
                        step={1}
                        disabled={loading}
                        onChange={(next) => setMinScoreThreshold(next)}
                      />
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </section>

          <section>
            <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
              Saved presets
            </h2>
            <div className="relative">
                <button
                type="button"
                onClick={() => setPresetMenuOpen((v) => !v)}
                  className="mb-2 w-full rounded border border-slate-300 bg-white px-3 py-2 text-left text-sm text-gray-800 hover:bg-slate-50"
              >
                {selectedPresetId
                  ? presets.find((p) => p.id === selectedPresetId)?.name ??
                    "Select a preset..."
                  : "Select a preset..."}
              </button>
              {presetMenuOpen ? (
                <div className="absolute left-0 right-0 z-40 max-h-64 overflow-y-auto rounded border border-slate-200 bg-white shadow">
                  {presets.length === 0 ? (
                    <p className="px-3 py-2 text-sm text-gray-500">
                      No presets yet
                    </p>
                  ) : (
                    presets.map((p) => (
                      <div
                        key={p.id}
                        className="flex items-center justify-between gap-2 px-3 py-2 hover:bg-slate-50"
                      >
                        <button
                          type="button"
                          onClick={() => void onApplyPreset(p.id)}
                          className="min-w-0 flex-1 truncate text-left text-sm text-gray-800"
                        >
                          {p.name}
                        </button>
                        <button
                          type="button"
                          onClick={() => void onDeletePreset(p.id)}
                          className="shrink-0 text-sm font-bold text-gray-400 hover:text-red-600"
                          title="Delete preset"
                        >
                          ×
                        </button>
                      </div>
                    ))
                  )}
                </div>
              ) : null}
            </div>

            {savingPreset ? (
              <div className="space-y-2">
                <label className="block text-xs font-medium text-gray-600">
                  Preset name:
                </label>
                <input
                  className="w-full rounded border border-slate-300 bg-white px-2 py-2 text-sm text-gray-900"
                  value={presetNameDraft}
                  onChange={(e) => setPresetNameDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void onSavePresetCommit();
                    if (e.key === "Escape") {
                      setSavingPreset(false);
                      setPresetNameDraft("");
                    }
                  }}
                  autoFocus
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={() => void onSavePresetCommit()}
                    className="flex-1 rounded border border-slate-900 bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800"
                  >
                    Save
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setSavingPreset(false);
                      setPresetNameDraft("");
                    }}
                    className="flex-1 rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setSavingPreset(true)}
                className="w-full rounded border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-gray-700 hover:bg-slate-50"
              >
                Save current filters as preset
              </button>
            )}
          </section>
        </div>
      </aside>

      {/* Right panel */}
      <main className="min-w-0 flex-1 overflow-y-auto bg-white">
        <div className="sticky top-0 z-10 border-b border-slate-100 bg-white px-4 py-2">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="text-sm font-medium text-slate-600">
              <span className="font-mono text-slate-900">
                {loading ? "…" : filteredAndScored.length}
              </span>{" "}
              LP records
              {emergingManagerFilter && emergingExcludedCount > 0 && !loading ? (
                <span className="ml-2 text-xs text-amber-600">
                  · <span className="font-mono">{emergingExcludedCount}</span>{" "}
                  excluded by pre-filter
                </span>
              ) : null}
              {isScanning && !loading ? (
                <div className="mt-0.5 text-xs font-mono text-emerald-600">
                  Scanning LP database...
                </div>
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
                className="rounded-sm border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
              />
              <label htmlFor="sort" className="text-xs text-slate-500">
                Sort
              </label>
              <select
                id="sort"
                value={sortBy}
                onChange={(e) => setSortBy(e.target.value as SortBy)}
                className="rounded-sm border border-slate-200 bg-white px-2 py-1 text-xs text-slate-700"
              >
                <option value="score">Fit Score ↓</option>
                <option value="name">Name A-Z</option>
                <option value="country">Country</option>
              </select>
            </div>
          </div>
          {fetchError ? (
            <p className="mt-1 text-sm text-red-600">{fetchError}</p>
          ) : null}
        </div>

        <div>
          {loading ? (
            <div className="divide-y divide-slate-100">
              {Array.from({ length: 12 }).map((_, i) => (
                <div key={i} className="h-[52px] animate-pulse px-4 py-2.5">
                  <div className="flex items-center gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="h-3 w-1/3 rounded bg-slate-200" />
                      <div className="mt-2 h-2 w-2/5 rounded bg-slate-200" />
                    </div>
                    <div className="hidden w-40 sm:block">
                      <div className="h-2 w-24 rounded bg-slate-200" />
                    </div>
                    <div className="flex items-center gap-4">
                      <div className="h-2 w-20 rounded bg-slate-200" />
                      <div className="h-[14px] w-[56px] rounded bg-slate-200" />
                      <div className="h-6 w-6 rounded bg-slate-200" />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : filteredAndScored.length === 0 ? (
            <div className="mx-auto max-w-md px-4 py-16 text-center">
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
                className="mt-6 rounded-md bg-slate-900 px-4 py-2 text-sm font-medium text-white hover:bg-slate-800"
              >
                Reset all filters
              </button>
            </div>
          ) : (
            <div
              className={`divide-y divide-slate-100 ${
                isScanning
                  ? "border border-emerald-300/70 animate-[border-pulse_600ms_2]"
                  : ""
              }`}
            >
              {filteredAndScored.map((lp) => (
                <div
                  key={lp.id}
                  className="flex cursor-pointer items-center gap-4 px-4 py-2.5 hover:bg-slate-50/80"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-col gap-0.5">
                      <Link
                        href={`/lp/${lp.id}`}
                        className="truncate font-serif text-sm font-semibold text-slate-900 hover:underline"
                      >
                        {lp.name}
                      </Link>
                      <div className="flex items-center gap-2">
                        <span className="max-w-xs truncate text-xs italic text-slate-400">
                          {matchSnippet(lp, lp.score)}
                        </span>
                        {lp.lp_category ? (
                          <span className="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500">
                            {lp.lp_category}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  </div>

                  <div className="hidden items-center gap-2 sm:flex">
                    <span className="text-xs text-slate-400">
                      {lp.location ?? "—"}
                    </span>
                    {lp.list_segment ? (
                      <span className="rounded-sm border border-slate-200 bg-slate-50 px-1.5 py-0.5 text-xs text-slate-500">
                        {lp.list_segment}
                      </span>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-4">
                    <span className="text-xs font-mono text-slate-500">
                      {formatCheckSize(lp.enrichment).replace(/\s*–\s*/g, "–")}
                    </span>
                    <FitMeter
                      score={lp.score.is_scored ? lp.score.total_score : null}
                      label={lp.score.is_scored ? lp.score.label : undefined}
                      showNumber
                    />
                    <AddToShortlistDropdown
                      items={[
                        {
                          lpId: lp.id,
                          fitScore: Math.round(lp.score.total_score),
                          lpName: lp.name,
                        },
                      ]}
                      buttonLabel="+"
                      className="h-7 w-7 rounded-sm border border-slate-200 bg-white text-xs font-medium text-slate-500 hover:bg-slate-50 disabled:opacity-50"
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
