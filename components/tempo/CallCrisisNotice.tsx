/**
 * CallCrisisNotice.tsx
 * A short, kind note at the top of the Discovery / Objections post-call screen, shown
 * only when the call brain ended the call because the student's words sounded like a
 * crisis (endReason "crisis", hooks/useSimulationVoiceSession.ts). Points to the 988
 * Suicide and Crisis Lifeline (call or text 988). Rendered by DiscoveryStageLayout and
 * ObjectionHandlingStageLayout.
 */

import { MaterialIcon } from "@/components/ui/MaterialIcon";

/**
 * The crisis note: the call stopped, support is there, and how to reach 988.
 */
export function CallCrisisNotice(): React.ReactElement {
  return (
    <div
      role="note"
      aria-label="Support is available"
      className="shrink-0 mx-4 lg:mx-xl mt-4 rounded-xl border border-outline-variant bg-surface-container-low p-4 flex items-start gap-3"
    >
      <MaterialIcon name="favorite" className="text-secondary text-[22px] shrink-0" />
      <div className="space-y-1 min-w-0">
        <p className="text-body-md font-semibold text-on-surface">We stopped the call so you can take care of yourself.</p>
        <p className="text-body-md text-on-surface-variant">
          If you are going through something hard, you don&apos;t have to face it alone. You can{" "}
          <a href="tel:988" className="underline font-semibold text-on-surface">
            call
          </a>{" "}
          or{" "}
          <a href="sms:988" className="underline font-semibold text-on-surface">
            text
          </a>{" "}
          988 to reach the 988 Suicide and Crisis Lifeline. It&apos;s free, confidential and open 24/7.
        </p>
      </div>
    </div>
  );
}
