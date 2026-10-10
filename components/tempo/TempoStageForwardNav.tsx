/**
 * TempoStageForwardNav.tsx
 * Shared top-right forward control for Tempo stage screens.
 * One forward button per step: "Next", or "Submit" when completing a stage.
 */

"use client";

import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type TempoStageForwardLabel = "Next" | "Submit";

type TempoStageForwardNavProps = {
  forwardLabel?: TempoStageForwardLabel;
  forwardDisabled?: boolean;
  onForward: () => void;
  isForwardLoading?: boolean;
  /** Shown left of the forward button when the gate blocks (desktop). */
  forwardHint?: string | null;
  onBack?: () => void;
  backDisabled?: boolean;
  backLabel?: string;
  /** Extra actions immediately left of Back / Next (e.g. Save Draft). */
  actions?: React.ReactNode;
};

/**
 * Renders optional actions, Back, hint, and the single forward button.
 */
export function TempoStageForwardNav({
  forwardLabel = "Next",
  forwardDisabled = false,
  onForward,
  isForwardLoading = false,
  forwardHint = null,
  onBack,
  backDisabled = false,
  backLabel = "Back",
  actions = null,
}: TempoStageForwardNavProps): React.ReactElement {
  const disabled = forwardDisabled || isForwardLoading;

  return (
    <div className="flex items-center gap-md shrink-0">
      {actions}
      {onBack ? (
        <button
          type="button"
          onClick={onBack}
          disabled={backDisabled}
          className="inline-flex items-center gap-1 text-label-sm text-on-surface-variant hover:text-primary transition-colors shrink-0 disabled:opacity-40 disabled:pointer-events-none"
        >
          <MaterialIcon name="arrow_back" className="text-[16px]" />
          {backLabel}
        </button>
      ) : null}
      {forwardHint ? (
        <span className="hidden sm:inline text-label-sm text-on-surface-variant">{forwardHint}</span>
      ) : null}
      <button
        type="button"
        disabled={disabled}
        onClick={onForward}
        className={`px-lg py-sm rounded-lg font-bold text-label-md flex items-center gap-xs transition-all ${
          !disabled
            ? forwardLabel === "Submit"
              ? "bg-tertiary-fixed text-on-tertiary-fixed hover:brightness-95 active:scale-95 cursor-pointer shadow-md"
              : "bg-primary-container text-white hover:bg-primary shadow-md cursor-pointer"
            : "bg-surface-container-highest text-on-surface-variant/40 cursor-not-allowed"
        }`}
      >
        {isForwardLoading ? "Submitting..." : forwardLabel}
        <MaterialIcon
          name={forwardLabel === "Submit" ? "send" : "arrow_forward"}
          className="text-[18px]"
        />
      </button>
    </div>
  );
}
