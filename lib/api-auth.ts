import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { NextRequest } from "next/server";
import { db } from "@/lib/turso";

const API_KEY_PREFIX = "pmy_";
const API_KEY_LENGTH = 32; // Random part length (excluding prefix)

/**
 * Generate a new API key
 * Format: pmy_<32 random characters>
 */
export function generateAPIKey(): string {
  const randomBytes = crypto.randomBytes(API_KEY_LENGTH);
  const randomPart = randomBytes.toString("base64url"); // URL-safe base64
  return `${API_KEY_PREFIX}${randomPart}`;
}

/**
 * Hash an API key for storage
 */
export async function hashAPIKey(key: string): Promise<string> {
  return bcrypt.hash(key, 10);
}

/**
 * Verify an API key against a hash
 */
export async function verifyAPIKey(key: string, hash: string): Promise<boolean> {
  return bcrypt.compare(key, hash);
}

/**
 * Extract API key from Authorization header
 * Supports: "Bearer <key>" or "<key>"
 */
export function extractAPIKeyFromHeader(request: NextRequest): string | null {
  const authHeader = request.headers.get("authorization");
  if (!authHeader) return null;

  // Handle "Bearer <key>" format
  if (authHeader.startsWith("Bearer ")) {
    return authHeader.substring(7).trim();
  }

  // Handle direct key format
  return authHeader.trim();
}

/**
 * Validate API key and return user_id if valid
 * Updates last_used_at timestamp
 */
export async function validateAPIKey(request: NextRequest): Promise<string | null> {
  const apiKey = extractAPIKeyFromHeader(request);
  if (!apiKey) return null;

  // Key must start with prefix
  if (!apiKey.startsWith(API_KEY_PREFIX)) return null;

  try {
    // Get key prefix for filtering (optimization - narrows down candidates)
    const keyPrefix = apiKey.substring(0, 8);
    const result = await db.execute(
      `SELECT id, user_id, key_hash FROM api_keys WHERE key_prefix = ? AND revoked_at IS NULL`,
      [keyPrefix]
    );

    if (result.rows.length === 0) return null;

    // Verify against each candidate key with matching prefix
    for (const row of result.rows) {
      const keyHash = row.key_hash as string;
      const isValid = await verifyAPIKey(apiKey, keyHash);

      if (isValid) {
        const keyId = row.id as string;
        // Update last_used_at
        await db.execute(`UPDATE api_keys SET last_used_at = datetime('now') WHERE id = ?`, [
          keyId,
        ]);
        return row.user_id as string;
      }
    }

    return null;
  } catch (error) {
    console.error("Error validating API key:", error);
    return null;
  }
}

/**
 * Get API key prefix for display
 */
export function getAPIKeyPrefix(key: string): string {
  return key.substring(0, 8);
}
