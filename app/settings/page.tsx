'use client'

import { useSession } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useEffect } from 'react'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { TimezoneSelector } from '@/components/timezone-selector'
import { Separator } from '@/components/ui/separator'
import { Clock } from 'lucide-react'

export default function SettingsPage() {
  const { data: session, status } = useSession()
  const router = useRouter()

  useEffect(() => {
    if (status === 'unauthenticated') {
      router.push('/auth/signin')
    }
  }, [status, router])

  if (status === 'loading') {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto mb-4"></div>
          <p className="text-muted-foreground">Loading...</p>
        </div>
      </div>
    )
  }

  if (!session) {
    return null
  }

  return (
    <div className="container mx-auto px-4 py-4 md:py-8 max-w-4xl">
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl md:text-3xl font-bold">Settings</h1>
          <p className="text-sm md:text-base text-muted-foreground mt-2">
            Manage your account preferences and settings
          </p>
        </div>

        <Separator />

        {/* Timezone Settings */}
        <Card>
          <CardHeader>
            <div className="flex items-center gap-2">
              <Clock className="h-5 w-5" />
              <CardTitle>Timezone Preferences</CardTitle>
            </div>
            <CardDescription>
              Set your preferred timezone. All dates and times will be displayed in this timezone, regardless of your local system time.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <TimezoneSelector />
            <p className="text-sm text-muted-foreground mt-4">
              Changing your timezone will update how all dates and times are displayed throughout the application.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

