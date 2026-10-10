/**
 * PresentationTopBar.tsx
 * Top app bar for Tempo Stage 3 Presentation — shared TempoStageTopBar shell.
 */

import { TempoStageTopBar } from "@/components/tempo/TempoStageTopBar";

type PresentationTopBarProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  onOpenHandoff: () => void;
  onBackToDashboard: () => void;
  onOpenReferenceLibrary?: () => void;
  isReferenceLibraryOpen?: boolean;
};

/**
 * Fixed header overlaying the default student header during Stage 3.
 */
export function PresentationTopBar({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  onOpenHandoff,
  onBackToDashboard,
  onOpenReferenceLibrary,
  isReferenceLibraryOpen,
}: PresentationTopBarProps): React.ReactElement {
  return (
    <TempoStageTopBar
      attemptId={attemptId}
      simulationId={simulationId}
      classId={classId}
      simulationTitle={simulationTitle}
      flowIndex={2}
      onOpenHandoff={onOpenHandoff}
      onBackToDashboard={onBackToDashboard}
      onOpenReferenceLibrary={onOpenReferenceLibrary}
      isReferenceLibraryOpen={isReferenceLibraryOpen}
    />
  );
}
