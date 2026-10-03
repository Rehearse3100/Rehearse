-- =============================================================================
-- Rehearse: multi-class student enrollment
-- Paste this ENTIRE file into Supabase → SQL Editor → Run
-- Safe to re-run if something failed partway through
-- =============================================================================

-- 1) Junction table
CREATE TABLE IF NOT EXISTS student_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  professor_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(student_id, class_id)
);

-- 2) Copy existing enrollments (only while students.class_id still exists)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'students'
      AND column_name = 'class_id'
  ) THEN
    INSERT INTO student_classes (student_id, class_id, professor_id)
    SELECT s.id, s.class_id, s.professor_id
    FROM students s
    WHERE s.class_id IS NOT NULL
    ON CONFLICT (student_id, class_id) DO NOTHING;
  END IF;
END $$;

-- 3) Drop policies/constraints that reference legacy columns BEFORE dropping them
DROP POLICY IF EXISTS "professors_read_their_students" ON students;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_class_id_username_key;

-- 4) Drop legacy columns from students
ALTER TABLE students DROP COLUMN IF EXISTS class_id;
ALTER TABLE students DROP COLUMN IF EXISTS professor_id;

-- 5) Global unique username

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'students_username_unique'
  ) THEN
    ALTER TABLE students ADD CONSTRAINT students_username_unique UNIQUE (username);
  END IF;
END $$;

-- 6) Link attempts to enrollments
ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS student_class_id uuid REFERENCES student_classes(id);

UPDATE attempts a
SET student_class_id = sc.id
FROM student_classes sc
WHERE a.student_class_id IS NULL
  AND a.class_id IS NOT NULL
  AND a.student_id IS NOT NULL
  AND sc.student_id = a.student_id
  AND sc.class_id = a.class_id;

-- 7) Grants + RLS
GRANT ALL ON TABLE student_classes TO service_role;
GRANT SELECT ON TABLE student_classes TO authenticated;
GRANT SELECT ON TABLE student_classes TO anon;

ALTER TABLE student_classes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "service_role_student_classes" ON student_classes;
DROP POLICY IF EXISTS "service_role_all_student_classes" ON student_classes;
DROP POLICY IF EXISTS "professors_read_their_student_classes" ON student_classes;

CREATE POLICY "service_role_all_student_classes" ON student_classes
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

CREATE POLICY "professors_read_their_student_classes" ON student_classes
  FOR SELECT
  TO authenticated
  USING (professor_id = auth.uid());

-- 8) Backfill from attempts if enrollments were missed
INSERT INTO student_classes (student_id, class_id, professor_id)
SELECT DISTINCT a.student_id, a.class_id, c.professor_id
FROM attempts a
JOIN classes c ON c.id = a.class_id
WHERE a.student_id IS NOT NULL
  AND a.class_id IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM student_classes sc
    WHERE sc.student_id = a.student_id
      AND sc.class_id = a.class_id
  )
ON CONFLICT (student_id, class_id) DO NOTHING;

-- 9) Professors can read student profiles for enrollments in their classes
DROP POLICY IF EXISTS "professors_read_enrolled_students" ON students;
CREATE POLICY "professors_read_enrolled_students" ON students
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM student_classes sc
      WHERE sc.student_id = students.id
        AND sc.professor_id = auth.uid()
    )
  );

-- 10) Student-facing class card appearance
ALTER TABLE classes ADD COLUMN IF NOT EXISTS card_image_url text;
ALTER TABLE classes ADD COLUMN IF NOT EXISTS card_color_scheme text DEFAULT 'default';
NOTIFY pgrst, 'reload schema';

-- 11) Allow abandoned attempts (required for Restart simulation)
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

-- Done. If Save Appearance still fails: Settings → API → Reload schema.
