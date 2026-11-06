/**
 * crm-leads/route.ts
 * GET/POST /api/student/crm-leads — list and create multi-entry CRM Leads.
 * With tester mode off, GET first deletes the leads tester mode seeded.
 * Uses service role because students do not have Supabase auth sessions.
 */

import { NextResponse } from "next/server";
import { requireStudentApi } from "@/lib/api-auth";
import { deleteTesterSeededLeads, isGateBypassEnabled } from "@/lib/tempo-test-bypass";
import { createServiceClient } from "@/lib/supabase/server";
import type { CrmLead } from "@/types";

type CreateLeadBody = {
  attemptId?: string;
  companyName?: string;
  contactName?: string;
  contactTitle?: string;
  whyFit?: string;
  trigger?: string;
  nextStep?: string;
  decisionMakerRationale?: string;
  /** Defaults to "new". Data Room shortlist creates "shortlisted". */
  status?: "new" | "shortlisted";
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
 * Maps a crm_leads row to the API CrmLead shape.
 */
function mapLeadRow(row: Record<string, unknown>): CrmLead {
  const statusRaw = String(row.status ?? "new");
  const status: CrmLead["status"] =
    statusRaw === "converted"
      ? "converted"
      : statusRaw === "selected"
        ? "selected"
        : statusRaw === "shortlisted"
          ? "shortlisted"
          : "new";

  return {
    id: String(row.id),
    attempt_id: String(row.attempt_id),
    company_name: String(row.company_name ?? ""),
    contact_name: String(row.contact_name ?? ""),
    contact_title: String(row.contact_title ?? ""),
    why_fit: String(row.why_fit ?? ""),
    trigger_event: String(row.trigger_event ?? ""),
    next_step: String(row.next_step ?? ""),
    decision_maker_rationale: String(row.decision_maker_rationale ?? ""),
    status,
    created_at: String(row.created_at ?? ""),
    updated_at: String(row.updated_at ?? ""),
  };
}

const LEAD_SELECT_COLUMNS =
  "id, attempt_id, company_name, contact_name, contact_title, why_fit, trigger_event, next_step, decision_maker_rationale, status, created_at, updated_at";

/**
 * GET /api/student/crm-leads?attemptId=… — all leads for the attempt.
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
      .from("crm_leads")
      .select(LEAD_SELECT_COLUMNS)
      .eq("attempt_id", attemptId)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("[crm-leads] GET failed:", error);
      return NextResponse.json({ error: "Could not load CRM leads." }, { status: 500 });
    }

    let leads = (data ?? []).map((row) => mapLeadRow(row as Record<string, unknown>));

    // Bypass off: delete the leads tester mode seeded, so they never pass for the
    // student's own picks. Leads the student wrote are left alone.
    if (!isGateBypassEnabled()) {
      leads = await deleteTesterSeededLeads(supabase, attemptId, leads);
    }

    return NextResponse.json({ leads });
  } catch {
    return NextResponse.json({ error: "Could not load CRM leads." }, { status: 500 });
  }
}

/**
 * POST /api/student/crm-leads — always creates a new Lead (multi-entry).
 */
export async function POST(request: Request): Promise<NextResponse> {
  const auth = await requireStudentApi();
  if (!auth.ok) {
    return auth.response;
  }

  try {
    const body = (await request.json()) as CreateLeadBody;
    const attemptId = body.attemptId?.trim();
    if (!attemptId) {
      return NextResponse.json({ error: "Missing attemptId." }, { status: 400 });
    }

    const attempt = await loadOwnedAttempt(attemptId, auth.session.studentId);
    if (!attempt) {
      return NextResponse.json({ error: "Attempt not found." }, { status: 404 });
    }

    const status: "new" | "shortlisted" =
      body.status === "shortlisted" ? "shortlisted" : "new";
    const companyName = (body.companyName ?? "").trim();

    const supabase = createServiceClient();

    if (status === "shortlisted") {
      if (!companyName) {
        return NextResponse.json({ error: "Company name is required." }, { status: 400 });
      }

      const { count, error: countError } = await supabase
        .from("crm_leads")
        .select("id", { count: "exact", head: true })
        .eq("attempt_id", attemptId)
        .eq("status", "shortlisted");

      if (countError) {
        console.error("[crm-leads] shortlist count failed:", countError);
        return NextResponse.json({ error: "Could not create CRM lead." }, { status: 500 });
      }
      if ((count ?? 0) >= 3) {
        return NextResponse.json(
          { error: "Shortlist is full (3/3). Remove one to add another." },
          { status: 400 }
        );
      }

      const { data: existingForCompany, error: dupError } = await supabase
        .from("crm_leads")
        .select("id")
        .eq("attempt_id", attemptId)
        .eq("status", "shortlisted")
        .eq("company_name", companyName)
        .limit(1);

      if (dupError) {
        console.error("[crm-leads] shortlist dup check failed:", dupError);
        return NextResponse.json({ error: "Could not create CRM lead." }, { status: 500 });
      }
      if ((existingForCompany ?? []).length > 0) {
        return NextResponse.json(
          { error: "This company is already on your shortlist." },
          { status: 400 }
        );
      }
    }

    const now = new Date().toISOString();
    const { data, error } = await supabase
      .from("crm_leads")
      .insert({
        attempt_id: attemptId,
        company_name: companyName,
        contact_name: (body.contactName ?? "").trim(),
        contact_title: (body.contactTitle ?? "").trim(),
        why_fit: (body.whyFit ?? "").trim(),
        trigger_event: (body.trigger ?? "").trim(),
        next_step: (body.nextStep ?? "").trim(),
        decision_maker_rationale: (body.decisionMakerRationale ?? "").trim(),
        status,
        created_at: now,
        updated_at: now,
      })
      .select(LEAD_SELECT_COLUMNS)
      .single();

    if (error || !data) {
      console.error("[crm-leads] POST failed:", error);
      return NextResponse.json({ error: "Could not create CRM lead." }, { status: 500 });
    }

    return NextResponse.json({ lead: mapLeadRow(data as Record<string, unknown>) });
  } catch {
    return NextResponse.json({ error: "Could not create CRM lead." }, { status: 500 });
  }
}
