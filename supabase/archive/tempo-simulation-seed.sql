-- Rehearse: Tempo simulation seed for Rehearse Essentials
-- Run AFTER default-class-migration.sql in Supabase → SQL Editor → Run
-- Safe to re-run (uses ON CONFLICT patterns)

-- Step 1: Allow NULL teacher_id for system-owned simulations
ALTER TABLE simulations
  ALTER COLUMN teacher_id DROP NOT NULL;

-- Step 2: Seed the Tempo / Summit Dental simulation
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
  description = EXCLUDED.description,
  persona_name = EXCLUDED.persona_name,
  persona_role = EXCLUDED.persona_role,
  persona_system_prompt = EXCLUDED.persona_system_prompt,
  product_context = EXCLUDED.product_context,
  is_published = true;

-- Step 3: Assign Tempo simulation to Rehearse Essentials (default class)
INSERT INTO class_simulations (class_id, simulation_id)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  '00000000-0000-0000-0000-000000000002'
)
ON CONFLICT (class_id, simulation_id) DO NOTHING;

-- Step 4: Verify
SELECT s.id, s.title, s.is_published, c.name AS class_name
FROM class_simulations cs
JOIN simulations s ON s.id = cs.simulation_id
JOIN classes c ON c.id = cs.class_id
WHERE cs.class_id = '00000000-0000-0000-0000-000000000001';
