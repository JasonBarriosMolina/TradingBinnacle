"use client";

import React from "react";
import Link from "next/link";
import { Card } from "@/components/ui/Card";

export default function BacktestPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-white">Backtesting</h1>
        <p className="text-xs text-dim mt-0.5">Prueba tu estrategia en datos históricos</p>
      </div>
      <Card>
        <div className="text-center py-10">
          <div className="text-4xl mb-4" style={{ color: "#1a2035" }}>◫</div>
          <p className="text-sm text-dim mb-3">
            Registra operaciones de backtest desde la Bitácora
          </p>
          <Link
            href="/journal"
            className="inline-flex items-center gap-2 px-4 py-2 rounded text-xs transition-colors"
            style={{ background: "rgba(0,229,160,0.1)", border: "1px solid rgba(0,229,160,0.2)", color: "#00e5a0" }}
          >
            Ir a Bitácora →
          </Link>
        </div>
      </Card>
    </div>
  );
}
