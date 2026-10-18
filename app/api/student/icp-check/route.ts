/**
 * icp-check/route.ts
 * The Prospecting ICP review, graded once by Tempo's rubric (lib/tempo-icp-criteria.ts,
 * with lib/icp-grading.ts). POST: step A (gpt-4o, temperature 0, JSON schema)
 * grades each criterion with a quote and a gap; code checks the quotes, scores the
 * location range, the total and the band; step B (gpt-4o, temperature 0.4) writes
 * the manager note from the student's fields and those verdicts only; code checks
 * the note and falls back to one built from the verdicts. If step A fails the ICP
 * is saved "ungraded" with an encouraging note, so the student is never blocked.
 * The record goes to attempts.stage_data.icp; a graded record is never re-graded.
 * GET returns the note; PATCH marks it seen. Responses carry only the note and its
 * state, never the score, band or criteria.
 */

import OpenAI from "openai";
import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import {
  buildFallbackNote,
  buildGradingMessages,
  buildGradingSchema,
  buildNoteMessages,
  checkManagerNote,
  gradeIcp,
  ICP_GRADE_TEMPERATURE,
  ICP_GRADING_MODEL,
  ICP_NOTE_MAX_TOKENS,
  ICP_NOTE_TEMPERATURE,
  parseGradingReply,
  parseIcpGradeRecord,
  splitLabelledText,
  toIcpNoteView,
  type IcpGradeRecord,
  type IcpSizeCriterion,
} from "@/lib/icp-grading";
import { revalidateStudentAttemptSurfaces } from "@/lib/revalidate-student-progress";
import { createServiceClient } from "@/lib/supabase/server";
import { TEMPO_ICP_NOTE_COPY, TEMPO_ICP_RUBRIC, TEMPO_TERRITORY_PLACES } from "@/lib/tempo-icp-criteria";
import {
  DEFAULT_PROSPECTING_WIZARD_STATE,
  formatIcpTextForFeedback,
  ICP_FORM_FIELD_KEYS,
  isIcpDefinitionComplete,
  parseIcpLocationCount,
  type ProspectingWizardState,
} from "@/lib/tempo-prospecting";

type PatchBody = {
  attemptId?: string;
  feedbackSeen?: boolean;
};

type IcpFormKey = (typeof ICP_FORM_FIELD_KEYS)[number];

type IcpFormFields = Pick<ProspectingWizardState, IcpFormKey>;

/** The longest text accepted for any ICP field (the form caps at 500). */
const MAX_FIELD_CHARS = 500;

/**
 * The ICP form fields from the request body, or null unless every field is a
 * string and they pass the ICP step's own completeness check.
 */
function readIcpFields(raw: unknown): IcpFormFields | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const source = raw as Record<string, unknown>;
  const fields = { ...DEFAULT_PROSPECTING_WIZARD_STATE } as ProspectingWizardState;
  for (const key of ICP_FORM_FIELD_KEYS) {
    const value = source[key];
    if (typeof value !== "string") {
      return null;
    }
    (fields as Record<IcpFormKey, string>)[key] = value.slice(0, MAX_FIELD_CHARS);
  }
  if (!isIcpDefinitionComplete(fields)) {
    return null;
  }
  return Object.fromEntries(ICP_FORM_FIELD_KEYS.map((key) => [key, fields[key]])) as IcpFormFields;
}

/**
 * Loads an attempt owned by the authenticated student.
 */
async function loadOwnedAttempt(
  attemptId: string,
  studentId: string
): Promise<{
  id: string;
  stage_data: Record<string, unknown> | null;
  class_id: string | null;
  simulation_id: string | null;
} | null> {
  const supabase = createServiceClient();
  const { data: attempt } = await supabase
    .from("attempts")
    .select("id, student_id, stage_data, class_id, simulation_id")
    .eq("id", attemptId)
    .eq("student_id", studentId)
    .single();

  if (!attempt) {
    return null;
  }

  return {
    id: attempt.id as string,
    stage_data: (attempt.stage_data as Record<string, unknown> | null) ?? null,
    class_id: (attempt.class_id as string | null) ?? null,
    simulation_id: (attempt.simulation_id as string | null) ?? null,
  };
}

/**
 * Writes the record to attempts.stage_data.icp, re-reading stage_data first so
 * wizard autosaves made while grading ran are kept.
 */
async function persistIcp(attemptId: string, studentId: string, icp: IcpGradeRecord): Promise<void> {
  const latest = await loadOwnedAttempt(attemptId, studentId);
  const supabase = createServiceClient();
  const { error } = await supabase
    .from("attempts")
    .update({ stage_data: { ...(latest?.stage_data ?? {}), icp } })
    .eq("id", attemptId);

  if (error) {
    throw error;
  }
}

/** The simulation's public directory company names (the note must never name one); empty when unavailable. */
async function loadDirectoryCompanyNames(simulationId: string | null): Promise<string[]> {
  if (!simulationId) {
    return [];
  }
  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("crm_prospect_directory")
    .select("company_name")
    .eq("simulation_id", simulationId)
    .eq("is_active", true);
  if (error) {
    console.error("[icp-check] company names", error);
    return [];
  }
  return (data ?? [])
    .map((row) => (typeof row.company_name === "string" ? row.company_name : ""))
    .filter((name) => name.trim().length > 0);
}

const sizeCriterion = TEMPO_ICP_RUBRIC.criteria.find(
  (criterion): criterion is IcpSizeCriterion => criterion.kind === "size"
);

/**
 * Grades the ICP (step A), then writes and checks the manager note (step B).
 * Step A failing gives the ungraded record; step B failing gives the fallback note.
 */
async function gradeAndWriteNote(fields: IcpFormFields, simulationId: string | null): Promise<IcpGradeRecord> {
  const gradedAt = new Date().toISOString();
  const ungraded: IcpGradeRecord = {
    rubricVersion: TEMPO_ICP_RUBRIC.version,
    fields: { ...fields },
    criteria: [],
    score: null,
    band: null,
    note: TEMPO_ICP_NOTE_COPY.ungradedNote,
    status: "ungraded",
    gradedAt,
    feedbackSeen: false,
  };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    console.error("[icp-check] OPENAI_API_KEY missing — saving ungraded.");
    return ungraded;
  }
  const openai = new OpenAI({ apiKey });
  // Built server-side from the validated fields, so what is graded is what is saved.
  const studentFields = splitLabelledText(
    formatIcpTextForFeedback({ ...DEFAULT_PROSPECTING_WIZARD_STATE, ...fields })
  );
  const studentText = studentFields.map((field) => field.value).join("\n");

  // ── Step A: grade ───
  let graded: ReturnType<typeof gradeIcp>;
  try {
    const grading = buildGradingMessages(TEMPO_ICP_RUBRIC, studentFields);
    const completion = await openai.chat.completions.create({
      model: ICP_GRADING_MODEL,
      temperature: ICP_GRADE_TEMPERATURE,
      response_format: { type: "json_schema", json_schema: buildGradingSchema(TEMPO_ICP_RUBRIC) },
      messages: [
        { role: "system", content: grading.system },
        { role: "user", content: grading.user },
      ],
    });
    const verdicts = parseGradingReply(completion.choices[0]?.message?.content, TEMPO_ICP_RUBRIC);
    if (!verdicts) {
      console.error("[icp-check] grading reply unreadable — saving ungraded.");
      return ungraded;
    }
    graded = gradeIcp({
      rubric: TEMPO_ICP_RUBRIC,
      verdicts,
      studentText,
      sizeMin: parseIcpLocationCount(fields.icpSizeMinLocations),
      sizeMax: parseIcpLocationCount(fields.icpSizeMaxLocations),
    });
  } catch (err) {
    console.error("[icp-check] grading failed — saving ungraded:", err);
    return ungraded;
  }

  // ── Step B: manager note ───
  let note = "";
  try {
    const noteMessages = buildNoteMessages({
      copy: TEMPO_ICP_NOTE_COPY,
      rubric: TEMPO_ICP_RUBRIC,
      fields: studentFields,
      criteria: graded.criteria,
    });
    const completion = await openai.chat.completions.create({
      model: ICP_GRADING_MODEL,
      temperature: ICP_NOTE_TEMPERATURE,
      max_tokens: ICP_NOTE_MAX_TOKENS,
      messages: [
        { role: "system", content: noteMessages.system },
        { role: "user", content: noteMessages.user },
      ],
    });
    const draft = (completion.choices[0]?.message?.content ?? "").trim();
    const problems = checkManagerNote(draft, {
      minWords: TEMPO_ICP_NOTE_COPY.minWords,
      maxWords: TEMPO_ICP_NOTE_COPY.maxWords,
      realRange: [sizeCriterion?.realMin ?? 0, sizeCriterion?.realMax ?? 0],
      forbiddenNames: [...TEMPO_TERRITORY_PLACES, ...(await loadDirectoryCompanyNames(simulationId))],
    });
    if (problems.length === 0) {
      note = draft;
    } else {
      console.error("[icp-check] note failed checks — using fallback:", problems.join(", "));
    }
  } catch (err) {
    console.error("[icp-check] note failed — using fallback:", err);
  }

  return {
    ...ungraded,
    criteria: graded.criteria,
    score: graded.score,
    band: graded.band,
    note: note || buildFallbackNote(TEMPO_ICP_RUBRIC, graded.criteria, TEMPO_ICP_NOTE_COPY),
    status: "graded",
  };
}

/**
 * GET /api/student/icp-check?attemptId=… — the saved note, or null.
 */
export async function GET(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const attemptId = new URL(request.url).searchParams.get("attemptId")?.trim() ?? "";
    if (!attemptId) {
      return NextResponse.json({ error: "Missing attemptId." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const icp = parseIcpGradeRecord(attempt.stage_data?.icp);
    return NextResponse.json({ icp: icp ? toIcpNoteView(icp) : null });
  } catch (err) {
    console.error("[icp-check] GET failed:", err);
    return NextResponse.json({ error: "Could not load the ICP review." }, { status: 500 });
  }
}

/**
 * PATCH /api/student/icp-check — mark manager feedback as seen (Continue).
 */
export async function PATCH(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as PatchBody;
    const attemptId = body.attemptId?.trim() ?? "";
    if (!attemptId || body.feedbackSeen !== true) {
      return NextResponse.json({ error: "Missing attemptId or feedbackSeen." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const existingIcp = parseIcpGradeRecord(attempt.stage_data?.icp);
    if (!existingIcp) {
      return NextResponse.json({ error: "ICP not submitted yet." }, { status: 400 });
    }

    const next: IcpGradeRecord = { ...existingIcp, feedbackSeen: true };
    await persistIcp(attemptId, auth.session.studentId, next);
    revalidateStudentAttemptSurfaces({
      classId: attempt.class_id,
      simulationId: attempt.simulation_id,
    });
    return NextResponse.json({ icp: toIcpNoteView(next) });
  } catch (err) {
    console.error("[icp-check] PATCH failed:", err);
    return NextResponse.json({ error: "Could not update ICP state." }, { status: 500 });
  }
}

/**
 * POST /api/student/icp-check — { attemptId, icpText, fields }. Grades the ICP
 * once and returns the note; a graded record is returned as is. icpText is the
 * client's formatIcpTextForFeedback; the route rebuilds it from the fields.
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as { attemptId?: unknown; fields?: unknown };
    const attemptId = typeof body.attemptId === "string" ? body.attemptId.trim() : "";
    const fields = readIcpFields(body.fields);

    if (!attemptId || !fields) {
      return NextResponse.json({ error: "Missing attemptId or a complete ICP." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    // Grade once: a graded record is returned without calling a model again.
    const existing = parseIcpGradeRecord(attempt.stage_data?.icp);
    if (existing?.status === "graded") {
      return NextResponse.json(toIcpNoteView(existing));
    }

    const icp = await gradeAndWriteNote(fields, attempt.simulation_id);
    await persistIcp(attemptId, auth.session.studentId, icp);
    revalidateStudentAttemptSurfaces({
      classId: attempt.class_id,
      simulationId: attempt.simulation_id,
    });

    return NextResponse.json(toIcpNoteView(icp));
  } catch (err) {
    console.error("[icp-check] POST failed:", err);
    return NextResponse.json({ error: "Could not review your ICP." }, { status: 500 });
  }
}
