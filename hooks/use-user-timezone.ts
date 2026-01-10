"use client";

import { useUserTimezoneContext } from "@/contexts/user-timezone-context";

/**
 * Hook to get and manage user's timezone preference.
 * This hook now consumes from the UserTimezoneContext provider,
 * ensuring only one API call is made at the app level regardless
 * of how many components use this hook.
 */
export function useUserTimezone() {
  return useUserTimezoneContext();
}
