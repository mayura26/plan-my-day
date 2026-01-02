import NextAuth from "next-auth";
import GitHub from "next-auth/providers/github";
import Google from "next-auth/providers/google";
import { db } from "@/lib/turso";

const googleClientId = process.env.GOOGLE_CLIENT_ID;
const googleClientSecret = process.env.GOOGLE_CLIENT_SECRET;
const githubClientId = process.env.GITHUB_CLIENT_ID;
const githubClientSecret = process.env.GITHUB_CLIENT_SECRET;

if (!googleClientId || !googleClientSecret) {
  throw new Error("GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables are required");
}

if (!githubClientId || !githubClientSecret) {
  throw new Error("GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables are required");
}

export const { handlers, signIn, signOut, auth } = NextAuth({
  providers: [
    Google({
      clientId: googleClientId,
      clientSecret: googleClientSecret,
    }),
    GitHub({
      clientId: githubClientId,
      clientSecret: githubClientSecret,
    }),
  ],
  callbacks: {
    async signIn({ user, account, profile: _profile }) {
      // Store user in Turso database
      try {
        if (!user.id) {
          return false;
        }

        // Determine the actual user ID to use (may differ from session ID if user exists by email)
        let actualUserId = user.id;

        // Check if user exists by ID first
        const existingUserById = await db.execute("SELECT id FROM users WHERE id = ?", [user.id]);

        if (existingUserById.rows.length > 0) {
          // User exists by ID, update their info (name, email, image may have changed)
          await db.execute(
            `
            UPDATE users 
            SET name = ?, email = ?, image = ?, updated_at = datetime('now')
            WHERE id = ?
          `,
            [user.name || null, user.email || null, user.image || null, user.id]
          );
        } else if (user.email) {
          // User doesn't exist by ID, check if they exist by email
          const existingUserByEmail = await db.execute("SELECT id FROM users WHERE email = ?", [
            user.email,
          ]);

          if (existingUserByEmail.rows.length > 0) {
            // User exists by email with different ID - use the existing ID
            actualUserId = existingUserByEmail.rows[0].id as string;
            console.warn(
              `User with email ${user.email} exists with ID ${actualUserId}, but session has ID ${user.id}. Using existing ID.`
            );

            // Update the existing user's info
            await db.execute(
              `
              UPDATE users 
              SET name = ?, image = ?, updated_at = datetime('now')
              WHERE id = ?
            `,
              [user.name || null, user.image || null, actualUserId]
            );
          } else {
            // User doesn't exist at all, create them
            await db.execute(
              `
              INSERT INTO users (id, name, email, image, created_at, updated_at)
              VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
            `,
              [user.id, user.name || null, user.email || null, user.image || null]
            );
          }
        } else {
          // No email, create user with just ID
          await db.execute(
            `
            INSERT INTO users (id, name, email, image, created_at, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
          `,
            [user.id, user.name || null, null, user.image || null]
          );
        }

        // Store account information using the actual user ID
        if (account) {
          await db.execute(
            `
            INSERT OR REPLACE INTO accounts (id, user_id, type, provider, provider_account_id, access_token, refresh_token, expires_at, token_type, scope, id_token, session_state)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `,
            [
              `${account.provider}-${account.providerAccountId}`,
              actualUserId, // Use actual user ID, not session ID
              account.type,
              account.provider,
              account.providerAccountId,
              account.access_token || null,
              account.refresh_token || null,
              account.expires_at || null,
              account.token_type || null,
              account.scope || null,
              account.id_token || null,
              typeof account.session_state === "string" ? account.session_state : null,
            ]
          );
        }

        // Update the user.id to match the actual user ID for the session
        if (actualUserId !== user.id) {
          user.id = actualUserId;
        }
      } catch (error) {
        console.error("Error storing user data:", error);
        // Don't fail authentication if user storage fails, but log it
        // The API endpoints will handle missing users gracefully
      }
      return true;
    },
    async session({ session, token }) {
      if (token.sub && session.user) {
        session.user.id = token.sub;
      }
      return session;
    },
    async jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
      }
      return token;
    },
  },
  pages: {
    signIn: "/auth/signin",
  },
});

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      name?: string | null;
      email?: string | null;
      image?: string | null;
    };
  }
}
