'use client'

import { Skeleton } from '@/components/ui/skeleton'
import { Card, CardContent, CardHeader } from '@/components/ui/card'

export function CalendarSkeleton() {
  return (
    <div className="flex h-[calc(100vh-4rem)] relative">
      {/* Left Sidebar Skeleton */}
      <div className="fixed md:static inset-y-0 left-0 z-50 md:z-auto w-[85vw] max-w-sm md:w-80 border-r overflow-y-auto bg-background">
        <div className="p-4 space-y-4">
          {/* Close button for mobile */}
          <div className="flex items-center justify-between md:hidden pb-2 border-b">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-8 w-8" />
          </div>
          
          {/* Add Task Button Skeleton */}
          <Skeleton className="w-full h-11" />

          {/* Task Groups Skeleton */}
          <div className="border rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b bg-card">
              <Skeleton className="h-5 w-32" />
            </div>
            <div className="p-4 space-y-2">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-10 w-3/4" />
            </div>
          </div>

          {/* Quick Stats Skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-32" />
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-3/4" />
              </div>
            </CardContent>
          </Card>

          {/* Unscheduled Tasks Skeleton */}
          <Card>
            <CardHeader>
              <Skeleton className="h-5 w-40" />
            </CardHeader>
            <CardContent className="space-y-2">
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-full" />
              <Skeleton className="h-16 w-5/6" />
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Main Calendar Area Skeleton */}
      <div className="flex-1 overflow-hidden w-full">
        <div className="flex flex-col h-full">
          {/* Calendar Header Skeleton */}
          <div className="flex items-center justify-between p-4 border-b">
            <div className="flex items-center gap-2 md:gap-4 flex-1 min-w-0">
              <Skeleton className="h-10 w-10 md:hidden" />
              <Skeleton className="h-8 w-48" />
              <Skeleton className="h-9 w-20 hidden sm:block" />
              <div className="ml-auto flex gap-1">
                <Skeleton className="h-9 w-9 md:hidden" />
                <Skeleton className="h-9 w-9 md:hidden" />
                <Skeleton className="h-9 w-9 md:hidden" />
              </div>
            </div>
            <div className="hidden md:flex items-center gap-1">
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-9 w-16" />
              <Skeleton className="h-9 w-16" />
            </div>
            <div className="flex items-center gap-2">
              <Skeleton className="h-10 w-10" />
              <Skeleton className="h-10 w-10" />
            </div>
          </div>

          {/* Days Header Skeleton */}
          <div className="grid grid-cols-[60px_repeat(7,1fr)] md:grid-cols-[80px_repeat(7,1fr)] border-b bg-muted/30">
            <div className="p-2"></div>
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="p-2 text-center border-l">
                <Skeleton className="h-4 w-12 mx-auto mb-2" />
                <Skeleton className="h-8 w-8 md:h-10 md:w-10 mx-auto rounded-full" />
              </div>
            ))}
          </div>

          {/* Calendar Grid Skeleton */}
          <div className="flex-1 overflow-auto">
            <div className="relative min-w-[600px] md:min-w-0">
              <div className="grid grid-cols-[60px_repeat(7,1fr)] md:grid-cols-[80px_repeat(7,1fr)]">
                {/* Time labels skeleton */}
                <div className="border-r sticky left-0 z-10 bg-background">
                  {Array.from({ length: 24 }).map((_, i) => (
                    <div key={i} className="h-16 border-b-2 border-border px-1 md:px-2">
                      <Skeleton className="h-4 w-10 mt-2" />
                    </div>
                  ))}
                </div>

                {/* Day columns skeleton */}
                {Array.from({ length: 7 }).map((_, dayIndex) => (
                  <div key={dayIndex} className="relative border-l">
                    {Array.from({ length: 24 }).map((_, hourIndex) => (
                      <div key={hourIndex} className="h-16 border-b-2 border-border" />
                    ))}
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

