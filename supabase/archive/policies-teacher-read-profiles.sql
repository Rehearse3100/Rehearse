-- Run once if teacher leaderboard shows "Student" instead of real names.
-- Allows teachers to read profiles of students who attempted their simulations.

create policy "Teachers read profiles for their simulation attempts"
  on profiles for select
  using (
    exists (
      select 1
      from attempts a
      join simulations s on s.id = a.simulation_id
      where a.student_id = profiles.id
        and s.teacher_id = auth.uid()
    )
  );
