import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import Link from "next/link";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CxLL — Voice Agent Dashboard",
  description: "Next-Gen Voice Agent Orchestration",
};

function NavBar() {
  return (
    <nav className="fixed top-0 left-0 right-0 z-50 bg-black/60 backdrop-blur-xl border-b border-white/5">
      <div className="max-w-7xl mx-auto px-6 h-14 flex items-center justify-between">
        <Link href="/" className="text-lg font-bold tracking-tight">
          <span className="text-white">Cx</span>
          <span className="bg-clip-text text-transparent bg-gradient-to-r from-blue-500 to-purple-500">LL</span>
        </Link>
        <div className="flex items-center gap-1">
          <Link
            href="/"
            className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Calls
          </Link>
          <Link
            href="/campaigns"
            className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Campaigns
          </Link>
          <Link
            href="/monitor"
            className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Monitor
          </Link>
          <Link
            href="/analytics"
            className="px-4 py-2 text-sm text-gray-400 hover:text-white rounded-lg hover:bg-white/5 transition-colors"
          >
            Analytics
          </Link>
        </div>
      </div>
    </nav>
  );
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>
        <NavBar />
        <div className="pt-14">
          {children}
        </div>
      </body>
    </html>
  );
}
