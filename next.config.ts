import type { NextConfig } from "next";
import withPWA from "next-pwa";

const nextConfig: NextConfig = {
  /* config options here */
  // next-pwa uses webpack, so we need to use webpack mode
  // or configure turbopack (but next-pwa may not support it yet)
};

const pwaConfig = withPWA({
  dest: "public",
  // Disable auto-registration - we'll register manually following Next.js best practices
  // This prevents reload loops caused by auto-registration on every webpack rebuild
  // See: https://nextjs.org/docs/app/guides/progressive-web-apps
  register: false, // Manual registration with updateViaCache: 'none'
  skipWaiting: true,
  // Disable PWA in development by default - enable with ENABLE_PWA_DEV=true
  // Service workers can cause issues with hot reloading, but can be enabled for testing
  // Note: The "GenerateSW has been called multiple times" warning in dev is harmless
  // It occurs because webpack watch mode rebuilds multiple times
  disable: process.env.NODE_ENV === "development" && process.env.ENABLE_PWA_DEV !== "true",
  sw: "sw.js",
  runtimeCaching: [
    {
      urlPattern: /^https?.*/,
      handler: "NetworkFirst",
      options: {
        cacheName: "offlineCache",
        expiration: {
          maxEntries: 200,
        },
      },
    },
  ],
});

export default pwaConfig(nextConfig);
