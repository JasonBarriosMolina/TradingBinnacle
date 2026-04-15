"use client";

import React from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { Badge } from "./Badge";

interface NavItem {
  href: string;
  label: string;
  icon: string;
  plans?: ("free" | "pro" | "elite" | "admin")[];
}

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: "▣", plans: ["free", "pro", "elite", "admin"] },
  { href: "/signals", label: "Señales", icon: "◈", plans: ["pro", "elite", "admin"] },
  { href: "/journal", label: "Bitácora", icon: "◧", plans: ["free", "pro", "elite", "admin"] },
  { href: "/ml-insights", label: "ML Insights", icon: "◬", plans: ["pro", "elite", "admin"] },
  { href: "/copilot", label: "Copiloto", icon: "◉", plans: ["pro", "elite", "admin"] },
  { href: "/backtest", label: "Backtesting", icon: "◫", plans: ["free", "pro", "elite", "admin"] },
  { href: "/settings", label: "Settings", icon: "◌", plans: ["free", "pro", "elite", "admin"] },
  { href: "/admin", label: "Admin", icon: "⊞", plans: ["admin"] },
];

const PLAN_VARIANT = {
  free: "free",
  pro: "pro",
  elite: "elite",
  admin: "elite",
} as const;

export function NavBar() {
  const pathname = usePathname();
  const { user, logout } = useAuth();
  const plan = (user?.plan ?? "free") as "free" | "pro" | "elite";
  const isAdmin = user?.groups?.includes("admin") ?? false;
  const effectivePlan = isAdmin ? "admin" : plan;

  const visibleItems = NAV_ITEMS.filter((item) =>
    item.plans?.includes(effectivePlan as "free" | "pro" | "elite" | "admin")
  );

  return (
    <>
      {/* Desktop sidebar */}
      <nav className="hidden md:flex flex-col fixed left-0 top-0 h-full w-56 bg-surface border-r border-border z-40">
        {/* Logo */}
        <div className="px-4 py-5 border-b border-border">
          <span className="text-green font-bold text-lg tracking-widest">SYNTRA</span>
          <span className="text-dim text-xs ml-1">2.0</span>
        </div>

        {/* Nav links */}
        <div className="flex-1 overflow-y-auto py-3">
          {visibleItems.map((item) => {
            const active = pathname === item.href || pathname.startsWith(item.href + "/");
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm transition-colors ${
                  active
                    ? "text-green bg-green/5 border-r-2 border-green"
                    : "text-dim hover:text-white hover:bg-surface2"
                }`}
              >
                <span className="text-base w-5 text-center">{item.icon}</span>
                {item.label}
              </Link>
            );
          })}
        </div>

        {/* Upgrade CTA for free/pro */}
        {(plan === "free" || plan === "pro") && (
          <div className="px-4 py-3 border-t border-border">
            <Link
              href="/upgrade"
              className="flex items-center gap-2 px-3 py-2 rounded bg-yellow/10 border border-yellow/20 text-yellow text-xs hover:bg-yellow/20 transition-colors"
            >
              <span>★</span> Upgrade a{" "}
              {plan === "free" ? "PRO" : "ELITE"}
            </Link>
          </div>
        )}

        {/* User info */}
        <div className="px-4 py-3 border-t border-border">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-xs text-white truncate">
                {user?.email ?? "—"}
              </p>
              <Badge variant={PLAN_VARIANT[effectivePlan]} className="mt-1">
                {effectivePlan.toUpperCase()}
              </Badge>
            </div>
            <button
              onClick={logout}
              className="text-dim hover:text-red text-xs shrink-0"
              title="Cerrar sesión"
            >
              ⏻
            </button>
          </div>
        </div>
      </nav>

      {/* Mobile bottom bar */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-surface border-t border-border z-40 flex">
        {visibleItems.slice(0, 5).map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex-1 flex flex-col items-center py-2 text-xs transition-colors ${
                active ? "text-green" : "text-dim"
              }`}
            >
              <span className="text-lg">{item.icon}</span>
              <span className="text-[10px] mt-0.5 truncate">{item.label}</span>
            </Link>
          );
        })}
      </nav>
    </>
  );
}
