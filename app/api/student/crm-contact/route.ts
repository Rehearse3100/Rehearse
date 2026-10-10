/**
 * crm-contact/route.ts
 * GET/POST /api/student/crm-contact — load and upsert contact profile + notes.
 */

import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import {
  CRM_CONTACT_SLOTS,
  emptyContactFields,
  type CrmContactKey,
} from "@/lib/tempo-crm-contact";
import { isGateBypassEnabled } from "@/lib/tempo-test-bypass";
import {
  stripTestBypassRecord,
  stripTestBypassString,
} from "@/lib/tempo-test-bypass-client";
import { createServiceClient } from "@/lib/supabase/server";

/**
 * Tempo CRM contact_key values allowed for crm_contact_notes (simulation-specific later).
 */
const TEMPO_CRM_VALID_CONTACT_KEYS: readonly CrmContactKey[] = CRM_CONTACT_SLOTS;

const TEMPO_CRM_CONTACT_KEY_SET = new Set<string>(TEMPO_CRM_VALID_CONTACT_KEYS);

/**
 * True when contactKey is a permitted Tempo contact slot.
 */
function isAllowedCrmContactKey(key: unknown): key is CrmContactKey {
  return typeof key === "string" && TEMPO_CRM_CONTACT_KEY_SET.has(key);
}

/** Legacy fallback when crm_contact_notes.fields column is not migrated yet. */
const PROFILE_MARKER = "__crm_profile__\n";

type ContactBody = {
  attemptId?: string;
  contactKey?: string;
  role?: string;
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
 * True when Supabase/Postgres rejected a missing `fields` column.
 */
function isMissingFieldsColumn(error: { message?: string; code?: string } | null): boolean {
  if (!error?.message) {
    return false;
  }
  const msg = error.message.toLowerCase();
  return (
    msg.includes("fields") &&
    (msg.includes("column") || msg.includes("schema cache") || error.code === "PGRST204")
  );
}

/**
 * Embeds profile fields in notes when jsonb column is unavailable.
 */
function encodeNotesWithProfile(fields: Record<string, string>, notes: string): string {
  return `${PROFILE_MARKER}${JSON.stringify(fields)}\n---\n${notes}`;
}

/**
 * Reads embedded profile from notes (legacy path before fields migration).
 */
function decodeNotesWithProfile(stored: string): {
  fields: Record<string, string>;
  notes: string;
} {
  if (!stored.startsWith(PROFILE_MARKER)) {
    return { fields: emptyContactFields(), notes: stored };
  }
  const afterMarker = stored.slice(PROFILE_MARKER.length);
  const sep = afterMarker.indexOf("\n---\n");
  if (sep === -1) {
    return { fields: emptyContactFields(), notes: stored };
  }
  try {
    const parsed = JSON.parse(afterMarker.slice(0, sep)) as Record<string, string>;
    return {
      fields: { ...emptyContactFields(), ...parsed },
      notes: afterMarker.slice(sep + 5),
    };
  } catch {
    return { fields: emptyContactFields(), notes: stored };
  }
}

/**
 * Resolves profile fields from jsonb column or embedded notes fallback.
 */
function resolveContactFields(
  fieldsRaw: unknown,
  notesRaw: string | null | undefined
): Record<string, string> {
  const fromColumn = normalizeFields(fieldsRaw);
  if ((fromColumn.name ?? "").trim()) {
    return { ...emptyContactFields(), ...fromColumn };
  }
  const decoded = decodeNotesWithProfile(notesRaw ?? "");
  return decoded.fields;
}

/**
 * Resolves relationship notes, stripping embedded profile payload when present.
 */
function resolveContactNotes(notesRaw: string | null | undefined): string {
  const raw = notesRaw ?? "";
  if (!raw.startsWith(PROFILE_MARKER)) {
    return raw;
  }
  return decodeNotesWithProfile(raw).notes;
}

/**
 * GET /api/student/crm-contact?attemptId=…&contactKey=…
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const url = new URL(request.url);
    const attemptId = url.searchParams.get("attemptId")?.trim();
    const contactKey = url.searchParams.get("contactKey")?.trim();

    if (!attemptId || !contactKey) {
      return NextResponse.json({ error: "Missing attemptId or contactKey." }, { status: 400 });
    }
    if (!isAllowedCrmContactKey(contactKey)) {
      return NextResponse.json(
        {
          error: `Invalid contactKey. Allowed values: ${TEMPO_CRM_VALID_CONTACT_KEYS.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const supabase = createServiceClient();
    let data: {
      role?: string | null;
      notes?: string | null;
      fields?: unknown;
      updated_at?: string | null;
    } | null = null;

    const withFields = await supabase
      .from("crm_contact_notes")
      .select("role, notes, fields, updated_at")
      .eq("attempt_id", attemptId)
      .eq("contact_key", contactKey)
      .maybeSingle();

    if (withFields.error && isMissingFieldsColumn(withFields.error)) {
      const withoutFields = await supabase
        .from("crm_contact_notes")
        .select("role, notes, updated_at")
        .eq("attempt_id", attemptId)
        .eq("contact_key", contactKey)
        .maybeSingle();
      if (withoutFields.error) {
        console.error("[crm-contact] GET failed:", withoutFields.error);
        return NextResponse.json({ error: "Could not load contact." }, { status: 500 });
      }
      data = withoutFields.data;
    } else if (withFields.error) {
      console.error("[crm-contact] GET failed:", withFields.error);
      return NextResponse.json({ error: "Could not load contact." }, { status: 500 });
    } else {
      data = withFields.data;
    }

    let notes = resolveContactNotes(data?.notes);
    let fields = resolveContactFields(data?.fields, data?.notes);
    let role = (data?.role as string | undefined) ?? "";

    // Bypass off: clear leftover [TEST] autofill so CRM text fields stay clean.
    if (!isGateBypassEnabled() && data) {
      const strippedFields = stripTestBypassRecord(fields);
      const strippedNotes = stripTestBypassString(notes);
      const strippedRole = stripTestBypassString(role);
      const fieldsChanged =
        JSON.stringify(strippedFields) !== JSON.stringify(fields);
      const notesChanged = strippedNotes !== notes;
      const roleChanged = strippedRole !== role;
      if (fieldsChanged || notesChanged || roleChanged) {
        fields = strippedFields;
        notes = strippedNotes;
        role = strippedRole;
        const updatedAt = new Date().toISOString();
        const { error: persistError } = await supabase
          .from("crm_contact_notes")
          .upsert(
            {
              attempt_id: attemptId,
              contact_key: contactKey,
              role,
              notes,
              fields,
              updated_at: updatedAt,
            },
            { onConflict: "attempt_id,contact_key" }
          );
        if (persistError) {
          console.error("[crm-contact] strip persist failed:", persistError);
        } else {
          return NextResponse.json({
            role,
            notes,
            fields,
            updated_at: updatedAt,
          });
        }
      }
    }

    return NextResponse.json({
      role,
      notes,
      fields,
      updated_at: (data?.updated_at as string | null | undefined) ?? null,
    });
  } catch {
    return NextResponse.json({ error: "Could not load contact." }, { status: 500 });
  }
}

/**
 * POST /api/student/crm-contact — upsert contact profile + notes for the owned attempt.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as ContactBody;
    const attemptId = body.attemptId?.trim();
    const contactKeyRaw = body.contactKey?.trim();

    if (
      !attemptId ||
      !contactKeyRaw ||
      typeof body.notes !== "string" ||
      typeof body.role !== "string" ||
      body.fields === undefined
    ) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }
    if (!isAllowedCrmContactKey(contactKeyRaw)) {
      return NextResponse.json(
        {
          error: `Invalid contactKey. Allowed values: ${TEMPO_CRM_VALID_CONTACT_KEYS.join(", ")}.`,
        },
        { status: 400 }
      );
    }

    const contactKey = contactKeyRaw;

    const fields = normalizeFields(body.fields);
    if (!(fields.name ?? "").trim()) {
      return NextResponse.json({ error: "Contact name is required." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const updatedAt = new Date().toISOString();
    const supabase = createServiceClient();

    const withFields = await supabase
      .from("crm_contact_notes")
      .upsert(
        {
          attempt_id: attemptId,
          contact_key: contactKey,
          role: body.role,
          notes: body.notes,
          fields,
          updated_at: updatedAt,
        },
        { onConflict: "attempt_id,contact_key" }
      )
      .select("role, notes, fields, updated_at")
      .single();

    let saved = withFields.data;
    let saveError = withFields.error;

    if (saveError && isMissingFieldsColumn(saveError)) {
      const withoutFields = await supabase
        .from("crm_contact_notes")
        .upsert(
          {
            attempt_id: attemptId,
            contact_key: contactKey,
            role: body.role,
            notes: encodeNotesWithProfile(fields, body.notes),
            updated_at: updatedAt,
          },
          { onConflict: "attempt_id,contact_key" }
        )
        .select("role, notes, updated_at")
        .single();
      saved = withoutFields.data
        ? { ...withoutFields.data, fields: null }
        : null;
      saveError = withoutFields.error;
    }

    if (saveError || !saved) {
      console.error("[crm-contact] POST failed:", saveError);
      return NextResponse.json({ error: "Could not save contact." }, { status: 500 });
    }

    const notes = resolveContactNotes(saved.notes as string | null | undefined);
    const resolvedFields = resolveContactFields(saved.fields, saved.notes as string | null);

    return NextResponse.json({
      role: saved.role as string,
      notes,
      fields: resolvedFields,
      updated_at: saved.updated_at as string,
    });
  } catch {
    return NextResponse.json({ error: "Could not save contact." }, { status: 500 });
  }
}
