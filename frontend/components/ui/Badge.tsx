"use client";

import React from "react";

type BadgeVariant =
  | "win"
  | "loss"
  | "open"
  | "buy"
  | "sell"
  | "free"
  | "pro"
  | "elite"
  | "auto"
  | "backtest"
  | "real";

interface BadgeProps {
  variant: BadgeVariant;
  children?: React.ReactNode;
  className?: string;
}

const VARIANT_STYLES: Record<BadgeVariant, string> = {
  win: "bg-green/10 text-green border border-green/30",
  loss: "bg-red/10 text-red border border-red/30",
  open: "bg-blue/10 text-blue border border-blue/30",
  buy: "bg-green/10 text-green border border-green/30",
  sell: "bg-red/10 text-red border border-red/30",
  free: "bg-dim/20 text-dim border border-dim/30",
  pro: "bg-blue/10 text-blue border border-blue/30",
  elite: "bg-yellow/10 text-yellow border border-yellow/30",
  auto: "bg-blue/10 text-blue border border-blue/30",
  backtest: "bg-yellow/10 text-yellow border border-yellow/30",
  real: "bg-green/10 text-green border border-green/30",
};

const VARIANT_LABELS: Partial<Record<BadgeVariant, string>> = {
  win: "WIN",
  loss: "LOSS",
  open: "OPEN",
  buy: "BUY",
  sell: "SELL",
  free: "FREE",
  pro: "PRO",
  elite: "ELITE",
  auto: "AUTO",
  backtest: "BACKTEST",
  real: "REAL",
};

export function Badge({ variant, children, className = "" }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium font-mono tracking-wider uppercase ${VARIANT_STYLES[variant]} ${className}`}
    >
      {children ?? VARIANT_LABELS[variant]}
    </span>
  );
}
