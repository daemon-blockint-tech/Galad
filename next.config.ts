import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // bullmq/ioredis are server-only and bullmq lazily requires optional Redis
  // clients (@valkey/valkey-glide) that webpack cannot resolve when bundling.
  serverExternalPackages: ["@prisma/client", "prisma", "@google/earthengine", "bullmq", "ioredis"],
  transpilePackages: ["@grond/plugin-sdk", "@maven-system/plugin-sdk", "resium", "react-player", "satellite.js"],
  allowedDevOrigins: process.env.ALLOWED_DEV_ORIGIN ? [process.env.ALLOWED_DEV_ORIGIN] : undefined,
  experimental: {
    memoryBasedWorkersCount: true,
    cpus: 2,
    optimizePackageImports: ["lucide-react"],
  },
  outputFileTracingIncludes: {
    "/*": ["./scripts/**/*"],
  },
  typescript: {
    ignoreBuildErrors: false,
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              // CesiumJS requires unsafe-eval (worker compilation) and unsafe-inline (styles)
              "script-src 'self' 'unsafe-eval' 'unsafe-inline' blob: https://unpkg.com https://cdn.jsdelivr.net https://analytics.worldwideview.dev https://va.vercel-scripts.com https://pagead2.googlesyndication.com https://adservice.google.com https://www.googletagservices.com https://ep2.adtrafficquality.google https://static.cloudflareinsights.com",
              "style-src 'self' 'unsafe-inline' fonts.googleapis.com",
              "font-src 'self' fonts.gstatic.com",
              // Camera streams load images/MJPEG from arbitrary IPs worldwide — http: https: required
              "img-src 'self' data: blob: http: https:",
              // Camera HLS streams and external data fetches need arbitrary origins
              "connect-src 'self' http: https: ws: wss:",
              // HLS video streams from arbitrary camera sources
              "media-src 'self' blob: http: https:",
              // Embeddable video platforms for camera iframes — needs to support arbitrary domains
              "frame-src 'self' http: https: blob:",
              "worker-src 'self' blob:",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-DNS-Prefetch-Control", value: "on" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(self)",
          },
        ],
      },
      {
        // The camera iframe proxy returns third-party HTML from this origin, so it
        // must NOT inherit the app policy above (which allows 'unsafe-inline' and
        // would let proxied script call our authenticated same-origin APIs).
        // `sandbox` without allow-same-origin puts the document in an opaque origin.
        //
        // This has to live here rather than on the route response: Next only appends
        // a handler header when the same key is not already set by this config, so a
        // route-level Content-Security-Policy is silently dropped. The catch-all
        // above also sets frame-ancestors 'none' and X-Frame-Options DENY, which
        // would block the app from framing its own proxy — this later, more specific
        // entry wins and restores same-origin framing.
        source: "/api/camera/proxy/iframe",
        headers: [
          { key: "Content-Security-Policy", value: "sandbox allow-scripts" },
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
        ],
      },
    ];
  },

  outputFileTracingExcludes: {
    "*": [
      "./public/cesium/**"
    ],
  },
  env: {
    CESIUM_BASE_URL: "/cesium",
  },
  webpack: (config, { isServer, webpack }) => {
    config.ignoreWarnings = [
      { module: /node_modules[\\/]@opentelemetry/ },
      { module: /node_modules[\\/]require-in-the-middle/ },
      { module: /node_modules[\\/]@sentry/ },
    ];

    if (!isServer) {
      // Define CESIUM_BASE_URL for Cesium's worker resolution
      config.plugins?.push(
        new webpack.DefinePlugin({
          CESIUM_BASE_URL: JSON.stringify("/cesium"),
        })
      );

      // Cesium uses some Node.js modules that should be excluded in the browser
      config.resolve = config.resolve || {};
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        http: false,
        https: false,
        zlib: false,
        url: false,
      };
    }

    return config;
  },
};

import { withSentryConfig } from "@sentry/nextjs";

export default nextConfig;
