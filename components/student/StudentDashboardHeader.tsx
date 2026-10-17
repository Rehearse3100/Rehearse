/**
 * StudentDashboardHeader.tsx
 * Top app bar for the student portal — Stitch visual treatment. The tester
 * shortcuts dropdown shows only when the server passes testBypass (the
 * TEMPO_TEST_BYPASS_GATES flag); this client file never reads process.env.
 */

"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { DEFAULT_CLASS_ID, TEMPO_SIMULATION_ID } from "@/lib/constants";
import { TestShortcutsDropdown } from "@/app/student/dashboard/TestShortcutsDropdown";

type StudentDashboardHeaderProps = {
  displayName: string;
  classCount: number;
  /** Server boolean from TEMPO_TEST_BYPASS_GATES — shows the tester shortcuts dropdown. */
  testBypass: boolean;
};

/**
 * Sticky header with logo, user info, the tester shortcuts (bypass flag only) and logout.
 */
export function StudentDashboardHeader({
  displayName,
  classCount,
  testBypass,
}: StudentDashboardHeaderProps): React.ReactElement {
  const router = useRouter();

  const handleLogout = async (): Promise<void> => {
    await fetch("/api/student/logout", { method: "POST" });
    router.push("/student-login");
    router.refresh();
  };

  const subtitle =
    classCount === 0
      ? "Student"
      : classCount === 1
        ? "1 class enrolled"
        : `${classCount} classes enrolled`;

  return (
    <header className="bg-surface-container-lowest h-16 w-full shrink-0 z-50 shadow-sm border-b border-outline-variant">
      <div className="flex justify-between items-center w-full h-16 px-4 sm:px-8">
        <Link
          href="/student/dashboard"
          className="flex items-center gap-2 font-headline-lg text-headline-lg text-on-surface"
        >
          <img
            src="/pitchlab-logo-new.png"
            alt="Rehearse logo"
            className="h-7 w-auto shrink-0"
          />
          <span className="hidden sm:inline">Rehearse</span>
        </Link>

        <div className="flex items-center gap-3 sm:gap-4">
          <div className="flex items-center gap-2 sm:gap-3 border-l border-outline-variant pl-3 sm:pl-4">
            <div className="hidden md:block text-right">
              <p className="font-label-md text-label-md text-on-surface">{displayName}</p>
              <p className="font-label-sm text-label-sm text-on-surface-variant">{subtitle}</p>
            </div>
            <div
              className="w-10 h-10 rounded-full bg-secondary-container flex items-center justify-center text-on-secondary-container font-bold text-sm border border-outline-variant shrink-0"
              aria-hidden
            >
              {displayName.charAt(0).toUpperCase()}
            </div>
          </div>

          {testBypass ? (
            <TestShortcutsDropdown
              simulationId={TEMPO_SIMULATION_ID}
              classId={DEFAULT_CLASS_ID}
              compact
            />
          ) : null}

          <button
            type="button"
            onClick={() => void handleLogout()}
            className="text-on-surface-variant hover:text-secondary transition-colors hover:bg-on-primary-container/10 p-1 rounded-xl duration-300"
            aria-label="Logout"
            title="Logout"
          >
            <span className="material-symbols-outlined">logout</span>
          </button>
        </div>
      </div>
    </header>
  );
}
