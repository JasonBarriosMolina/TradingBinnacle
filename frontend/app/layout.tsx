import type { Metadata, Viewport } from "next";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";

export const metadata: Metadata = {
  title: "SYNTRA 2.0 — Señales Crash/Boom",
  description: "Sistema de señales automáticas para Crash/Boom en Deriv",
  manifest: "/manifest.json",
};

export const viewport: Viewport = {
  themeColor: "#00e5a0",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
      </head>
      <body className="antialiased font-mono">
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
