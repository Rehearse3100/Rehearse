/**
 * student-enrollment.ts
 * Shared helpers for enrolling students in classes via student_classes.
 */

import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_CLASS_ID } from "@/lib/constants";

type EnrollInput = {
  studentId: string;
  classId: string;
  professorId: string | null;
};

export type EnrollmentFailure = {
  status: number;
  message: string;
  code?: string;
};

type EnrollResult = { ok: true } | ({ ok: false } & EnrollmentFailure);

/**
 * Maps Supabase enrollment errors to API-friendly responses.
 */
export function enrollmentErrorMessage(error: PostgrestError): { ok: false } & EnrollmentFailure {
  console.error("[student-enrollment]", error.code, error.message, error.details);

  if (error.code === "23505") {
    return {
      ok: false as const,
      status: 409,
      message: "You are already enrolled in this class",
      code: error.code,
    };
  }

  const missingTable =
    error.code === "42P01" ||
    error.code === "PGRST205" ||
    error.message?.includes("student_classes") ||
    error.message?.includes("schema cache");

  if (missingTable) {
    return {
      ok: false as const,
      status: 503,
      message:
        "Class enrollment is not set up yet. Run supabase/FULL-SETUP.sql in the Supabase SQL editor.",
      code: error.code,
    };
  }

  if (error.code === "23503") {
    return {
      ok: false as const,
      status: 400,
      message: "Invalid class or student record. Try signing out and back in.",
      code: error.code,
    };
  }

  return {
    ok: false as const,
    status: 500,
    message: "Could not join class. Please try again.",
    code: error.code,
  };
}

/**
 * Inserts a student_classes enrollment row.
 */
export async function enrollStudentInClass(
  supabase: SupabaseClient,
  input: EnrollInput
): Promise<EnrollResult> {
  const { error } = await supabase.from("student_classes").insert({
    student_id: input.studentId,
    class_id: input.classId,
    professor_id: input.professorId,
  });

  if (error) {
    return enrollmentErrorMessage(error);
  }

  return { ok: true };
}

/**
 * Returns true if the student is already enrolled in the class.
 */
export async function isStudentEnrolledInClass(
  supabase: SupabaseClient,
  studentId: string,
  classId: string
): Promise<{ enrolled: boolean; lookupFailed: boolean }> {
  const { data, error } = await supabase
    .from("student_classes")
    .select("id")
    .eq("student_id", studentId)
    .eq("class_id", classId)
    .maybeSingle();

  if (error) {
    console.error("[student-enrollment] lookup", error.code, error.message);
    return { enrolled: false, lookupFailed: true };
  }

  return { enrolled: Boolean(data), lookupFailed: false };
}

/**
 * Enrolls a student in the Rehearse Essentials system class.
 * Non-blocking — duplicate enrollments are ignored.
 */
export async function enrollStudentInDefaultClass(
  supabase: SupabaseClient,
  studentId: string
): Promise<void> {
  const { error } = await supabase.from("student_classes").insert({
    student_id: studentId,
    class_id: DEFAULT_CLASS_ID,
    professor_id: null,
  });

  if (error && error.code !== "23505") {
    console.error("[student-enrollment] default class enroll failed:", error);
  }
}
