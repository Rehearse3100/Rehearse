/**
 * security-setup.test.ts
 * The 2026-11-08 security fixes in the database setup, on a local in-memory Postgres
 * (PGlite; no live database): after supabase/FULL-SETUP.sql the anon role can't read
 * classes, class_simulations or simulations and "anyone_read_classes" is gone (teachers
 * keep their own-classes policy); student_login_failures exists with RLS on and no
 * privileges for anon or authenticated. supabase/2026-11-08-lock-anon-reads.sql runs
 * twice cleanly and removes the old anon grants and policy from a database set up
 * before.
 */

import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { adaptFullSetupForPglite, createSetupDatabase } from "./helpers/pglite-harness";

const MIGRATION = adaptFullSetupForPglite(
  readFileSync(join(process.cwd(), "supabase/2026-11-08-lock-anon-reads.sql"), "utf8")
);

let dataDir: string;
let db: PGlite;

beforeAll(async () => {
  dataDir = mkdtempSync(join(tmpdir(), "rehearse-security-"));
  db = await createSetupDatabase(dataDir);
}, 60_000);

afterAll(async () => {
  await db?.close();
  rmSync(dataDir, { recursive: true, force: true });
});

async function value<T>(sql: string): Promise<T> {
  const result = await db.query(sql);
  return Object.values(result.rows[0] as Record<string, unknown>)[0] as T;
}

const canRead = (role: string, table: string): Promise<boolean> =>
  value<boolean>(`SELECT has_table_privilege('${role}', 'public.${table}', 'SELECT')`);
const policyExists = (table: string, name: string): Promise<boolean> =>
  value<boolean>(`SELECT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = '${table}' AND policyname = '${name}')`);

describe("FULL-SETUP.sql after the 2026-11-08 fixes", () => {
  it("anon can't read classes, class_simulations or simulations; the open class policy is gone", async () => {
    for (const table of ["classes", "class_simulations", "simulations"]) {
      expect(await canRead("anon", table), table).toBe(false);
    }
    expect(await policyExists("classes", "anyone_read_classes")).toBe(false);
    // Teachers keep reading their own classes; signed-in reads in general are unchanged.
    expect(await policyExists("classes", "professors_manage_own_classes")).toBe(true);
    expect(await canRead("authenticated", "classes")).toBe(true);
  });

  it("student_login_failures: RLS on, no privileges for anon or authenticated, the two lookup indexes", async () => {
    expect(await value<boolean>("SELECT relrowsecurity FROM pg_class WHERE oid = 'public.student_login_failures'::regclass")).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      for (const privilege of ["SELECT", "INSERT", "DELETE"]) {
        expect(
          await value<boolean>(`SELECT has_table_privilege('${role}', 'public.student_login_failures', '${privilege}')`),
          `${role} ${privilege}`
        ).toBe(false);
      }
    }
    const indexes = await db.query("SELECT indexname FROM pg_indexes WHERE tablename = 'student_login_failures' ORDER BY indexname");
    expect((indexes.rows as Array<{ indexname: string }>).map((row) => row.indexname)).toEqual([
      "student_login_failures_ip_created_idx",
      "student_login_failures_pkey",
      "student_login_failures_username_created_idx",
    ]);
  });
});

describe("supabase/2026-11-08-lock-anon-reads.sql on a database set up before", () => {
  it("removes the old anon grants and the open class policy; idempotent", async () => {
    // The state before this fix.
    await db.exec(`
      GRANT SELECT ON public.classes TO anon;
      GRANT SELECT ON public.class_simulations TO anon;
      GRANT SELECT ON public.simulations TO anon;
      DROP POLICY IF EXISTS "anyone_read_classes" ON public.classes;
      CREATE POLICY "anyone_read_classes" ON public.classes FOR SELECT USING (true);
    `);
    expect(await canRead("anon", "classes")).toBe(true);

    await db.exec(MIGRATION);
    await db.exec(MIGRATION);
    for (const table of ["classes", "class_simulations", "simulations"]) {
      expect(await canRead("anon", table), table).toBe(false);
    }
    expect(await policyExists("classes", "anyone_read_classes")).toBe(false);
    expect(await canRead("authenticated", "student_login_failures")).toBe(false);
  });
});
