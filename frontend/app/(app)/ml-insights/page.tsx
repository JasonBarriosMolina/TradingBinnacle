"use client";

import React from "react";
import { Card } from "@/components/ui/Card";

export default function MLInsightsPage() {
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-lg font-semibold text-white">ML Insights</h1>
        <p className="text-xs text-dim mt-0.5">Predicciones basadas en machine learning</p>
      </div>
      <Card>
        <div className="text-center py-10">
          <div className="text-4xl mb-4" style={{ color: "#1a2035" }}>◬</div>
          <p className="text-sm text-dim">Módulo ML en desarrollo — próximamente disponible</p>
        </div>
      </Card>
    </div>
  );
}
