/**
 * HandoffModal.tsx
 * Manager handoff modal for Tempo simulation stages, on the shared
 * ManagerMessageModal window: the manager's message, then the stage that comes
 * next with its AI rule, and Begin Stage.
 * Overlays the page with blur backdrop; student must click Begin Stage to proceed.
 * No CRM gates: Begin Stage is always available. The CRM stays reachable from
 * the top-bar menu and the Prospecting lead step.
 */

"use client";

import { ManagerMessageModal } from "@/components/tempo/ManagerMessageModal";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type HandoffModalProps = {
  stageNumber: number;
  stageName: string;
  stageIcon: string;
  message: string;
  hasAIRestriction: boolean;
  onBegin: () => void;
  onDismiss: () => void;
  /** @deprecated CRM gates removed; ignored. */
  justCompletedStage?: string | null;
  /** @deprecated CRM gates removed; ignored. */
  crmLogExists?: boolean;
  /** @deprecated CRM gates removed; ignored. */
  onOpenCrmForStage?: (stage: string) => void;
  /** @deprecated CRM gates removed; ignored. */
  testBypass?: boolean;
};

/**
 * Renders the manager handoff overlay with entry animation and the Begin Stage button.
 */
export function HandoffModal({
  stageNumber,
  stageName,
  stageIcon,
  message,
  hasAIRestriction,
  onBegin,
  onDismiss,
}: HandoffModalProps): React.ReactElement {
  return (
    <ManagerMessageModal
      context={`Stage ${stageNumber} of 5`}
      message={message}
      actionLabel={`Begin Stage ${stageNumber}`}
      onAction={onBegin}
      onDismiss={onDismiss}
    >
      <div className="bg-secondary-fixed/10 border border-secondary-fixed/20 p-4 rounded-lg flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 bg-secondary-fixed/20 rounded-lg flex items-center justify-center shrink-0">
            <MaterialIcon name={stageIcon} className="text-secondary" />
          </div>
          <div className="min-w-0">
            <p className="font-label-sm text-secondary uppercase tracking-tight">Up next</p>
            <h3 className="font-headline-md text-on-surface">
              Stage {stageNumber}: {stageName}
            </h3>
          </div>
        </div>
        {!hasAIRestriction ? (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-green-100 rounded-full shrink-0">
            <div className="w-1.5 h-1.5 bg-green-600 rounded-full" />
            <span className="text-[11px] font-bold text-green-700 uppercase">
              No AI restrictions
            </span>
          </div>
        ) : (
          <div className="flex items-center gap-1.5 px-2 py-1 bg-amber-100 rounded-full shrink-0">
            <div className="w-1.5 h-1.5 bg-amber-600 rounded-full" />
            <span className="text-[11px] font-bold text-amber-800 uppercase">No AI on call</span>
          </div>
        )}
      </div>
    </ManagerMessageModal>
  );
}
