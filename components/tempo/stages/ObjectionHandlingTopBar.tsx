/**
 * ObjectionHandlingTopBar.tsx
 * Top app bar for Tempo Stage 4 Objection Handling — shared TempoStageTopBar shell.
 */

import { TempoStageTopBar } from "@/components/tempo/TempoStageTopBar";

type ObjectionHandlingTopBarProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  onOpenHandoff: () => void;
  onOpenReferenceLibrary?: () => void;
  isReferenceLibraryOpen?: boolean;
};

/**
 * Fixed header overlaying the default student header during Stage 4.
 */
export function ObjectionHandlingTopBar({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  onOpenHandoff,
  onOpenReferenceLibrary,
  isReferenceLibraryOpen,
}: ObjectionHandlingTopBarProps): React.ReactElement {
  return (
    <TempoStageTopBar
      attemptId={attemptId}
      simulationId={simulationId}
      classId={classId}
      simulationTitle={simulationTitle}
      flowIndex={3}
      onOpenHandoff={onOpenHandoff}
      onOpenReferenceLibrary={onOpenReferenceLibrary}
      isReferenceLibraryOpen={isReferenceLibraryOpen}
    />
  );
}
