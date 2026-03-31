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

async function requireUserId(
  supabase: ReturnType<typeof createClient>,
): Promise<string> {
  if (process.env.DEMO_MODE === "true") return PLACEHOLDER_USER_ID;

  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) throw new Error("Not authenticated");
  return user.id;
}

async function assertOwnsShortlist(
  supabase: ReturnType<typeof createClient>,
  shortlistId: string,
  userId: string,
): Promise<void> {
  let q = supabase
    .from("shortlists")
    .select("id")
    .eq("id", shortlistId);

  if (process.env.DEMO_MODE === "true") {
    q = q.or(`created_by.eq.${userId},created_by.is.null`);
  } else {
    q = q.eq("created_by", userId);
  }

  const { data, error } = await q.maybeSingle();

  if (error) throw error;
  if (!data) throw new Error("Shortlist not found");
}

export async function getUserShortlists(): Promise<UserShortlistSummary[]> {
  const supabase = createClient();
  const userId = await requireUserId(supabase);

  let q = supabase
    .from("shortlists")
    .select(
      `
      id,
      name,
      created_at,
      shortlist_lps(count)
    `,
    )
    .order("created_at", { ascending: true });

  if (process.env.DEMO_MODE === "true") {
    q = q.or(`created_by.eq.${userId},created_by.is.null`);
  } else {
    q = q.eq("created_by", userId);
  }

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
  const userId = await requireUserId(supabase);

  const { data, error } = await supabase
    .from("shortlists")
    .insert({
      name: name.trim() || "Untitled",
      created_by: userId,
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
  const userId = await requireUserId(supabase);
  await assertOwnsShortlist(supabase, shortlistId, userId);

  const score = Math.round(
    Math.min(100, Math.max(0, Number.isFinite(fitScore) ? fitScore : 0)),
  );
  const { error } = await supabase.from("shortlist_lps").insert({
    shortlist_id: shortlistId,
    lp_id: lpId,
    fit_score: score,
    added_by: userId,
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
  const userId = await requireUserId(supabase);
  await assertOwnsShortlist(supabase, shortlistId, userId);

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
  const userId = await requireUserId(supabase);
  await assertOwnsShortlist(supabase, shortlistId, userId);

  let q = supabase
    .from("shortlists")
    .update({
      name: newName.trim() || "Untitled",
      updated_at: new Date().toISOString(),
    })
    .eq("id", shortlistId);

  if (process.env.DEMO_MODE === "true") {
    q = q.or(`created_by.eq.${userId},created_by.is.null`);
  } else {
    q = q.eq("created_by", userId);
  }

  const { error } = await q;
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
  const userId = await requireUserId(supabase);

  let slq = supabase
    .from("shortlists")
    .select("id, name, created_at, updated_at")
    .eq("id", shortlistId);

  if (process.env.DEMO_MODE === "true") {
    slq = slq.or(`created_by.eq.${userId},created_by.is.null`);
  } else {
    slq = slq.eq("created_by", userId);
  }

  const { data: shortlistRow, error: slErr } = await slq.maybeSingle();

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

export async function getMostRecentShortlistNav(): Promise<{
  id: string;
  name: string;
  lp_count: number;
} | null> {
  const supabase = createClient();
  const userId = await requireUserId(supabase);

  let q = supabase
    .from("shortlists")
    .select(
      `
      id,
      name,
      shortlist_lps(count)
    `,
    );

  if (process.env.DEMO_MODE === "true") {
    q = q.or(`created_by.eq.${userId},created_by.is.null`);
  } else {
    q = q.eq("created_by", userId);
  }

  const { data, error } = await q
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;

  const rawCount = data.shortlist_lps as { count?: number }[] | undefined;
  const lp_count =
    Array.isArray(rawCount) && rawCount[0] && typeof rawCount[0].count === "number"
      ? rawCount[0].count
      : 0;

  return {
    id: String(data.id),
    name: String(data.name),
    lp_count,
  };
}

export async function isLPInAnyShortlist(lpId: string): Promise<boolean> {
  if (process.env.DEMO_MODE === "true") return true;

  const supabase = createClient();
  const userId = await requireUserId(supabase);

  const { data, error } = await supabase
    .from("shortlist_lps")
    .select(
      `
      id,
      shortlists!inner(id, created_by)
    `,
    )
    .eq("lp_id", lpId)
    .eq("shortlists.created_by", userId)
    .limit(1);

  if (error) return false;
  return Boolean(data && data.length > 0);
}
