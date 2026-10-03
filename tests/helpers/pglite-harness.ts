/**
 * pglite-harness.ts
 * Local in-memory Postgres for FULL-SETUP + prospect-directory generator tests.
 * No network. No live Supabase.
 */

import { readFileSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";

export type Filter = {
  type: string;
  col: string;
  val: unknown;
  vals?: unknown[];
};

/**
 * Adapts FULL-SETUP.sql for PGlite (no pgcrypto extension / pgrst notify).
 */
export function adaptFullSetupForPglite(sql: string): string {
  return sql
    .replace(/CREATE EXTENSION IF NOT EXISTS "pgcrypto";/g, "-- pgcrypto skipped in PGlite")
    .replace(/EXECUTE FUNCTION/g, "EXECUTE PROCEDURE")
    .replace(/NOTIFY pgrst, 'reload schema';/g, "-- NOTIFY skipped");
}

/**
 * Creates auth/storage stubs and roles expected by FULL-SETUP.sql.
 */
export async function stubSupabaseSchemas(db: PGlite): Promise<void> {
  await db.exec(`
    CREATE SCHEMA IF NOT EXISTS auth;
    CREATE SCHEMA IF NOT EXISTS storage;
    CREATE TABLE IF NOT EXISTS auth.users (
      id uuid PRIMARY KEY,
      raw_user_meta_data jsonb DEFAULT '{}'::jsonb
    );
    CREATE OR REPLACE FUNCTION auth.uid()
      RETURNS uuid
      LANGUAGE sql
      STABLE
      AS $$ SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid; $$;
    CREATE TABLE IF NOT EXISTS storage.buckets (
      id text PRIMARY KEY,
      name text NOT NULL,
      public boolean DEFAULT false
    );
    CREATE TABLE IF NOT EXISTS storage.objects (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bucket_id text,
      name text,
      owner uuid,
      created_at timestamptz DEFAULT now()
    );
    DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
    DO $$ BEGIN CREATE ROLE service_role; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
  `);
}

/**
 * Opens a fresh PGlite database, stubs schemas, and runs FULL-SETUP.sql twice.
 */
export async function createSetupDatabase(dataDir: string): Promise<PGlite> {
  rmSync(dataDir, { recursive: true, force: true });
  mkdirSync(dataDir, { recursive: true });
  const db = new PGlite(dataDir);
  await stubSupabaseSchemas(db);
  const sqlPath = join(process.cwd(), "supabase/FULL-SETUP.sql");
  const sql = adaptFullSetupForPglite(readFileSync(sqlPath, "utf8"));
  await db.exec(sql);
  await db.exec(sql);
  return db;
}

function applyFilters(sql: string, filters: Filter[], params: unknown[]): string {
  let out = sql;
  for (const filter of filters) {
    if (filter.type === "eq") {
      params.push(filter.val);
      out += ` AND "${filter.col}" = $${params.length}`;
    } else if (filter.type === "in") {
      const placeholders = (filter.vals as unknown[]).map((value) => {
        params.push(value);
        return `$${params.length}`;
      });
      out += ` AND "${filter.col}" IN (${placeholders.join(",")})`;
    }
  }
  return out;
}

/**
 * Minimal Supabase-client shim backed by PGlite for the directory generator.
 */
export function createPgliteSupabaseShim(db: PGlite): {
  from: (table: string) => Record<string, unknown>;
} {
  function makeQuery(table: string): Record<string, unknown> {
    const state: {
      action: string;
      cols: string;
      head?: boolean;
      rows?: Record<string, unknown>[];
      filters: Filter[];
      returning: string | null;
    } = {
      action: "select",
      cols: "*",
      filters: [],
      returning: null,
    };

    const api: Record<string, unknown> = {
      select(cols: string, opts?: { head?: boolean }) {
        if (state.action === "insert") {
          state.returning = cols;
        } else {
          state.action = "select";
          state.cols = cols;
          state.head = opts?.head;
        }
        return api;
      },
      insert(rows: Record<string, unknown> | Record<string, unknown>[]) {
        state.action = "insert";
        state.rows = Array.isArray(rows) ? rows : [rows];
        return api;
      },
      update(patch: Record<string, unknown>) {
        state.action = "update";
        (state as { patch?: Record<string, unknown> }).patch = patch;
        return api;
      },
      delete() {
        state.action = "delete";
        return api;
      },
      eq(col: string, val: unknown) {
        state.filters.push({ type: "eq", col, val });
        return api;
      },
      in(col: string, vals: unknown[]) {
        state.filters.push({ type: "in", col, val: null, vals });
        return api;
      },
      order() {
        return api;
      },
      limit() {
        return api;
      },
      then(resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) {
        return (async () => {
          try {
            const params: unknown[] = [];
            if (state.action === "select") {
              let sql = `SELECT ${state.cols} FROM public.${table} WHERE true`;
              sql = applyFilters(sql, state.filters, params);
              const res = await db.query(sql, params);
              return {
                data: state.head ? null : res.rows,
                error: null,
                count: res.rows.length,
              };
            }
            if (state.action === "delete") {
              let sql = `DELETE FROM public.${table} WHERE true`;
              sql = applyFilters(sql, state.filters, params);
              await db.query(sql, params);
              return { data: null, error: null };
            }
            if (state.action === "insert") {
              const rows = state.rows ?? [];
              if (!rows.length) {
                return { data: [], error: null };
              }
              const cols = Object.keys(rows[0] as Record<string, unknown>);
              const valuesSql: string[] = [];
              for (const row of rows) {
                const placeholders = cols.map((col) => {
                  let value = (row as Record<string, unknown>)[col];
                  if (Array.isArray(value) || (value && typeof value === "object")) {
                    value = JSON.stringify(value);
                  }
                  params.push(value);
                  if (col === "public_signals" || col === "research_facts") {
                    return `$${params.length}::jsonb`;
                  }
                  return `$${params.length}`;
                });
                valuesSql.push(`(${placeholders.join(",")})`);
              }
              const returning = state.returning
                ? ` RETURNING ${state.returning}`
                : " RETURNING *";
              const sql = `INSERT INTO public.${table} (${cols
                .map((col) => `"${col}"`)
                .join(",")}) VALUES ${valuesSql.join(",")}${returning}`;
              const res = await db.query(sql, params);
              return { data: res.rows, error: null };
            }
            return { data: null, error: { message: "unsupported shim action" } };
          } catch (error) {
            const message = error instanceof Error ? error.message : String(error);
            return { data: null, error: { message } };
          }
        })().then(resolve, reject);
      },
    };

    return api;
  }

  return { from: (table: string) => makeQuery(table) };
}
