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

export const metadata: Metadata = {
  title: "FieldOS Nepal — Branch Manager Dashboard",
  description: "Branch Manager Dashboard for FieldOS Nepal — Real-time monitoring of field operations, staff activity, collections, and compliance for microfinance operations.",
  keywords: ["FieldOS", "Nepal", "microfinance", "branch manager", "dashboard", "field operations", "collections"],
  authors: [{ name: "Z.ai Team" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "FieldOS Nepal — Branch Manager Dashboard",
    description: "Real-time monitoring dashboard for microfinance field operations in Nepal.",
    url: "https://chat.z.ai",
    siteName: "FieldOS Nepal",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "FieldOS Nepal — Branch Manager Dashboard",
    description: "Real-time monitoring dashboard for microfinance field operations in Nepal.",
  },
};

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
