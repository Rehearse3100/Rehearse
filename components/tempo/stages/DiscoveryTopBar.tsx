/**
 * DiscoveryTopBar.tsx
 * Top app bar for Tempo Stage 2 Discovery — shared TempoStageTopBar shell.
 */

import { TempoStageTopBar } from "@/components/tempo/TempoStageTopBar";

type DiscoveryTopBarProps = {
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
 * Fixed header overlaying the default student header during Stage 2.
 */
export function DiscoveryTopBar({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  onOpenHandoff,
  onBackToDashboard,
  onOpenReferenceLibrary,
  isReferenceLibraryOpen,
}: DiscoveryTopBarProps): React.ReactElement {
  return (
    <TempoStageTopBar
      attemptId={attemptId}
      simulationId={simulationId}
      classId={classId}
      simulationTitle={simulationTitle}
      flowIndex={1}
      onOpenHandoff={onOpenHandoff}
      onBackToDashboard={onBackToDashboard}
      onOpenReferenceLibrary={onOpenReferenceLibrary}
      isReferenceLibraryOpen={isReferenceLibraryOpen}
    />
  );
}
