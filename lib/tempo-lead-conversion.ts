/**
 * tempo-lead-conversion.ts
 * Shared Lead identity validation + Account/Contact conversion for Tempo CRM.
 * Uses typo-tolerant fuzzy matching for company/contact names.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { isCloseMatch } from "@/lib/string-similarity";

export const CORRECT_COMPANY = "Summit Dental Group";
export const CORRECT_CONTACT = "Dana Reyes";

/** Failure shape kept loose so callers that only check success stay compatible. */
export type LeadValidationResult =
  | { success: true }
  | { success: false; reason: "company" | "contact"; managerNote?: string };

export type ConvertLeadResult = LeadValidationResult;

/**
 * Validates company + contact against the known correct Tempo path (fuzzy).
 * Always enforced — TEMPO_TEST_BYPASS_GATES must not skip manager-note feedback
 * for a wrong company/contact (Summit/Dana can still be pre-seeded for convenience).
 */
export function validateLeadIdentity(
  companyName: string,
  contactName: string
): LeadValidationResult {
  if (!isCloseMatch(companyName, CORRECT_COMPANY)) {
    return { success: false, reason: "company" };
  }
  if (!isCloseMatch(contactName, CORRECT_CONTACT)) {
    return { success: false, reason: "contact" };
  }
  return { success: true };
}

/** Lead columns needed to build Account + Contact records. */
export type LeadRecordForSync = {
  company_name?: unknown;
  contact_name?: unknown;
  contact_title?: unknown;
  why_fit?: unknown;
  trigger_event?: unknown;
};

/**
 * Autofills the Account + Dana Contact records from a Lead's fields.
 * Merges into any existing rows so student-entered fields (industry, region,
 * strategy notes, buying role, …) are preserved. Used both when the target
 * lead is selected (early autofill) and at conversion.
 */
export async function syncLeadToAccountAndContact(
  supabase: SupabaseClient,
  attemptId: string,
  lead: LeadRecordForSync
): Promise<void> {
  const companyName = String(lead.company_name ?? "").trim();
  const contactName = String(lead.contact_name ?? "").trim();
  const contactTitle = String(lead.contact_title ?? "").trim();
  const whyFit = String(lead.why_fit ?? "").trim();
  const triggerEvent = String(lead.trigger_event ?? "").trim();
  const primaryContact = contactTitle
    ? `${contactName}, ${contactTitle}`
    : contactName;
  const updatedAt = new Date().toISOString();

  const { data: existingAccount } = await supabase
    .from("crm_account_notes")
    .select("notes, fields")
    .eq("attempt_id", attemptId)
    .maybeSingle();

  const accountFields: Record<string, string> = {
    ...((existingAccount?.fields as Record<string, string> | null) ?? {}),
    accountName: companyName,
    primaryContact,
    whyFit,
    trigger: triggerEvent,
  };

  const { error: accountError } = await supabase.from("crm_account_notes").upsert(
    {
      attempt_id: attemptId,
      notes: String(existingAccount?.notes ?? ""),
      fields: accountFields,
      updated_at: updatedAt,
    },
    { onConflict: "attempt_id" }
  );

  if (accountError) {
    console.error("[syncLeadToAccountAndContact] account upsert failed:", accountError);
    throw new Error("Could not create account from lead.");
  }

  const { data: existingContact } = await supabase
    .from("crm_contact_notes")
    .select("role, notes, fields")
    .eq("attempt_id", attemptId)
    .eq("contact_key", "dana_reyes")
    .maybeSingle();

  const contactFields: Record<string, string> = {
    ...((existingContact?.fields as Record<string, string> | null) ?? {}),
    name: contactName,
    position: contactTitle,
  };

  const { error: contactError } = await supabase.from("crm_contact_notes").upsert(
    {
      attempt_id: attemptId,
      contact_key: "dana_reyes",
      role: String(existingContact?.role ?? ""),
      notes: String(existingContact?.notes ?? ""),
      fields: contactFields,
      updated_at: updatedAt,
    },
    { onConflict: "attempt_id,contact_key" }
  );

  if (contactError) {
    console.error("[syncLeadToAccountAndContact] contact upsert failed:", contactError);
    throw new Error("Could not create contact from lead.");
  }
}

/**
 * Converts a Lead into Account + Dana Contact and marks the Lead converted.
 * Validates identity first; idempotent if this lead is already converted.
 */
export async function convertLead(
  supabase: SupabaseClient,
  attemptId: string,
  leadId: string
): Promise<ConvertLeadResult> {
  const { data: lead, error: loadError } = await supabase
    .from("crm_leads")
    .select(
      "id, attempt_id, status, company_name, contact_name, contact_title, why_fit, trigger_event"
    )
    .eq("id", leadId)
    .eq("attempt_id", attemptId)
    .maybeSingle();

  if (loadError || !lead) {
    console.error("[convertLead] load failed:", loadError);
    throw new Error("Could not load lead for conversion.");
  }

  if (lead.status === "converted") {
    return { success: true };
  }

  const companyName = String(lead.company_name ?? "");
  const contactName = String(lead.contact_name ?? "");
  const validation = validateLeadIdentity(companyName, contactName);
  if (!validation.success) {
    return validation;
  }

  const { data: alreadyConverted } = await supabase
    .from("crm_leads")
    .select("id")
    .eq("attempt_id", attemptId)
    .eq("status", "converted")
    .maybeSingle();

  if (alreadyConverted && alreadyConverted.id !== leadId) {
    console.error(
      "[convertLead] another lead already converted for attempt",
      attemptId,
      alreadyConverted.id
    );
    throw new Error("A lead has already been converted for this deal.");
  }

  await syncLeadToAccountAndContact(supabase, attemptId, lead);

  const updatedAt = new Date().toISOString();
  const { error: leadError } = await supabase
    .from("crm_leads")
    .update({ status: "converted", updated_at: updatedAt })
    .eq("id", leadId);

  if (leadError) {
    console.error("[convertLead] lead status update failed:", leadError);
    throw new Error("Could not mark lead converted.");
  }

  return { success: true };
}
