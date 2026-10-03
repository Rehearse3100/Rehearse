-- crm-leads-migration.sql
-- Creates the multi-entry CRM Leads table used by Rehearse CRM Convert flow.
-- Run in Supabase → SQL Editor → Run, then optionally:
--   NOTIFY pgrst, 'reload schema';

CREATE TABLE IF NOT EXISTS public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  company_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_title text NOT NULL DEFAULT '',
  why_fit text NOT NULL DEFAULT '',
  trigger_event text NOT NULL DEFAULT '',
  next_step text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'selected', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_leads_attempt_id_idx
  ON public.crm_leads (attempt_id);

CREATE INDEX IF NOT EXISTS crm_leads_attempt_status_idx
  ON public.crm_leads (attempt_id, status);

ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
-- No RLS policies: app uses the service-role key for student CRM routes.

NOTIFY pgrst, 'reload schema';
