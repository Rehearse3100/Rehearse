/**
 * data-room-integrity.test.ts
 * Local PGlite: FULL-SETUP summary + prospect-directory answer-key invariants.
 * Math.random is stubbed with a seeded PRNG for deterministic CI (generator unchanged).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { TEMPO_ICP } from "../scripts/config/tempo-icp";
import { tempoDirectorySeed } from "../scripts/config/tempo-directory-seed";
import {
  companyFirstWord,
  countMatchedTriggerThemes,
  generateProspectDirectory,
} from "../scripts/generate-prospect-directory";
import {
  adaptFullSetupForPglite,
  createPgliteSupabaseShim,
  createSetupDatabase,
} from "./helpers/pglite-harness";

/** Fixed seeds used in CI — same every run. */
const CI_SEEDS = [1009, 4242, 7777, 13579, 24680] as const;

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

/**
 * Mulberry32 PRNG — deterministic [0,1) sequence from a 32-bit seed.
 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

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

  const factReuse = await db.query(
    `SELECT fact FROM (
       SELECT jsonb_array_elements_text(research_facts) AS fact
       FROM public.crm_prospect_directory WHERE simulation_id = $1
     ) facts GROUP BY fact HAVING COUNT(*) > 2`,
    [simId]
  );
  expect(factReuse.rows).toEqual([]);

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

  for (const row of companies.rows as Array<{
    company_name: string;
    public_signals: string[] | string;
    class: string;
    subtype: string | null;
    research_facts: string[] | string;
  }>) {
    const signals = Array.isArray(row.public_signals)
      ? row.public_signals
      : (JSON.parse(String(row.public_signals)) as string[]);
    const facts = Array.isArray(row.research_facts)
      ? row.research_facts
      : (JSON.parse(String(row.research_facts)) as string[]);

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
    }
  }

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
  let randomSpy: ReturnType<typeof vi.spyOn> | undefined;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), "rehearse-pglite-"));
  });

  afterEach(async () => {
    randomSpy?.mockRestore();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await (db as any)?.close?.();
    rmSync(dataDir, { recursive: true, force: true });
  });

  it.each(CI_SEEDS)(
    "seed %s: FULL-SETUP summary true + directory invariants",
    async (seed) => {
      randomSpy = vi.spyOn(Math, "random").mockImplementation(mulberry32(seed));

      db = await createSetupDatabase(dataDir);
      await assertSummaryColumns(db);

      const supabase = createPgliteSupabaseShim(db) as unknown as Parameters<
        typeof generateProspectDirectory
      >[0];
      const result = await generateProspectDirectory(supabase, tempoDirectorySeed);
      await assertDirectoryInvariants(
        db,
        result.insertedCompanies,
        result.report.countsByClass
      );
    },
    120_000
  );
});
