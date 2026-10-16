/**
 * data-room-integrity.test.ts
 * Local PGlite: FULL-SETUP summary + prospect-directory answer-key invariants, and
 * the research-finding rules: reproducible from the seed, topic-tagged, never
 * shared by two companies, never a repeat of the company's own public signals.
 * The generator is seeded from config.seed; CI runs it with fixed seeds.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import {
  FACT_TOPICS,
  QUESTION_TOPIC_FACT_TOPICS,
  parseResearchFindings,
} from "../lib/tempo-research-topics";
import { TEMPO_ICP } from "../scripts/config/tempo-icp";
import { tempoDirectorySeed } from "../scripts/config/tempo-directory-seed";
import {
  buildCompanyRoster,
  companyFirstWord,
  countMatchedTriggerThemes,
  findingRepeatsSignals,
  generateProspectDirectory,
  normalizeSentence,
} from "../scripts/generate-prospect-directory";
import {
  adaptFullSetupForPglite,
  createPgliteSupabaseShim,
  createSetupDatabase,
} from "./helpers/pglite-harness";

/** Fixed seeds used in CI — same every run. */
const CI_SEEDS = [1009, 4242, 7777, 13579, 24680] as const;

/** Fact topics a student reaches by asking about risks or fit. */
const DISQUALIFIER_REACHABLE_TOPICS = new Set<string>([
  ...QUESTION_TOPIC_FACT_TOPICS.risks,
  ...QUESTION_TOPIC_FACT_TOPICS.fit,
]);

const SUMMARY_COLUMNS = [
  "expected_tables_present",
  "tempo_row_exists",
  "anam_ids_populated",
  "onboarding_videos_bucket_public",
  "data_room_v2_columns_present",
  "ownerless_rows_protected",
  "tempo_prompt_scrubbed",
  "password_hash_hidden",
] as const;

function adaptFullSetupSql(): string {
  return adaptFullSetupForPglite(
    readFileSync(join(process.cwd(), "supabase/FULL-SETUP.sql"), "utf8")
  );
}

async function assertSummaryColumns(db: PGlite): Promise<void> {
  const fullSql = adaptFullSetupSql();
  const selectStart = fullSql.lastIndexOf("SELECT\n  (");
  expect(selectStart).toBeGreaterThan(0);
  const result = await db.query(fullSql.slice(selectStart));
  const row = result.rows[0] as Record<string, boolean | number>;
  expect(Number(row.expected_tables_present)).toBe(15);
  for (const column of SUMMARY_COLUMNS) {
    if (column === "expected_tables_present") continue;
    expect(row[column], column).toBe(true);
  }
}

async function assertDirectoryInvariants(
  db: PGlite,
  insertedCompanies: number,
  countsByClass: Record<string, number>
): Promise<void> {
  expect(insertedCompanies).toBe(64);
  expect(countsByClass).toEqual({
    strong_fit: 9,
    near_miss: 16,
    trap: 7,
    pass: 32,
  });

  const simId = tempoDirectorySeed.simulationId;

  const rankOne = await db.query(
    `SELECT company_name FROM public.crm_prospect_directory
     WHERE simulation_id = $1 AND fit_rank = 1`,
    [simId]
  );
  expect(rankOne.rows).toHaveLength(1);
  expect((rankOne.rows[0] as { company_name: string }).company_name).toBe(
    "Summit Dental Group"
  );

  const badPasses = await db.query(
    `SELECT company_name FROM public.crm_prospect_directory
     WHERE simulation_id = $1 AND class = 'pass'
       AND lower(vertical) = ANY($2::text[])
       AND locations BETWEEN $3 AND $4
       AND in_territory = true`,
    [
      simId,
      TEMPO_ICP.verticals.map((v) => v.toLowerCase()),
      TEMPO_ICP.minLocations,
      TEMPO_ICP.maxLocations,
    ]
  );
  expect(badPasses.rows).toEqual([]);

  const badStrong = await db.query(
    `SELECT company_name FROM public.crm_prospect_directory
     WHERE simulation_id = $1 AND class = 'strong_fit'
       AND (fit_rank IS NULL OR fit_rank <> 1)
       AND lower(vertical) = ANY($2::text[])
       AND locations BETWEEN $3 AND $4
       AND in_territory = true
       AND online_booking = false
       AND trigger_quality = 'strong'`,
    [
      simId,
      TEMPO_ICP.verticals.map((v) => v.toLowerCase()),
      TEMPO_ICP.minLocations,
      TEMPO_ICP.maxLocations,
    ]
  );
  expect(badStrong.rows).toEqual([]);

  const contactIssues = await db.query(
    `SELECT d.company_name
     FROM public.crm_prospect_directory d
     JOIN public.crm_prospect_contacts c ON c.company_id = d.id
     WHERE d.simulation_id = $1
     GROUP BY d.id, d.company_name
     HAVING COUNT(c.id) <> 3
        OR COUNT(*) FILTER (WHERE c.is_correct_contact) <> 1`,
    [simId]
  );
  expect(contactIssues.rows).toEqual([]);

  const signalReuse = await db.query(
    `SELECT signal FROM (
       SELECT jsonb_array_elements_text(public_signals) AS signal
       FROM public.crm_prospect_directory WHERE simulation_id = $1
     ) signals GROUP BY signal HAVING COUNT(*) > 2`,
    [simId]
  );
  expect(signalReuse.rows).toEqual([]);

  const companies = await db.query(
    `SELECT company_name, public_signals, class, subtype, research_facts
     FROM public.crm_prospect_directory WHERE simulation_id = $1`,
    [simId]
  );

  const bothHalves: string[] = [];
  const firstWordCounts = new Map<string, number>();
  const lengthsByClass = new Map<string, Set<number>>();
  const companiesByFindingText = new Map<string, string[]>();

  for (const row of companies.rows as Array<{
    company_name: string;
    public_signals: string[] | string;
    class: string;
    subtype: string | null;
    research_facts: unknown;
  }>) {
    const signals = Array.isArray(row.public_signals)
      ? row.public_signals
      : (JSON.parse(String(row.public_signals)) as string[]);
    const findings = parseResearchFindings(
      typeof row.research_facts === "string" ? JSON.parse(row.research_facts) : row.research_facts
    );
    const facts = findings.map((finding) => finding.text);

    // Stored as [{ text, topics }]: every finding has 1–2 known topics.
    for (const finding of findings) {
      expect(finding.topics.length, finding.text).toBeGreaterThanOrEqual(1);
      expect(finding.topics.length, finding.text).toBeLessThanOrEqual(2);
      expect(FACT_TOPICS, finding.text).toEqual(expect.arrayContaining(finding.topics));
      expect(findingRepeatsSignals(finding.text, signals), `${row.company_name}: ${finding.text}`).toBe(
        false
      );
      const key = normalizeSentence(finding.text);
      companiesByFindingText.set(key, [...(companiesByFindingText.get(key) ?? []), row.company_name]);
    }

    if (
      countMatchedTriggerThemes(
        signals,
        tempoDirectorySeed.targetTriggerSignatureThemes
      ) >= 2
    ) {
      bothHalves.push(row.company_name);
    }

    expect(row.company_name.includes("("), row.company_name).toBe(false);
    const first = companyFirstWord(row.company_name).toLowerCase();
    firstWordCounts.set(first, (firstWordCounts.get(first) ?? 0) + 1);

    const lengths = lengthsByClass.get(row.class) ?? new Set<number>();
    lengths.add(facts.length);
    lengthsByClass.set(row.class, lengths);

    if (row.class === "trap") {
      const subtype =
        row.subtype as keyof typeof tempoDirectorySeed.trapDisqualifierVariantsBySubtype;
      const authoredDisqualifiers = tempoDirectorySeed.authoredCompanies
        .filter((company) => company.class === "trap" && company.trapDisqualifierFact)
        .map((company) => company.trapDisqualifierFact as string);
      const variants = new Set(
        [
          ...(tempoDirectorySeed.trapDisqualifierVariantsBySubtype[subtype] ?? []),
          ...authoredDisqualifiers,
        ].map((v) => v.trim().toLowerCase())
      );
      const keywords =
        tempoDirectorySeed.disqualifierKeywordsByTrapSubtype[subtype] ?? [];
      const disqualifierIndexes = facts
        .map((fact, index) => {
          const lower = fact.trim().toLowerCase();
          const isVariant = variants.has(lower);
          const isKeyword = keywords.some((keyword) =>
            lower.includes(keyword.toLowerCase())
          );
          return isVariant || isKeyword ? index : -1;
        })
        .filter((index) => index >= 0);
      expect(
        disqualifierIndexes,
        `${row.company_name} (${row.subtype})`
      ).toHaveLength(1);
      expect(disqualifierIndexes[0], `${row.company_name} index`).not.toBe(0);

      // The disqualifier is reachable: a "risks" or "fit" question surfaces its topic.
      const disqualifier = findings[disqualifierIndexes[0] as number];
      expect(
        disqualifier?.topics.some((topic) => DISQUALIFIER_REACHABLE_TOPICS.has(topic)),
        `${row.company_name} disqualifier topics [${disqualifier?.topics.join(", ")}]`
      ).toBe(true);
    }
  }

  // No finding text (normalized) appears at two companies.
  const sharedFindings = Array.from(companiesByFindingText.entries()).filter(
    ([, names]) => names.length > 1
  );
  expect(sharedFindings).toEqual([]);

  expect(bothHalves).toEqual(["Summit Dental Group"]);
  for (const [word, count] of Array.from(firstWordCounts.entries())) {
    expect(count, word).toBeLessThanOrEqual(2);
  }
  for (const [companyClass, lengths] of Array.from(lengthsByClass.entries())) {
    expect(Array.from(lengths).sort((a, b) => a - b), companyClass).toEqual([
      4, 5, 6, 7,
    ]);
  }
}

describe("data-room integrity (seeded, local PGlite)", () => {
  let db: PGlite;
  let dataDir: string;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "rehearse-pglite-"));
  });

  afterEach(async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)?.close?.();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it("the same seed generates an identical roster; another seed does not", () => {
    const first = buildCompanyRoster(tempoDirectorySeed);
    const second = buildCompanyRoster(tempoDirectorySeed);
    expect(second).toEqual(first);
    expect(buildCompanyRoster({ ...tempoDirectorySeed, seed: CI_SEEDS[0] })).not.toEqual(first);
  });

  it.each([tempoDirectorySeed.seed, ...CI_SEEDS])(
    "seed %s: FULL-SETUP summary true + directory invariants",
    async (seed) => {
      db = await createSetupDatabase(dataDir);
      await assertSummaryColumns(db);

      const supabase = createPgliteSupabaseShim(db) as unknown as Parameters<
        typeof generateProspectDirectory
      >[0];
      const result = await generateProspectDirectory(supabase, { ...tempoDirectorySeed, seed });
      await assertDirectoryInvariants(
        db,
        result.insertedCompanies,
        result.report.countsByClass
      );
    },
    120_000
  );

  it(
    "FULL-SETUP adds the background badge grading columns to stage_scores",
    async () => {
      db = await createSetupDatabase(dataDir);
      const result = await db.query<{
        column_name: string;
        data_type: string;
        is_nullable: string;
        column_default: string | null;
      }>(
        `SELECT column_name, data_type, is_nullable, column_default
           FROM information_schema.columns
          WHERE table_schema = 'public'
            AND table_name = 'stage_scores'
            AND column_name IN ('badges_status', 'badges_claimed_at', 'badges_claim_id')
          ORDER BY column_name`
      );
      expect(result.rows).toEqual([
        {
          column_name: "badges_claim_id",
          data_type: "uuid",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "badges_claimed_at",
          data_type: "timestamp with time zone",
          is_nullable: "YES",
          column_default: null,
        },
        {
          column_name: "badges_status",
          data_type: "text",
          is_nullable: "NO",
          column_default: "'done'::text",
        },
      ]);
    },
    120_000
  );
});
