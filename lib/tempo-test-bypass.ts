/**
 * tempo-test-bypass.ts
 * Server-only Tempo Prospecting gate bypass for local testing.
 * Enabled solely by TEMPO_TEST_BYPASS_GATES=true — never NEXT_PUBLIC_, never client process.env.
 * With the flag off, the CRM leads tester mode seeded (isTesterSeededLead) are
 * deleted and the wizard's references to them dropped, so they never pass for the
 * student's own picks.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CRM_ACCOUNT_FIELD_SCHEMA,
  emptyAccountFields,
} from "@/lib/tempo-crm-account";
import { emptyContactFields } from "@/lib/tempo-crm-contact";
import type { ProspectingWizardState } from "@/lib/tempo-prospecting";
import { isTestBypassAutofillValue, TEST_BYPASS_PREFIX } from "@/lib/tempo-test-bypass-client";

/** Re-export for server callers; single definition lives in tempo-test-bypass-client. */
export { TEST_BYPASS_PREFIX };

/** Known correct Tempo target — duplicated here to avoid circular imports with lead-conversion. */
const CORRECT_COMPANY = "Summit Dental Group";
const CORRECT_CONTACT = "Dana Reyes";

/**
 * True only when the exact string "true" is set. Absent / empty / other values are off.
 */
export function isGateBypassEnabled(): boolean {
  return process.env.TEMPO_TEST_BYPASS_GATES === "true";
}

/** ICP placeholders — satisfy isIcpDefinitionComplete when fields are empty. */
export const TEST_BYPASS_ICP = {
  icpTargetVerticals: `${TEST_BYPASS_PREFIX} Multi-location dental and specialty clinics`,
  icpDecisionMakerRole: `${TEST_BYPASS_PREFIX} Director of Operations owning scheduling and front-desk processes`,
  icpSizeMinLocations: "5",
  icpSizeMaxLocations: "20",
  icpOperationalSignals: `${TEST_BYPASS_PREFIX} Manual phone scheduling, rising no-shows, after-hours demand`,
  icpDisqualifier1: `${TEST_BYPASS_PREFIX} Single-location practices`,
  icpDisqualifier2: `${TEST_BYPASS_PREFIX} No front-desk overload signal`,
  icpDisqualifier3: `${TEST_BYPASS_PREFIX} Outside target metro territory`,
} as const;

/** Opening message within the 20–120 word gate, marked as test data. */
export const TEST_BYPASS_OPENING_MESSAGE =
  `${TEST_BYPASS_PREFIX} Hi Dana — I noticed Summit Dental Group recently opened an eighth ` +
  "location and wanted to reach out about how Tempo helps multi-site dental groups reduce " +
  "no-shows and capture after-hours demand. Would you have fifteen minutes next week to " +
  "explore whether this is worth a closer look for your operations team as you scale?";

const TEST_ACCOUNT_DEFAULTS: Record<string, string> = {
  accountName: `${TEST_BYPASS_PREFIX} ${CORRECT_COMPANY}`,
  industry: `${TEST_BYPASS_PREFIX} Healthcare / Dentistry`,
  locations: `${TEST_BYPASS_PREFIX} 8 practices`,
  region: `${TEST_BYPASS_PREFIX} Denver, CO`,
  primaryContact: `${TEST_BYPASS_PREFIX} ${CORRECT_CONTACT}, Director of Operations`,
  whyFit: `${TEST_BYPASS_PREFIX} Matches ICP: multi-site dental with scheduling strain`,
  trigger: `${TEST_BYPASS_PREFIX} Opening an 8th location`,
};

const TEST_CONTACT_DEFAULTS = {
  name: `${TEST_BYPASS_PREFIX} ${CORRECT_CONTACT}`,
  position: `${TEST_BYPASS_PREFIX} Director of Operations`,
  role: "Champion",
} as const;

const LEAD_SELECT_COLUMNS =
  "id, attempt_id, company_name, contact_name, contact_title, why_fit, trigger_event, next_step, decision_maker_rationale, status, created_at, updated_at";

// ── Tester-seeded CRM leads ───

/** why_fit of the three shortlist leads ensureShortlist seeds (after the [TEST] prefix). */
export const TEST_SHORTLIST_WHY_FIT = "Shortlist placeholder for gate bypass";
/** why_fit of the selected target lead ensureTargetLead seeds (after the [TEST] prefix). */
export const TEST_TARGET_WHY_FIT = "Correct target pre-seeded for faster testing";

const SEEDED_LEAD_WHY_FIT: readonly string[] = [TEST_SHORTLIST_WHY_FIT, TEST_TARGET_WHY_FIT];

/** The crm_leads text columns tester mode fills. */
export const LEAD_TEXT_COLUMNS = [
  "company_name",
  "contact_name",
  "contact_title",
  "why_fit",
  "trigger_event",
  "next_step",
  "decision_maker_rationale",
] as const;

export type LeadTextRow = Partial<Record<(typeof LEAD_TEXT_COLUMNS)[number], unknown>>;

const withoutPrefix = (value: string): string => {
  const trimmed = value.trim();
  return trimmed.startsWith(TEST_BYPASS_PREFIX) ? trimmed.slice(TEST_BYPASS_PREFIX.length).trim() : trimmed;
};

/**
 * True for a CRM lead tester mode seeded (ensureShortlist / ensureTargetLead):
 * any text column starts with the [TEST] prefix, or why_fit is one of the seed
 * placeholders with or without the prefix. A lead the student wrote matches neither.
 */
export function isTesterSeededLead(lead: LeadTextRow): boolean {
  const texts = LEAD_TEXT_COLUMNS.map((column) => (typeof lead[column] === "string" ? (lead[column] as string) : ""));
  if (texts.some(isTestBypassAutofillValue)) {
    return true;
  }
  return SEEDED_LEAD_WHY_FIT.includes(withoutPrefix(typeof lead.why_fit === "string" ? lead.why_fit : ""));
}

/**
 * Tester mode off: deletes the attempt's tester-seeded leads among `leads` and
 * returns the rest. If the delete fails, logs it and returns `leads` unchanged.
 */
export async function deleteTesterSeededLeads<T extends LeadTextRow & { id: unknown }>(
  supabase: SupabaseClient,
  attemptId: string,
  leads: readonly T[]
): Promise<T[]> {
  const seededIds = leads.filter(isTesterSeededLead).map((lead) => String(lead.id));
  if (seededIds.length === 0) {
    return [...leads];
  }
  const { error } = await supabase.from("crm_leads").delete().eq("attempt_id", attemptId).in("id", seededIds);
  if (error) {
    console.error("[tempo-test-bypass] seeded lead delete failed:", error);
    return [...leads];
  }
  return leads.filter((lead) => !seededIds.includes(String(lead.id)));
}

/**
 * Drops wizard references to leads that no longer exist: a selectedLeadId with no
 * lead row, and shortlisted directory company ids whose company has no lead left.
 * Ids whose company name is unknown are kept.
 */
export function dropMissingLeadRefs(
  state: ProspectingWizardState,
  leads: ReadonlyArray<{ id: unknown; company_name?: unknown }>,
  companyNameById: ReadonlyMap<string, string>
): ProspectingWizardState {
  const leadIds = new Set(leads.map((lead) => String(lead.id)));
  const leadCompanies = new Set(leads.map((lead) => String(lead.company_name ?? "")));
  const shortlistedCompanyIds = state.shortlistedCompanyIds.filter((companyId) => {
    const name = companyNameById.get(companyId);
    return name === undefined || leadCompanies.has(name);
  });
  const selectedLeadId = state.selectedLeadId && leadIds.has(state.selectedLeadId) ? state.selectedLeadId : null;
  return shortlistedCompanyIds.length === state.shortlistedCompanyIds.length && selectedLeadId === state.selectedLeadId
    ? state
    : { ...state, shortlistedCompanyIds, selectedLeadId };
}

/**
 * Tester mode off: deletes the attempt's tester-seeded leads, then drops the
 * wizard's references to leads that are gone (selected lead, shortlist ids).
 */
export async function clearTesterSeededLeads(
  supabase: SupabaseClient,
  attemptId: string,
  state: ProspectingWizardState
): Promise<ProspectingWizardState> {
  const { data, error } = await supabase
    .from("crm_leads")
    .select(`id, ${LEAD_TEXT_COLUMNS.join(", ")}`)
    .eq("attempt_id", attemptId);
  if (error) {
    console.error("[tempo-test-bypass] lead load failed:", error);
    return state;
  }
  const remaining = await deleteTesterSeededLeads(
    supabase,
    attemptId,
    (data ?? []) as unknown as Array<LeadTextRow & { id: unknown }>
  );

  const companyNameById = new Map<string, string>();
  if (state.shortlistedCompanyIds.length > 0) {
    // Public columns only: the directory company's id and name.
    const { data: companies, error: companiesError } = await supabase
      .from("crm_prospect_directory")
      .select("id, company_name")
      .in("id", state.shortlistedCompanyIds);
    if (companiesError) {
      console.error("[tempo-test-bypass] directory lookup failed:", companiesError);
    }
    for (const company of companies ?? []) {
      companyNameById.set(String(company.id), String(company.company_name ?? ""));
    }
  }
  return dropMissingLeadRefs(state, remaining, companyNameById);
}

type DirectoryPick = {
  id: string;
  company_name: string;
};

type ContactPick = {
  contact_name: string;
  contact_title: string;
};

/**
 * Fills empty wizard fields with [TEST] placeholders. Never overwrites non-empty values.
 */
export function applyWizardAutofill(state: ProspectingWizardState): ProspectingWizardState {
  const next: ProspectingWizardState = { ...state, selfCheck: { ...state.selfCheck } };

  // Do NOT set onboardingComplete here — new sims must open on Welcome Briefing.
  // Next on onboarding stays unlocked via the client testBypass prop (no full watch required).
  if (!next.onboardingComplete) {
    next.currentStepId = "onboarding";
  }

  if (!next.icpTargetVerticals.trim()) {
    next.icpTargetVerticals = TEST_BYPASS_ICP.icpTargetVerticals;
  }
  if (!next.icpDecisionMakerRole.trim()) {
    next.icpDecisionMakerRole = TEST_BYPASS_ICP.icpDecisionMakerRole;
  }
  if (!next.icpSizeMinLocations.trim()) {
    next.icpSizeMinLocations = TEST_BYPASS_ICP.icpSizeMinLocations;
  }
  if (!next.icpSizeMaxLocations.trim()) {
    next.icpSizeMaxLocations = TEST_BYPASS_ICP.icpSizeMaxLocations;
  }
  if (!next.icpOperationalSignals.trim()) {
    next.icpOperationalSignals = TEST_BYPASS_ICP.icpOperationalSignals;
  }
  if (!next.icpDisqualifier1.trim()) {
    next.icpDisqualifier1 = TEST_BYPASS_ICP.icpDisqualifier1;
  }
  if (!next.icpDisqualifier2.trim()) {
    next.icpDisqualifier2 = TEST_BYPASS_ICP.icpDisqualifier2;
  }
  if (!next.icpDisqualifier3.trim()) {
    next.icpDisqualifier3 = TEST_BYPASS_ICP.icpDisqualifier3;
  }

  if (!next.openingMessage.trim()) {
    next.openingMessage = TEST_BYPASS_OPENING_MESSAGE;
  }

  next.icpGateComplete = true;
  return next;
}

/**
 * Picks the first N Data Room companies alphabetically by company_name.
 * Selects only id + company_name — never class, fit_rank, entry_type, or other answer-key columns.
 */
async function pickAlphabeticalDataRoomCompanies(
  supabase: SupabaseClient,
  simulationId: string,
  count: number
): Promise<DirectoryPick[]> {
  const { data, error } = await supabase
    .from("crm_prospect_directory")
    .select("id, company_name")
    .eq("simulation_id", simulationId)
    .eq("in_data_room", true)
    .eq("is_active", true)
    .order("company_name", { ascending: true })
    .limit(count);

  if (error) {
    console.error("[tempo-test-bypass] directory pick failed:", error);
    return [];
  }

  return (data ?? []).map((row) => ({
    id: String(row.id),
    company_name: String(row.company_name ?? ""),
  }));
}

/**
 * First contact for a company by contact_name — public columns only.
 */
async function firstContactForCompany(
  supabase: SupabaseClient,
  companyId: string
): Promise<ContactPick> {
  const { data } = await supabase
    .from("crm_prospect_contacts")
    .select("contact_name, contact_title")
    .eq("company_id", companyId)
    .order("contact_name", { ascending: true })
    .limit(1)
    .maybeSingle();

  return {
    contact_name: String(data?.contact_name ?? `${TEST_BYPASS_PREFIX} Contact`),
    contact_title: String(data?.contact_title ?? `${TEST_BYPASS_PREFIX} Title`),
  };
}

/**
 * Ensures three shortlisted leads exist; returns their directory company ids.
 */
async function ensureShortlist(
  supabase: SupabaseClient,
  attemptId: string,
  simulationId: string
): Promise<string[]> {
  const { data: existing } = await supabase
    .from("crm_leads")
    .select("id, company_name")
    .eq("attempt_id", attemptId)
    .eq("status", "shortlisted")
    .order("created_at", { ascending: true });

  const shortlisted = existing ?? [];
  if (shortlisted.length >= 3) {
    const picks = await pickAlphabeticalDataRoomCompanies(supabase, simulationId, 64);
    const byName = new Map(picks.map((p) => [p.company_name, p.id]));
    return shortlisted
      .slice(0, 3)
      .map((row) => byName.get(String(row.company_name ?? "")) ?? "")
      .filter(Boolean);
  }

  const needed = 3 - shortlisted.length;
  const existingNames = new Set(shortlisted.map((row) => String(row.company_name ?? "")));
  const candidates = await pickAlphabeticalDataRoomCompanies(supabase, simulationId, 64);
  const toAdd = candidates.filter((c) => !existingNames.has(c.company_name)).slice(0, needed);
  const now = new Date().toISOString();

  for (const company of toAdd) {
    const contact = await firstContactForCompany(supabase, company.id);
    const { error } = await supabase.from("crm_leads").insert({
      attempt_id: attemptId,
      company_name: company.company_name,
      contact_name: `${TEST_BYPASS_PREFIX} ${contact.contact_name}`,
      contact_title: `${TEST_BYPASS_PREFIX} ${contact.contact_title}`,
      why_fit: `${TEST_BYPASS_PREFIX} ${TEST_SHORTLIST_WHY_FIT}`,
      trigger_event: `${TEST_BYPASS_PREFIX} Test trigger`,
      next_step: `${TEST_BYPASS_PREFIX} Call to qualify`,
      decision_maker_rationale: `${TEST_BYPASS_PREFIX} Placeholder rationale`,
      status: "shortlisted",
      created_at: now,
      updated_at: now,
    });
    if (error) {
      console.error("[tempo-test-bypass] shortlist insert failed:", error);
    }
  }

  const refreshes = await pickAlphabeticalDataRoomCompanies(supabase, simulationId, 64);
  const byName = new Map(refreshes.map((p) => [p.company_name, p.id]));
  const { data: after } = await supabase
    .from("crm_leads")
    .select("company_name")
    .eq("attempt_id", attemptId)
    .eq("status", "shortlisted")
    .order("created_at", { ascending: true });

  return (after ?? [])
    .slice(0, 3)
    .map((row) => byName.get(String(row.company_name ?? "")) ?? "")
    .filter(Boolean);
}

/**
 * Fills empty Account + primary Contact required fields with [TEST] placeholders.
 */
async function fillEmptyCrmProfile(
  supabase: SupabaseClient,
  attemptId: string
): Promise<void> {
  const now = new Date().toISOString();

  const { data: existingAccount } = await supabase
    .from("crm_account_notes")
    .select("notes, fields")
    .eq("attempt_id", attemptId)
    .maybeSingle();

  const accountFields: Record<string, string> = {
    ...emptyAccountFields(),
    ...((existingAccount?.fields as Record<string, string> | null) ?? {}),
  };
  for (const field of CRM_ACCOUNT_FIELD_SCHEMA) {
    if (!(accountFields[field.key] ?? "").trim()) {
      accountFields[field.key] = TEST_ACCOUNT_DEFAULTS[field.key] ?? `${TEST_BYPASS_PREFIX} value`;
    }
  }

  await supabase.from("crm_account_notes").upsert(
    {
      attempt_id: attemptId,
      notes: String(existingAccount?.notes ?? ""),
      fields: accountFields,
      updated_at: now,
    },
    { onConflict: "attempt_id" }
  );

  const { data: existingContact } = await supabase
    .from("crm_contact_notes")
    .select("role, notes, fields")
    .eq("attempt_id", attemptId)
    .eq("contact_key", "dana_reyes")
    .maybeSingle();

  const contactFields: Record<string, string> = {
    ...emptyContactFields(),
    ...((existingContact?.fields as Record<string, string> | null) ?? {}),
  };
  if (!(contactFields.name ?? "").trim()) {
    contactFields.name = TEST_CONTACT_DEFAULTS.name;
  }
  if (!(contactFields.position ?? "").trim()) {
    contactFields.position = TEST_CONTACT_DEFAULTS.position;
  }
  const role = String(existingContact?.role ?? "").trim() || TEST_CONTACT_DEFAULTS.role;

  await supabase.from("crm_contact_notes").upsert(
    {
      attempt_id: attemptId,
      contact_key: "dana_reyes",
      role,
      notes: String(existingContact?.notes ?? ""),
      fields: contactFields,
      updated_at: now,
    },
    { onConflict: "attempt_id,contact_key" }
  );
}

/**
 * Ensures a Summit / Dana lead exists and is marked selected. Returns its id.
 * Prefers the correct target even if a wrong lead was previously selected, so
 * bypass preselect stays on Summit while wrong picks can still fail validation.
 */
async function ensureTargetLead(
  supabase: SupabaseClient,
  attemptId: string
): Promise<string | null> {
  const { data: leads } = await supabase
    .from("crm_leads")
    .select(LEAD_SELECT_COLUMNS)
    .eq("attempt_id", attemptId)
    .order("created_at", { ascending: true });

  const rows = leads ?? [];

  let target =
    rows.find(
      (row) =>
        String(row.company_name ?? "").toLowerCase().includes("summit") &&
        String(row.contact_name ?? "").toLowerCase().includes("dana")
    ) ?? null;

  const alreadySelectedCorrect =
    target && String(target.status ?? "") === "selected" ? target : null;
  if (alreadySelectedCorrect) {
    await fillEmptyCrmProfile(supabase, attemptId);
    return String(alreadySelectedCorrect.id);
  }

  const now = new Date().toISOString();

  if (!target) {
    const { data: inserted, error } = await supabase
      .from("crm_leads")
      .insert({
        attempt_id: attemptId,
        company_name: CORRECT_COMPANY,
        contact_name: CORRECT_CONTACT,
        contact_title: "Director of Operations",
        why_fit: `${TEST_BYPASS_PREFIX} ${TEST_TARGET_WHY_FIT}`,
        trigger_event: `${TEST_BYPASS_PREFIX} Eighth location opening`,
        next_step: `${TEST_BYPASS_PREFIX} Book discovery`,
        decision_maker_rationale: `${TEST_BYPASS_PREFIX} Dana owns operations`,
        status: "new",
        created_at: now,
        updated_at: now,
      })
      .select(LEAD_SELECT_COLUMNS)
      .single();

    if (error || !inserted) {
      console.error("[tempo-test-bypass] target lead insert failed:", error);
      return null;
    }
    target = inserted;
  }

  const leadId = String(target.id);

  // Clear any wrong previously-selected lead so Summit is the only selected target.
  await supabase
    .from("crm_leads")
    .update({ status: "new", updated_at: now })
    .eq("attempt_id", attemptId)
    .eq("status", "selected")
    .neq("id", leadId);

  const { error: selectError } = await supabase
    .from("crm_leads")
    .update({ status: "selected", updated_at: now })
    .eq("id", leadId);

  if (selectError) {
    console.error("[tempo-test-bypass] select target failed:", selectError);
  }

  await fillEmptyCrmProfile(supabase, attemptId);
  return leadId;
}

export type BypassPrepareResult = {
  state: ProspectingWizardState;
  didPersist: boolean;
};

/**
 * When bypass is on: autofill empty wizard fields, seed shortlist + Summit lead + CRM gaps.
 * No-ops when bypass is off. Never overwrites non-empty student text.
 */
export async function prepareTempoTestBypass(
  supabase: SupabaseClient,
  attemptId: string,
  simulationId: string,
  state: ProspectingWizardState
): Promise<BypassPrepareResult> {
  if (!isGateBypassEnabled()) {
    return { state, didPersist: false };
  }

  let next = applyWizardAutofill(state);

  const shortlistedCompanyIds = await ensureShortlist(supabase, attemptId, simulationId);
  if (shortlistedCompanyIds.length > 0 && next.shortlistedCompanyIds.length === 0) {
    next = { ...next, shortlistedCompanyIds };
  }

  const selectedLeadId = await ensureTargetLead(supabase, attemptId);
  if (selectedLeadId && !next.selectedLeadId) {
    next = { ...next, selectedLeadId };
  }

  return { state: next, didPersist: true };
}
