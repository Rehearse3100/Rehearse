/**
 * classes/route.ts
 * GET  /api/professor/classes — list professor's classes
 * POST /api/professor/classes — create class with auto join code
 */

import { NextResponse } from "next/server";
import { requireProfessorApi } from "@/lib/api-auth";
import { generateJoinCode } from "@/lib/join-code";
import { createServiceClient } from "@/lib/supabase/server";

import { CLASS_COLOR_SCHEMES, type ClassColorSchemeId } from "@/lib/class-appearance";

type CreateClassBody = {
  name?: string;
  description?: string;
  cardColorScheme?: string;
};

const VALID_COLOR_SCHEMES = new Set(CLASS_COLOR_SCHEMES.map((s) => s.id));

const JOIN_CODE_RETRIES = 8;

/**
 * Returns all classes for the logged-in professor with counts.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const auth = await requireProfessorApi();
    if (!auth.ok) {
      return auth.response;
    }

    const supabase = createServiceClient();
    const { data: classes, error } = await supabase
      .from("classes")
      .select("*")
      .eq("professor_id", auth.professorId)
      .order("created_at", { ascending: false });

    if (error) {
      return NextResponse.json({ error: "Could not load classes." }, { status: 500 });
    }

    const classIds = (classes ?? []).map((c) => c.id);
    const studentCounts = new Map<string, number>();
    const simulationCounts = new Map<string, number>();

    if (classIds.length > 0) {
      const { data: enrollments } = await supabase
        .from("student_classes")
        .select("class_id")
        .in("class_id", classIds);

      (enrollments ?? []).forEach((row) => {
        studentCounts.set(row.class_id, (studentCounts.get(row.class_id) ?? 0) + 1);
      });

      const { data: sims } = await supabase
        .from("class_simulations")
        .select("class_id")
        .in("class_id", classIds);

      (sims ?? []).forEach((row) => {
        simulationCounts.set(row.class_id, (simulationCounts.get(row.class_id) ?? 0) + 1);
      });
    }

    const enriched = (classes ?? []).map((c) => ({
      ...c,
      student_count: studentCounts.get(c.id) ?? 0,
      simulation_count: simulationCounts.get(c.id) ?? 0,
    }));

    return NextResponse.json({ classes: enriched });
  } catch (err) {
    console.error("[professor/classes GET]", err);
    return NextResponse.json({ error: "Could not load classes." }, { status: 500 });
  }
}

/**
 * Creates a new class with a unique join code.
 */
export async function POST(request: Request): Promise<NextResponse> {
  try {
    const auth = await requireProfessorApi();
    if (!auth.ok) {
      return auth.response;
    }

    const body = (await request.json()) as CreateClassBody;
    const name = body.name?.trim() ?? "";
    const description = body.description?.trim() || null;
    const schemeRaw = body.cardColorScheme?.trim() ?? "default";
    const cardColorScheme: ClassColorSchemeId = VALID_COLOR_SCHEMES.has(schemeRaw as ClassColorSchemeId)
      ? (schemeRaw as ClassColorSchemeId)
      : "default";

    if (!name) {
      return NextResponse.json({ error: "Class name is required." }, { status: 400 });
    }

    const supabase = createServiceClient();

    for (let i = 0; i < JOIN_CODE_RETRIES; i += 1) {
      const joinCode = generateJoinCode();
      const { data, error } = await supabase
        .from("classes")
        .insert({
          professor_id: auth.professorId,
          name,
          description,
          join_code: joinCode,
          card_color_scheme: cardColorScheme,
        })
        .select("*")
        .single();

      if (!error && data) {
        return NextResponse.json({ class: data });
      }

      if (error?.code !== "23505") {
        return NextResponse.json({ error: "Could not create class." }, { status: 500 });
      }
    }

    return NextResponse.json({ error: "Could not generate a unique join code." }, { status: 500 });
  } catch (err) {
    console.error("[professor/classes POST]", err);
    return NextResponse.json({ error: "Could not create class." }, { status: 500 });
  }
}
