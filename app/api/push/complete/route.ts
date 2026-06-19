import { type NextRequest, NextResponse } from "next/server";
import { getPublicOriginFromRequest } from "@/lib/request-public-origin";

/**
 * Backward-compat shim for old notifications that still point at the API route.
 * Redirects to the token action page which performs the completion.
 */
export async function GET(request: NextRequest) {
  const origin = getPublicOriginFromRequest(request);
  const token = request.nextUrl.searchParams.get("token");

  if (token) {
    return NextResponse.redirect(new URL(`/reminder/a/${token}`, origin));
  }
  return NextResponse.redirect(new URL("/settings", origin));
}
