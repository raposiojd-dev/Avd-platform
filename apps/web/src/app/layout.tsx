import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { THEME_INIT } from "@/components/theme";
import { PRODUCT_NAME, PRODUCT_TAGLINE } from "@/lib/product";
import "./globals.css";

export const metadata: Metadata = { title: { default: PRODUCT_NAME, template: `%s · ${PRODUCT_NAME}` }, description: PRODUCT_TAGLINE };
export const viewport: Viewport = { themeColor: "#070a13", width: "device-width", initialScale: 1 };

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-theme="dark" suppressHydrationWarning>
      <head><script dangerouslySetInnerHTML={{ __html: THEME_INIT }} /></head>
      <body>{children}</body>
    </html>
  );
}
