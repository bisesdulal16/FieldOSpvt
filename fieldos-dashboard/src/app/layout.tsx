import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

/** Fetch branding at runtime so the dashboard is white-label ready. */
async function getBranding() {
  try {
    const res = await fetch(`${process.env.FIELDOS_API_URL || 'http://localhost:8000/api/v1'}/branding`, { next: { revalidate: 3600 } });
    if (res.ok) {
      const data = await res.json();
      return data.data;
    }
  } catch {}
  return null;
}

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  const org = b?.org_name || 'Asha';
  const tagline = b?.tagline || 'Nepal';
  const suffix = b?.product_suffix || 'Branch Manager Dashboard';
  const fullName = `${org} ${tagline} — ${suffix}`;
  return {
    title: fullName,
    description: `Branch Manager Dashboard for ${org} ${tagline} — Real-time monitoring of field operations, staff activity, collections, and compliance for microfinance operations.`,
    keywords: [org, tagline, "microfinance", "branch manager", "dashboard", "field operations", "collections"],
    authors: [{ name: "Z.ai Team" }],
    icons: {
      icon: b?.logo_url || undefined,
    },
    openGraph: {
      title: fullName,
      description: `Real-time monitoring dashboard for microfinance field operations in ${tagline}.`,
      url: "https://chat.z.ai",
      siteName: `${org} ${tagline}`,
      type: "website",
    },
    twitter: {
      card: "summary_large_image",
      title: fullName,
      description: `Real-time monitoring dashboard for microfinance field operations in ${tagline}.`,
    },
  };
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
