export const FUND_CONFIG = {
  fundName: process.env.NEXT_PUBLIC_FUND_NAME || "HealthVC Fund",
  gpName: process.env.NEXT_PUBLIC_GP_NAME || "Alex Morgan",
  gpTitle: process.env.NEXT_PUBLIC_GP_TITLE || "General Partner",
  fundFocus:
    process.env.NEXT_PUBLIC_FUND_FOCUS ||
    "AI-first B2B SaaS healthcare companies",
  fundStage: process.env.NEXT_PUBLIC_FUND_STAGE || "Seed to Series A",
  checkSizeMin: Number(process.env.NEXT_PUBLIC_CHECK_SIZE_MIN) || 2_000_000,
  checkSizeMax: Number(process.env.NEXT_PUBLIC_CHECK_SIZE_MAX) || 7_000_000,
} as const;

export const isDemoMode = process.env.DEMO_MODE === "true";
