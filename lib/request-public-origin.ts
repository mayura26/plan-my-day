import type { NextRequest } from "next/server";

/**
 * Public origin for redirects and absolute URLs. Prefer proxy headers over
 * request.url / NEXTAUTH_URL — those often point at localhost in production.
 */
export function getPublicOriginFromRequest(request: NextRequest): string {
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0]?.trim();
  const forwardedProto =
    request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    (forwardedHost?.includes("localhost") ? "http" : "https");
  if (forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }

  const rawHost = request.headers.get("host")?.split(",")[0]?.trim();
  if (rawHost && rawHost !== "localhost" && !/^127\./.test(rawHost)) {
    const proto =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
      (rawHost.includes("localhost") ? "http" : "https");
    return `${proto}://${rawHost}`;
  }

  const fromEnv =
    process.env.NEXTAUTH_URL ||
    process.env.NEXT_PUBLIC_APP_URL ||
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL.replace(/^https?:\/\//, "")}`
      : null);
  if (fromEnv) {
    try {
      return new URL(fromEnv).origin;
    } catch {
      /* fall through */
    }
  }

  return request.nextUrl.origin;
}
