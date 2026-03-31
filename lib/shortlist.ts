import type { Enrichment, LP } from "@/lib/types";

export const PLACEHOLDER_USER_ID = "00000000-0000-0000-0000-000000000001";

export type UserShortlistSummary = {
  id: string;
  name: string;
  created_at: string;
  lp_count: number;
};

export type ShortlistWithLPs = {
  shortlist: {
    id: string;
    name: string;
    created_at: string;
    updated_at: string;
  };
  lps: Array<{
    lp: LP;
    enrichment: Enrichment | null;
    fit_score: number;
    added_at: string;
  }>;
};
