-- Rehearse: Rehearse Essentials system class
-- Run this ENTIRE file in Supabase → SQL Editor → Run
-- Safe to re-run (uses ON CONFLICT / IF NOT EXISTS patterns)

-- Step 1: Allow NULL professor_id for system classes
ALTER TABLE classes
  ALTER COLUMN professor_id DROP NOT NULL;

ALTER TABLE student_classes
  ALTER COLUMN professor_id DROP NOT NULL;

-- Step 2: Create the system default class
INSERT INTO classes (
  id,
  professor_id,
  name,
  description,
  join_code,
  is_active,
  created_at
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

-- Step 2b: Update name/description if class was already seeded with old values
UPDATE classes SET
  name = 'Rehearse Essentials',
  description = 'Curated simulations from Rehearse — available to every student.'
WHERE id = '00000000-0000-0000-0000-000000000001';

-- Step 3: Enroll all existing students in the default class
INSERT INTO student_classes (student_id, class_id, professor_id)
SELECT
  s.id,
  '00000000-0000-0000-0000-000000000001',
  NULL
FROM students s
WHERE NOT EXISTS (
  SELECT 1 FROM student_classes sc
  WHERE sc.student_id = s.id
  AND sc.class_id = '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT (student_id, class_id) DO NOTHING;

-- Step 4: Verify default class
SELECT * FROM classes WHERE id = '00000000-0000-0000-0000-000000000001';
SELECT COUNT(*) AS default_class_enrollments FROM student_classes
WHERE class_id = '00000000-0000-0000-0000-000000000001';

-- Step 5: Seed Tempo simulation (see tempo-simulation-seed.sql for full details)
ALTER TABLE simulations
  ALTER COLUMN teacher_id DROP NOT NULL;

INSERT INTO simulations (
  id,
  teacher_id,
  title,
  description,
  persona_name,
  persona_role,
  persona_system_prompt,
  product_context,
  simli_face_id,
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
  true,
  now()
)
ON CONFLICT (id) DO UPDATE SET
  title = EXCLUDED.title,
  is_published = true;

INSERT INTO class_simulations (class_id, simulation_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
)
ON CONFLICT (class_id, simulation_id) DO NOTHING;

-- Step 6: Allow abandoned status (required for Restart simulation)
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
