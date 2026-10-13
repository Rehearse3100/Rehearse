/**
 * TempoExitSimulation.tsx
 * Exit Simulation for Tempo stages: returns the student to the simulation entry
 * (briefing) screen. useExitSimulation holds the navigation; the top-bar menu
 * (TempoStageMenu) and the left-column button both use it.
 */

"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

type TempoExitSimulationProps = {
  className?: string;
};

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

/**
 * Compact arrow + text exit — matches top-bar control height.
 */
export function TempoExitSimulation({
  className = "",
}: TempoExitSimulationProps): React.ReactElement {
  const handleExit = useExitSimulation();

  return (
    <button
      type="button"
      onClick={handleExit}
      className={`inline-flex items-center gap-1.5 h-8 w-fit text-[12px] font-medium tracking-wide text-on-primary/85 hover:text-on-primary transition-colors ${className}`}
    >
      <MaterialIcon name="arrow_back" className="text-[18px]" />
      Exit Simulation
    </button>
  );
}
