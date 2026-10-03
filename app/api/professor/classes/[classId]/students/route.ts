/**
 * classes/[classId]/students/route.ts
 * DELETE — remove a student enrollment from a class
 */

import { NextResponse } from "next/server";
import { requireProfessorApi } from "@/lib/api-auth";
import { createServiceClient } from "@/lib/supabase/server";

type RouteContext = { params: { classId: string } };

type DeleteBody = {
  studentId?: string;
};

/**
 * Removes a student from the professor's class (deletes student_classes row).
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    const auth = await requireProfessorApi();
    if (!auth.ok) {
      return auth.response;
    }

    const body = (await request.json()) as DeleteBody;
    const studentId = body.studentId?.trim();
    if (!studentId) {
      return NextResponse.json({ error: "studentId is required." }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: classRow } = await supabase
      .from("classes")
      .select("id")
      .eq("id", params.classId)
      .eq("professor_id", auth.professorId)
      .single();

    if (!classRow) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const { error } = await supabase
      .from("student_classes")
      .delete()
      .eq("class_id", params.classId)
      .eq("student_id", studentId)
      .eq("professor_id", auth.professorId);

    if (error) {
      return NextResponse.json({ error: "Could not remove student." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[professor/classes/students DELETE]", err);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
