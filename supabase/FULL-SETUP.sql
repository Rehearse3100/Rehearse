-- =============================================================================
-- Rehearse — FULL greenfield Supabase setup (single paste)
-- Paste this ENTIRE file into Supabase → SQL Editor → Run once on a new project.
-- Idempotent: safe to run a second time.
-- Does NOT seed the 64 data-room companies (run generate-prospect-directory.ts after).
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ── Profiles (professors via Supabase Auth) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('student', 'teacher')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, full_name, role)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', 'User'),
    COALESCE(NEW.raw_user_meta_data->>'role', 'student')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- ── Simulations ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  teacher_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  persona_name text NOT NULL,
  persona_role text NOT NULL,
  persona_system_prompt text NOT NULL,
  product_context text NOT NULL,
  simli_face_id text NOT NULL DEFAULT '',
  anam_avatar_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  anam_voice_ids jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_published boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.simulations
  ADD COLUMN IF NOT EXISTS anam_avatar_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.simulations
  ADD COLUMN IF NOT EXISTS anam_voice_ids jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.simulations.anam_avatar_ids IS
  'Per-stage Anam avatar UUIDs, e.g. {"discovery":"…","objections":"…"}';

COMMENT ON COLUMN public.simulations.anam_voice_ids IS
  'Per-stage Anam voice UUIDs, e.g. {"discovery":"…","objections":"…"}';

-- ── Classes ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professor_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  join_code text NOT NULL UNIQUE,
  is_active boolean NOT NULL DEFAULT true,
  card_image_url text,
  card_color_scheme text DEFAULT 'default',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ── Students (app auth — NOT Supabase Auth) ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  joined_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT students_username_unique UNIQUE (username)
);

-- ── Student ↔ class enrollments ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  professor_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (student_id, class_id)
);

-- ── Class ↔ simulation assignments ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.class_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid NOT NULL REFERENCES public.classes(id) ON DELETE CASCADE,
  simulation_id uuid NOT NULL REFERENCES public.simulations(id) ON DELETE CASCADE,
  added_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (class_id, simulation_id)
);

-- ── Attempts ─────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  simulation_id uuid NOT NULL REFERENCES public.simulations(id) ON DELETE CASCADE,
  class_id uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  student_class_id uuid REFERENCES public.student_classes(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'completed', 'abandoned')),
  current_stage text NOT NULL DEFAULT 'lead_gen',
  total_score integer NOT NULL DEFAULT 0,
  stage_data jsonb,
  lead_selection_attempts integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS attempts_student_id_idx ON public.attempts (student_id);
CREATE INDEX IF NOT EXISTS attempts_simulation_id_idx ON public.attempts (simulation_id);
CREATE INDEX IF NOT EXISTS attempts_class_id_idx ON public.attempts (class_id);

-- ── Stage scores ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.stage_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  stage text NOT NULL,
  score integer NOT NULL CHECK (score BETWEEN 0 AND 100),
  feedback text,
  transcript text,
  badges_earned text[] NOT NULL DEFAULT '{}'::text[],
  completed_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, stage)
);

-- ── CRM: opportunity logs ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  stage text NOT NULL,
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  submitted_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, stage)
);

CREATE INDEX IF NOT EXISTS crm_log_entries_attempt_id_idx
  ON public.crm_log_entries (attempt_id);

-- ── CRM: account notes (1 per attempt) ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_account_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  notes text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id)
);

-- ── CRM: contact notes (Dana / Kim slots) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_contact_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  contact_key text NOT NULL,
  role text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  fields jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, contact_key)
);

CREATE INDEX IF NOT EXISTS crm_contact_notes_attempt_id_idx
  ON public.crm_contact_notes (attempt_id);

-- ── CRM: leads ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id uuid NOT NULL REFERENCES public.attempts(id) ON DELETE CASCADE,
  company_name text NOT NULL DEFAULT '',
  contact_name text NOT NULL DEFAULT '',
  contact_title text NOT NULL DEFAULT '',
  why_fit text NOT NULL DEFAULT '',
  trigger_event text NOT NULL DEFAULT '',
  next_step text NOT NULL DEFAULT '',
  decision_maker_rationale text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'new'
    CHECK (status IN ('new', 'shortlisted', 'selected', 'converted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_leads
  ADD COLUMN IF NOT EXISTS decision_maker_rationale text NOT NULL DEFAULT '';

ALTER TABLE public.crm_leads DROP CONSTRAINT IF EXISTS crm_leads_status_check;
ALTER TABLE public.crm_leads
  ADD CONSTRAINT crm_leads_status_check
  CHECK (status IN ('new', 'shortlisted', 'selected', 'converted'));

CREATE INDEX IF NOT EXISTS crm_leads_attempt_id_idx ON public.crm_leads (attempt_id);
CREATE INDEX IF NOT EXISTS crm_leads_attempt_status_idx
  ON public.crm_leads (attempt_id, status);

-- ── Prospect directory (companies) ───────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_prospect_directory (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  simulation_id uuid NOT NULL REFERENCES public.simulations(id) ON DELETE CASCADE,
  company_name text NOT NULL,
  industry text NOT NULL DEFAULT '',
  size_locations text NOT NULL DEFAULT '',
  signal_hint text NOT NULL DEFAULT '',
  hidden_claim text,
  entry_type text NOT NULL DEFAULT 'filler'
    CHECK (entry_type IN ('target', 'crafted_decoy', 'filler')),
  is_active boolean NOT NULL DEFAULT true,
  in_data_room boolean NOT NULL DEFAULT false,
  vertical text,
  locations integer,
  metro text,
  in_territory boolean,
  size_note text,
  online_booking boolean,
  blurb text,
  public_signals jsonb,
  research_facts jsonb,
  class text,
  subtype text,
  fit_rank integer,
  trigger_quality text,
  keyed_trigger text,
  best_contact text,
  why text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS in_data_room boolean NOT NULL DEFAULT false;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS vertical text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS locations integer;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS metro text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS in_territory boolean;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS size_note text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS online_booking boolean;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS blurb text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS public_signals jsonb;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS research_facts jsonb;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS class text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS subtype text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS fit_rank integer;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS trigger_quality text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS keyed_trigger text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS best_contact text;
ALTER TABLE public.crm_prospect_directory
  ADD COLUMN IF NOT EXISTS why text;

CREATE INDEX IF NOT EXISTS crm_prospect_directory_simulation_id_idx
  ON public.crm_prospect_directory (simulation_id);

CREATE UNIQUE INDEX IF NOT EXISTS crm_prospect_directory_one_target_per_sim_idx
  ON public.crm_prospect_directory (simulation_id)
  WHERE entry_type = 'target' AND is_active = true;

-- ── Prospect directory contacts (3 per company) ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.crm_prospect_contacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES public.crm_prospect_directory(id) ON DELETE CASCADE,
  contact_name text NOT NULL DEFAULT '',
  contact_title text NOT NULL DEFAULT '',
  department text NOT NULL DEFAULT '',
  gender text,
  is_correct_contact boolean NOT NULL DEFAULT false,
  stronger_axis text,
  weaker_axis text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS crm_prospect_contacts_company_id_idx
  ON public.crm_prospect_contacts (company_id);

-- ── Prospect documents (Profile / News — kept empty; generator does not seed) ─
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

-- ── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.students ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.class_simulations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.stage_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_log_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_account_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_contact_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_leads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prospect_directory ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prospect_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.crm_prospect_documents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users read own profile" ON public.profiles;
CREATE POLICY "Users read own profile" ON public.profiles
  FOR SELECT USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users update own profile" ON public.profiles;
CREATE POLICY "Users update own profile" ON public.profiles
  FOR UPDATE USING (auth.uid() = id);

DROP POLICY IF EXISTS "Users insert own profile" ON public.profiles;
CREATE POLICY "Users insert own profile" ON public.profiles
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "professors_read_profiles_for_sim_attempts" ON public.profiles;
CREATE POLICY "professors_read_profiles_for_sim_attempts" ON public.profiles
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.attempts a
      JOIN public.simulations s ON s.id = a.simulation_id
      WHERE a.student_id = profiles.id
        AND s.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Teachers manage own simulations" ON public.simulations;
CREATE POLICY "Teachers manage own simulations" ON public.simulations
  FOR ALL USING (auth.uid() = teacher_id OR teacher_id IS NULL);

DROP POLICY IF EXISTS "Students read published simulations" ON public.simulations;
CREATE POLICY "Students read published simulations" ON public.simulations
  FOR SELECT USING (is_published = true OR auth.uid() = teacher_id);

DROP POLICY IF EXISTS "professors_manage_own_classes" ON public.classes;
CREATE POLICY "professors_manage_own_classes" ON public.classes
  FOR ALL USING (professor_id = auth.uid() OR professor_id IS NULL);

DROP POLICY IF EXISTS "anyone_read_classes" ON public.classes;
CREATE POLICY "anyone_read_classes" ON public.classes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "service_role_students" ON public.students;
CREATE POLICY "service_role_students" ON public.students
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "professors_read_enrolled_students" ON public.students;
CREATE POLICY "professors_read_enrolled_students" ON public.students
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.student_classes sc
      WHERE sc.student_id = students.id
        AND sc.professor_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_role_all_student_classes" ON public.student_classes;
CREATE POLICY "service_role_all_student_classes" ON public.student_classes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "professors_read_their_student_classes" ON public.student_classes;
CREATE POLICY "professors_read_their_student_classes" ON public.student_classes
  FOR SELECT TO authenticated
  USING (professor_id = auth.uid());

DROP POLICY IF EXISTS "professors_manage_class_simulations" ON public.class_simulations;
CREATE POLICY "professors_manage_class_simulations" ON public.class_simulations
  FOR ALL USING (
    class_id IN (
      SELECT id FROM public.classes WHERE professor_id = auth.uid()
    )
    OR class_id = '00000000-0000-0000-0000-000000000001'
  );

DROP POLICY IF EXISTS "anyone_read_class_simulations" ON public.class_simulations;
CREATE POLICY "anyone_read_class_simulations" ON public.class_simulations
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "Teachers read class student attempts" ON public.attempts;
CREATE POLICY "Teachers read class student attempts" ON public.attempts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.simulations s
      WHERE s.id = attempts.simulation_id AND s.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Teachers read stage scores" ON public.stage_scores;
CREATE POLICY "Teachers read stage scores" ON public.stage_scores
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.attempts a
      JOIN public.simulations s ON s.id = a.simulation_id
      WHERE a.id = stage_scores.attempt_id AND s.teacher_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "service_role_crm_log_entries" ON public.crm_log_entries;
CREATE POLICY "service_role_crm_log_entries" ON public.crm_log_entries
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_crm_account_notes" ON public.crm_account_notes;
CREATE POLICY "service_role_crm_account_notes" ON public.crm_account_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_crm_contact_notes" ON public.crm_contact_notes;
CREATE POLICY "service_role_crm_contact_notes" ON public.crm_contact_notes
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_crm_leads" ON public.crm_leads;
CREATE POLICY "service_role_crm_leads" ON public.crm_leads
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_crm_prospect_directory" ON public.crm_prospect_directory;
CREATE POLICY "service_role_crm_prospect_directory" ON public.crm_prospect_directory
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_crm_prospect_contacts" ON public.crm_prospect_contacts;
CREATE POLICY "service_role_crm_prospect_contacts" ON public.crm_prospect_contacts
  FOR ALL TO service_role USING (true) WITH CHECK (true);

DROP POLICY IF EXISTS "service_role_crm_prospect_documents" ON public.crm_prospect_documents;
CREATE POLICY "service_role_crm_prospect_documents" ON public.crm_prospect_documents
  FOR ALL TO service_role USING (true) WITH CHECK (true);

-- ── Grants ───────────────────────────────────────────────────────────────────
GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;

GRANT ALL ON ALL TABLES IN SCHEMA public TO service_role;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT SELECT ON public.classes TO anon;
GRANT SELECT ON public.class_simulations TO anon;
GRANT SELECT ON public.simulations TO anon;

GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO service_role;

-- ── Storage: onboarding videos (public bucket) ───────────────────────────────
INSERT INTO storage.buckets (id, name, public)
VALUES ('onboarding-videos', 'onboarding-videos', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public read onboarding-videos" ON storage.objects;
CREATE POLICY "Public read onboarding-videos" ON storage.objects
  FOR SELECT
  USING (bucket_id = 'onboarding-videos');

DROP POLICY IF EXISTS "Service role write onboarding-videos" ON storage.objects;
CREATE POLICY "Service role write onboarding-videos" ON storage.objects
  FOR ALL TO service_role
  USING (bucket_id = 'onboarding-videos')
  WITH CHECK (bucket_id = 'onboarding-videos');

-- ── Seed: Rehearse Essentials class ──────────────────────────────────────────
INSERT INTO public.classes (
  id, professor_id, name, description, join_code, is_active, created_at
) VALUES (
  '00000000-0000-0000-0000-000000000001',
  NULL,
  'Rehearse Essentials',
  'Curated simulations from Rehearse — available to every student.',
  'DEFAULT',
  true,
  now()
)
ON CONFLICT (id) DO NOTHING;

-- ── Seed: Tempo simulation (EXACT ID required by lib/constants.ts) ───────────
-- Live Discovery / Objection prompts are read from lib/constants.ts at runtime
-- (DANA_REYES_SYSTEM_PROMPT / DR_KIM_SYSTEM_PROMPT), not from this row.
-- persona_system_prompt / product_context must still be non-empty (NOT NULL).
-- Anam IDs recovered from supabase/anam-ids-migration.sql (also previously in FULL-SETUP).
INSERT INTO public.simulations (
  id,
  teacher_id,
  title,
  description,
  persona_name,
  persona_role,
  persona_system_prompt,
  product_context,
  simli_face_id,
  anam_avatar_ids,
  anam_voice_ids,
  is_published,
  created_at
) VALUES (
  '00000000-0000-0000-0000-000000000002',
  NULL,
  'Sell Tempo to Summit Dental Group',
  'Work a full-cycle B2B deal selling Tempo AI scheduling to Summit Dental Group — from prospecting through close.',
  'Dana Reyes',
  'Director of Operations',
  $$You are Dana Reyes, Director of Operations at Summit Dental Group, a multi-location dental practice network in Denver with 8 locations.

You are practical, data-driven, and skeptical of vendor hype. You care about front-desk burnout, patient no-shows (currently ~20%), and integration with Dentrix. You do NOT make purchasing decisions alone — Dr. Saul Kim (owner) signs off on major software spend.

On discovery calls: answer questions honestly but do not volunteer pain points until the rep earns trust with good questions. Push back on vague ROI claims. You have 15 minutes max.

Stay in character. Short, realistic responses — 2-3 sentences max. Never break character or mention that this is a simulation.$$,
  $$Tempo AI is an AI-powered patient scheduling platform for dental practices. It integrates with Dentrix and OpenDental, sends automated multi-channel reminders, handles routine re-bookings, and reduces no-shows by up to 40%. Pricing starts around $800/month per location with volume discounts for multi-site groups.$$,
  '',
  '{"discovery":"071b0286-4cce-4808-bee2-e642f1062de3","objections":"960f614f-ea88-47c3-9883-f02094f70874"}'::jsonb,
  '{"discovery":"d338ed86-05e6-4ca0-a3fc-3d438ddb1a96","objections":"2e7fc41b-be40-49d8-a5ca-b26ab5775a33"}'::jsonb,
  true,
  now()
)
ON CONFLICT (id) DO NOTHING;

INSERT INTO public.class_simulations (class_id, simulation_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
)
ON CONFLICT (class_id, simulation_id) DO NOTHING;

NOTIFY pgrst, 'reload schema';

-- =============================================================================
-- OPTIONAL — only if Anam IDs need to be replaced later (already seeded above)
-- =============================================================================
-- UPDATE public.simulations
--   SET anam_avatar_ids = '{"discovery":"PASTE","objections":"PASTE"}'::jsonb,
--       anam_voice_ids  = '{"discovery":"PASTE","objections":"PASTE"}'::jsonb
-- WHERE id = '00000000-0000-0000-0000-000000000002';

-- ── Final check (SQL Editor shows only the last result) ──────────────────────
SELECT
  (
    SELECT COUNT(*)::int
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = ANY (ARRAY[
        'profiles',
        'simulations',
        'classes',
        'students',
        'student_classes',
        'class_simulations',
        'attempts',
        'stage_scores',
        'crm_log_entries',
        'crm_account_notes',
        'crm_contact_notes',
        'crm_leads',
        'crm_prospect_directory',
        'crm_prospect_contacts',
        'crm_prospect_documents'
      ])
  ) AS expected_tables_present,
  EXISTS (
    SELECT 1
    FROM public.simulations
    WHERE id = '00000000-0000-0000-0000-000000000002'
  ) AS tempo_row_exists,
  EXISTS (
    SELECT 1
    FROM public.simulations
    WHERE id = '00000000-0000-0000-0000-000000000002'
      AND COALESCE(anam_avatar_ids->>'discovery', '') <> ''
      AND COALESCE(anam_avatar_ids->>'objections', '') <> ''
      AND COALESCE(anam_voice_ids->>'discovery', '') <> ''
      AND COALESCE(anam_voice_ids->>'objections', '') <> ''
  ) AS anam_ids_populated,
  EXISTS (
    SELECT 1
    FROM storage.buckets
    WHERE id = 'onboarding-videos' AND public = true
  ) AS onboarding_videos_bucket_public,
  EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_prospect_directory'
      AND column_name = 'research_facts'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_prospect_directory'
      AND column_name = 'in_data_room'
  )
  AND EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'crm_prospect_directory'
      AND column_name = 'vertical'
  ) AS data_room_v2_columns_present;
