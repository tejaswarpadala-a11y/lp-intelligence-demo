"use server";

import { FUND_CONFIG } from "@/lib/config";
import { calculateScore, getScoringConfig, parseSupabaseLps } from "@/lib/scoring";
import { createClient } from "@/lib/supabase/server";
import Anthropic from "@anthropic-ai/sdk";

type DraftResult =
  | { draft: string; email: string }
  | { error: string };

function formatUsdMillions(n: number): string {
  const m = n / 1_000_000;
  return Number.isFinite(m) ? String(Math.round(m)) : String(n);
}

export async function draftOutreachEmail(lpId: string): Promise<DraftResult> {
  const supabase = createClient();

  const { data: raw, error } = await supabase
    .from("lps")
    .select("*, enrichment(*)")
    .eq("id", lpId)
    .single();

  if (error || !raw) return { error: "LP not found" };

  const [parsed] = parseSupabaseLps([raw]);
  if (!parsed) return { error: "LP not found" };

  const lp = parsed;
  const enrichment = parsed.enrichment;

  if (process.env.DEMO_MODE !== "true") {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return { error: "Not authenticated" };

    const { data: links, error: linkErr } = await supabase
      .from("shortlist_lps")
      .select(
        `
        id,
        shortlists!inner(id, created_by)
      `,
      )
      .eq("lp_id", lpId)
      .eq("shortlists.created_by", user.id)
      .limit(1);

    if (linkErr) return { error: "Could not verify shortlist membership" };
    if (!links || links.length === 0) {
      return {
        error: "Add this LP to your shortlist to unlock email drafting",
      };
    }
  }

  const email = enrichment?.enriched_email?.trim() || lp.contact_email?.trim() || "";
  if (!email) return { error: "No email found for this LP" };

  const config = await getScoringConfig(supabase);
  const score = calculateScore(lp, enrichment, config);

  const decisionMaker =
    enrichment?.decision_maker_name?.trim() || "the investment team";

  const checkSizeMinM = formatUsdMillions(FUND_CONFIG.checkSizeMin);
  const checkSizeMaxM = formatUsdMillions(FUND_CONFIG.checkSizeMax);

  const system =
    "You are a venture capital associate drafting a first-contact LP outreach email.\n" +
    "Write professionally but personally. Be specific — reference the LP's actual\n" +
    "investment thesis. Keep under 200 words. No generic openers like\n" +
    "'I hope this email finds you well.' No placeholders like [NAME].";

  const userPrompt =
    `Draft a first outreach email from ${FUND_CONFIG.gpName}, ${FUND_CONFIG.gpTitle}\n` +
    `of ${FUND_CONFIG.fundName}, to ${decisionMaker}\n` +
    `at ${lp.name}.\n\n` +
    `LP Profile:\n` +
    `- Organization: ${lp.name}\n` +
    `- Location: ${lp.location ?? ""}\n` +
    `- Category: ${lp.lp_category ?? ""}\n` +
    `- Investment thesis: ${enrichment?.thesis_notes ?? "Not available"}\n` +
    `- Healthcare focus: ${enrichment?.healthcare_focus ?? "unknown"}\n` +
    `- Investment philosophy: ${enrichment?.investment_philosophy ?? "unknown"}\n` +
    `- Fit score: ${score.total_score}/100\n\n` +
    `Fund Context:\n` +
    `We are ${FUND_CONFIG.fundName}, investing in ${FUND_CONFIG.fundFocus}.\n` +
    `Stage: ${FUND_CONFIG.fundStage}.\n` +
    `Target check size: $${checkSizeMinM}M to $${checkSizeMaxM}M.\n` +
    `We are emerging managers with deep healthcare operator networks.\n\n` +
    `Write a concise personalized first-outreach email. Include:\n` +
    `1. One specific sentence referencing the LP's actual investment focus\n` +
    `2. Brief explanation of why ${FUND_CONFIG.fundName} fits their portfolio\n` +
    `3. Low-friction ask (15-minute call)\n\n` +
    `Return only the email body — no subject line.`;

  const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  try {
    const msg = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 800,
      system,
      messages: [{ role: "user", content: userPrompt }],
    });

    const text =
      msg.content
        .filter((c) => c.type === "text")
        .map((c) => c.text)
        .join("\n")
        .trim() || "";

    if (!text) return { error: "No draft generated" };

    return { draft: text, email };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Drafting failed" };
  }
}

