-- LP Intelligence Platform — database schema

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  name text,
  role text DEFAULT 'gp' CHECK (role IN ('gp', 'associate')),
  created_at timestamptz DEFAULT now()
);

CREATE TABLE lps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  website text,
  crunchbase_url text,
  linkedin_url text,
  summary text,
  linkedin_description text,
  size text,
  location text,
  country text,
  yr_founded integer,
  investor_type_raw text,
  lp_category text CHECK (lp_category IN ('Family Office','Institutional','Venture/VC','Fund of Funds','Government/Endowment','Other')),
  list_segment text CHECK (list_segment IN ('US Family Offices','Pension Funds','European Family Offices','Family Offices','Fund of Funds')),
  contact_email text,
  source_sheet text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE enrichment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lp_id uuid NOT NULL REFERENCES lps(id) ON DELETE CASCADE UNIQUE,
  decision_maker_name text,
  decision_maker_linkedin text,
  enriched_email text,
  check_size_min bigint,
  check_size_max bigint,
  healthcare_focus text CHECK (healthcare_focus IN ('true','partial','false','unknown')),
  invests_in_funds text DEFAULT 'unknown' CHECK (invests_in_funds IN ('true','false','unknown')),
  investment_philosophy text DEFAULT 'unknown' CHECK (investment_philosophy IN ('value_based','growth_oriented','unicorn_focused','unknown')),
  open_to_emerging_managers boolean DEFAULT NULL,
  stage_preference text DEFAULT 'unknown' CHECK (stage_preference IN ('early','growth','both','unknown')),
  thesis_notes text,
  enrichment_source text DEFAULT 'ai_scrape' CHECK (enrichment_source IN ('ai_scrape','pdl','manual')),
  confidence_score integer CHECK (confidence_score BETWEEN 0 AND 100),
  enriched_at timestamptz DEFAULT now()
);

CREATE TABLE shortlists (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE shortlist_lps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shortlist_id uuid NOT NULL REFERENCES shortlists(id) ON DELETE CASCADE,
  lp_id uuid NOT NULL REFERENCES lps(id) ON DELETE CASCADE,
  fit_score integer CHECK (fit_score BETWEEN 0 AND 100),
  added_at timestamptz DEFAULT now(),
  added_by uuid REFERENCES users(id),
  UNIQUE(shortlist_id, lp_id)
);

CREATE TABLE scoring_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value text NOT NULL,
  description text,
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE presets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  created_by uuid REFERENCES users(id) ON DELETE CASCADE,
  healthcare_weight integer NOT NULL DEFAULT 40,
  invests_in_funds_weight integer NOT NULL DEFAULT 25,
  value_based_weight integer NOT NULL DEFAULT 20,
  checksize_weight integer NOT NULL DEFAULT 10,
  geo_weight integer NOT NULL DEFAULT 5,
  emerging_manager_filter boolean NOT NULL DEFAULT true,
  list_segment_filter text[],
  lp_category_filter text[],
  country_filter text[],
  min_score_threshold integer NOT NULL DEFAULT 60,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_lps_country ON lps(country);
CREATE INDEX idx_lps_list_segment ON lps(list_segment);
CREATE INDEX idx_lps_lp_category ON lps(lp_category);
CREATE INDEX idx_enrichment_lp_id ON enrichment(lp_id);
CREATE INDEX idx_enrichment_healthcare ON enrichment(healthcare_focus);
CREATE INDEX idx_shortlist_lps_shortlist ON shortlist_lps(shortlist_id);
CREATE INDEX idx_presets_created_by ON presets(created_by);

INSERT INTO scoring_config (key, value, description) VALUES
  ('healthcare_weight', '40', 'Healthcare focus signal weight'),
  ('invests_in_funds_weight', '25', 'Invests in VC funds signal weight'),
  ('value_based_weight', '20', 'Value-based orientation signal weight'),
  ('checksize_weight', '10', 'Check size match signal weight'),
  ('geo_weight', '5', 'Invests in US funds signal weight'),
  ('check_size_min', '2000000', 'Fund minimum LP check size in USD'),
  ('check_size_max', '7000000', 'Fund maximum LP check size in USD'),
  ('healthcare_partial_score', '14', 'Points for partial healthcare focus'),
  ('healthcare_unknown_score', '8', 'Points for unknown healthcare focus'),
  ('invests_in_funds_unknown_score', '8', 'Partial credit for unknown fund investment status'),
  ('value_based_score', '20', 'Full points for value_based philosophy'),
  ('growth_oriented_score', '10', 'Partial credit for growth_oriented philosophy'),
  ('unicorn_focused_score', '0', 'Zero points for unicorn_focused philosophy'),
  ('investment_philosophy_unknown_score', '8', 'Partial credit for unknown philosophy'),
  ('check_unknown_score', '5', 'Partial credit for unknown check size'),
  ('geo_us_score', '5', 'Points for US-based LP'),
  ('geo_tier2_score', '4', 'Points for UK, Canada, Australia LP'),
  ('geo_europe_score', '3', 'Points for Western European LP'),
  ('geo_intl_fo_score', '2', 'Points for international family office LP'),
  ('geo_intl_other_score', '1', 'Points for other international LP'),
  ('band_strong_min', '80', 'Minimum score for Strong fit'),
  ('band_moderate_min', '60', 'Minimum score for Moderate fit'),
  ('band_weak_min', '40', 'Minimum score for Weak fit');
