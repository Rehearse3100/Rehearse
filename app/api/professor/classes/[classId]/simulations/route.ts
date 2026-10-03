/**
 * classes/[classId]/simulations/route.ts
 * POST   — add simulation to class
 * DELETE — remove simulation from class
 */

import { NextResponse } from "next/server";
import { requireProfessorApi } from "@/lib/api-auth";
import { DEFAULT_CLASS_ID } from "@/lib/constants";
import { createServiceClient } from "@/lib/supabase/server";

type RouteContext = { params: { classId: string } };

type SimulationBody = {
  simulationId?: string;
};

/**
 * Assigns one of the professor's simulations to a class.
 */
export async function POST(
  request: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    if (params.classId === DEFAULT_CLASS_ID) {
      return NextResponse.json(
        { error: "Simulations in the default class are managed by the system." },
        { status: 403 }
      );
    }

    const auth = await requireProfessorApi();
    if (!auth.ok) {
      return auth.response;
    }

    const body = (await request.json()) as SimulationBody;
    const simulationId = body.simulationId?.trim();
    if (!simulationId) {
      return NextResponse.json({ error: "simulationId is required." }, { status: 400 });
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

    const { data: simulation } = await supabase
      .from("simulations")
      .select("id")
      .eq("id", simulationId)
      .eq("teacher_id", auth.professorId)
      .single();

    if (!simulation) {
      return NextResponse.json({ error: "Simulation not found." }, { status: 404 });
    }

    const { data, error } = await supabase
      .from("class_simulations")
      .insert({ class_id: params.classId, simulation_id: simulationId })
      .select("*")
      .single();

    if (error) {
      if (error.code === "23505") {
        return NextResponse.json(
          { error: "Simulation already assigned to this class." },
          { status: 409 }
        );
      }
      return NextResponse.json({ error: "Could not assign simulation." }, { status: 500 });
    }

    return NextResponse.json({ classSimulation: data });
  } catch (err) {
    console.error("[professor/classes/simulations POST]", err);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}

/**
 * Removes a simulation assignment from a class.
 */
export async function DELETE(
  request: Request,
  { params }: RouteContext
): Promise<NextResponse> {
  try {
    if (params.classId === DEFAULT_CLASS_ID) {
      return NextResponse.json(
        { error: "Simulations in the default class are managed by the system." },
        { status: 403 }
      );
    }

    const auth = await requireProfessorApi();
    if (!auth.ok) {
      return auth.response;
    }

    const body = (await request.json()) as SimulationBody;
    const simulationId = body.simulationId?.trim();
    if (!simulationId) {
      return NextResponse.json({ error: "simulationId is required." }, { status: 400 });
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
      .from("class_simulations")
      .delete()
      .eq("class_id", params.classId)
      .eq("simulation_id", simulationId);

    if (error) {
      return NextResponse.json({ error: "Could not remove simulation." }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[professor/classes/simulations DELETE]", err);
    return NextResponse.json({ error: "Unexpected server error." }, { status: 500 });
  }
}
