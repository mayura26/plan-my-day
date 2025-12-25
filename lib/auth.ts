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
        await db.execute(`
          INSERT OR REPLACE INTO users (id, name, email, image, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `, [user.id, user.name || null, user.email || null, user.image || null])

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
