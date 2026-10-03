/**
 * data-room-integrity.test.ts
 * Local PGlite: FULL-SETUP summary + prospect-directory answer-key invariants.
 * Generation uses unseeded Math.random — no seed parameter (not a small change).
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

let db: PGlite;
let dataDir: string;
let generationResult: Awaited<ReturnType<typeof generateProspectDirectory>>;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "rehearse-pglite-"));
  db = await createSetupDatabase(dataDir);
  const supabase = createPgliteSupabaseShim(db) as Parameters<
    typeof generateProspectDirectory
  >[0];
  generationResult = await generateProspectDirectory(supabase, tempoDirectorySeed);
}, 120_000);

afterAll(async () => {
  // PGlite close if available
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await (db as any)?.close?.();
  rmSync(dataDir, { recursive: true, force: true });
});

describe("FULL-SETUP.sql summary (local PGlite)", () => {
  it("asserts every summary column is true / complete", async () => {
    // Re-execute the file's final SELECT (FULL-SETUP ends with this query).
    const fullSql = adaptFullSetupSql();
    const selectStart = fullSql.lastIndexOf("SELECT\n  (");
    expect(selectStart).toBeGreaterThan(0);
    const summarySql = fullSql.slice(selectStart);
    const result = await db.query(summarySql);
    const row = result.rows[0] as Record<string, boolean | number>;
    expect(row).toBeTruthy();

    // expected_tables_present is a COUNT — all 15 listed tables must exist.
    expect(Number(row.expected_tables_present)).toBe(15);

    for (const column of SUMMARY_COLUMNS) {
      if (column === "expected_tables_present") continue;
      expect(row[column], column).toBe(true);
    }
  });
});

function adaptFullSetupSql(): string {
  return adaptFullSetupForPglite(
    readFileSync(join(process.cwd(), "supabase/FULL-SETUP.sql"), "utf8")
  );
}

describe("prospect-directory generator invariants (local PGlite)", () => {
  it("inserts 64 companies with class counts 9 / 16 / 7 / 32", () => {
    expect(generationResult.insertedCompanies).toBe(64);
    expect(generationResult.report.countsByClass).toEqual({
      strong_fit: 9,
      near_miss: 16,
      trap: 7,
      pass: 32,
    });
  });

  it("has exactly one fit_rank = 1 and it is Summit Dental Group", async () => {
    const result = await db.query(`
      SELECT company_name, fit_rank
      FROM public.crm_prospect_directory
      WHERE simulation_id = $1 AND fit_rank = 1
    `, [tempoDirectorySeed.simulationId]);
    expect(result.rows).toHaveLength(1);
    expect((result.rows[0] as { company_name: string }).company_name).toBe(
      "Summit Dental Group"
    );
  });

  it("has zero passes in an ICP vertical AND 3–12 locations AND in territory", async () => {
    const result = await db.query(
      `
      SELECT company_name, vertical, locations, metro, in_territory
      FROM public.crm_prospect_directory
      WHERE simulation_id = $1
        AND class = 'pass'
        AND lower(vertical) = ANY($2::text[])
        AND locations BETWEEN $3 AND $4
        AND in_territory = true
    `,
      [
        tempoDirectorySeed.simulationId,
        TEMPO_ICP.verticals.map((v) => v.toLowerCase()),
        TEMPO_ICP.minLocations,
        TEMPO_ICP.maxLocations,
      ]
    );
    expect(result.rows).toEqual([]);
  });

  it("has zero non-rank-1 strong fits matching all ICP axes with a strong trigger", async () => {
    const result = await db.query(
      `
      SELECT company_name, vertical, locations, metro, in_territory, online_booking, trigger_quality
      FROM public.crm_prospect_directory
      WHERE simulation_id = $1
        AND class = 'strong_fit'
        AND (fit_rank IS NULL OR fit_rank <> 1)
        AND lower(vertical) = ANY($2::text[])
        AND locations BETWEEN $3 AND $4
        AND in_territory = true
        AND online_booking = false
        AND trigger_quality = 'strong'
    `,
      [
        tempoDirectorySeed.simulationId,
        TEMPO_ICP.verticals.map((v) => v.toLowerCase()),
        TEMPO_ICP.minLocations,
        TEMPO_ICP.maxLocations,
      ]
    );
    expect(result.rows).toEqual([]);
  });

  it("gives every company exactly 3 contacts with exactly 1 correct contact", async () => {
    const result = await db.query(
      `
      SELECT d.company_name,
             COUNT(c.id)::int AS contact_count,
             COUNT(*) FILTER (WHERE c.is_correct_contact)::int AS correct_count
      FROM public.crm_prospect_directory d
      JOIN public.crm_prospect_contacts c ON c.company_id = d.id
      WHERE d.simulation_id = $1
      GROUP BY d.id, d.company_name
      HAVING COUNT(c.id) <> 3
         OR COUNT(*) FILTER (WHERE c.is_correct_contact) <> 1
    `,
      [tempoDirectorySeed.simulationId]
    );
    expect(result.rows).toEqual([]);
  });

  it("reuses no research fact in more than 2 companies", async () => {
    const result = await db.query(
      `
      SELECT fact, COUNT(*)::int AS company_count
      FROM (
        SELECT jsonb_array_elements_text(research_facts) AS fact
        FROM public.crm_prospect_directory
        WHERE simulation_id = $1
      ) facts
      GROUP BY fact
      HAVING COUNT(*) > 2
    `,
      [tempoDirectorySeed.simulationId]
    );
    expect(result.rows).toEqual([]);
  });

  it("reuses no public signal in more than 2 companies", async () => {
    const result = await db.query(
      `
      SELECT signal, COUNT(*)::int AS company_count
      FROM (
        SELECT jsonb_array_elements_text(public_signals) AS signal
        FROM public.crm_prospect_directory
        WHERE simulation_id = $1
      ) signals
      GROUP BY signal
      HAVING COUNT(*) > 2
    `,
      [tempoDirectorySeed.simulationId]
    );
    expect(result.rows).toEqual([]);
  });

  it("only Summit carries both halves of its trigger signature", async () => {
    const result = await db.query(
      `
      SELECT company_name, public_signals
      FROM public.crm_prospect_directory
      WHERE simulation_id = $1
    `,
      [tempoDirectorySeed.simulationId]
    );

    const bothHalves: string[] = [];
    for (const row of result.rows as Array<{
      company_name: string;
      public_signals: string[] | string;
    }>) {
      const signals = Array.isArray(row.public_signals)
        ? row.public_signals
        : (JSON.parse(String(row.public_signals)) as string[]);
      const matched = countMatchedTriggerThemes(
        signals,
        tempoDirectorySeed.targetTriggerSignatureThemes
      );
      if (matched >= 2) {
        bothHalves.push(row.company_name);
      }
    }
    expect(bothHalves).toEqual(["Summit Dental Group"]);
  });

  it("every class spans research_facts lengths 4, 5, 6, and 7", async () => {
    const result = await db.query(
      `
      SELECT class, array_agg(DISTINCT jsonb_array_length(research_facts) ORDER BY jsonb_array_length(research_facts)) AS lengths
      FROM public.crm_prospect_directory
      WHERE simulation_id = $1
      GROUP BY class
    `,
      [tempoDirectorySeed.simulationId]
    );

    for (const row of result.rows as Array<{ class: string; lengths: number[] }>) {
      expect(row.lengths, row.class).toEqual([4, 5, 6, 7]);
    }
  });

  it("every trap has exactly one disqualifier fact, never at index 0", async () => {
    const result = await db.query(
      `
      SELECT company_name, subtype, research_facts
      FROM public.crm_prospect_directory
      WHERE simulation_id = $1 AND class = 'trap'
    `,
      [tempoDirectorySeed.simulationId]
    );

    expect(result.rows.length).toBe(7);
    for (const row of result.rows as Array<{
      company_name: string;
      subtype: string;
      research_facts: string[] | string;
    }>) {
      const facts = Array.isArray(row.research_facts)
        ? row.research_facts
        : (JSON.parse(String(row.research_facts)) as string[]);
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
      const keywords = [
        ...(tempoDirectorySeed.disqualifierKeywordsByTrapSubtype[subtype] ?? []),
      ];
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
        `${row.company_name} (${row.subtype}) facts=${JSON.stringify(facts)}`
      ).toHaveLength(1);
      expect(disqualifierIndexes[0], `${row.company_name} index`).not.toBe(0);
    }
  });

  it('forbids "(" in company names and caps first-word reuse at 2', async () => {
    const result = await db.query(
      `
      SELECT company_name
      FROM public.crm_prospect_directory
      WHERE simulation_id = $1
    `,
      [tempoDirectorySeed.simulationId]
    );

    const firstWordCounts = new Map<string, number>();
    for (const row of result.rows as Array<{ company_name: string }>) {
      expect(row.company_name.includes("("), row.company_name).toBe(false);
      const first = companyFirstWord(row.company_name).toLowerCase();
      firstWordCounts.set(first, (firstWordCounts.get(first) ?? 0) + 1);
    }
    for (const [word, count] of Array.from(firstWordCounts.entries())) {
      expect(count, word).toBeLessThanOrEqual(2);
    }
  });
});
