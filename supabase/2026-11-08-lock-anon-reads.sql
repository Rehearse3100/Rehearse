-- =============================================================================
-- Rehearse — security fixes, 2026-11-08 (code review 2026-11-07, H2 and M4)
-- Run once in Supabase → SQL Editor. Idempotent: safe to run a second time.
-- The same changes are in supabase/FULL-SETUP.sql.
--
-- 1. Anon reads (H2): the public anon key could list every class (and its join
--    code) and every published simulation (including persona_system_prompt).
--    Nothing in the app reads these tables as anon: students read them through the
--    server's service client, teachers through their own signed-in session.
-- 2. Student login limits (M4): failed student logins, so the login route can stop
--    guessing (10 failures per username and 30 per IP in 15 minutes). Written and
--    read only by the server's service client.
-- =============================================================================

-- ── 1. Anon reads ────────────────────────────────────────────────────────────
-- "anyone_read_classes" let every role (anon and every signed-in teacher) read
-- every class; teachers keep "professors_manage_own_classes" (their own classes).
DROP POLICY IF EXISTS "anyone_read_classes" ON public.classes;

REVOKE SELECT ON public.classes FROM anon;
REVOKE SELECT ON public.class_simulations FROM anon;
REVOKE SELECT ON public.simulations FROM anon;

-- ── 2. Failed student logins ─────────────────────────────────────────────────
-- One row per failed attempt (unknown username or wrong password); a successful
-- login writes nothing. username is lowercased; ip_hash is the SHA-256 of the
-- client IP (the IP itself is never stored). RLS on, no policies: only the
-- service client (app/api/student/login) reads and writes it.
CREATE TABLE IF NOT EXISTS public.student_login_failures (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  ip_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_login_failures_username_created_idx
  ON public.student_login_failures (username, created_at);
CREATE INDEX IF NOT EXISTS student_login_failures_ip_created_idx
  ON public.student_login_failures (ip_hash, created_at);

ALTER TABLE public.student_login_failures ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.student_login_failures FROM anon, authenticated;
GRANT ALL ON public.student_login_failures TO service_role;

NOTIFY pgrst, 'reload schema';

-- ── Check (SQL Editor shows only the last result) ────────────────────────────
SELECT
  NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'classes' AND policyname = 'anyone_read_classes'
  ) AS anyone_read_classes_dropped,
  NOT has_table_privilege('anon', 'public.classes', 'SELECT') AS anon_cannot_read_classes,
  NOT has_table_privilege('anon', 'public.class_simulations', 'SELECT') AS anon_cannot_read_class_simulations,
  NOT has_table_privilege('anon', 'public.simulations', 'SELECT') AS anon_cannot_read_simulations,
  EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'student_login_failures'
  ) AS student_login_failures_present;
