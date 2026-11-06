/**
 * test-bypass-strip.test.ts
 * When bypass is off, strip helpers must clear [TEST] autofill leftovers, and the
 * CRM leads tester mode seeded are deleted (with the wizard's references to them)
 * while the student's own leads are left alone; with bypass on nothing is deleted.
 * Routes run against a fake database (no network, no live database).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET as getLeads } from "@/app/api/student/crm-leads/route";
import { GET as getWizard } from "@/app/api/student/prospecting-wizard/route";
import {
  dropMissingLeadRefs,
  isTesterSeededLead,
  TEST_SHORTLIST_WHY_FIT,
  TEST_TARGET_WHY_FIT,
} from "@/lib/tempo-test-bypass";
import {
  applyDiscoveryPrepAutofill,
  applyNegotiationAutofill,
  applyPresentationAutofill,
  isTestBypassAutofillValue,
  stripDiscoveryPrepTestAutofill,
  stripNegotiationTestAutofill,
  stripPresentationTestAutofill,
  stripTestBypassRecord,
  stripTestBypassString,
  stripWizardTestAutofill,
  TEST_BYPASS_PREFIX,
} from "@/lib/tempo-test-bypass-client";
import { createInitialNegotiationData } from "@/lib/tempo-negotiation";
import { DEFAULT_PROSPECTING_WIZARD_STATE } from "@/lib/tempo-prospecting";
import { EMPTY_PRESENTATION_FORM } from "@/lib/tempo-presentation";

// ── Fake database (any query chain; records each table's calls) ───

type Op = { table: string; calls: Array<[string, unknown[]]> };

const db = vi.hoisted(() => ({
  leads: [] as Array<Record<string, unknown>>,
  stageData: {} as Record<string, unknown>,
  ops: [] as Array<{ table: string; calls: Array<[string, unknown[]]> }>,
}));

const DIRECTORY = [
  { id: "dir-alpine", company_name: "Alpine Smiles" },
  { id: "dir-peak", company_name: "Peak Vision Partners" },
];

/** What the database answers for a finished query chain. */
function answer(op: Op): { data: unknown; error: null } {
  const called = (name: string): unknown[] | undefined => op.calls.find(([method]) => method === name)?.[1];
  if (called("delete")) {
    const ids = (called("in")?.[1] ?? []) as string[];
    db.leads = db.leads.filter((lead) => !ids.includes(String(lead.id)));
    return { data: null, error: null };
  }
  if (op.table === "attempts") {
    const update = called("update")?.[0] as { stage_data?: Record<string, unknown> } | undefined;
    if (update?.stage_data) {
      db.stageData = update.stage_data;
      return { data: null, error: null };
    }
    return {
      data: { id: "attempt-1", student_id: "student-1", stage_data: db.stageData, simulation_id: "sim-1", class_id: "class-1" },
      error: null,
    };
  }
  if (op.table === "crm_leads" && !called("update") && !called("insert")) {
    return { data: [...db.leads], error: null };
  }
  if (op.table === "crm_prospect_directory") {
    return { data: DIRECTORY, error: null };
  }
  return { data: null, error: null };
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from(table: string) {
      const op: Op = { table, calls: [] };
      db.ops.push(op);
      const builder: object = new Proxy(
        {},
        {
          get(_target, prop) {
            if (prop === "then") {
              return (resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) =>
                Promise.resolve(answer(op)).then(resolve, reject);
            }
            return (...args: unknown[]) => {
              op.calls.push([String(prop), args]);
              return builder;
            };
          },
        }
      );
      return builder;
    },
  }),
}));

vi.mock("@/lib/api-auth", () => ({
  requireStudentApi: vi.fn(async () => ({ ok: true, session: { studentId: "student-1" } })),
}));

vi.mock("@/lib/revalidate-student-progress", () => ({
  revalidateStudentAttemptSurfaces: vi.fn(),
}));

describe("stripTestBypassString", () => {
  it("clears [TEST]-prefixed values", () => {
    expect(stripTestBypassString(`${TEST_BYPASS_PREFIX} hello`)).toBe("");
    expect(isTestBypassAutofillValue(`  ${TEST_BYPASS_PREFIX} x`)).toBe(true);
  });

  it("keeps real student text", () => {
    expect(stripTestBypassString("Multi-location dental")).toBe("Multi-location dental");
  });
});

describe("stripWizardTestAutofill", () => {
  it("clears [TEST] text and paired size defaults", () => {
    const filled = {
      ...DEFAULT_PROSPECTING_WIZARD_STATE,
      icpTargetVerticals: `${TEST_BYPASS_PREFIX} clinics`,
      icpDecisionMakerRole: `${TEST_BYPASS_PREFIX} ops`,
      icpSizeMinLocations: "5",
      icpSizeMaxLocations: "20",
      openingMessage: `${TEST_BYPASS_PREFIX} Hi Dana`,
    };
    const stripped = stripWizardTestAutofill(filled);
    expect(stripped.icpTargetVerticals).toBe("");
    expect(stripped.icpDecisionMakerRole).toBe("");
    expect(stripped.icpSizeMinLocations).toBe("");
    expect(stripped.icpSizeMaxLocations).toBe("");
    expect(stripped.openingMessage).toBe("");
  });

  it("does not clear size fields when no [TEST] markers exist", () => {
    const student = {
      ...DEFAULT_PROSPECTING_WIZARD_STATE,
      icpTargetVerticals: "Dental clinics",
      icpSizeMinLocations: "5",
      icpSizeMaxLocations: "20",
    };
    const stripped = stripWizardTestAutofill(student);
    expect(stripped.icpSizeMinLocations).toBe("5");
    expect(stripped.icpSizeMaxLocations).toBe("20");
    expect(stripped.icpTargetVerticals).toBe("Dental clinics");
  });
});

describe("strip stage autofill", () => {
  it("clears Discovery prep autofill", () => {
    const filled = applyDiscoveryPrepAutofill({
      openQuestions: ["", "", ""],
      anticipatedProbe: "",
      anticipatedConfirm: "",
    });
    const stripped = stripDiscoveryPrepTestAutofill(filled);
    expect(stripped.openQuestions.every((q) => q === "")).toBe(true);
    expect(stripped.anticipatedProbe).toBe("");
    expect(stripped.anticipatedConfirm).toBe("");
  });

  it("clears Presentation autofill", () => {
    const filled = applyPresentationAutofill(EMPTY_PRESENTATION_FORM);
    const stripped = stripPresentationTestAutofill(filled);
    expect(Object.values(stripped).every((v) => v === "")).toBe(true);
  });

  it("clears Negotiation AI-work autofill only", () => {
    const filled = applyNegotiationAutofill(createInitialNegotiationData());
    const stripped = stripNegotiationTestAutofill(filled);
    expect(stripped.aiWork.prompts).toBe("");
    expect(stripped.aiWork.corrections).toBe("");
    expect(stripped.scenarioAState).toBe("complete");
  });

  it("clears CRM field records", () => {
    expect(
      stripTestBypassRecord({
        accountName: `${TEST_BYPASS_PREFIX} Summit`,
        industry: "Healthcare",
      })
    ).toEqual({ accountName: "", industry: "Healthcare" });
  });
});

// ── Tester-seeded CRM leads ───

/** A shortlist lead as ensureShortlist inserts it. */
const SEEDED_SHORTLIST = {
  id: "lead-s1",
  company_name: "Alpine Smiles",
  contact_name: `${TEST_BYPASS_PREFIX} Jo Park`,
  contact_title: `${TEST_BYPASS_PREFIX} Office Manager`,
  why_fit: `${TEST_BYPASS_PREFIX} ${TEST_SHORTLIST_WHY_FIT}`,
  trigger_event: `${TEST_BYPASS_PREFIX} Test trigger`,
  next_step: `${TEST_BYPASS_PREFIX} Call to qualify`,
  decision_maker_rationale: `${TEST_BYPASS_PREFIX} Placeholder rationale`,
  status: "shortlisted",
};

/** The selected target as ensureTargetLead inserts it (plain company and contact). */
const SEEDED_TARGET = {
  id: "lead-t1",
  company_name: "Summit Dental Group",
  contact_name: "Dana Reyes",
  contact_title: "Director of Operations",
  why_fit: `${TEST_BYPASS_PREFIX} ${TEST_TARGET_WHY_FIT}`,
  trigger_event: `${TEST_BYPASS_PREFIX} Eighth location opening`,
  next_step: `${TEST_BYPASS_PREFIX} Book discovery`,
  decision_maker_rationale: `${TEST_BYPASS_PREFIX} Dana owns operations`,
  status: "selected",
};

/** A lead the student wrote in the Data Room. */
const STUDENT_LEAD = {
  id: "lead-mine",
  company_name: "Peak Vision Partners",
  contact_name: "Lena Ortiz",
  contact_title: "VP of Operations",
  why_fit: "Six clinics, still booking by phone",
  trigger_event: "Opening a seventh clinic",
  next_step: "Email Lena about a call",
  decision_maker_rationale: "Lena owns front-desk operations",
  status: "shortlisted",
};

describe("isTesterSeededLead", () => {
  it("matches the seeded shortlist and target leads, prefixed or with the prefix already removed", () => {
    expect(isTesterSeededLead(SEEDED_SHORTLIST)).toBe(true);
    expect(isTesterSeededLead(SEEDED_TARGET)).toBe(true);
    const unprefixed = { company_name: "Summit Dental Group", contact_name: "Dana Reyes", why_fit: TEST_TARGET_WHY_FIT, trigger_event: "" };
    expect(isTesterSeededLead(unprefixed)).toBe(true);
    expect(isTesterSeededLead({ company_name: "Alpine Smiles", why_fit: `  ${TEST_SHORTLIST_WHY_FIT} ` })).toBe(true);
  });

  it("never matches a lead the student wrote, even for the right company and contact", () => {
    expect(isTesterSeededLead(STUDENT_LEAD)).toBe(false);
    expect(
      isTesterSeededLead({ ...STUDENT_LEAD, company_name: "Summit Dental Group", contact_name: "Dana Reyes", why_fit: "Eight locations and phone chaos" })
    ).toBe(false);
    expect(isTesterSeededLead({ ...STUDENT_LEAD, why_fit: `My note: ${TEST_SHORTLIST_WHY_FIT}` })).toBe(false);
  });
});

describe("dropMissingLeadRefs", () => {
  const state = {
    ...DEFAULT_PROSPECTING_WIZARD_STATE,
    shortlistedCompanyIds: ["dir-alpine", "dir-peak", "dir-unknown"],
    selectedLeadId: "lead-t1",
  };
  const names = new Map([
    ["dir-alpine", "Alpine Smiles"],
    ["dir-peak", "Peak Vision Partners"],
  ]);

  it("drops the selected lead and shortlist companies with no lead left; keeps the rest", () => {
    expect(dropMissingLeadRefs(state, [STUDENT_LEAD], names)).toMatchObject({
      shortlistedCompanyIds: ["dir-peak", "dir-unknown"],
      selectedLeadId: null,
    });
  });

  it("returns the same state when every reference still has its lead", () => {
    expect(dropMissingLeadRefs(state, [STUDENT_LEAD, SEEDED_SHORTLIST, SEEDED_TARGET], names)).toBe(state);
  });
});

describe("routes with tester mode off and on", () => {
  beforeEach(() => {
    db.leads = [SEEDED_SHORTLIST, SEEDED_TARGET, STUDENT_LEAD];
    db.ops = [];
    db.stageData = {
      ...DEFAULT_PROSPECTING_WIZARD_STATE,
      currentStepId: "select_lead",
      onboardingComplete: true,
      shortlistedCompanyIds: ["dir-alpine", "dir-peak"],
      selectedLeadId: "lead-t1",
    };
  });
  afterEach(() => {
    delete process.env.TEMPO_TEST_BYPASS_GATES;
  });

  const deletes = (): Array<{ table: string; calls: Array<[string, unknown[]]> }> => db.ops.filter((op) => op.calls.some(([name]) => name === "delete"));

  it("off: crm-leads GET deletes the seeded leads and returns only the student's", async () => {
    const res = await getLeads(new Request("http://localhost/api/student/crm-leads?attemptId=attempt-1"));
    const body = (await res.json()) as { leads: Array<{ id: string }> };
    expect(body.leads.map((lead) => lead.id)).toEqual(["lead-mine"]);
    expect(deletes()).toHaveLength(1);
    expect(deletes()[0]?.calls).toContainEqual(["in", ["id", ["lead-s1", "lead-t1"]]]);
    expect(deletes()[0]?.calls).toContainEqual(["eq", ["attempt_id", "attempt-1"]]);
  });

  it("off: prospecting-wizard GET deletes them and clears the shortlist ids and selected lead that pointed at them", async () => {
    const res = await getWizard(new Request("http://localhost/api/student/prospecting-wizard?attemptId=attempt-1"));
    const body = (await res.json()) as { state: { shortlistedCompanyIds: string[]; selectedLeadId: string | null } };
    expect(body.state.shortlistedCompanyIds).toEqual(["dir-peak"]);
    expect(body.state.selectedLeadId).toBeNull();
    expect(deletes()).toHaveLength(1);
    // Persisted like the existing strip.
    expect(db.stageData).toMatchObject({ shortlistedCompanyIds: ["dir-peak"], selectedLeadId: null });
  });

  it("off: a student with no seeded leads is left alone", async () => {
    db.leads = [STUDENT_LEAD];
    db.stageData = { ...db.stageData, shortlistedCompanyIds: ["dir-peak"], selectedLeadId: "lead-mine" };
    const before = JSON.stringify(db.stageData);
    await getLeads(new Request("http://localhost/api/student/crm-leads?attemptId=attempt-1"));
    await getWizard(new Request("http://localhost/api/student/prospecting-wizard?attemptId=attempt-1"));
    expect(deletes()).toHaveLength(0);
    expect(JSON.stringify(db.stageData)).toBe(before);
  });

  it("on: nothing is deleted by either GET", async () => {
    process.env.TEMPO_TEST_BYPASS_GATES = "true";
    const res = await getLeads(new Request("http://localhost/api/student/crm-leads?attemptId=attempt-1"));
    expect(((await res.json()) as { leads: unknown[] }).leads).toHaveLength(3);
    await getWizard(new Request("http://localhost/api/student/prospecting-wizard?attemptId=attempt-1"));
    expect(deletes()).toHaveLength(0);
  });
});
