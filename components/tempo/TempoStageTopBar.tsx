/**
 * TempoStageTopBar.tsx
 * Shared fixed header for all Tempo stages — left brand zone, middle project
 * flow, and a content-sized right action zone (Reference Library, Handoff,
 * Restart).
 */

import Link from "next/link";
import { RestartSimulationButton } from "@/components/simulation/RestartSimulationButton";
import { TempoProjectFlow } from "@/components/tempo/TempoProjectFlow";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

const BAR_BUTTON =
  "flex items-center gap-1.5 px-3 py-1.5 font-label-sm text-label-sm rounded-lg shrink-0 transition-all duration-150";

type TempoStageTopBarProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  /** 0 = Prospecting … 4 = Negotiation */
  flowIndex: number;
  onOpenHandoff: () => void;
  /** Mobile-only dashboard exit (desktop uses left-column control). */
  onBackToDashboard: () => void;
  /** Opens the shared Reference Library drawer when provided. */
  onOpenReferenceLibrary?: () => void;
  /** Highlights the Reference Library button while the drawer is open. */
  isReferenceLibraryOpen?: boolean;
};

/**
 * Fixed Tempo simulation top bar shared across stages 1–5.
 */
export function TempoStageTopBar({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  flowIndex,
  onOpenHandoff,
  onBackToDashboard,
  onOpenReferenceLibrary,
  isReferenceLibraryOpen = false,
}: TempoStageTopBarProps): React.ReactElement {
  return (
    <header className="fixed top-0 left-0 right-0 z-[50] h-16 border-b border-border bg-page shrink-0">
      <div className="h-full flex items-stretch min-w-0">
        {/* Left zone — matches stage blue column width */}
        <div className="hidden lg:flex w-60 xl:w-[280px] shrink-0 items-center gap-3 px-4 lg:px-6 border-r border-transparent">
          <Link
            href="/student/dashboard"
            className="flex items-center gap-2 shrink-0 text-xl font-bold text-primary tracking-tight"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pitchlab-logo-new.png"
              alt="Rehearse logo"
              className="h-[1.5em] w-auto shrink-0"
            />
            <span className="hidden xl:inline">Rehearse</span>
          </Link>
        </div>

        {/* Mobile logo + back */}
        <div className="flex lg:hidden items-center gap-2 px-3 shrink-0">
          <Link
            href="/student/dashboard"
            className="flex items-center gap-2 shrink-0 text-xl font-bold text-primary tracking-tight"
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src="/pitchlab-logo-new.png"
              alt="Rehearse logo"
              className="h-[1.5em] w-auto shrink-0"
            />
          </Link>
          <button
            type="button"
            onClick={onBackToDashboard}
            className={`${BAR_BUTTON} text-on-surface-variant border border-outline-variant hover:bg-surface-container`}
          >
            <MaterialIcon name="arrow_back" className="text-[16px]" />
            <span>Back</span>
          </button>
        </div>

        {/* Middle zone — same flex space as the stage center column */}
        <div className="flex-1 min-w-0 flex items-center px-3 sm:px-4">
          <TempoProjectFlow currentIndex={flowIndex} />
        </div>

        {/* Right zone — content-sized action cluster */}
        <div className="shrink-0 flex items-center justify-end gap-2 sm:gap-3 px-3 sm:px-4 lg:px-6 w-auto">
          {onOpenReferenceLibrary ? (
            <button
              type="button"
              onClick={onOpenReferenceLibrary}
              aria-pressed={isReferenceLibraryOpen}
              className={`${BAR_BUTTON} ${
                isReferenceLibraryOpen
                  ? "text-on-surface bg-surface-container border border-outline"
                  : "text-on-surface-variant border border-outline-variant hover:bg-surface-container"
              }`}
            >
              <MaterialIcon name="menu_book" className="text-[16px]" />
              <span className="hidden sm:inline">Reference Library</span>
            </button>
          ) : null}
          <button
            type="button"
            onClick={onOpenHandoff}
            className={`${BAR_BUTTON} text-on-surface-variant border border-outline-variant hover:bg-surface-container`}
          >
            <MaterialIcon name="mail" className="text-[16px]" />
            <span className="hidden sm:inline">Handoff Note</span>
          </button>
          <RestartSimulationButton
            attemptId={attemptId}
            simulationId={simulationId}
            classId={classId}
            simulationTitle={simulationTitle}
            variant="tempoTopBar"
          />
        </div>
      </div>
    </header>
  );
}
