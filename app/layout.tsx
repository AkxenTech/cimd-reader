import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";

import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "CIMD Validator",
  description: "Validate MCP OAuth Client ID Metadata Document support across developer tools."
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}>
        <header className="border-b border-line bg-white">
          <div className="mx-auto flex max-w-7xl flex-col gap-4 px-4 py-5 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <Link href="/" className="text-lg font-semibold tracking-tight">
              CIMD Validator
            </Link>
            <nav className="flex gap-2 text-sm text-slate-600">
              <Link className="rounded-md px-3 py-2 hover:bg-slate-100 hover:text-ink" href="/">
                Clients
              </Link>
              <Link className="rounded-md px-3 py-2 hover:bg-slate-100 hover:text-ink" href="/sessions">
                Sessions
              </Link>
              <Link className="rounded-md px-3 py-2 hover:bg-slate-100 hover:text-ink" href="/.well-known/oauth-authorization-server">
                Metadata
              </Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
