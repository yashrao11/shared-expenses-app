import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SplitSmart - Shared Roommate Expenses & Ingestion Engine",
  description: "Efficiently track, optimize, and simplify shared roommate expenses, resolve CSV anomalies, and minimize transactions with peer-to-peer debt simplification.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className="h-full antialiased font-sans"
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
