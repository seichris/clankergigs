import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const siteOrigin =
  process.env.NEXT_PUBLIC_WEB_ORIGIN ||
  (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3001");
const metadataBase = new URL(siteOrigin);

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase,
  title: "ClankerGigs",
  applicationName: "ClankerGigs",
  description: "Fund Open Source. Ship code. Earn ETH.",
  keywords: [
    "ClankerGigs",
    "GitHub bounties",
    "open source funding",
    "crypto bounties",
    "issue bounties",
  ],
  icons: {
    icon: [
      { url: "/favicon_black.ico", media: "(prefers-color-scheme: light)" },
      { url: "/favicon_white.ico", media: "(prefers-color-scheme: dark)" },
    ],
    shortcut: "/favicon_black.ico",
  },
  openGraph: {
    title: "ClankerGigs",
    description: "Fund Open Source. Ship code. Earn ETH.",
    url: "/",
    siteName: "ClankerGigs",
    images: [
      {
        url: "/clankergigs_light.png",
        width: 1200,
        height: 630,
        alt: "ClankerGigs social preview (light)",
      },
      {
        url: "/clankergigs_dark.png",
        width: 1200,
        height: 630,
        alt: "ClankerGigs social preview (dark)",
      },
    ],
    locale: "en_US",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ClankerGigs",
    description: "Fund Open Source. Ship code. Earn ETH.",
    images: ["/clankergigs_light.png"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  alternates: {
    canonical: "/",
  },
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#ffffff" },
    { media: "(prefers-color-scheme: dark)", color: "#0d0d0d" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const themeScript = `
    try {
      const stored = localStorage.getItem("ghb-theme");
      const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
      const theme = stored || (prefersDark ? "dark" : "light");
      if (theme === "dark") document.documentElement.classList.add("dark");
    } catch {}
  `;

  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className={`${geistSans.variable} ${geistMono.variable} antialiased`}>
        <Providers>
          {children}
        </Providers>
      </body>
    </html>
  );
}
