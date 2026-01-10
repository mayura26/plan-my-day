"use client";

import { useSession } from "next-auth/react";
import { createContext, type ReactNode, useContext, useEffect, useRef, useState } from "react";
import { getUserTimezone } from "@/lib/timezone-utils";

interface UserTimezoneContextType {
  timezone: string;
  isLoading: boolean;
  updateTimezone: (newTimezone: string) => Promise<{ success: boolean; error?: string }>;
}

const UserTimezoneContext = createContext<UserTimezoneContextType | undefined>(undefined);

interface UserTimezoneProviderProps {
  children: ReactNode;
}

/**
 * Provider that fetches and manages user timezone preference at the app level.
 * This ensures only one API call is made regardless of how many components need the timezone.
 */
export function UserTimezoneProvider({ children }: UserTimezoneProviderProps) {
  const { data: session, status } = useSession();
  const [timezone, setTimezone] = useState<string>("UTC");
  const [isLoading, setIsLoading] = useState(true);
  const fetchedUserIdRef = useRef<string | null>(null);
  const fetchPromiseRef = useRef<Promise<void> | null>(null);

  // Fetch user timezone on mount and when session changes
  useEffect(() => {
    if (status === "loading") {
      return;
    }

    if (!session?.user?.id) {
      // Default to UTC if not authenticated
      setTimezone("UTC");
      setIsLoading(false);
      fetchedUserIdRef.current = null;
      fetchPromiseRef.current = null;
      return;
    }

    const currentUserId = session.user.id;
    // If we already fetched for this user, skip
    if (fetchedUserIdRef.current === currentUserId) {
      return;
    }

    // If there's already a fetch in progress, don't start another one
    // (This should be rare since effects are serialized, but good for safety)
    if (fetchPromiseRef.current) {
      return;
    }

    fetchedUserIdRef.current = currentUserId;

    const fetchTimezone = async () => {
      try {
        const response = await fetch("/api/user/timezone");
        if (response.ok) {
          const data = await response.json();
          const userTimezone = getUserTimezone(data.timezone);
          // Set timezone and loading state together to avoid intermediate renders
          setTimezone(userTimezone);
          setIsLoading(false);
        } else {
          // Default to UTC on error
          setTimezone("UTC");
          setIsLoading(false);
        }
      } catch (error) {
        console.error("Error fetching user timezone:", error);
        setTimezone("UTC");
        setIsLoading(false);
      } finally {
        fetchPromiseRef.current = null;
      }
    };

    fetchPromiseRef.current = fetchTimezone();
    fetchPromiseRef.current.catch(() => {
      // Error already handled in fetchTimezone
      fetchPromiseRef.current = null;
    });
  }, [session?.user?.id, status]);

  const updateTimezone = async (newTimezone: string) => {
    if (!session?.user?.id) {
      return { success: false, error: "Not authenticated" };
    }

    try {
      const response = await fetch("/api/user/timezone", {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ timezone: newTimezone }),
      });

      if (response.ok) {
        setTimezone(newTimezone);
        return { success: true };
      } else {
        const error = await response.json();
        return { success: false, error: error.error || "Failed to update timezone" };
      }
    } catch (error) {
      console.error("Error updating timezone:", error);
      return { success: false, error: "Failed to update timezone" };
    }
  };

  return (
    <UserTimezoneContext.Provider value={{ timezone, isLoading, updateTimezone }}>
      {children}
    </UserTimezoneContext.Provider>
  );
}

/**
 * Hook to access the user timezone context.
 * This hook should be used instead of making direct API calls.
 */
export function useUserTimezoneContext(): UserTimezoneContextType {
  const context = useContext(UserTimezoneContext);
  if (context === undefined) {
    throw new Error("useUserTimezoneContext must be used within a UserTimezoneProvider");
  }
  return context;
}
