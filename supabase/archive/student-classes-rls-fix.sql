-- Run this in Supabase SQL editor if join-class returns "Could not join class"
-- Safe to re-run (idempotent)

-- Ensure table exists (skip if you already ran student-classes-migration.sql)
CREATE TABLE IF NOT EXISTS student_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  professor_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(student_id, class_id)
);

-- Table-level grants (required for PostgREST / service role writes)
GRANT ALL ON TABLE student_classes TO service_role;
GRANT SELECT ON TABLE student_classes TO authenticated;
GRANT SELECT ON TABLE student_classes TO anon;

ALTER TABLE student_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_student_classes" ON student_classes;
DROP POLICY IF EXISTS "service_role_all_student_classes" ON student_classes;
DROP POLICY IF EXISTS "professors_read_their_student_classes" ON student_classes;

-- Service role must be able to insert enrollments from API routes
CREATE POLICY "service_role_all_student_classes" ON student_classes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Professors read enrollments for their classes
CREATE POLICY "professors_read_their_student_classes" ON student_classes
  FOR SELECT
  TO authenticated
  USING (professor_id = auth.uid());
