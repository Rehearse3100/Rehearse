-- crm-contact-fields-migration.sql
-- Structured contact profile fields (name, position, etc.) on CRM contacts.
-- Run in Supabase SQL editor if not already applied.

ALTER TABLE crm_contact_notes
  ADD COLUMN IF NOT EXISTS fields jsonb NOT NULL DEFAULT '{}'::jsonb;
