'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { getUserTimezone } from '@/lib/timezone-utils'

/**
 * Hook to get and manage user's timezone preference
 */
export function useUserTimezone() {
  const { data: session, status } = useSession()
  const [timezone, setTimezone] = useState<string>('UTC')
  const [isLoading, setIsLoading] = useState(true)
  const fetchedUserIdRef = useRef<string | null>(null)

  // Fetch user timezone on mount and when session changes
  useEffect(() => {
    if (status === 'loading') {
      return
    }

    if (!session?.user?.id) {
      // Default to UTC if not authenticated
      setTimezone('UTC')
      setIsLoading(false)
      fetchedUserIdRef.current = null
      return
    }

    const currentUserId = session.user.id
    // If we already fetched for this user, skip
    if (fetchedUserIdRef.current === currentUserId) {
      return
    }
    fetchedUserIdRef.current = currentUserId

    const fetchTimezone = async () => {
      try {
        const response = await fetch('/api/user/timezone')
        if (response.ok) {
          const data = await response.json()
          const userTimezone = getUserTimezone(data.timezone)
          // Set timezone and loading state together to avoid intermediate renders
          setTimezone(userTimezone)
          setIsLoading(false)
        } else {
          // Default to UTC on error
          setTimezone('UTC')
          setIsLoading(false)
        }
      } catch (error) {
        console.error('Error fetching user timezone:', error)
        setTimezone('UTC')
        setIsLoading(false)
      }
    }

    fetchTimezone()
  }, [session?.user?.id, status])

  const updateTimezone = async (newTimezone: string) => {
    if (!session?.user?.id) {
      return { success: false, error: 'Not authenticated' }
    }

    try {
      const response = await fetch('/api/user/timezone', {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ timezone: newTimezone }),
      })

      if (response.ok) {
        setTimezone(newTimezone)
        return { success: true }
      } else {
        const error = await response.json()
        return { success: false, error: error.error || 'Failed to update timezone' }
      }
    } catch (error) {
      console.error('Error updating timezone:', error)
      return { success: false, error: 'Failed to update timezone' }
    }
  }

  return {
    timezone,
    isLoading,
    updateTimezone,
  }
}

