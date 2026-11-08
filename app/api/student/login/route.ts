/**
 * login/route.ts
 * POST /api/student/login — authenticate returning student by username + password.
 * An unknown username and a wrong password get the same reply (401), and failed
 * logins are limited per username and per IP (429; lib/student-login-limits.ts).
 */

import { NextResponse } from "next/server";
import { verifyPassword } from "@/lib/password";
import { createStudentSession } from "@/lib/student-session";
import {
  LOGIN_REPLIES,
  clientIpHash,
  isLoginLimited,
  loginUsernameKey,
  recordLoginFailure,
} from "@/lib/student-login-limits";
import { createServiceClient } from "@/lib/supabase/server";

type LoginBody = {
  username?: string;
  password?: string;
};

/**
 * Validates credentials and sets the student session cookie.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const body = (await request.json()) as LoginBody;
    const username = body.username?.trim() ?? "";
    const password = body.password ?? "";

    if (!username || !password) {
      return NextResponse.json({ error: "Invalid credentials." }, { status: 400 });
    }

    const supabase = createServiceClient();

    // Checked before the password, so a limited username or IP can't keep guessing.
    // A 429 isn't recorded as a failure, so retrying doesn't extend the lockout.
    const limitKey = { username: loginUsernameKey(username), ipHash: clientIpHash(request) };
    if (await isLoginLimited(supabase, limitKey)) {
      return NextResponse.json({ error: LOGIN_REPLIES.tooMany }, { status: 429 });
    }

    const { data: student } = await supabase
      .from("students")
      .select("id, username, display_name, password_hash")
      .eq("username", username)
      .single();

    if (!student) {
      await recordLoginFailure(supabase, limitKey);
      return NextResponse.json({ error: LOGIN_REPLIES.invalid }, { status: 401 });
    }

    const valid = await verifyPassword(password, student.password_hash);
    if (!valid) {
      await recordLoginFailure(supabase, limitKey);
      return NextResponse.json({ error: LOGIN_REPLIES.invalid }, { status: 401 });
    }

    await createStudentSession({
      studentId: student.id,
      username: student.username,
      displayName: student.display_name,
    });

    return NextResponse.json({ success: true });
  } catch {
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
