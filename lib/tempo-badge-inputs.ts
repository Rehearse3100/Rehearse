/**
 * tempo-badge-inputs.ts
 * Builds the CRM fields and Discovery prep payload that detectTempoBadges receives.
 * Moved unchanged out of POST /api/student/complete-stage so inline (legacy)
 * grading and background Tempo grading (POST /api/student/grade-badges) pass
 * identical inputs. Reads only from the database, never from the browser.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { DiscoveryPreCallPrepPayload, TempoBadgeStage } from "@/lib/tempo-badges";
import { parseDiscoveryPreCallPrepFromTranscript } from "@/lib/tempo-discovery";

export type TempoBadgeInputs = {
  crmFields: Record<string, string> | null;
  discoveryPrepPayload: DiscoveryPreCallPrepPayload | null;
};

/**
 * Loads the stage's CRM fields (converted lead for prospecting, CRM log for
 * discovery/objections) and parses the Discovery pre-call plan from the saved
 * transcript. Other stages get { crmFields: null, discoveryPrepPayload: null }.
 */
export async function buildTempoBadgeInputs(
  supabase: SupabaseClient,
  attemptId: string,
  stage: TempoBadgeStage,
  transcript: string
): Promise<TempoBadgeInputs> {
  let crmFields: Record<string, string> | null = null;

  if (stage === "prospecting") {
    const { data: convertedLead } = await supabase
      .from("crm_leads")
      .select("trigger_event, why_fit")
      .eq("attempt_id", attemptId)
      .eq("status", "converted")
      .maybeSingle();

    if (convertedLead) {
      crmFields = {
        trigger: String(convertedLead.trigger_event ?? ""),
        whyFit: String(convertedLead.why_fit ?? ""),
      };
    }
  } else if (stage === "discovery" || stage === "objections") {
    const { data: crmLog } = await supabase
      .from("crm_log_entries")
      .select("fields")
      .eq("attempt_id", attemptId)
      .eq("stage", stage)
      .maybeSingle();

    const rawFields = crmLog?.fields;
    if (rawFields && typeof rawFields === "object" && !Array.isArray(rawFields)) {
      const normalized: Record<string, string> = {};
      for (const [key, value] of Object.entries(rawFields as Record<string, unknown>)) {
        if (typeof value === "string") {
          normalized[key] = value;
        } else if (value != null) {
          normalized[key] = String(value);
        }
      }
      crmFields = normalized;
    }
  }

  const discoveryPrepPayload =
    stage === "discovery"
      ? (() => {
          const prep = parseDiscoveryPreCallPrepFromTranscript(transcript);
          if (!prep) {
            return null;
          }
          return {
            openQuestions: prep.openQuestions.filter((q) => q.trim().length > 0),
            anticipatedProbe: prep.anticipatedProbe,
            anticipatedConfirm: prep.anticipatedConfirm,
          };
        })()
      : null;

  return { crmFields, discoveryPrepPayload };
}
