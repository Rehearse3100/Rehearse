-- crm-prospect-directory-migration.sql
-- Shared Prospecting company directory: 1 real Tempo target + decoys.
-- Run in Supabase → SQL Editor. App falls back to lib seed if table is empty/missing.

CREATE TABLE IF NOT EXISTS public.crm_prospect_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  industry text NOT NULL DEFAULT '',
  size_label text NOT NULL DEFAULT '',
  signal_hint text NOT NULL DEFAULT '',
  is_target boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS crm_prospect_directory_one_target_idx
  ON public.crm_prospect_directory ((is_target))
  WHERE is_target = true;

CREATE INDEX IF NOT EXISTS crm_prospect_directory_industry_idx
  ON public.crm_prospect_directory (industry);

ALTER TABLE public.crm_prospect_directory ENABLE ROW LEVEL SECURITY;
-- No RLS policies: student routes use the service-role key.

INSERT INTO public.crm_prospect_directory (id, name, industry, size_label, signal_hint, is_target)
VALUES
  ('a1000001-0001-4000-8000-000000000001', 'Summit Dental Group', 'Dental', '8 locations', 'Just opened 8th Front Range location; phone scheduling under strain.', true),
  ('a1000001-0001-4000-8000-000000000002', 'Bright Smile Dental', 'Dental', '3 locations', 'Posting about front-desk overtime after evening hygiene blocks.', false),
  ('a1000001-0001-4000-8000-000000000003', 'Main Street Dental', 'Dental', '1 location', 'Hiring a second receptionist; mentions missed after-hours calls.', false),
  ('a1000001-0001-4000-8000-000000000004', 'Apex Dental Arts', 'Dental', '2 locations', 'Updating patient portal; looking to reduce no-shows.', false),
  ('a1000001-0001-4000-8000-000000000005', 'Urban Orthodontics', 'Dental', '4 locations', 'Expanding aligner consults; calendar double-books on consult days.', false),
  ('a1000001-0001-4000-8000-000000000006', 'Paws & Whiskers Veterinary', 'Veterinary', '2 clinics', 'Weekend emergency overflow and high same-day cancel rate.', false),
  ('a1000001-0001-4000-8000-000000000007', 'Riverbend Animal Hospital', 'Veterinary', '1 clinic', 'New associate onboarded; phone line busy during lunch rush.', false),
  ('a1000001-0001-4000-8000-000000000008', 'Summit Peak Physical Therapy', 'Physical Therapy', '5 clinics', 'Opening fifth clinic; therapists lose time to rescheduling calls.', false),
  ('a1000001-0001-4000-8000-000000000009', 'Cascade Rehab Partners', 'Physical Therapy', '3 clinics', 'Insurance auth delays causing last-minute cancellations.', false),
  ('a1000001-0001-4000-8000-00000000000a', 'ClearView Optometry', 'Optometry', '2 locations', 'Contact-lens reorder reminders still manual via spreadsheet.', false),
  ('a1000001-0001-4000-8000-00000000000b', 'Lumen Eye Care', 'Optometry', '4 locations', 'Adding Saturday hours; online booking often double-books slots.', false),
  ('a1000001-0001-4000-8000-00000000000c', 'Glow Med Spa Denver', 'Med Spa', '2 studios', 'Injectables waitlist growing; no-shows on first consults.', false),
  ('a1000001-0001-4000-8000-00000000000d', 'Aurora Wellness Spa', 'Med Spa', '1 studio', 'Launching membership packages; tracking renewals in email.', false),
  ('a1000001-0001-4000-8000-00000000000e', 'SpineAlign Chiropractic', 'Chiropractic', '3 clinics', 'Care-plan adherence dropping after visit three.', false),
  ('a1000001-0001-4000-8000-00000000000f', 'TrueNorth Chiro Group', 'Chiropractic', '6 clinics', 'Multi-clinic schedule conflicts when DCs cover for each other.', false)
ON CONFLICT (id) DO NOTHING;

NOTIFY pgrst, 'reload schema';
