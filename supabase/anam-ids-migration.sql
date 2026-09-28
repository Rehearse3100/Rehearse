-- Anam avatar/voice IDs per stage (Discovery + Objection Handling)
-- Run in Supabase → SQL Editor after deploying the Anam client migration.
-- Safe to re-run (IF NOT EXISTS / idempotent updates).

ALTER TABLE public.simulations
  ADD COLUMN IF NOT EXISTS anam_avatar_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.simulations
  ADD COLUMN IF NOT EXISTS anam_voice_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.simulations.anam_avatar_ids IS
  'Per-stage Anam avatar UUIDs, e.g. {"discovery":"…","objections":"…"}';

COMMENT ON COLUMN public.simulations.anam_voice_ids IS
  'Per-stage Anam voice UUIDs, e.g. {"discovery":"…","objections":"…"}';

-- Tempo / Summit Dental simulation — Dana (Discovery) + Dr. Kim (Objections)
UPDATE public.simulations
SET
  anam_avatar_ids = '{"discovery":"071b0286-4cce-4808-bee2-e642f1062de3","objections":"cd5b5961-717d-4173-95bd-179631789874"}'::jsonb,
  anam_voice_ids  = '{"discovery":"d338ed86-05e6-4ca0-a3fc-3d438ddb1a96","objections":"2e7fc41b-be40-49d8-a5ca-b26ab5775a33"}'::jsonb
WHERE id = '00000000-0000-0000-0000-000000000002';
