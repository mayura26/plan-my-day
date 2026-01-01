import type { NextConfig } from "next";

/**
 * Next.js PWA Configuration
 * Following Next.js official PWA guide: https://nextjs.org/docs/app/guides/progressive-web-apps
 *
 * We use a custom service worker (public/sw.js) instead of next-pwa
 * The service worker is registered manually with updateViaCache: 'none'
 * This follows the Next.js recommended approach for PWAs
 */
const nextConfig: NextConfig = {
  /* config options here */
};

export default nextConfig;
