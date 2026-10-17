/**
 * TempoWizardTopBar.tsx
 * Top navigation for the Tempo prospecting wizard — wraps shared TempoStageTopBar.
 */

import { TempoStageTopBar } from "@/components/tempo/TempoStageTopBar";

type TempoWizardTopBarProps = {
  attemptId: string;
  simulationId: string;
  classId: string;
  simulationTitle: string;
  onOpenHandoff: () => void;
  onOpenReferenceLibrary?: () => void;
  isReferenceLibraryOpen?: boolean;
};

/**
 * Fixed header for Stage 1 Prospecting.
 */
export function TempoWizardTopBar({
  attemptId,
  simulationId,
  classId,
  simulationTitle,
  onOpenHandoff,
  onOpenReferenceLibrary,
  isReferenceLibraryOpen,
}: TempoWizardTopBarProps): React.ReactElement {
  return (
    <TempoStageTopBar
      attemptId={attemptId}
      simulationId={simulationId}
      classId={classId}
      simulationTitle={simulationTitle}
      flowIndex={0}
      onOpenHandoff={onOpenHandoff}
      onOpenReferenceLibrary={onOpenReferenceLibrary}
      isReferenceLibraryOpen={isReferenceLibraryOpen}
    />
  );
}
