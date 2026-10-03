-- crm-leads-selected-status-migration.sql
-- Allows Lead status 'selected' (Prospecting target) alongside new/converted.
-- Run in Supabase → SQL Editor if crm_leads already exists without 'selected'.

ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_status_check;

ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_status_check
  CHECK (status IN ('new', 'selected', 'converted'));

NOTIFY pgrst, 'reload schema';
