-- crm-data-room-migration.sql
-- Prerequisite for scripts/generate-data-room.ts
-- Adds in_data_room flag + crm_prospect_documents table.

ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS in_data_room boolean NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS public.crm_prospect_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_prospect_directory(id) ON DELETE CASCADE,
  doc_type text NOT NULL CHECK (doc_type IN ('profile', 'news')),
  title text NOT NULL DEFAULT '',
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (company_id, doc_type)
);

CREATE INDEX IF NOT EXISTS crm_prospect_documents_company_id_idx
  ON public.crm_prospect_documents (company_id);

ALTER TABLE public.crm_prospect_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_crm_prospect_documents" ON public.crm_prospect_documents;
CREATE POLICY "service_role_crm_prospect_documents" ON public.crm_prospect_documents
  FOR ALL USING (true) WITH CHECK (true);
