import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "alert-hub",
  description: "Receive, dedup, and route fired alarms — the event plane.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="min-h-screen antialiased">
        <header className="border-b border-slate-200 bg-white">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
            <Link href="/" className="text-lg font-semibold text-slate-900">
              alert-hub
            </Link>
            <div className="flex items-center gap-4">
              <Link href="/admin" className="text-sm text-slate-600 hover:text-blue-600">
                관리
              </Link>
              <span className="text-sm text-slate-400">event plane · MVP</span>
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
      </body>
    </html>
  );
}
