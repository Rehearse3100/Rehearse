-- crm-account-fields-migration.sql
-- Adds structured account profile fields for empty-first CRM accounts.
-- Run in Supabase SQL editor if not already applied.

ALTER TABLE crm_account_notes
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '{}'::jsonb;
