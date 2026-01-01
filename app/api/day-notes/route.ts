import { type NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { generateDayNoteId } from "@/lib/task-utils";
import { db } from "@/lib/turso";
import type { CreateDayNoteRequest, DayNote } from "@/lib/types";

// Helper function to map database row to DayNote
function mapRowToDayNote(row: any): DayNote {
  return {
    id: row.id as string,
    user_id: row.user_id as string,
    note_date: row.note_date as string,
    content: row.content as string,
    created_at: row.created_at as string,
    updated_at: row.updated_at as string,
  };
}

// Helper function to normalize date to YYYY-MM-DD format
function normalizeDate(date: Date | string): string {
  const dateObj = typeof date === "string" ? new Date(date) : date;
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, "0");
  const day = String(dateObj.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// GET /api/day-notes?date=YYYY-MM-DD - Get note for a specific date
export async function GET(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");

    if (!dateParam) {
      return NextResponse.json({ error: "Date parameter is required" }, { status: 400 });
    }

    // Validate date format (YYYY-MM-DD)
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateParam)) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
    }

    const result = await db.execute(
      "SELECT * FROM day_notes WHERE user_id = ? AND note_date = ?",
      [session.user.id, dateParam]
    );

    if (result.rows.length === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const note = mapRowToDayNote(result.rows[0]);
    return NextResponse.json({ note });
  } catch (error) {
    console.error("Error fetching day note:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// POST /api/day-notes - Create new day note
export async function POST(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body: CreateDayNoteRequest = await request.json();

    // Validate request body
    if (!body.note_date || !body.content) {
      return NextResponse.json(
        { error: "note_date and content are required" },
        { status: 400 }
      );
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(body.note_date)) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
    }

    // Check if note already exists for this date
    const existingResult = await db.execute(
      "SELECT id FROM day_notes WHERE user_id = ? AND note_date = ?",
      [session.user.id, body.note_date]
    );

    if (existingResult.rows.length > 0) {
      return NextResponse.json(
        { error: "Note already exists for this date. Use PUT to update." },
        { status: 409 }
      );
    }

    const noteId = generateDayNoteId();
    const now = new Date().toISOString();

    await db.execute(
      `
      INSERT INTO day_notes (id, user_id, note_date, content, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `,
      [noteId, session.user.id, body.note_date, body.content, now, now]
    );

    // Fetch the created note
    const result = await db.execute("SELECT * FROM day_notes WHERE id = ?", [noteId]);
    const note = mapRowToDayNote(result.rows[0]);

    return NextResponse.json({ note }, { status: 201 });
  } catch (error) {
    console.error("Error creating day note:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// PUT /api/day-notes?date=YYYY-MM-DD - Update existing day note
export async function PUT(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");

    if (!dateParam) {
      return NextResponse.json({ error: "Date parameter is required" }, { status: 400 });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateParam)) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
    }

    const body: { content: string } = await request.json();

    if (!body.content) {
      return NextResponse.json({ error: "content is required" }, { status: 400 });
    }

    // Check if note exists
    const existingResult = await db.execute(
      "SELECT id FROM day_notes WHERE user_id = ? AND note_date = ?",
      [session.user.id, dateParam]
    );

    if (existingResult.rows.length === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    const now = new Date().toISOString();

    await db.execute(
      "UPDATE day_notes SET content = ?, updated_at = ? WHERE user_id = ? AND note_date = ?",
      [body.content, now, session.user.id, dateParam]
    );

    // Fetch the updated note
    const result = await db.execute(
      "SELECT * FROM day_notes WHERE user_id = ? AND note_date = ?",
      [session.user.id, dateParam]
    );
    const note = mapRowToDayNote(result.rows[0]);

    return NextResponse.json({ note });
  } catch (error) {
    console.error("Error updating day note:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// DELETE /api/day-notes?date=YYYY-MM-DD - Delete day note
export async function DELETE(request: NextRequest) {
  try {
    const session = await auth();
    if (!session?.user?.id) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const dateParam = searchParams.get("date");

    if (!dateParam) {
      return NextResponse.json({ error: "Date parameter is required" }, { status: 400 });
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(dateParam)) {
      return NextResponse.json({ error: "Invalid date format. Use YYYY-MM-DD" }, { status: 400 });
    }

    // Check if note exists
    const existingResult = await db.execute(
      "SELECT id FROM day_notes WHERE user_id = ? AND note_date = ?",
      [session.user.id, dateParam]
    );

    if (existingResult.rows.length === 0) {
      return NextResponse.json({ error: "Note not found" }, { status: 404 });
    }

    await db.execute("DELETE FROM day_notes WHERE user_id = ? AND note_date = ?", [
      session.user.id,
      dateParam,
    ]);

    return NextResponse.json({ message: "Note deleted successfully" });
  } catch (error) {
    console.error("Error deleting day note:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

