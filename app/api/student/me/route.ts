/**
 * me/route.ts
 * GET /api/student/me — returns current student session data.
 */

import { NextResponse } from "next/server";
import { getStudentSession } from "@/lib/student-session";

/**
 * Returns the decoded student session or 401.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const session = await getStudentSession();
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.json(session);
  } catch (err) {
    console.error("[student/me GET]", err);
    return NextResponse.json({ error: "Could not load session." }, { status: 500 });
  }
}
