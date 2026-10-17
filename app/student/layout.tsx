/**
 * layout.tsx — student section
 * JWT session auth with professor-style sidebar shell and dashboard header.
 */

export const dynamic = "force-dynamic";

import { redirect } from "next/navigation";
import { StudentPortalShell } from "@/components/student/StudentPortalShell";
import { loadStudentEnrolledClasses } from "@/lib/student-class-data";
import { getStudentSession } from "@/lib/student-session";
import { isGateBypassEnabled } from "@/lib/tempo-test-bypass";

/**
 * Student layout wrapper — portal shell with sidebar navigation.
 */
export default async function StudentLayout({
  children,
}: {
  children: React.ReactNode;
}): Promise<React.ReactElement> {
  const session = await getStudentSession();
  if (!session) {
    redirect("/student-login");
  }

  const enrolledClasses = await loadStudentEnrolledClasses(session.studentId);

  // Server-read flag, passed down as a boolean (client code never reads process.env).
  return (
    <StudentPortalShell
      displayName={session.displayName}
      classCount={enrolledClasses.length}
      testBypass={isGateBypassEnabled()}
    >
      {children}
    </StudentPortalShell>
  );
}
