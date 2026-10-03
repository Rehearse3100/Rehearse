/**
 * classes/[classId]/route.ts
 * GET    — class details + students + simulations
 * PATCH  — update name/description/isActive
 * DELETE — delete class
 */

import { NextResponse } from "next/server";
import { requireProfessorApi } from "@/lib/api-auth";
import { DEFAULT_CLASS_ID } from "@/lib/constants";
import { createServiceClient } from "@/lib/supabase/server";

type RouteContext = { params: { classId: string } };

type PatchBody = {
  name?: string;
  description?: string;
  isActive?: boolean;
  cardImageUrl?: string | null;
  cardColorScheme?: string | null;
};

const VALID_COLOR_SCHEMES = new Set([
  "default",
  "ocean",
  "forest",
  "sunset",
  "violet",
  "rose",
]);

/**
 * Loads a single class with enrolled students and assigned simulations.
 */
export async function GET(
  _request: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    const auth = await requireProfessorApi();
    if (!auth.ok) {
      return auth.response;
    }

    const supabase = createServiceClient();

    const { data: classRow, error } = await supabase
      .from("classes")
      .select("*")
      .eq("id", params.classId)
      .eq("professor_id", auth.professorId)
      .single();

    if (error || !classRow) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const { data: enrollmentRows } = await supabase
      .from("student_classes")
      .select(
        `
      joined_at,
      students (
        id,
        username,
        display_name,
        joined_at
      )
    `
      )
      .eq("class_id", params.classId)
      .order("joined_at", { ascending: false });

    const students = (enrollmentRows ?? []).map((row) => {
      const studentRaw = row.students;
      const student = Array.isArray(studentRaw) ? studentRaw[0] : studentRaw;
      if (!student) return null;
      return {
        id: student.id,
        username: student.username,
        display_name: student.display_name,
        joined_at: row.joined_at,
      };
    }).filter(Boolean);

    const { data: classSimulations } = await supabase
      .from("class_simulations")
      .select(
        `
      id,
      simulation_id,
      added_at,
      simulations (
        id, title, description, persona_name, persona_role, is_published
      )
    `
      )
      .eq("class_id", params.classId)
      .order("added_at", { ascending: false });

    return NextResponse.json({
      class: classRow,
      students: students ?? [],
      simulations: classSimulations ?? [],
    });
  } catch (err) {
    console.error("[professor/classes/[classId] GET]", err);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}

/**
 * Updates class metadata for the logged-in professor.
 */
export async function PATCH(
  request: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    if (params.classId === DEFAULT_CLASS_ID) {
      return NextResponse.json(
        { error: "The default class cannot be modified." },
        { status: 403 }
      );
    }

    const auth = await requireProfessorApi();
    if (!auth.ok) {
      return auth.response;
    }

    const body = (await request.json()) as PatchBody;
    const updates: Record<string, string | boolean | null> = {};

    if (body.name !== undefined) {
      const name = body.name.trim();
      if (!name) {
        return NextResponse.json({ error: "Class name cannot be empty." }, { status: 400 });
      }
      updates.name = name;
    }
    if (body.description !== undefined) {
      updates.description = body.description.trim() || null;
    }
    if (body.isActive !== undefined) {
      updates.is_active = body.isActive;
    }
    if (body.cardImageUrl !== undefined) {
      const url = body.cardImageUrl?.trim() ?? "";
      updates.card_image_url = url || null;
    }
    if (body.cardColorScheme !== undefined) {
      const scheme = body.cardColorScheme?.trim() ?? "default";
      if (!VALID_COLOR_SCHEMES.has(scheme)) {
        return NextResponse.json({ error: "Invalid color scheme." }, { status: 400 });
      }
      updates.card_color_scheme = scheme;
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "No updates provided." }, { status: 400 });
    }

    const supabase = createServiceClient();

    const { data: existing } = await supabase
      .from("classes")
      .select("id")
      .eq("id", params.classId)
      .eq("professor_id", auth.professorId)
      .maybeSingle();

    if (!existing) {
      return NextResponse.json({ error: "Class not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("classes")
      .update(updates)
      .eq("id", params.classId)
      .eq("professor_id", auth.professorId)
      .select("*")
      .single();

    if (error) {
      const message = error.message ?? "";
      const code = error.code;
      if (
        code === "PGRST204" ||
        message.includes("schema cache") ||
        (message.includes("Could not find") && message.includes("column"))
      ) {
        return NextResponse.json(
          {
            error:
              "Columns exist but Supabase API cache is stale. In Dashboard go to Settings → API → Reload schema, or run: NOTIFY pgrst, 'reload schema';",
          },
          { status: 503 }
        );
      }
      if (
        message.includes("card_image_url") ||
        message.includes("card_color_scheme") ||
        code === "42703"
      ) {
        return NextResponse.json(
          {
            error:
              "Class appearance columns are missing. Run supabase/class-appearance.sql in the SQL editor.",
          },
          { status: 503 }
        );
      }
      console.error("[professor/classes PATCH]", error);
      return NextResponse.json(
        { error: message || "Could not update class." },
        { status: 500 }
      );
    }

    if (!data) {
      return NextResponse.json({ error: "Could not update class." }, { status: 500 });
    }

    return NextResponse.json({ class: data });
  } catch (err) {
    console.error("[professor/classes/[classId] PATCH]", err);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}

/**
 * Deletes a class owned by the logged-in professor.
 */
export async function DELETE(
  _request: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    if (params.classId === DEFAULT_CLASS_ID) {
      return NextResponse.json(
        { error: "The default class cannot be modified." },
        { status: 403 }
      );
    }

    const auth = await requireProfessorApi();
    if (!auth.ok) {
      return auth.response;
    }

    const supabase = createServiceClient();
    const { error } = await supabase
      .from("classes")
      .delete()
      .eq("id", params.classId)
      .eq("professor_id", auth.professorId);

    if (error) {
      return NextResponse.json({ error: "Could not delete class." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[professor/classes/[classId] DELETE]", err);
    return NextResponse.json(
      { error: "Unexpected server error." },
      { status: 500 }
    );
  }
}
