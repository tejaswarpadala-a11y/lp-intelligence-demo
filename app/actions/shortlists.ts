"use server";

import { parseSupabaseLps } from "@/lib/scoring";
import {
  PLACEHOLDER_USER_ID,
  type ShortlistWithLPs,
  type UserShortlistSummary,
} from "@/lib/shortlist";
import { createClient } from "@/lib/supabase/server";

function isUniqueViolation(error: { code?: string; message?: string }): boolean {
  return (
    error.code === "23505" ||
    (error.message?.toLowerCase().includes("duplicate") ?? false)
  );
}

export async function getUserShortlists(): Promise<UserShortlistSummary[]> {
  const supabase = createClient();
  const q = supabase
    .from("shortlists")
    .select(
      `
      id,
      name,
      created_at,
      shortlist_lps(count)
    `,
    )
    .or(`created_by.eq.${PLACEHOLDER_USER_ID},created_by.is.null`)
    .order("created_at", { ascending: true });

  const { data, error } = await q;
  if (error) throw error;

  return (data ?? []).map((row: Record<string, unknown>) => {
    const rawCount = row.shortlist_lps as { count?: number }[] | undefined;
    const count =
      Array.isArray(rawCount) && rawCount[0] && typeof rawCount[0].count === "number"
        ? rawCount[0].count
        : 0;
    return {
      id: String(row.id),
      name: String(row.name),
      created_at: String(row.created_at),
      lp_count: count,
    };
  });
}

export async function createShortlist(name: string): Promise<{ id: string }> {
  const supabase = createClient();
  const { data, error } = await supabase
    .from("shortlists")
    .insert({
      name: name.trim() || "Untitled",
      created_by: PLACEHOLDER_USER_ID,
    })
    .select("id")
    .single();

  if (error) throw error;
  return { id: String(data.id) };
}

export async function addLPToShortlist(
  shortlistId: string,
  lpId: string,
  fitScore: number,
): Promise<{ success: true } | { already_exists: true }> {
  const supabase = createClient();
  const score = Math.round(
    Math.min(100, Math.max(0, Number.isFinite(fitScore) ? fitScore : 0)),
  );
  const { error } = await supabase.from("shortlist_lps").insert({
    shortlist_id: shortlistId,
    lp_id: lpId,
    fit_score: score,
    added_by: PLACEHOLDER_USER_ID,
  });

  if (error) {
    if (isUniqueViolation(error)) return { already_exists: true };
    throw error;
  }
  return { success: true };
}

export async function removeLPFromShortlist(
  shortlistId: string,
  lpId: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("shortlist_lps")
    .delete()
    .eq("shortlist_id", shortlistId)
    .eq("lp_id", lpId);
  if (error) throw error;
}

export async function renameShortlist(
  shortlistId: string,
  newName: string,
): Promise<void> {
  const supabase = createClient();
  const { error } = await supabase
    .from("shortlists")
    .update({
      name: newName.trim() || "Untitled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", shortlistId);
  if (error) throw error;
}

function unwrapLps(
  raw: unknown,
): Record<string, unknown> | null {
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

export async function getShortlistWithLPs(
  shortlistId: string,
): Promise<ShortlistWithLPs | null> {
  const supabase = createClient();

  const { data: shortlistRow, error: slErr } = await supabase
    .from("shortlists")
    .select("id, name, created_at, updated_at")
    .eq("id", shortlistId)
    .maybeSingle();

  if (slErr) throw slErr;
  if (!shortlistRow) return null;

  const { data: linkRows, error: linkErr } = await supabase
    .from("shortlist_lps")
    .select(
      `
      fit_score,
      added_at,
      lps (
        *,
        enrichment (*)
      )
    `,
    )
    .eq("shortlist_id", shortlistId);

  if (linkErr) throw linkErr;

  const lps: ShortlistWithLPs["lps"] = [];

  for (const row of (linkRows ?? []) as Array<Record<string, unknown>>) {
    const fit_score = Number(row.fit_score);
    const added_at = String(row.added_at);
    const lpRaw = unwrapLps(row.lps);
    if (!lpRaw) continue;
    const [parsed] = parseSupabaseLps([lpRaw] as unknown as Record<
      string,
      unknown
    >[]);
    if (!parsed) continue;
    lps.push({
      lp: parsed,
      enrichment: parsed.enrichment,
      fit_score: Number.isFinite(fit_score) ? fit_score : 0,
      added_at,
    });
  }

  return {
    shortlist: {
      id: String(shortlistRow.id),
      name: String(shortlistRow.name),
      created_at: String(shortlistRow.created_at),
      updated_at: String(shortlistRow.updated_at),
    },
    lps,
  };
}
