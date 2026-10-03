-- Allow abandoned attempts when a student restarts a simulation.
-- Run this in Supabase → SQL Editor if Restart shows "Could not restart simulation."

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'attempts'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE attempts DROP CONSTRAINT %I', constraint_name);
  END LOOP;
END $$;

ALTER TABLE attempts ADD CONSTRAINT attempts_status_check
  CHECK (status IN ('in_progress', 'completed', 'abandoned'));
