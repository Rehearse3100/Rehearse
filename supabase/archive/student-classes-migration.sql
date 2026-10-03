-- Rehearse multi-class student auth — run in Supabase SQL editor in this exact order

-- Step 1: Create the new junction table FIRST
CREATE TABLE student_classes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES students(id) ON DELETE CASCADE,
  class_id uuid REFERENCES classes(id) ON DELETE CASCADE,
  professor_id uuid REFERENCES profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now(),
  UNIQUE(student_id, class_id)
);

-- Step 2: Migrate existing data into junction table
INSERT INTO student_classes (student_id, class_id, professor_id)
SELECT id, class_id, professor_id
FROM students
WHERE class_id IS NOT NULL;

-- Step 3: Drop policy + constraint that depend on legacy columns
DROP POLICY IF EXISTS "professors_read_their_students" ON students;
ALTER TABLE students DROP CONSTRAINT IF EXISTS students_class_id_username_key;

-- Step 4: Remove class_id and professor_id from students table
ALTER TABLE students DROP COLUMN IF EXISTS class_id;
ALTER TABLE students DROP COLUMN IF EXISTS professor_id;

-- Step 5: Make username globally unique (not per class)
ALTER TABLE students ADD CONSTRAINT students_username_unique UNIQUE (username);

-- Step 6: Update attempts table to use student_classes
ALTER TABLE attempts
  ADD COLUMN IF NOT EXISTS student_class_id uuid REFERENCES student_classes(id);

-- Backfill student_class_id from existing class_id + student_id
UPDATE attempts a
SET student_class_id = sc.id
FROM student_classes sc
WHERE a.student_class_id IS NULL
  AND a.class_id IS NOT NULL
  AND a.student_id IS NOT NULL
  AND sc.student_id = a.student_id
  AND sc.class_id = a.class_id;

-- Step 7: Grants + RLS on student_classes
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

-- Professors read enrollments via student_classes (policy created above)
