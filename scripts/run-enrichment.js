/* eslint-disable no-console */

import "dotenv/config";
import Anthropic from "@anthropic-ai/sdk";
import { createClient } from "@supabase/supabase-js";

const isDemoMode = process.env.DEMO_MODE === "true";

if (isDemoMode) {
  console.warn("DEMO MODE: Enrichment disabled. Demo data is pre-seeded.");
  process.exit(0);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const anthropicKey = process.env.ANTHROPIC_API_KEY;

if (!supabaseUrl || !supabaseAnon) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY");
  process.exit(1);
}
if (!anthropicKey) {
  console.error("Missing ANTHROPIC_API_KEY");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnon);
const anthropic = new Anthropic({ apiKey: anthropicKey });

const MODEL = "claude-haiku-4-20250514";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTargets() {
  const { data, error } = await supabase
    .from("lps")
    .select(
      `
      id,
      name,
      website,
      linkedin_url,
      summary,
      enrichment (healthcare_focus, invests_in_funds)
    `,
    );
  if (error) throw error;
  const rows = data ?? [];
  return rows.filter((r) => {
    const e = Array.isArray(r.enrichment) ? r.enrichment[0] : r.enrichment;
    return !e || e.healthcare_focus == null || e.invests_in_funds == null;
  });
}

function buildPrompt(lp) {
  return `You are enriching a fictional LP record for a VC fundraising CRM.

Given the LP information, extract these fields as JSON:
- healthcare_focus: one of "true" | "partial" | "false" | "unknown"
- invests_in_funds: one of "true" | "false" | "unknown"
- investment_philosophy: one of "value_based" | "growth_oriented" | "unicorn_focused" | "unknown"
- open_to_emerging_managers: true | false | null
- check_size_min: number | null (USD)
- check_size_max: number | null (USD)
- decision_maker_name: string | null
- thesis_notes: string | null
- confidence_score: integer 0-100

Rules:
- Prefer null over guessing. If you are not confident, use "unknown" / null.
- If both could apply, prefer "partial" over "true".
- Only include an email if it is explicitly present; do not invent emails.
- Output JSON only. No markdown.

LP:
- name: ${lp.name}
- website: ${lp.website ?? ""}
- linkedin: ${lp.linkedin_url ?? ""}
- summary: ${lp.summary ?? ""}`.trim();
}

async function enrichOne(lp) {
  const prompt = buildPrompt(lp);
  const msg = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });
  const text = msg.content
    .filter((c) => c.type === "text")
    .map((c) => c.text)
    .join("\n")
    .trim();

  let obj;
  try {
    obj = JSON.parse(text);
  } catch (e) {
    throw new Error(`Bad JSON for ${lp.id}: ${text.slice(0, 200)}`);
  }

  return obj;
}

async function upsertEnrichment(lpId, fields) {
  const payload = {
    lp_id: lpId,
    healthcare_focus: fields.healthcare_focus ?? null,
    invests_in_funds: fields.invests_in_funds ?? "unknown",
    investment_philosophy: fields.investment_philosophy ?? "unknown",
    open_to_emerging_managers:
      fields.open_to_emerging_managers === undefined
        ? null
        : fields.open_to_emerging_managers,
    check_size_min: fields.check_size_min ?? null,
    check_size_max: fields.check_size_max ?? null,
    decision_maker_name: fields.decision_maker_name ?? null,
    thesis_notes: fields.thesis_notes ?? null,
    confidence_score:
      typeof fields.confidence_score === "number"
        ? Math.max(0, Math.min(100, Math.round(fields.confidence_score)))
        : null,
    enrichment_source: "ai_scrape",
    enriched_at: new Date().toISOString(),
  };

  const { error } = await supabase.from("enrichment").upsert(payload, {
    onConflict: "lp_id",
  });
  if (error) throw error;
}

async function main() {
  const targets = await fetchTargets();
  console.log(`Targets: ${targets.length}`);

  const batchSize = 10;
  for (let i = 0; i < targets.length; i += batchSize) {
    const batch = targets.slice(i, i + batchSize);
    const start = i + 1;
    const end = i + batch.length;

    const results = await Promise.allSettled(
      batch.map(async (lp) => {
        const fields = await enrichOne(lp);
        await upsertEnrichment(lp.id, fields);
        return { id: lp.id, name: lp.name };
      }),
    );

    const ok = results.filter((r) => r.status === "fulfilled").length;
    const bad = results.filter((r) => r.status === "rejected").length;
    console.log(`Batch ${start}-${end}: ok=${ok} failed=${bad}`);

    await sleep(2000);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

