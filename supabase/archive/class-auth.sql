-- Rehearse class-based student auth — run in Supabase SQL editor after schema.sql

-- Classes created by professors (teachers)
CREATE TABLE IF NOT EXISTS classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  professor_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  join_code text NOT NULL UNIQUE,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

-- Students — stored in Supabase, not Supabase auth
CREATE TABLE IF NOT EXISTS students (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  username text NOT NULL,
  display_name text NOT NULL,
  password_hash text NOT NULL,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  professor_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(class_id, username)
);

-- Which simulations belong to which class
CREATE TABLE IF NOT EXISTS class_simulations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  simulation_id uuid REFERENCES simulations(id) ON DELETE CASCADE,
  added_at timestamptz DEFAULT now(),
  UNIQUE(class_id, simulation_id)
);

-- Link attempts to class students (repoint FK from profiles → students)
ALTER TABLE attempts DROP CONSTRAINT IF EXISTS attempts_student_id_fkey;
ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS class_id uuid REFERENCES classes(id);

-- Legacy attempts used profiles.id as student_id; those rows are not in students.
-- Remove dependent scores first, then orphan attempts, before adding the new FK.
DELETE FROM stage_scores
WHERE attempt_id IN (
  SELECT id FROM attempts
  WHERE student_id IS NOT NULL
    AND student_id NOT IN (SELECT id FROM students)
);

DELETE FROM attempts
WHERE student_id IS NOT NULL
  AND student_id NOT IN (SELECT id FROM students);

ALTER TABLE attempts
  ADD CONSTRAINT attempts_student_id_fkey
  FOREIGN KEY (student_id) REFERENCES students(id) ON DELETE CASCADE;

-- RLS policies
ALTER TABLE classes ENABLE ROW LEVEL SECURITY;
ALTER TABLE students ENABLE ROW LEVEL SECURITY;
ALTER TABLE class_simulations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "professors_manage_own_classes" ON classes;
CREATE POLICY "professors_manage_own_classes" ON classes
  FOR ALL USING (professor_id = auth.uid());

DROP POLICY IF EXISTS "anyone_read_classes" ON classes;
CREATE POLICY "anyone_read_classes" ON classes
  FOR SELECT USING (true);

DROP POLICY IF EXISTS "service_role_students" ON students;
CREATE POLICY "service_role_students" ON students
  FOR ALL USING (auth.role() = 'service_role');

DROP POLICY IF EXISTS "professors_read_their_students" ON students;
CREATE POLICY "professors_read_their_students" ON students
  FOR SELECT USING (professor_id = auth.uid());

DROP POLICY IF EXISTS "professors_manage_class_simulations" ON class_simulations;
CREATE POLICY "professors_manage_class_simulations" ON class_simulations
  FOR ALL USING (
    class_id IN (
      SELECT id FROM classes WHERE professor_id = auth.uid()
    )
  );

-- Teachers read attempts from class students
DROP POLICY IF EXISTS "Teachers read class student attempts" ON attempts;
CREATE POLICY "Teachers read class student attempts" ON attempts
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM simulations s
      WHERE s.id = attempts.simulation_id AND s.teacher_id = auth.uid()
    )
  );
