# LP Intelligence Platform

An AI-powered LP prioritization and outreach tool for emerging VC funds.

> **Live Demo:** [your-vercel-url] — all LP data is fictional

## What It Does
- Scores 50+ LP records against your fund's criteria using a 5-signal model
- Enriches LP profiles with AI-extracted investment signals  
- Filters to a ranked shortlist using adjustable scoring weights
- Drafts personalized outreach emails in one click using Claude
- Exports shortlists as CSV

## 5-Signal Scoring Model
| Signal | Default Weight | What It Measures |
|---|---|---|
| Healthcare focus | 40% | Does this LP invest in healthcare? |
| Invests in VC funds | 25% | Does this LP commit to fund structures? |
| Value-based orientation | 20% | Does this LP prioritize value creation? |
| Check size match | 10% | Is this LP's check size in target range? |
| Invests in US funds | 5% | Is this LP active in US-domiciled funds? |

Plus: Emerging manager pre-filter

## Tech Stack
Next.js 14 · TypeScript · Supabase · Claude API · Tailwind CSS · Vercel · Google OAuth

## Running Locally
```bash
git clone https://github.com/tejaswarpadala-a11y/lp-intelligence-demo
cd lp-intelligence-demo
npm install
cp .env.example .env.local
# Fill in your keys
npm run dev
```

## Adapting for Your Fund
Set these env vars:
```
NEXT_PUBLIC_FUND_NAME=Your Fund Name
NEXT_PUBLIC_GP_NAME=Your Name
NEXT_PUBLIC_GP_TITLE=General Partner
NEXT_PUBLIC_FUND_FOCUS=Your investment thesis
NEXT_PUBLIC_CHECK_SIZE_MIN=1000000
NEXT_PUBLIC_CHECK_SIZE_MAX=5000000
```

## Demo Data
All 50 LP records are fictional. The scoring engine, enrichment signals,
and email agent are identical to the production system.

## Built By
MBA engineer-turned-VC Associate. Built as an internal tool for a healthcare
VC fund actively raising its next fund.

---
MIT License
