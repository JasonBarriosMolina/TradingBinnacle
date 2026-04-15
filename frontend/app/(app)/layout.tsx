"use client";

import React, { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/context/AuthContext";
import { NavBar } from "@/components/ui/NavBar";

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-bg">
        <div className="text-green text-sm tracking-widest animate-pulse">SYNTRA...</div>
      </div>
    );
  }

  if (!user) return null;

  return (
    <div className="min-h-screen bg-bg">
      <NavBar />
      {/* Main content — offset for sidebar on desktop, bottom bar on mobile */}
      <main className="md:ml-56 pb-16 md:pb-0 min-h-screen">
        <div className="max-w-6xl mx-auto p-4 md:p-6">{children}</div>
      </main>
    </div>
  );
}
