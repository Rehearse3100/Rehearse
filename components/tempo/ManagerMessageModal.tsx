/**
 * ManagerMessageModal.tsx
 * The hovering manager-message window every Tempo manager note uses: blurred
 * backdrop, "Message from your manager" bar, the manager (Alex Torres), the
 * message in a quote box, an optional block under it (e.g. what comes next), and
 * one action button. Clicking the backdrop calls onDismiss. Used by HandoffModal
 * (stage handoffs) and the Prospecting ICP review note (IcpManagerNoteModal).
 */

"use client";

import { useEffect, useState } from "react";
import { MaterialIcon } from "@/components/ui/MaterialIcon";

export type ManagerMessageModalProps = {
  /** Right side of the top bar, e.g. "Stage 2 of 5". */
  context: string;
  /** The manager's message; blank lines start a new paragraph. */
  message: string;
  /** Shown under the message (e.g. the stage that comes next). */
  children?: React.ReactNode;
  actionLabel: string;
  onAction: () => void;
  isActionDisabled?: boolean;
  onDismiss: () => void;
};

/**
 * Renders the manager message overlay with its entry animation and one action button.
 */
export function ManagerMessageModal({
  context,
  message,
  children = null,
  actionLabel,
  onAction,
  isActionDisabled = false,
  onDismiss,
}: ManagerMessageModalProps): React.ReactElement {
  const [entered, setEntered] = useState(false);
  const paragraphs = message
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  useEffect(() => {
    const timer = window.setTimeout(() => setEntered(true), 100);
    return () => window.clearTimeout(timer);
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center p-4 modal-overlay animate-overlay-in"
      onClick={onDismiss}
      role="presentation"
    >
      <div
        className={`bg-surface-container-lowest w-full max-w-[560px] rounded-xl shadow-xl overflow-hidden border border-outline-variant transition-all duration-300 ${
          entered ? "animate-modal-in" : "opacity-0 scale-95 translate-y-2"
        }`}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="handoff-modal-title"
      >
        <div className="px-4 py-2 flex justify-between items-center bg-primary-container">
          <span className="font-code-md text-[10px] tracking-widest text-on-primary uppercase">
            MESSAGE FROM YOUR MANAGER
          </span>
          <span className="font-code-md text-[10px] tracking-widest text-on-primary uppercase">{context}</span>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-full flex items-center justify-center font-headline-md bg-secondary-fixed text-on-secondary-fixed">
              AT
            </div>
            <div>
              <h2 id="handoff-modal-title" className="font-headline-md text-on-surface">
                Alex Torres
              </h2>
              <p className="font-label-sm text-on-surface-variant">Senior Sales Manager</p>
            </div>
          </div>

          <div
            className={`bg-surface-container-low p-4 rounded-r-lg border-l-4 border-tertiary-container${
              paragraphs.length > 1 ? " space-y-3 max-h-[45vh] overflow-y-auto" : ""
            }`}
          >
            {paragraphs.map((paragraph) => (
              <p key={paragraph} className="font-body-lg text-on-surface leading-relaxed italic">
                {paragraph}
              </p>
            ))}
          </div>

          {children}

          <div className="pt-2 space-y-3">
            <button
              type="button"
              onClick={onAction}
              disabled={isActionDisabled}
              className="w-full min-h-12 rounded-lg font-headline-md flex items-center justify-center gap-2 font-bold transition-all bg-primary-container text-white hover:bg-primary active:scale-[0.98]"
            >
              {actionLabel}
              <MaterialIcon name="arrow_forward" />
            </button>
          </div>
        </div>

        <div className="h-1 bg-gradient-to-r from-tertiary-container via-secondary-fixed to-secondary-container opacity-50" />
      </div>
    </div>
  );
}
