/**
 * PostCallCompletePanel.tsx
 * Small center-panel interstitial after a Discovery/Objections call is saved.
 * Shown under the manager handoff (and after dismiss) so clicking outside the
 * note does not leave the student on a spinner-only "Call completed" screen.
 * Forward navigation lives in TempoStageForwardNav (top right), not here.
 */

import { MaterialIcon } from "@/components/ui/MaterialIcon";

type PostCallCompletePanelProps = {
  callLengthLabel: string;
  nextStageName: string;
  isSubmitting: boolean;
};

/**
 * Saving spinner, or a compact "call done" card (Next is in the stage top bar).
 */
export function PostCallCompletePanel({
  callLengthLabel,
  nextStageName,
  isSubmitting,
}: PostCallCompletePanelProps): React.ReactElement {
  if (isSubmitting) {
    return (
      <section className="flex-1 min-w-0 flex flex-col items-center justify-center bg-surface-container-low gap-md px-lg">
        <div className="w-10 h-10 border-2 border-secondary border-t-transparent rounded-full animate-spin" />
        <p className="font-headline-md text-headline-md text-on-surface">Saving your call…</p>
        <p className="text-body-md text-on-surface-variant">Call length: {callLengthLabel}</p>
      </section>
    );
  }

  return (
    <section className="flex-1 min-w-0 flex flex-col items-center justify-center bg-surface-container-low px-lg">
      <div className="w-full max-w-md rounded-xl border border-outline-variant bg-surface-container-lowest p-6 shadow-sm space-y-5 text-center">
        <div className="mx-auto w-12 h-12 rounded-full bg-secondary-fixed/20 flex items-center justify-center">
          <MaterialIcon name="check_circle" className="text-secondary text-[28px]" />
        </div>
        <div className="space-y-1">
          <h2 className="font-headline-md text-on-surface">Call completed</h2>
          <p className="text-body-md text-on-surface-variant">
            Call length: {callLengthLabel}
          </p>
        </div>
        <p className="text-body-md text-on-surface-variant">
          Your manager left a note about what comes next. Use Next (top right) when you are ready
          to continue to {nextStageName}.
        </p>
      </div>
    </section>
  );
}
