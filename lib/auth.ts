import NextAuth from "next-auth"
import Google from "next-auth/providers/google"
import GitHub from "next-auth/providers/github"
import { db } from "@/lib/turso"

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    }),
    GitHub({
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    }),
  ],
  callbacks: {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async signIn({ user, account, profile }) {
      // Store user in Turso database
      try {
        if (!user.id) {
          return false
        }

        // Check if user exists by ID first
        const existingUserById = await db.execute(
          'SELECT id FROM users WHERE id = ?',
          [user.id]
        )

        if (existingUserById.rows.length > 0) {
          // User exists by ID, update their info (name, email, image may have changed)
          await db.execute(`
            UPDATE users 
            SET name = ?, email = ?, image = ?, updated_at = datetime('now')
            WHERE id = ?
          `, [user.name || null, user.email || null, user.image || null, user.id])
        } else {
          // User doesn't exist by ID, try to create them
          // Use INSERT OR IGNORE to handle case where user exists by email but not by ID
          if (user.email) {
            await db.execute(`
              INSERT OR IGNORE INTO users (id, name, email, image, created_at, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            `, [user.id, user.name || null, user.email || null, user.image || null])
            
            // Verify user was created
            const verifyUser = await db.execute(
              'SELECT id FROM users WHERE id = ?',
              [user.id]
            )
            
            if (verifyUser.rows.length === 0) {
              // User exists by email with different ID - this is a data inconsistency
              // Log it but don't fail auth - API endpoints will handle this gracefully
              console.warn(`User with email ${user.email} exists but with different ID. Session ID: ${user.id}`)
            }
          } else {
            // No email, create user with just ID
            await db.execute(`
              INSERT INTO users (id, name, email, image, created_at, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            `, [user.id, user.name || null, null, user.image || null])
          }
        }

        // Store account information
        if (account) {
          await db.execute(`
            INSERT OR REPLACE INTO accounts (id, user_id, type, provider, provider_account_id, access_token, refresh_token, expires_at, token_type, scope, id_token, session_state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `, [
            `${account.provider}-${account.providerAccountId}`,
            user.id,
            account.type,
            account.provider,
            account.providerAccountId,
            account.access_token || null,
            account.refresh_token || null,
            account.expires_at || null,
            account.token_type || null,
            account.scope || null,
            account.id_token || null,
            typeof account.session_state === 'string' ? account.session_state : null,
          ])
        }
      } catch (error) {
        console.error("Error storing user data:", error)
        // Don't fail authentication if user storage fails, but log it
        // The API endpoints will handle missing users gracefully
      }
      return true
    },
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub
      }
      return session
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id
      }
      return token
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
})

declare module "next-auth" {
  interface Session {
    user: {
      id: string
      name?: string | null
      email?: string | null
      image?: string | null
    }
  }
}
