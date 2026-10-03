-- data-room-v2-migration.sql
-- Additive columns for visible/hidden prospect-directory layers (Tempo data room v2).
-- Does NOT drop tables or columns. Idempotent via IF NOT EXISTS.

-- Visible layer
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS vertical text,
  ADD COLUMN IF NOT EXISTS locations integer,
  ADD COLUMN IF NOT EXISTS metro text,
  ADD COLUMN IF NOT EXISTS in_territory boolean,
  ADD COLUMN IF NOT EXISTS size_note text,
  ADD COLUMN IF NOT EXISTS online_booking boolean,
  ADD COLUMN IF NOT EXISTS blurb text,
  ADD COLUMN IF NOT EXISTS public_signals jsonb;

-- Hidden layer (server-only — never sent to clients)
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS research_facts jsonb,
  ADD COLUMN IF NOT EXISTS class text,
  ADD COLUMN IF NOT EXISTS subtype text,
  ADD COLUMN IF NOT EXISTS fit_rank integer,
  ADD COLUMN IF NOT EXISTS trigger_quality text,
  ADD COLUMN IF NOT EXISTS keyed_trigger text,
  ADD COLUMN IF NOT EXISTS best_contact text,
  ADD COLUMN IF NOT EXISTS why text;
