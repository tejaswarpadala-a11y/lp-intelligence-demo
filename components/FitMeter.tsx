"use client";

import type { FitLabel } from "@/lib/types";

type FitMeterProps = {
  score: number | null;
  showNumber?: boolean;
  label?: FitLabel;
};

function bandLabel(score: number): FitLabel {
  if (score >= 80) return "Strong fit";
  if (score >= 60) return "Moderate fit";
  if (score >= 40) return "Weak fit";
  return "Poor fit";
}

function filledCount(score: number): number {
  if (score >= 80) return 5;
  if (score >= 60) return 4;
  if (score >= 40) return 3;
  if (score >= 20) return 2;
  return score > 0 ? 1 : 0;
}

function fillColor(score: number): string {
  if (score >= 80) return "bg-emerald-500";
  if (score >= 60) return "bg-emerald-400";
  if (score >= 40) return "bg-amber-400";
  if (score >= 20) return "bg-slate-300";
  return "bg-slate-200";
}

export function FitMeter({ score, showNumber = false, label }: FitMeterProps) {
  const scored = typeof score === "number" && Number.isFinite(score) && score > 0;
  const s = scored ? Math.max(0, Math.min(100, Math.round(score))) : 0;
  const n = scored ? filledCount(s) : 0;
  const fill = scored ? fillColor(s) : "bg-slate-100";
  const l = scored ? (label ?? bandLabel(s)) : null;

  return (
    <div
      className="flex items-center gap-2"
      title={scored && l ? `${s} · ${l}` : undefined}
    >
      <div className="flex items-center gap-px">
        {Array.from({ length: 5 }).map((_, i) => (
          <span
            key={i}
            className={`h-[14px] w-[8px] ${i < n ? fill : "bg-slate-100"}`}
          />
        ))}
      </div>
      {showNumber ? (
        <span className="font-mono text-sm text-slate-700">
          {scored ? s : "—"}
        </span>
      ) : null}
    </div>
  );
}

