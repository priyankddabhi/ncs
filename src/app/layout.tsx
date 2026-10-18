import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Trade Advisor: Nifty · Sensex · Crude",
  description: "BUY / WAIT / HOLD / SELL for Nifty 50, Sensex and crude oil on 1-day, 1-week and 1-month plans.",
  applicationName: "Trade Advisor",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  colorScheme: "light dark",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f7f6f3" },
    { media: "(prefers-color-scheme: dark)", color: "#191919" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en-IN">
      <body>{children}</body>
    </html>
  );
}
