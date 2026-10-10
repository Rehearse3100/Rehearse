/**
 * crm-account/route.ts
 * GET/POST /api/student/crm-account — load and upsert account profile + strategy notes.
 */

import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import { isGateBypassEnabled } from "@/lib/tempo-test-bypass";
import {
  stripTestBypassRecord,
  stripTestBypassString,
} from "@/lib/tempo-test-bypass-client";
import { createServiceClient } from "@/lib/supabase/server";

type AccountBody = {
  attemptId?: string;
  notes?: string;
  fields?: Record<string, unknown>;
};

/**
 * Ensures the attempt exists and belongs to the authenticated student.
 */
async function loadOwnedAttempt(
  attemptId: string,
  studentId: string
): Promise<{ id: string } | null> {
  const supabase = createServiceClient();
  const { data: attempt } = await supabase
    .from("attempts")
    .select("id")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .single();
  return attempt;
}

/**
 * Normalizes jsonb fields into a string map.
 */
function normalizeFields(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {};
  }
  const next: Record<string, string> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof value === "string") {
      next[key] = value;
    } else if (value != null) {
      next[key] = String(value);
    }
  }
  return next;
}

/**
 * GET /api/student/crm-account?attemptId=…
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const attemptId = new URL(request.url).searchParams.get("attemptId")?.trim();
    if (!attemptId) {
      return NextResponse.json({ error: "Missing attemptId." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("crm_account_notes")
      .select("notes, fields, updated_at")
      .eq("attempt_id", attemptId)
      .maybeSingle();

    if (error) {
      console.error("[crm-account] GET failed:", error);
      return NextResponse.json({ error: "Could not load account." }, { status: 500 });
    }

    let notes = (data?.notes as string | undefined) ?? "";
    let fields = normalizeFields(data?.fields);

    // Bypass off: clear leftover [TEST] autofill so CRM text fields stay clean.
    if (!isGateBypassEnabled() && data) {
      const strippedFields = stripTestBypassRecord(fields);
      const strippedNotes = stripTestBypassString(notes);
      const fieldsChanged =
        JSON.stringify(strippedFields) !== JSON.stringify(fields);
      const notesChanged = strippedNotes !== notes;
      if (fieldsChanged || notesChanged) {
        fields = strippedFields;
        notes = strippedNotes;
        const updatedAt = new Date().toISOString();
        const { error: persistError } = await supabase
          .from("crm_account_notes")
          .upsert(
            {
              attempt_id: attemptId,
              notes,
              fields,
              updated_at: updatedAt,
            },
            { onConflict: "attempt_id" }
          );
        if (persistError) {
          console.error("[crm-account] strip persist failed:", persistError);
        } else {
          return NextResponse.json({
            notes,
            fields,
            updated_at: updatedAt,
          });
        }
      }
    }

    return NextResponse.json({
      notes,
      fields,
      updated_at: (data?.updated_at as string | null | undefined) ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Could not load account." }, { status: 500 });
  }
}

/**
 * POST /api/student/crm-account — upsert account profile + notes for the owned attempt.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as AccountBody;
    const attemptId = body.attemptId?.trim();
    if (!attemptId || typeof body.notes !== "string" || body.fields === undefined) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const fields = normalizeFields(body.fields);
    if (!(fields.accountName ?? "").trim()) {
      return NextResponse.json({ error: "Account name is required." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const updatedAt = new Date().toISOString();
    const supabase = createServiceClient();
    const { data, error } = await supabase
      .from("crm_account_notes")
      .upsert(
        {
          attempt_id: attemptId,
          notes: body.notes,
          fields,
          updated_at: updatedAt,
        },
        { onConflict: "attempt_id" }
      )
      .select("notes, fields, updated_at")
      .single();

    if (error || !data) {
      console.error("[crm-account] POST failed:", error);
      return NextResponse.json({ error: "Could not save account." }, { status: 500 });
    }

    return NextResponse.json({
      notes: data.notes as string,
      fields: normalizeFields(data.fields),
      updated_at: data.updated_at as string,
    });
  } catch {
    return NextResponse.json({ error: "Could not save account." }, { status: 500 });
  }
}
