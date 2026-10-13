/**
 * badge-grading.test.ts
 * Background Tempo badge grading: input building matches the old inline code,
 * the claim rule, request parsing, the Tempo check, and completeStage's
 * fire-and-forget grade-badges call. No network, no database.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { afterEach, describe, expect, it, vi } from "vitest";
import { completeStage } from "@/lib/attempt-actions";
import { DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID } from "@/lib/constants";
import {
  BADGE_CLAIM_STALE_MS,
  buildBadgeClaimFilter,
  isBadgeGradingClaimable,
  isTempoAttempt,
  parseGradeBadgesBody,
  readJoinedSimulationTitle,
} from "@/lib/tempo-attempt";
import { buildTempoBadgeInputs } from "@/lib/tempo-badge-inputs";
import type { TempoBadgeStage } from "@/lib/tempo-badges";
import { parseDiscoveryPreCallPrepFromTranscript } from "@/lib/tempo-discovery";

// ── Fake read-only client (records every query) ───

type RecordedQuery = { table: string; columns: string; eqs: Array<[string, unknown]> };

/**
 * Minimal stand-in for the select → eq → maybeSingle chain both versions use.
 */
function createReadClient(rowsByTable: Record<string, unknown>): {
  client: SupabaseClient;
  queries: RecordedQuery[];
} {
  const queries: RecordedQuery[] = [];
  const client = {
    from(table: string) {
      const query: RecordedQuery = { table, columns: "", eqs: [] };
      queries.push(query);
      const builder = {
        select(columns: string) {
          query.columns = columns;
          return builder;
        },
        eq(column: string, value: unknown) {
          query.eqs.push([column, value]);
          return builder;
        },
        maybeSingle() {
          return Promise.resolve({ data: rowsByTable[table] ?? null, error: null });
        },
      };
      return builder;
    },
  };
  return { client: client as unknown as SupabaseClient, queries };
}

/**
 * Verbatim copy of the inline block that lived in complete-stage/route.ts
 * (commit 43babf0, lines 123-174) before it moved to lib/tempo-badge-inputs.ts.
 */
async function legacyInlineInputs(
  supabase: SupabaseClient,
  attemptId: string,
  stage: TempoBadgeStage,
  transcriptToStore: string
): Promise<{ crmFields: Record<string, string> | null; discoveryPrepPayload: unknown }> {
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
              const prep = parseDiscoveryPreCallPrepFromTranscript(transcriptToStore);
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

const DISCOVERY_TRANSCRIPT = JSON.stringify({
  transcript: "Dana: hello",
  preCallPrep: {
    openQuestions: ["How do you book today?", "", "  What breaks on Mondays?  "],
    anticipatedProbe: "Ask what a no-show costs",
    anticipatedConfirm: "Play back the three pains",
  },
});

const INPUT_CASES: Array<{
  name: string;
  stage: TempoBadgeStage;
  rows: Record<string, unknown>;
  transcript: string;
}> = [
  {
    name: "prospecting with a converted lead",
    stage: "prospecting",
    rows: { crm_leads: { trigger_event: "Opened 2 clinics", why_fit: null } },
    transcript: "{}",
  },
  { name: "prospecting without a converted lead", stage: "prospecting", rows: {}, transcript: "{}" },
  {
    name: "discovery with CRM fields and a prep plan",
    stage: "discovery",
    rows: { crm_log_entries: { fields: { issue: "No-shows", count: 3, empty: null, flag: true } } },
    transcript: DISCOVERY_TRANSCRIPT,
  },
  {
    name: "discovery with array fields and no prep",
    stage: "discovery",
    rows: { crm_log_entries: { fields: ["not", "an", "object"] } },
    transcript: "not json",
  },
  {
    name: "objections with CRM fields",
    stage: "objections",
    rows: { crm_log_entries: { fields: { cost: "$179", tradeoff: 15 } } },
    transcript: "{}",
  },
  { name: "objections without a CRM log", stage: "objections", rows: {}, transcript: "{}" },
  { name: "presentation", stage: "presentation", rows: {}, transcript: "{\"form\":{}}" },
  { name: "close", stage: "close", rows: {}, transcript: "{\"scenarioA\":{}}" },
];

describe("buildTempoBadgeInputs", () => {
  it.each(INPUT_CASES)("matches the old inline code: $name", async ({ stage, rows, transcript }) => {
    const moved = createReadClient(rows);
    const inline = createReadClient(rows);

    const movedResult = await buildTempoBadgeInputs(moved.client, "attempt-1", stage, transcript);
    const inlineResult = await legacyInlineInputs(inline.client, "attempt-1", stage, transcript);

    expect(movedResult).toEqual(inlineResult);
    expect(moved.queries).toEqual(inline.queries);
  });
});

// ── Claim rule ───

describe("badge grading claim rule", () => {
  const NOW = Date.parse("2026-10-13T12:00:00.000Z");
  const ago = (ms: number): string => new Date(NOW - ms).toISOString();

  it("claims a pending row", () => {
    expect(isBadgeGradingClaimable("pending", null, NOW)).toBe(true);
  });

  it("never claims a done row", () => {
    expect(isBadgeGradingClaimable("done", ago(10 * BADGE_CLAIM_STALE_MS), NOW)).toBe(false);
  });

  it("does not claim a grading row younger than 120 s", () => {
    expect(isBadgeGradingClaimable("grading", ago(0), NOW)).toBe(false);
    expect(isBadgeGradingClaimable("grading", ago(119_999), NOW)).toBe(false);
  });

  it("claims a grading row 120 s or older", () => {
    expect(isBadgeGradingClaimable("grading", ago(120_000), NOW)).toBe(true);
    expect(isBadgeGradingClaimable("grading", ago(600_000), NOW)).toBe(true);
  });

  it("does not claim a grading row with no claim time (SQL comparison with NULL)", () => {
    expect(isBadgeGradingClaimable("grading", null, NOW)).toBe(false);
  });

  it("builds the same rule as a PostgREST filter", () => {
    expect(buildBadgeClaimFilter(NOW)).toBe(
      `badges_status.eq.pending,and(badges_status.eq.grading,badges_claimed_at.lte.${ago(120_000)})`
    );
  });
});

// ── Request parsing ───

describe("parseGradeBadgesBody", () => {
  it("keeps only attemptId and stage; transcript and badges are ignored", () => {
    const parsed = parseGradeBadgesBody({
      attemptId: "attempt-1",
      stage: "close",
      transcript: "forged submission",
      badges: ["neg_closed_deal"],
      badges_status: "done",
    });
    expect(parsed).toEqual({ attemptId: "attempt-1", stage: "close" });
    expect(Object.keys(parsed ?? {})).toEqual(["attemptId", "stage"]);
  });

  it.each([
    { name: "a non-badge stage", body: { attemptId: "a", stage: "lead_gen" } },
    { name: "results", body: { attemptId: "a", stage: "results" } },
    { name: "a missing stage", body: { attemptId: "a" } },
    { name: "a missing attemptId", body: { stage: "close" } },
    { name: "a blank attemptId", body: { attemptId: "  ", stage: "close" } },
    { name: "a non-string attemptId", body: { attemptId: 7, stage: "close" } },
    { name: "an array body", body: ["a", "close"] },
    { name: "a null body", body: null },
  ])("rejects $name", ({ body }) => {
    expect(parseGradeBadgesBody(body)).toBeNull();
  });
});

// ── Tempo check ───

describe("isTempoAttempt", () => {
  it("is true for the default class and the Tempo simulation", () => {
    expect(isTempoAttempt(DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID, "Tempo")).toBe(true);
  });

  it("is false when the title cannot be read (falls back to inline grading)", () => {
    expect(isTempoAttempt(DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID, null)).toBe(false);
  });

  it("is false outside the default class", () => {
    expect(isTempoAttempt("another-class", TEMPO_SIMULATION_ID, "Tempo")).toBe(false);
  });

  it("is false for a non-Tempo simulation in the default class", () => {
    expect(isTempoAttempt(DEFAULT_CLASS_ID, "other-sim", "Legacy Sales Call")).toBe(false);
  });

  it("reads the joined title from an object or a one-item array", () => {
    expect(readJoinedSimulationTitle({ title: "Tempo" })).toBe("Tempo");
    expect(readJoinedSimulationTitle([{ title: "Tempo" }])).toBe("Tempo");
    expect(readJoinedSimulationTitle(null)).toBeNull();
    expect(readJoinedSimulationTitle({ title: 5 })).toBeNull();
  });
});

// ── completeStage background call ───

describe("completeStage", () => {
  const PENDING_REPLY = { nextStage: "discovery", totalScore: 0, badgesPending: true };
  const savedReply = (body: unknown): { ok: boolean; json: () => Promise<unknown> } => ({
    ok: true,
    json: async () => body,
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns the server reply and fires grade-badges without waiting for it", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(savedReply(PENDING_REPLY))
      .mockReturnValueOnce(new Promise(() => undefined));
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeStage("attempt-1", "prospecting", 0, "f", "t")).resolves.toEqual(
      PENDING_REPLY
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [url, init] = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(url).toBe("/api/student/grade-badges");
    expect(init).toMatchObject({ method: "POST", keepalive: true });
    expect(JSON.parse(String(init.body))).toEqual({ attemptId: "attempt-1", stage: "prospecting" });
  });

  it("returns the same value when the background request fails", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(savedReply(PENDING_REPLY))
      .mockRejectedValueOnce(new Error("offline"));
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeStage("attempt-1", "close", 0, "f", "t")).resolves.toEqual(
      PENDING_REPLY
    );
  });

  it("returns the same value when fetch throws synchronously", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(savedReply(PENDING_REPLY))
      .mockImplementationOnce(() => {
        throw new TypeError("keepalive not supported");
      });
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeStage("attempt-1", "discovery", 0, "f", "t")).resolves.toEqual(
      PENDING_REPLY
    );
  });

  it("sends no background request when badges are not pending (legacy)", async () => {
    const legacyReply = { nextStage: "presentation", totalScore: 72 };
    const fetchMock = vi.fn().mockResolvedValueOnce(savedReply(legacyReply));
    vi.stubGlobal("fetch", fetchMock);

    await expect(completeStage("attempt-1", "discovery", 72, "f", "t")).resolves.toEqual(
      legacyReply
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
