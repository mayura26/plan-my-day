'use client'

import { useSession, signIn, signOut } from 'next-auth/react'
import { Button } from '@/components/ui/button'
import Link from 'next/link'

export function AuthButton() {
  const { data: session, status } = useSession()

  if (status === 'loading') {
    return <Button size="sm" disabled>Loading...</Button>
  }

  if (session) {
    return (
      <div className="flex items-center space-x-2">
        <span className="text-sm text-muted-foreground">
          Welcome, {session.user?.name || session.user?.email}
        </span>
        <Link href="/tasks">
          <Button size="sm">Go to Tasks</Button>
        </Link>
        <Button size="sm" variant="outline" onClick={() => signOut()}>
          Sign Out
        </Button>
      </div>
    )
  }

  return (
    <Button size="sm" onClick={() => signIn()}>
      Sign In
    </Button>
  )
}
