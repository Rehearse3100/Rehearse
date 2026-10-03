/**
 * logout/route.ts
 * POST /api/student/logout — clears the student session cookie.
 */

import { NextResponse } from "next/server";
import { clearStudentSession } from "@/lib/student-session";

/**
 * Clears student_session and returns success.
 */
export async function POST(): Promise<NextResponse> {
  try {
    await clearStudentSession();
    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[student/logout POST]", err);
    return NextResponse.json({ error: "Could not log out." }, { status: 500 });
  }
}
