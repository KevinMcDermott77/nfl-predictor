import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "NFL Predictor",
  description: "Algorithm-generated NFL game winner predictions",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <nav className="border-b border-white/5 bg-[var(--bg-card)]">
          <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between">
            <Link href="/" className="text-lg font-bold text-[var(--text-primary)]">
              NFL Predictor
            </Link>
            <div className="flex gap-6 text-sm">
              <Link
                href="/"
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Predictions
              </Link>
              <Link
                href="/accuracy"
                className="text-[var(--text-secondary)] hover:text-[var(--text-primary)] transition-colors"
              >
                Accuracy
              </Link>
            </div>
          </div>
        </nav>
        <main className="flex-1">{children}</main>
      </body>
    </html>
  );
}
