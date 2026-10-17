/**
 * StudentPortalShell.tsx
 * Full-viewport student layout — header, optional sidebar, scrollable main content.
 * Sidebar hidden during active simulation stages (full-screen runner).
 */

"use client";

import { usePathname } from "next/navigation";
import { StudentDashboardHeader } from "./StudentDashboardHeader";
import { StudentShellProvider } from "./StudentShellProvider";
import { StudentSidebar } from "./StudentSidebar";

type StudentPortalShellProps = {
  displayName: string;
  classCount: number;
  /** Server layout boolean from TEMPO_TEST_BYPASS_GATES — shows the tester shortcuts. */
  testBypass: boolean;
  children: React.ReactNode;
};

/**
 * Returns true when the student is inside the live simulation runner (no chrome).
 */
function shouldHideSidebar(pathname: string): boolean {
  return /^\/student\/simulation\/[^/]+$/.test(pathname);
}

/**
 * Tempo briefing entry — hero/footer are primary-container; match scrollport so
 * rubber-band overscroll stays blue instead of flashing the light page background.
 */
function isTempoEntryPage(pathname: string): boolean {
  return /^\/student\/simulation\/[^/]+\/entry\/?$/.test(pathname);
}

/**
 * Wraps authenticated student pages with portal chrome.
 */
export function StudentPortalShell({
  displayName,
  classCount,
  testBypass,
  children,
}: StudentPortalShellProps): React.ReactElement {
  const pathname = usePathname();
  const hideSidebar = shouldHideSidebar(pathname);
  const tempoEntry = isTempoEntryPage(pathname);

  return (
    <StudentShellProvider>
      <div className="fixed inset-0 z-40 flex flex-col bg-surface overflow-hidden font-body-md text-body-md text-on-surface">
        {!hideSidebar && (
          <StudentDashboardHeader displayName={displayName} classCount={classCount} testBypass={testBypass} />
        )}
        <div className="flex flex-1 min-h-0 overflow-hidden">
          {!hideSidebar && <StudentSidebar />}
          <main
            className={`flex-1 overflow-y-auto custom-scrollbar ${
              tempoEntry ? "bg-primary-container" : "bg-background"
            }`}
          >
            {children}
          </main>
        </div>
      </div>
    </StudentShellProvider>
  );
}
