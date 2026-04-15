"use client";

import React from "react";

interface CardProps {
  title?: string;
  children: React.ReactNode;
  className?: string;
  action?: React.ReactNode;
}

export function Card({ title, children, className = "", action }: CardProps) {
  return (
    <div
      className={`bg-surface border border-border rounded-lg ${className}`}
    >
      {title && (
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <span className="text-xs font-medium text-dim uppercase tracking-widest">
            {title}
          </span>
          {action && <div>{action}</div>}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}
