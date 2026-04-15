"use client";

import React from "react";

interface LoadingSkeletonProps {
  className?: string;
  rows?: number;
}

export function LoadingSkeleton({
  className = "",
  rows = 1,
}: LoadingSkeletonProps) {
  return (
    <div className={`space-y-2 ${className}`}>
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="bg-surface2 rounded skeleton-pulse"
          style={{ height: "20px", opacity: 0.6 - i * 0.1 }}
        />
      ))}
    </div>
  );
}

export function CardSkeleton({ className = "" }: { className?: string }) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg p-4 skeleton-pulse ${className}`}
    >
      <div className="h-3 bg-surface2 rounded w-1/3 mb-3" />
      <div className="h-7 bg-surface2 rounded w-1/2 mb-2" />
      <div className="h-3 bg-surface2 rounded w-2/3" />
    </div>
  );
}

export function TableSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }).map((_, i) => (
        <div
          key={i}
          className="bg-surface border border-border rounded h-10 skeleton-pulse"
          style={{ opacity: 1 - i * 0.15 }}
        />
      ))}
    </div>
  );
}
