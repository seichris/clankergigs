import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "gh-bounties (Sui)",
  description: "Sui-native GitHub bounties",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-white text-slate-900">
        <Providers>
          <div className="mx-auto w-full max-w-5xl px-6 py-6">{children}</div>
        </Providers>
      </body>
    </html>
  );
}
