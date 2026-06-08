import { type NextRequest, NextResponse } from "next/server";
import { getPublicOriginFromRequest } from "@/lib/request-public-origin";

/**
 * Backward-compat shim for old notifications that still point at the API route.
 * Redirects to the confirmation page which performs the completion.
 */
export async function GET(request: NextRequest) {
  const origin = getPublicOriginFromRequest(request);
  const token = request.nextUrl.searchParams.get("token");

  const dest = new URL("/push/complete", origin);
  if (token) {
    dest.searchParams.set("token", token);
  }
  return NextResponse.redirect(dest);
}
