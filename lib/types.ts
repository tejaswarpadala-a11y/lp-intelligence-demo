export type LP = {
  id: string;
  name: string;
  website: string | null;
  crunchbase_url: string | null;
  linkedin_url: string | null;
  summary: string | null;
  linkedin_description: string | null;
  size: string | null;
  location: string | null;
  country: string | null;
  yr_founded: number | null;
  investor_type_raw: string | null;
  lp_category: string | null;
  list_segment: string | null;
  contact_email: string | null;
  source_sheet: string | null;
  created_at: string;
  updated_at: string;
};

export type Enrichment = {
  id: string;
  lp_id: string;
  decision_maker_name: string | null;
  decision_maker_linkedin: string | null;
  enriched_email: string | null;
  check_size_min: number | null;
  check_size_max: number | null;
  healthcare_focus: string | null;
  invests_in_funds: string | null;
  investment_philosophy: string | null;
  open_to_emerging_managers: boolean | null;
  stage_preference: string | null;
  thesis_notes: string | null;
  enrichment_source: string | null;
  confidence_score: number | null;
  enriched_at: string;
};

export type ScoringWeights = {
  healthcare: number;
  invests_in_funds: number;
  value_based: number;
  check_size: number;
  geography: number;
};

export type ScoreBreakdownSignal = {
  score: number;
  max: number;
  reason: string;
};

export type FitLabel =
  | "Strong fit"
  | "Moderate fit"
  | "Weak fit"
  | "Poor fit";

export type ScoreResult = {
  total_score: number;
  label: FitLabel;
  is_scored: boolean;
  breakdown: {
    healthcare: ScoreBreakdownSignal;
    invests_in_funds: ScoreBreakdownSignal;
    value_based: ScoreBreakdownSignal;
    check_size: ScoreBreakdownSignal;
    geography: ScoreBreakdownSignal;
  };
};

export type ScoredLP = LP & {
  enrichment: Enrichment | null;
  score: ScoreResult;
};
