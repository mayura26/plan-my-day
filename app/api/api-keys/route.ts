import { type NextRequest, NextResponse } from "next/server";
import { generateAPIKey, getAPIKeyPrefix, hashAPIKey } from "@/lib/api-auth";
import { auth } from "@/lib/auth";
import { generateAPIKeyId } from "@/lib/task-utils";
import { db } from "@/lib/turso";
import type { APIKeyResponse, CreateAPIKeyRequest } from "@/lib/types";

/**
 * GET /api/api-keys
 * List all API keys for the authenticated user
 */
export async function GET() {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const result = await db.execute(
      `SELECT id, name, key_prefix, last_used_at, created_at, revoked_at 
       FROM api_keys 
       WHERE user_id = ? 
       ORDER BY created_at DESC`,
      [session.user.id]
    );

    const keys: APIKeyResponse[] = result.rows.map((row) => ({
      id: row.id as string,
      name: row.name as string,
      key_prefix: row.key_prefix as string,
      last_used_at: row.last_used_at as string | null,
      created_at: row.created_at as string,
      revoked_at: row.revoked_at as string | null,
    }));

    return NextResponse.json({ keys });
  } catch (error) {
    console.error("Error fetching API keys:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * POST /api/api-keys
 * Create a new API key
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: CreateAPIKeyRequest = await request.json();

    if (!body.name || body.name.trim().length === 0) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }

    // Generate API key
    const apiKey = generateAPIKey();
    const keyHash = await hashAPIKey(apiKey);
    const keyPrefix = getAPIKeyPrefix(apiKey);

    const keyId = generateAPIKeyId();
    const now = new Date().toISOString();

    // Insert into database
    await db.execute(
      `INSERT INTO api_keys (id, user_id, name, key_hash, key_prefix, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [keyId, session.user.id, body.name.trim(), keyHash, keyPrefix, now]
    );

    // Return the key (only time it will be shown)
    const response: APIKeyResponse = {
      id: keyId,
      name: body.name.trim(),
      key_prefix: keyPrefix,
      last_used_at: null,
      created_at: now,
      revoked_at: null,
      key: apiKey, // Include full key only on creation
    };

    return NextResponse.json({ key: response }, { status: 201 });
  } catch (error) {
    console.error("Error creating API key:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

/**
 * DELETE /api/api-keys
 * Revoke an API key (soft delete)
 */
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { id } = body;

    if (!id || typeof id !== "string") {
      return NextResponse.json({ error: "API key ID is required" }, { status: 400 });
    }

    // Verify the key belongs to the user
    const checkResult = await db.execute(`SELECT id FROM api_keys WHERE id = ? AND user_id = ?`, [
      id,
      session.user.id,
    ]);

    if (checkResult.rows.length === 0) {
      return NextResponse.json({ error: "API key not found" }, { status: 404 });
    }

    // Revoke the key (soft delete)
    await db.execute(`UPDATE api_keys SET revoked_at = datetime('now') WHERE id = ?`, [id]);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error revoking API key:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
