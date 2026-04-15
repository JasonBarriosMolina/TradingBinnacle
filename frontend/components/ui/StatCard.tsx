"use client";

import React from "react";

interface StatCardProps {
  label: string;
  value: string | number;
  trend?: "up" | "down" | "neutral";
  positive?: boolean;
  className?: string;
  subtext?: string;
}

export function StatCard({
  label,
  value,
  trend,
  positive,
  className = "",
  subtext,
}: StatCardProps) {
  const valueColor =
    positive === undefined
      ? "text-white"
      : positive
      ? "text-green"
      : "text-red";

  const trendIcon =
    trend === "up" ? "▲" : trend === "down" ? "▼" : null;

  const trendColor =
    trend === "up" ? "text-green" : trend === "down" ? "text-red" : "text-dim";

  return (
    <div
      className={`bg-surface border border-border rounded-lg p-4 flex flex-col gap-1 ${className}`}
    >
      <span className="text-xs text-dim uppercase tracking-widest">{label}</span>
      <div className="flex items-end gap-2">
        <span className={`text-2xl font-semibold tabular-nums ${valueColor}`}>
          {value}
        </span>
        {trendIcon && (
          <span className={`text-sm pb-0.5 ${trendColor}`}>{trendIcon}</span>
        )}
      </div>
      {subtext && (
        <span className="text-xs text-dim">{subtext}</span>
      )}
    </div>
  );
}
