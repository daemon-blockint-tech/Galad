import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import "@/styles/hud-animations.css";

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
};

export const metadata: Metadata = {
  title: "Grond | Geospatial Operations",
  description: "Grond — real-time geospatial intelligence and common operating picture.",
};

/** Runs before first paint; `wwv-theme` is the pre-rebrand key, read for one release. */
const THEME_INIT_SCRIPT = `(function(){try{document.documentElement.setAttribute("data-theme",localStorage.getItem("grond-theme")||localStorage.getItem("wwv-theme")||"black")}catch(e){document.documentElement.setAttribute("data-theme","black")}})();`;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning data-theme="black">
      <head>
        {process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID && (
          <meta name="google-adsense-account" content={process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID} />
        )}
        {(process.env.NEXT_PUBLIC_MAVEN_EDITION === "demo") && process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID && (
          <Script
            id="adsbygoogle"
            async
            src={`https://pagead2.googlesyndication.com/pagead/js/adsbygoogle.js?client=${process.env.NEXT_PUBLIC_ADSENSE_CLIENT_ID}`}
            crossOrigin="anonymous"
            strategy="afterInteractive"
          />
        )}
        {/* Load CesiumJS base styles (optional, but helps with UI widgets if used later) */}
        <link rel="stylesheet" href="/cesium/Widgets/widgets.css" />
        {/* Applies the stored theme before first paint to avoid a flash of the default theme. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        {process.env.VERCEL && <Analytics />}
        {(process.env.NEXT_PUBLIC_MAVEN_ANALYTICS === "true") && (
          <Script
            src="https://analytics.grond.dev/script.js"
            data-website-id="2c8f6c09-2651-4a2a-af99-b8cee1612b9a"
            strategy="afterInteractive"
          />
        )}
      </body>
    </html>
  );
}
