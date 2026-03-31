import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Enrichment,
  FitLabel,
  LP,
  ScoreBreakdownSignal,
  ScoreResult,
  ScoredLP,
  ScoringWeights,
} from "./types";

const EUROPE = new Set([
  "DE",
  "FR",
  "CH",
  "SE",
  "NL",
  "ES",
  "IT",
  "BE",
  "DK",
  "NO",
  "FI",
  "AT",
]);

function parseConfigNumber(config: Record<string, number>, key: string): number {
  const v = config[key];
  if (typeof v !== "number" || Number.isNaN(v)) return 0;
  return v;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "bigint") return Number(v);
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function cap(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(Math.max(0, value), max);
}

export async function getScoringConfig(
  supabase: SupabaseClient,
): Promise<Record<string, number>> {
  const { data, error } = await supabase.from("scoring_config").select("key, value");
  if (error) throw error;
  const out: Record<string, number> = {};
  for (const row of data ?? []) {
    const k = row.key as string;
    const n = Number(row.value);
    out[k] = Number.isFinite(n) ? n : 0;
  }
  return out;
}

function resolveWeights(
  config: Record<string, number>,
  weights?: ScoringWeights,
): ScoringWeights {
  if (weights) return weights;
  return {
    healthcare: parseConfigNumber(config, "healthcare_weight"),
    invests_in_funds: parseConfigNumber(config, "invests_in_funds_weight"),
    value_based: parseConfigNumber(config, "value_based_weight"),
    check_size: parseConfigNumber(config, "checksize_weight"),
    geography: parseConfigNumber(config, "geo_weight"),
  };
}

function bandLabel(total: number, config: Record<string, number>): FitLabel {
  const strong = parseConfigNumber(config, "band_strong_min");
  const moderate = parseConfigNumber(config, "band_moderate_min");
  const weak = parseConfigNumber(config, "band_weak_min");
  if (total >= strong) return "Strong fit";
  if (total >= moderate) return "Moderate fit";
  if (total >= weak) return "Weak fit";
  return "Poor fit";
}

function scoreHealthcare(
  enrichment: Enrichment,
  config: Record<string, number>,
  max: number,
): ScoreBreakdownSignal {
  const raw = enrichment.healthcare_focus;
  if (raw === "true") {
    return {
      score: cap(max, max),
      max,
      reason: "Confirmed healthcare investor",
    };
  }
  if (raw === "partial") {
    const p = parseConfigNumber(config, "healthcare_partial_score");
    return {
      score: cap(p, max),
      max,
      reason: "Healthcare is one of several sectors",
    };
  }
  if (raw === "false") {
    return { score: 0, max, reason: "No healthcare focus" };
  }
  const u = parseConfigNumber(config, "healthcare_unknown_score");
  return {
    score: cap(u, max),
    max,
    reason: "Insufficient data",
  };
}

function scoreInvestsInFunds(
  enrichment: Enrichment,
  config: Record<string, number>,
  max: number,
): ScoreBreakdownSignal {
  const raw = enrichment.invests_in_funds ?? "unknown";
  if (raw === "true") {
    return {
      score: cap(max, max),
      max,
      reason: "Confirmed fund investor",
    };
  }
  if (raw === "false") {
    return { score: 0, max, reason: "Direct investing only" };
  }
  const u = parseConfigNumber(config, "invests_in_funds_unknown_score");
  return {
    score: cap(u, max),
    max,
    reason: "Fund investment status unknown",
  };
}

function scoreValueBased(
  enrichment: Enrichment,
  config: Record<string, number>,
  max: number,
): ScoreBreakdownSignal {
  const raw = enrichment.investment_philosophy ?? "unknown";
  if (raw === "value_based") {
    const p = parseConfigNumber(config, "value_based_score");
    return {
      score: cap(p, max),
      max,
      reason: "Value creation focus — strong alignment",
    };
  }
  if (raw === "growth_oriented") {
    const p = parseConfigNumber(config, "growth_oriented_score");
    return {
      score: cap(p, max),
      max,
      reason: "Growth-oriented — partial alignment",
    };
  }
  if (raw === "unicorn_focused") {
    const p = parseConfigNumber(config, "unicorn_focused_score");
    return {
      score: cap(p, max),
      max,
      reason: "Unicorn focus — not aligned",
    };
  }
  const p = parseConfigNumber(config, "investment_philosophy_unknown_score");
  return {
    score: cap(p, max),
    max,
    reason: "Philosophy unknown",
  };
}

function scoreCheckSize(
  enrichment: Enrichment,
  config: Record<string, number>,
  max: number,
): ScoreBreakdownSignal {
  const fundMin = parseConfigNumber(config, "check_size_min");
  const fundMax = parseConfigNumber(config, "check_size_max");
  const lpMinRaw = toNum(enrichment.check_size_min);
  const lpMaxRaw = toNum(enrichment.check_size_max);

  if (lpMinRaw === null) {
    const p = parseConfigNumber(config, "check_unknown_score");
    return {
      score: cap(p, max),
      max,
      reason: "Check size unknown",
    };
  }

  let lpMin = lpMinRaw;
  let lpMax = lpMaxRaw ?? lpMinRaw;
  if (lpMax < lpMin) [lpMin, lpMax] = [lpMax, lpMin];

  const span = Math.max(0, fundMax - fundMin);
  const adjacentBand = span > 0 ? 0.2 * span : 0;

  const fullInside = lpMin >= fundMin && lpMax <= fundMax;
  if (fullInside) {
    return {
      score: cap(max, max),
      max,
      reason: "Check size fully within target range",
    };
  }

  const overlapLow = Math.max(lpMin, fundMin);
  const overlapHigh = Math.min(lpMax, fundMax);
  const hasOverlap = overlapLow <= overlapHigh;

  if (hasOverlap) {
    return {
      score: cap(max * 0.6, max),
      max,
      reason: "Check size partially overlaps target range",
    };
  }

  if (span === 0) {
    return {
      score: 0,
      max,
      reason: "Check size outside target range",
    };
  }

  if (lpMax < fundMin) {
    const gap = fundMin - lpMax;
    if (gap <= adjacentBand) {
      return {
        score: cap(max * 0.3, max),
        max,
        reason: "Check size adjacent to target range",
      };
    }
  } else if (lpMin > fundMax) {
    const gap = lpMin - fundMax;
    if (gap <= adjacentBand) {
      return {
        score: cap(max * 0.3, max),
        max,
        reason: "Check size adjacent to target range",
      };
    }
  }

  return {
    score: 0,
    max,
    reason: "Check size outside target range",
  };
}

function scoreGeography(
  lp: LP,
  config: Record<string, number>,
  max: number,
): ScoreBreakdownSignal {
  const country = lp.country?.trim() || null;

  if (country === "US") {
    const p = parseConfigNumber(config, "geo_us_score");
    return {
      score: cap(p, max),
      max,
      reason: "US-based LP — strong fit",
    };
  }

  if (country === "GB" || country === "CA" || country === "AU") {
    const p = parseConfigNumber(config, "geo_tier2_score");
    return {
      score: cap(p, max),
      max,
      reason: "English-speaking international LP",
    };
  }

  if (country && EUROPE.has(country)) {
    const p = parseConfigNumber(config, "geo_europe_score");
    return {
      score: cap(p, max),
      max,
      reason: "European LP",
    };
  }

  if (country && lp.lp_category === "Family Office") {
    const p = parseConfigNumber(config, "geo_intl_fo_score");
    return {
      score: cap(p, max),
      max,
      reason: "International family office",
    };
  }

  const p = parseConfigNumber(config, "geo_intl_other_score");
  return {
    score: cap(p, max),
    max,
    reason: "International LP",
  };
}

function emptyBreakdown(weights: ScoringWeights): ScoreResult["breakdown"] {
  const zonk = (max: number): ScoreBreakdownSignal => ({
    score: 0,
    max,
    reason: "Not scored",
  });
  return {
    healthcare: zonk(weights.healthcare),
    invests_in_funds: zonk(weights.invests_in_funds),
    value_based: zonk(weights.value_based),
    check_size: zonk(weights.check_size),
    geography: zonk(weights.geography),
  };
}

export function calculateScore(
  lp: LP,
  enrichment: Enrichment | null,
  config: Record<string, number>,
  weights?: ScoringWeights,
): ScoreResult {
  const w = resolveWeights(config, weights);

  if (
    !enrichment ||
    enrichment.confidence_score === null ||
    enrichment.confidence_score === 0
  ) {
    return {
      total_score: 0,
      label: "Poor fit",
      is_scored: false,
      breakdown: emptyBreakdown(w),
    };
  }

  const healthcare = scoreHealthcare(enrichment, config, w.healthcare);
  const invests_in_funds = scoreInvestsInFunds(
    enrichment,
    config,
    w.invests_in_funds,
  );
  const value_based = scoreValueBased(enrichment, config, w.value_based);
  const check_size = scoreCheckSize(enrichment, config, w.check_size);
  const geography = scoreGeography(lp, config, w.geography);

  const rawTotal =
    healthcare.score +
    invests_in_funds.score +
    value_based.score +
    check_size.score +
    geography.score;

  const total_score = Math.min(100, Math.max(0, Math.round(rawTotal)));
  const label = bandLabel(total_score, config);

  return {
    total_score,
    label,
    is_scored: true,
    breakdown: {
      healthcare,
      invests_in_funds,
      value_based,
      check_size,
      geography,
    },
  };
}

function normalizeEnrichmentRow(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (Array.isArray(raw)) {
    const first = raw[0];
    return first && typeof first === "object"
      ? (first as Record<string, unknown>)
      : null;
  }
  if (typeof raw === "object") return raw as Record<string, unknown>;
  return null;
}

function mapEnrichmentRow(row: Record<string, unknown>): Enrichment {
  return {
    id: String(row.id),
    lp_id: String(row.lp_id),
    decision_maker_name: (row.decision_maker_name as string | null) ?? null,
    decision_maker_linkedin: (row.decision_maker_linkedin as string | null) ?? null,
    enriched_email: (row.enriched_email as string | null) ?? null,
    check_size_min: toNum(row.check_size_min),
    check_size_max: toNum(row.check_size_max),
    healthcare_focus: (row.healthcare_focus as string | null) ?? null,
    invests_in_funds: (row.invests_in_funds as string | null) ?? null,
    investment_philosophy: (row.investment_philosophy as string | null) ?? null,
    open_to_emerging_managers:
      typeof row.open_to_emerging_managers === "boolean"
        ? row.open_to_emerging_managers
        : row.open_to_emerging_managers === null
          ? null
          : Boolean(row.open_to_emerging_managers),
    stage_preference: (row.stage_preference as string | null) ?? null,
    thesis_notes: (row.thesis_notes as string | null) ?? null,
    enrichment_source: (row.enrichment_source as string | null) ?? null,
    confidence_score:
      row.confidence_score === null || row.confidence_score === undefined
        ? null
        : Number(row.confidence_score),
    enriched_at: String(row.enriched_at),
  };
}

function mapLPRow(row: Record<string, unknown>): LP {
  return {
    id: String(row.id),
    name: String(row.name),
    website: (row.website as string | null) ?? null,
    crunchbase_url: (row.crunchbase_url as string | null) ?? null,
    linkedin_url: (row.linkedin_url as string | null) ?? null,
    summary: (row.summary as string | null) ?? null,
    linkedin_description: (row.linkedin_description as string | null) ?? null,
    size: (row.size as string | null) ?? null,
    location: (row.location as string | null) ?? null,
    country: (row.country as string | null) ?? null,
    yr_founded:
      row.yr_founded === null || row.yr_founded === undefined
        ? null
        : Number(row.yr_founded),
    investor_type_raw: (row.investor_type_raw as string | null) ?? null,
    lp_category: (row.lp_category as string | null) ?? null,
    list_segment: (row.list_segment as string | null) ?? null,
    contact_email: (row.contact_email as string | null) ?? null,
    source_sheet: (row.source_sheet as string | null) ?? null,
    created_at: String(row.created_at),
    updated_at: String(row.updated_at),
  };
}

export async function scoreAllLPs(
  supabase: SupabaseClient,
  weights?: ScoringWeights,
): Promise<ScoredLP[]> {
  const config = await getScoringConfig(supabase);
  const { data, error } = await supabase.from("lps").select(`
    *,
    enrichment (*)
  `);
  if (error) throw error;

  const rows = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const scored: ScoredLP[] = rows.map((row) => {
    const { enrichment: encRaw, ...lpRest } = row;
    const lp = mapLPRow(lpRest);
    const encObj = normalizeEnrichmentRow(encRaw);
    const enrichment = encObj ? mapEnrichmentRow(encObj) : null;
    const score = calculateScore(lp, enrichment, config, weights);
    return { ...lp, enrichment, score };
  });

  scored.sort((a, b) => b.score.total_score - a.score.total_score);
  return scored;
}
