/**
 * TempoExitSimulation.tsx
 * Exit Simulation for Tempo stages: returns the student to the simulation entry
 * (briefing) screen. Used by the top-bar menu (TempoStageMenu).
 */

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Returns the Exit Simulation handler: the briefing screen for the current
 * class, or the dashboard when the URL has no classId.
 */
export function useExitSimulation(): () => void {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (): void => {
    // Stage pages live at /student/simulation/[id]; the briefing screen is /entry.
    const classId = searchParams.get("classId")?.trim() ?? "";
    router.push(
      classId ? `${pathname}/entry?classId=${classId}` : "/student/dashboard"
    );
  };
}
