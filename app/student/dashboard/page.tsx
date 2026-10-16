/**
 * dashboard/page.tsx — student Home
 * Welcome + enrolled class cards with join-class tile, plus completed simulations.
 */

import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { JoinClassButton } from "@/app/student/dashboard/JoinClassButton";
import {
  StudentAttemptHistory,
  type StudentAttemptRow,
} from "@/components/StudentAttemptHistory";
import { StudentClassCard } from "@/components/StudentClassCard";
import { StudentEmptyState } from "@/components/student/StudentEmptyState";
import { DEFAULT_CLASS_ID } from "@/lib/constants";
import { loadStudentEnrolledClasses } from "@/lib/student-class-data";
import { getStudentSession } from "@/lib/student-session";
import { createServiceClient } from "@/lib/supabase/server";

export const metadata: Metadata = {
  title: "Home — Rehearse",
};

/**
 * Student home — welcome, class cards, and completed simulation history.
 */
export default async function StudentDashboardPage(): Promise<React.ReactElement> {
  const session = await getStudentSession();
  if (!session) {
    redirect("/student-login");
  }

  const enrolledClasses = await loadStudentEnrolledClasses(session.studentId);

  const supabase = createServiceClient();
  const { data: completedAttempts } = await supabase
    .from("attempts")
    // No persona name: it can give away the right contact.
    .select("id, total_score, completed_at, simulations ( id, title )")
    .eq("student_id", session.studentId)
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(20);

  const history: StudentAttemptRow[] = (completedAttempts ?? []).map((row) => {
    const sim = row.simulations;
    const simulation = Array.isArray(sim) ? sim[0] ?? null : sim;
    return {
      id: row.id as string,
      total_score: row.total_score as number,
      completed_at: row.completed_at as string | null,
      simulations: simulation as StudentAttemptRow["simulations"],
    };
  });

  return (
    <div className="animate-fade-in-up">
      <div className="max-w-[1440px] mx-auto px-4 sm:px-8 py-8 space-y-8">
        <header>
          <h1 className="font-display text-display text-on-surface">
            Welcome back, {session.displayName}
          </h1>
          <p className="text-on-surface-variant font-body-md mt-1">
            {enrolledClasses.length === 0
              ? "Join a class to get started."
              : enrolledClasses.length === 1
                ? "Open your class to start a simulation."
                : `${enrolledClasses.length} classes — open one to view simulations.`}
          </p>
        </header>

        <section>
          {enrolledClasses.length === 0 ? (
            <StudentEmptyState
              icon="school"
              heading="No classes yet"
              description="You haven't joined any classes yet. Enter your professor's class code to get started."
              action={<JoinClassButton variant="empty" />}
            />
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              {enrolledClasses.map((cls) => (
                <StudentClassCard
                  key={cls.classId}
                  classId={cls.classId}
                  className={cls.className}
                  description={cls.description}
                  cardImageUrl={cls.cardImageUrl}
                  cardColorScheme={cls.cardColorScheme}
                  simulationCount={cls.simulationCount}
                  isSystemDefault={cls.classId === DEFAULT_CLASS_ID}
                />
              ))}
              <JoinClassButton variant="tile" />
            </div>
          )}
        </section>

        <section className="space-y-4">
          <h2 className="font-headline-lg text-headline-lg text-on-surface">
            My completed simulations
          </h2>
          <StudentAttemptHistory attempts={history} />
        </section>
      </div>
    </div>
  );
}
