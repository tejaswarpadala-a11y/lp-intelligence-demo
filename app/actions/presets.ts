"use server";

import { PLACEHOLDER_USER_ID } from "@/lib/shortlist";
import { createClient } from "@/lib/supabase/server";
import type { ScoringWeights } from "@/lib/types";

export type PresetFilters = {
  emergingManagerFilter: boolean;
  selectedListSegments: string[];
  selectedCategories: string[];
  selectedCountries: string[];
  minScoreThreshold: number;
};

export type PresetRecord = {
  id: string;
  name: string;
  created_by: string | null;
  healthcare_weight: number;
  invests_in_funds_weight: number;
  value_based_weight: number;
  checksize_weight: number;
  geo_weight: number;
  emerging_manager_filter: boolean;
  list_segment_filter: string[] | null;
  lp_category_filter: string[] | null;
  country_filter: string[] | null;
  min_score_threshold: number;
  created_at: string;
};

async function getUserId(): Promise<string> {
  if (process.env.DEMO_MODE === "true") return PLACEHOLDER_USER_ID;
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Not authenticated");
  return user.id;
}

export async function savePreset(
  name: string,
  weights: ScoringWeights,
  filters: PresetFilters,
): Promise<{ id: string }> {
  const supabase = createClient();
  const userId = await getUserId();

  const { data, error } = await supabase
    .from("presets")
    .insert({
      name: name.trim() || "Untitled preset",
      created_by: userId,
      healthcare_weight: Math.round(weights.healthcare),
      invests_in_funds_weight: Math.round(weights.invests_in_funds),
      value_based_weight: Math.round(weights.value_based),
      checksize_weight: Math.round(weights.check_size),
      geo_weight: Math.round(weights.geography),
      emerging_manager_filter: filters.emergingManagerFilter,
      list_segment_filter: filters.selectedListSegments,
      lp_category_filter: filters.selectedCategories,
      country_filter: filters.selectedCountries,
      min_score_threshold: Math.round(filters.minScoreThreshold),
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: String(data.id) };
}

export async function listPresets(): Promise<PresetRecord[]> {
  const supabase = createClient();
  const userId = await getUserId();

  let q = supabase.from("presets").select("*").order("created_at", {
    ascending: false,
  });

  if (process.env.DEMO_MODE === "true") {
    q = q.or(`created_by.eq.${userId},created_by.is.null`);
  } else {
    q = q.eq("created_by", userId);
  }

  const { data, error } = await q;
  if (error) throw error;
  return (data ?? []) as PresetRecord[];
}

export async function loadPreset(presetId: string): Promise<PresetRecord | null> {
  const supabase = createClient();
  const userId = await getUserId();

  let q = supabase.from("presets").select("*").eq("id", presetId);
  if (process.env.DEMO_MODE === "true") {
    q = q.or(`created_by.eq.${userId},created_by.is.null`);
  } else {
    q = q.eq("created_by", userId);
  }

  const { data, error } = await q.maybeSingle();
  if (error) throw error;
  return (data ?? null) as PresetRecord | null;
}

export async function deletePreset(presetId: string): Promise<void> {
  const supabase = createClient();
  const userId = await getUserId();

  const { error } = await supabase
    .from("presets")
    .delete()
    .eq("id", presetId)
    .eq("created_by", userId);

  if (error) throw error;
}

