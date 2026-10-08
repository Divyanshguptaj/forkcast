import type { Metadata, Viewport } from "next";
import { Bricolage_Grotesque, DM_Sans, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const bricolage = Bricolage_Grotesque({ variable: "--font-bricolage", subsets: ["latin"], display: "swap" });
const dmSans = DM_Sans({ variable: "--font-dm-sans", subsets: ["latin"], display: "swap" });
const jetbrains = JetBrains_Mono({ variable: "--font-jetbrains", subsets: ["latin"], display: "swap" });

export const metadata: Metadata = {
  title: "Forkcast",
  description: "Tell Forkcast what you're hungry for. It researches restaurants, menus and reviews to find your best match.",
};

export const viewport: Viewport = {
  themeColor: "#14110f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${bricolage.variable} ${dmSans.variable} ${jetbrains.variable}`}>
      <body className="min-h-dvh">{children}</body>
    </html>
  );
}
